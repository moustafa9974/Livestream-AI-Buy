import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { applyCapture } from "@/lib/commerce/checkout";
import { audit } from "@/lib/commerce/db";
import { prisma } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { getEnv } from "@/lib/env";
import { killAllKernelSessions } from "@/lib/kernel/watcher";
import { matchDetection, matchNewlyVisible } from "@/lib/matching/match";
import { currentStreamFor } from "@/lib/rail";
import { emitRailChanged } from "@/lib/realtime/bus";
import { getCurrentCreator } from "@/lib/session";
import { clearRuntimeSettings, setRuntimeSettings } from "@/lib/settings";
import { processFrame } from "@/lib/vision/process-frame";
import { dHashFromJpeg } from "@/lib/vision/server-hash";

/**
 * Demo control panel actions (SPEC §8). Only with DEMO_MODE=true. These exist so a live
 * demo survives a bad network, an empty free quota or a nervous presenter.
 */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reset") }),
  z.object({ action: z.literal("inject_frame") }),
  z.object({ action: z.literal("force_detection"), productId: z.string().min(1) }),
  z.object({ action: z.literal("simulate_sale"), productId: z.string().min(1) }),
  z.object({
    action: z.literal("settings"),
    commissionHoldHours: z.number().int().min(0).max(720).nullable().optional(),
    aiProvider: z.enum(["gemini", "ollama", "claude"]).nullable().optional(),
  }),
  z.object({ action: z.literal("kill_kernel") }),
]);

const FIXTURE = path.join(process.cwd(), "e2e", "fixtures", "mug-search-screen.jpg");

async function liveDemoStream(creatorId: string) {
  const stream = await currentStreamFor(creatorId);
  if (!stream) throw new Error("No stream");
  if (stream.status !== "live") {
    const now = new Date();
    return prisma.stream.update({
      where: { id: stream.id },
      data: { status: "live", startedAt: stream.startedAt ?? now, consentOwnContent: true, consentAt: now },
    });
  }
  return stream;
}

/** Constant-time check of the optional demo key (public deployments set DEMO_PANEL_KEY). */
function demoKeyOk(req: Request): boolean {
  const expected = getEnv().DEMO_PANEL_KEY;
  if (!expected) return true;
  const given = req.headers.get("x-demo-key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!getEnv().DEMO_MODE) return Response.json({ error: "Demo mode is off" }, { status: 404 });
  if (!demoKeyOk(req)) return Response.json({ error: "Demo key required", code: "DEMO_KEY" }, { status: 401 });
  try {
    const creator = await getCurrentCreator();
    if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
    const body = Body.parse(await req.json());

    switch (body.action) {
      case "reset": {
        await killAllKernelSessions().catch(() => 0);
        await clearRuntimeSettings();
        const r = await seedDemo(prisma);
        return Response.json({ ok: true, ...r.counts });
      }

      case "inject_frame": {
        // A known frame (a screen of mugs) through the real pipeline: AI or cache.
        const stream = await liveDemoStream(creator.id);
        const jpeg = readFileSync(FIXTURE);
        const out = await processFrame({
          streamId: stream.id,
          tsSec: Math.round((Date.now() - (stream.startedAt?.getTime() ?? Date.now())) / 1000),
          dHash: dHashFromJpeg(jpeg),
          imageJpegBase64: jpeg.toString("base64"),
        });
        after(() => matchNewlyVisible(stream.id, out.newlyVisibleIds));
        return Response.json({ ok: true, source: out.source, items: out.itemsSeen, note: out.note ?? null });
      }

      case "force_detection": {
        // Bypasses the AI entirely (zero quota): a visible detection for a catalog product.
        const p = await prisma.partnerProduct.findUniqueOrThrow({ where: { id: body.productId } });
        const stream = await liveDemoStream(creator.id);
        const at = Math.round((Date.now() - (stream.startedAt?.getTime() ?? Date.now())) / 1000);
        const d = await prisma.detection.create({
          data: {
            streamId: stream.id,
            label: p.title.split(":")[0].toLowerCase(),
            category: p.category,
            attributes: p.attributes ?? {},
            confidence: 0.99,
            hits: 2,
            firstSeenSec: at,
            lastSeenSec: at,
            state: "visible",
            bbox: [0.3, 0.25, 0.4, 0.5],
          },
        });
        await audit(prisma, { entityType: "Detection", entityId: d.id, type: "detection.forced", source: "system", payload: { productId: p.id } });
        await matchDetection(d.id, "cached");
        emitRailChanged(stream.id);
        return Response.json({ ok: true, detectionId: d.id });
      }

      case "simulate_sale": {
        // A sale with NO money: no PayPal call, fake capture id, clearly labelled. Exercises
        // the commission ledger, ticker and Zapier events when PayPal is unavailable.
        const p = await prisma.partnerProduct.findUniqueOrThrow({ where: { id: body.productId } });
        const stream = await liveDemoStream(creator.id);
        const viewer = await prisma.viewerSession.create({ data: { anonId: `sim-${crypto.randomUUID()}` } });
        const attribution = await prisma.attribution.create({
          data: { streamId: stream.id, partnerProductId: p.id, viewerSessionId: viewer.id, tsSec: 0 },
        });
        const order = await prisma.order.create({
          data: {
            viewerSessionId: viewer.id,
            attributionId: attribution.id,
            items: [{ partnerProductId: p.id, title: p.title, unitMinor: p.priceMinor, quantity: 1 }],
            subtotalMinor: p.priceMinor,
            totalMinor: p.priceMinor,
            currency: p.currency,
            paypalOrderId: `SIM-ORDER-${crypto.randomUUID()}`,
          },
        });
        await audit(prisma, { entityType: "Order", entityId: order.id, type: "order.simulated", source: "system" });
        const res = await applyCapture({
          orderId: order.id,
          capture: { id: `SIM-CAPTURE-${crypto.randomUUID()}`, status: "COMPLETED" },
          source: "system",
        });
        return Response.json({ ok: true, ...res });
      }

      case "settings": {
        const value = await setRuntimeSettings({
          commissionHoldHours: body.commissionHoldHours ?? undefined,
          aiProvider: body.aiProvider ?? undefined,
        });
        return Response.json({ ok: true, settings: value });
      }

      case "kill_kernel":
        return Response.json({ ok: true, stopped: await killAllKernelSessions() });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
