import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { isZapierHookUrl, notify } from "@/lib/notify";
import { getCurrentCreator } from "@/lib/session";

const Body = z.object({
  // "" clears it. Only Zapier Catch Hook URLs are accepted (no arbitrary webhooks = no SSRF).
  zapierWebhookUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || isZapierHookUrl(v), "Paste a Zapier Catch Hook URL (https://hooks.zapier.com/hooks/catch/…)")
    .optional(),
  sendTest: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  try {
    const creator = await getCurrentCreator();
    if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
    const body = Body.parse(await req.json());
    if (body.zapierWebhookUrl !== undefined) {
      await prisma.creator.update({ where: { id: creator.id }, data: { zapierWebhookUrl: body.zapierWebhookUrl || null } });
    }
    if (body.sendTest) {
      await notify(creator.id, "sale.created", {
        title: "Test event from Seen",
        body: "If you can read this in Zapier, your Zap is connected.",
        data: { test: true, product: "Speckled Stoneware Mug", commissionMinor: 220, currency: "USD" },
      });
      const last = await prisma.notification.findFirst({ where: { creatorId: creator.id }, orderBy: { createdAt: "desc" } });
      return Response.json({ ok: true, zapierStatus: last?.zapierStatus ?? null });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
