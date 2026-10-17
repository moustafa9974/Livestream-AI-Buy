import { peek } from "@/lib/budget";
import { prisma } from "@/lib/db";
import { sumMinor } from "@/lib/money";
import { getCurrentCreator } from "@/lib/session";

/** Studio live ticker: today's sales/earnings, latest sales, free-tier budget state. Polled. */
export async function GET() {
  const creator = await getCurrentCreator();
  if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [today, recent, unread, gemini] = await Promise.all([
    prisma.commission.findMany({ where: { creatorId: creator.id, createdAt: { gte: startOfDay }, status: { not: "REVERSED" } } }),
    prisma.commission.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { order: true },
    }),
    prisma.notification.count({ where: { creatorId: creator.id, readAt: null } }),
    peek("gemini"),
  ]);
  return Response.json({
    todaySales: today.length,
    todayEarnedMinor: sumMinor(today.map((c) => c.amountMinor - c.reversedMinor)),
    currency: today[0]?.currency ?? recent[0]?.currency ?? "USD",
    recent: recent.map((c) => ({
      id: c.id,
      title: (c.order.items as unknown as Array<{ title?: string }>)[0]?.title ?? "Sale",
      amountMinor: c.amountMinor - c.reversedMinor,
      currency: c.currency,
      at: c.createdAt.toISOString(),
    })),
    unreadNotifications: unread,
    budget: { mode: gemini.mode, usedToday: gemini.usage.day, limitPerDay: gemini.limits.perDay ?? null },
  });
}
