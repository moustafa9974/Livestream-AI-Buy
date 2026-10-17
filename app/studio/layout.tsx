import { Suspense } from "react";
import { StudioNav } from "@/components/studio/studio-nav";

export default function StudioLayout({ children }: LayoutProps<"/studio">) {
  return (
    <>
      {/* The nav reads the current path (usePathname), which Next 16 streams in on
          dynamic routes, so it needs its own Suspense boundary. */}
      <Suspense fallback={<div className="h-[57px] border-b" aria-hidden />}>
        <StudioNav />
      </Suspense>
      {children}
    </>
  );
}
