import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/app/page-header";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getRuntimeSettings } from "@/lib/settings";
import { DemoPanel } from "./demo-panel";

export default function DemoPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  await connection();
  const env = getEnv();
  if (!env.DEMO_MODE) return <p>The demo control panel isn&apos;t available.</p>;
  const [products, settings, kernelRunning] = await Promise.all([
    prisma.partnerProduct.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true } }),
    getRuntimeSettings(),
    prisma.kernelSession.count({ where: { status: "running" } }),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Presenter tools"
        title="Demo control panel"
        description="Presenter tools: reset the demo, show a product instantly, or record a sale without a payment."
      />
      <DemoPanel
        products={products}
        holdHours={settings.commissionHoldHours ?? env.COMMISSION_HOLD_HOURS}
        holdOverridden={settings.commissionHoldHours !== undefined}
        kernelRunning={kernelRunning}
      />
    </>
  );
}
