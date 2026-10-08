import { prisma } from "./db";
import { getCurrentCreator } from "./session";

/** Returns the stream if the signed-in creator owns it, else null (callers answer 404). */
export async function getOwnedStream(streamId: string) {
  const creator = await getCurrentCreator();
  if (!creator) return null;
  const stream = await prisma.stream.findUnique({ where: { id: streamId } });
  return stream && stream.creatorId === creator.id ? stream : null;
}

export async function getOwnedDetection(detectionId: string) {
  const creator = await getCurrentCreator();
  if (!creator) return null;
  const d = await prisma.detection.findUnique({ where: { id: detectionId }, include: { stream: true } });
  return d && d.stream.creatorId === creator.id ? d : null;
}
