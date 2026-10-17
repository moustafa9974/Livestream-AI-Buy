import { prisma } from "@/lib/db";
import { getCurrentCreator } from "@/lib/session";

/** In-app notification center (also the Zapier fallback). */
export async function GET() {
  const creator = await getCurrentCreator();
  if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
  const items = await prisma.notification.findMany({
    where: { creatorId: creator.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return Response.json({
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      zapierStatus: n.zapierStatus,
      read: !!n.readAt,
      at: n.createdAt.toISOString(),
    })),
  });
}

/** Mark all as read. */
export async function POST() {
  const creator = await getCurrentCreator();
  if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
  await prisma.notification.updateMany({ where: { creatorId: creator.id, readAt: null }, data: { readAt: new Date() } });
  return Response.json({ ok: true });
}
