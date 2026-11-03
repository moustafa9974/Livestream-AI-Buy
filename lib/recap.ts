import { generate } from "./ai/text";
import { prisma } from "./db";
import { formatMoney, sumMinor } from "./money";
import { notify } from "./notify";

/**
 * Stream recap (SPEC §6.4): the numbers are computed here from the DB; the AI only
 * writes a short, friendly headline around them and is told never to state numbers
 * itself, so a recap can't misreport earnings. Falls back to a template when the AI is
 * unavailable.
 */

export interface RecapMoment {
  detectionId: string;
  label: string;
  atSec: number;
  sales: number;
  productTitle: string | null;
}

export interface RecapStats {
  durationMin: number;
  products: number;
  sales: number;
  earnedMinor: number;
  currency: string;
  moments: RecapMoment[];
}

export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export async function recapStats(streamId: string): Promise<RecapStats> {
  const stream = await prisma.stream.findUniqueOrThrow({ where: { id: streamId } });
  const [detections, commissions] = await Promise.all([
    prisma.detection.findMany({
      where: { streamId, state: { in: ["visible", "pinned"] } },
      include: {
        matches: { where: { source: "partner" }, include: { partnerProduct: true } },
        attributions: { include: { orders: { where: { status: { in: ["CAPTURED", "PARTIALLY_REFUNDED"] } } } } },
      },
    }),
    prisma.commission.findMany({ where: { order: { attribution: { streamId } }, status: { not: "REVERSED" } } }),
  ]);

  const moments: RecapMoment[] = detections
    .map((d) => ({
      detectionId: d.id,
      label: d.label,
      atSec: d.firstSeenSec,
      sales: d.attributions.reduce((n, a) => n + a.orders.length, 0),
      productTitle: d.matches[0]?.partnerProduct?.title ?? null,
    }))
    .sort((a, b) => b.sales - a.sales || a.atSec - b.atSec);

  const start = stream.startedAt ?? stream.createdAt;
  const end = stream.endedAt ?? new Date();
  return {
    durationMin: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000)),
    products: detections.length,
    sales: commissions.length,
    earnedMinor: sumMinor(commissions.map((c) => c.amountMinor - c.reversedMinor)),
    currency: commissions[0]?.currency ?? "USD",
    moments,
  };
}

export function statsLine(s: RecapStats): string {
  const best = s.moments[0];
  return (
    `Your ${s.durationMin}-min stream: ${s.products} products, ${s.sales} sales, ${formatMoney(s.earnedMinor, s.currency)} earned.` +
    (best ? ` Best moment: ${mmss(best.atSec)}, the ${best.label}.` : "")
  );
}

/**
 * The same facts for the public recap page. Viewers and anyone the link is shared with
 * see sales activity, never what the creator earned (that stays in the studio).
 */
export function publicStatsLine(s: RecapStats): string {
  const best = s.moments[0];
  return (
    `A ${s.durationMin}-min stream: ${s.products} products shown, ${s.sales} sold.` +
    (best ? ` Best moment: ${mmss(best.atSec)}, the ${best.label}.` : "")
  );
}

/** Generates (or regenerates) the recap headline and notifies the creator. */
export async function generateRecap(streamId: string): Promise<string> {
  const stream = await prisma.stream.findUniqueOrThrow({ where: { id: streamId }, include: { creator: true } });
  const stats = await recapStats(streamId);
  let headline: string;
  try {
    const res = await generate({
      systemInstruction:
        "You write one upbeat, shareable sentence (max 22 words) celebrating a creator's shoppable livestream. " +
        "Do NOT include any numbers, prices or amounts: those are shown separately. Mention one product from the list by name. " +
        "Plain text only, no hashtags, no emojis except at most one at the end.",
      contents: [
        {
          role: "user",
          parts: [{ text: `Stream title: ${stream.title}\nProducts featured: ${stats.moments.slice(0, 5).map((m) => m.label).join(", ") || "none"}` }],
        },
      ],
      timeoutMs: 12_000,
    });
    // Strip digits defensively: numbers must only ever come from statsLine().
    headline = (res.text ?? "").replace(/\d/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  } catch {
    headline = "";
  }
  if (!headline) headline = `${stream.title}: everything on screen was shoppable, and it showed.`;

  await prisma.stream.update({ where: { id: streamId }, data: { recapText: headline, recapAt: new Date() } });
  await notify(stream.creatorId, "stream.recap", {
    title: "Your stream recap is ready",
    body: statsLine(stats),
    data: { streamId, sales: stats.sales, earnedMinor: stats.earnedMinor, currency: stats.currency, recapPath: `/recap/${streamId}` },
  });
  return headline;
}
