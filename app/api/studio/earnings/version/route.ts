import { prisma } from "@/lib/db";
import { getCurrentCreator } from "@/lib/session";

/**
 * Cheap change detector for the live earnings page: changes when a sale is added or any
 * commission/order changes (paid, refunded, reversed). The page polls this and only
 * re-fetches the full earnings when it moves.
 */
export async function GET() {
  const creator = await getCurrentCreator();
  if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
  const [commissions, orders] = await Promise.all([
    prisma.commission.aggregate({ where: { creatorId: creator.id }, _count: true, _max: { updatedAt: true } }),
    prisma.order.aggregate({ where: { commissions: { some: { creatorId: creator.id } } }, _max: { updatedAt: true } }),
  ]);
  const version = `${commissions._count}:${commissions._max.updatedAt?.getTime() ?? 0}:${orders._max?.updatedAt?.getTime() ?? 0}`;
  return Response.json({ version }, { headers: { "Cache-Control": "no-store" } });
}
