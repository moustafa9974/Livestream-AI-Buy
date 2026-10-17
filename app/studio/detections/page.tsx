import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentStreamFor } from "@/lib/rail";
import { getCurrentCreator } from "@/lib/session";

/** /studio/detections → the current stream's detections grid. */
export default function DetectionsIndex() {
  return (
    <Suspense fallback={<p className="p-8 text-muted-foreground">Loading…</p>}>
      <Go />
    </Suspense>
  );
}

async function Go(): Promise<null> {
  await connection();
  const creator = await getCurrentCreator();
  const stream = creator ? await currentStreamFor(creator.id) : null;
  redirect(stream ? `/studio/stream/${stream.id}/detections` : "/studio");
}
