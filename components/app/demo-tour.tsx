import Link from "next/link";
import { ArrowLeft, ArrowRight, Clapperboard, Eye } from "lucide-react";
import { getEnv } from "@/lib/env";

/**
 * Demo-mode guide bar. One person (usually a judge) plays both sides of Seen in one
 * browser, so every page says who you are right now and what to do next:
 * 1. shop as a viewer → 2. see Maya get paid → 3. go live as Maya.
 * Hidden outside DEMO_MODE, where viewers and creators are different people.
 */
export function DemoTour({ role }: { role: "viewer" | "creator" }) {
  if (!getEnv().DEMO_MODE) return null;

  const steps = [
    { n: 1, label: "Shop as a viewer", href: "/live/maya-makes", active: role === "viewer" },
    { n: 2, label: "See Maya get paid", href: "/studio/earnings", active: role === "creator" },
    { n: 3, label: "Go live as Maya", href: "/studio", active: role === "creator" },
  ];

  return (
    <div className="border-b bg-accent text-accent-foreground">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-x-4 gap-y-2 px-4 sm:px-6 lg:px-8 py-2 text-sm">
        <p className="flex min-w-0 flex-1 items-center gap-2 truncate">
          {role === "viewer" ? (
            <>
              <Eye className="size-4 shrink-0" aria-hidden />
              <span>
                <b>You&apos;re a viewer</b>
                {/* Phones get the short version: the long sentence wrapped into a tall column. */}
                <span className="hidden sm:inline"> watching Maya Makes</span>
              </span>
            </>
          ) : (
            <>
              <Clapperboard className="size-4 shrink-0" aria-hidden />
              <span>
                <b>You&apos;re Maya Makes, the creator.</b>
                <span className="hidden sm:inline"> Private studio, demo login</span>
              </span>
            </>
          )}
        </p>

        <ol aria-label="Demo tour" className="hidden items-center gap-1 text-xs md:flex">
          {steps.map((s) => (
            <li key={s.n}>
              <Link
                href={s.href}
                aria-current={s.active ? "step" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
                  s.active ? "bg-card font-medium text-foreground shadow-sm" : "hover:bg-card/60"
                }`}
              >
                <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{s.n}</span>
                {s.label}
              </Link>
            </li>
          ))}
        </ol>

        {role === "viewer" ? (
          <Link href="/studio/earnings" className="inline-flex shrink-0 items-center gap-1 font-medium underline-offset-4 hover:underline">
            <span className="hidden sm:inline">Bought something?&nbsp;</span>Switch to Maya <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : (
          <Link href="/live/maya-makes" className="inline-flex shrink-0 items-center gap-1 font-medium underline-offset-4 hover:underline">
            <ArrowLeft className="size-3.5" aria-hidden /> Back to the viewer
          </Link>
        )}
      </div>
    </div>
  );
}
