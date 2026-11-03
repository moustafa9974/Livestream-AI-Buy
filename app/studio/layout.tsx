import { Suspense } from "react";
import type { Metadata } from "next";
import { StudioNav } from "@/components/studio/studio-nav";

export const metadata: Metadata = { title: "Creator Studio" };

export default function StudioLayout({ children }: LayoutProps<"/studio">) {
  return (
    <>
      {/* The nav reads the current path (usePathname), which Next 16 streams in on
          dynamic routes, so it needs its own Suspense boundary. */}
      <Suspense fallback={<div className="h-[53px] border-b bg-card/85" aria-hidden />}>
        <StudioNav />
      </Suspense>
      {children}
    </>
  );
}
