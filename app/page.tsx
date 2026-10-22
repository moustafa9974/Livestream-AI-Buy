import Link from "next/link";
import { ArrowRight, Globe, HandCoins, MonitorUp, ScanSearch, ShieldCheck, ShoppingBag, Wallet } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { ProductThumb } from "@/components/app/product-thumb";

// Landing (SPEC §8). Static: no data access, so it prerenders and loads instantly even
// while a sleeping free Render instance wakes up behind it.

const STEPS = [
  { icon: MonitorUp, title: "Go live", body: "Stream, screen-share or upload a video. Seen samples frames and spots the products on screen." },
  { icon: ShoppingBag, title: "Tap to buy", body: "Viewers see cards next to the video and pay with PayPal (or a card) without leaving it." },
  { icon: HandCoins, title: "Get paid", body: "Every sale credits the creator's commission. One tap sends it out with PayPal Payouts." },
];

const WHY = [
  { icon: ScanSearch, title: "New checkout moments", body: "Every frame of every video becomes a place to buy. PayPal or guest card, without leaving the stream." },
  { icon: Wallet, title: "Payouts to creators", body: "Commission is tracked per stream moment and paid with PayPal Payouts. No waiting weeks for an affiliate network." },
  { icon: Globe, title: "Any platform", body: "Seen watches pixels, not platform APIs, so it works for creators anywhere PayPal does." },
];

const CARDS = [
  { title: "Oversized Hoodie: Black", merchant: "Northloop Apparel", price: "$45.00", tag: "Exact match", delay: "0.2s" },
  { title: "Clip-On Wireless Mic Kit", merchant: "Studio Signal", price: "$69.00", tag: "Exact match", delay: "1.2s" },
  { title: "Speckled Stoneware Mug", merchant: "Kiln & Co. Home", price: "$22.00", tag: "Similar", delay: "2.2s" },
];

const STACK = ["PayPal", "Gemini", "Channel3", "Elastic", "KERNEL", "Astropods", "Zapier", "AG Grid", "Bryntum", "Render", "Neon"];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <div className="hero-glow">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
          <Logo />
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/live/maya-makes" className="rounded-lg px-3 py-2 text-muted-foreground hover:text-foreground">
              Viewer
            </Link>
            <Link href="/studio" className="rounded-lg px-3 py-2 text-muted-foreground hover:text-foreground">
              Studio
            </Link>
          </nav>
        </header>

        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-20 pt-10 md:grid-cols-[1.05fr_1fr] md:pt-16">
          <div className="space-y-7">
            <p className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              AI shoppable video · powered by PayPal
            </p>
            <h1 className="text-4xl font-semibold leading-[1.08] md:text-6xl">
              If it&apos;s on screen, <span className="brand-text">it&apos;s shoppable.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              An AI watches a creator&apos;s stream, recognizes the products on screen in real time, and pins one-tap PayPal checkout next to the video.
              Creators earn commission, paid out with PayPal Payouts.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/live/maya-makes"
                className="brand-bg group inline-flex items-center gap-2 rounded-xl px-5 py-3 font-medium text-white shadow-lift transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Watch as Viewer
                <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
              </Link>
              <Link
                href="/studio"
                className="inline-flex items-center gap-2 rounded-xl border bg-card px-5 py-3 font-medium shadow-sm transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Open Creator Studio
              </Link>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="size-4 text-success" aria-hidden />
              No signup. The studio opens as demo creator Maya Makes. Payments run in the PayPal sandbox.
            </p>
          </div>

          {/* Product cards "popping in" next to a video: a static stand-in for the hero clip. */}
          <div aria-hidden className="surface relative grid gap-3 p-3 shadow-lift sm:grid-cols-[1fr_210px]">
            <div className="stage-dots relative aspect-[4/5] overflow-hidden rounded-xl sm:aspect-auto">
              <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-live px-2.5 py-1 text-[11px] font-semibold text-white">
                <span className="size-1.5 rounded-full bg-white" /> LIVE
              </span>
              <span className="absolute right-3 top-3 rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/80 backdrop-blur">1.2k watching</span>
              <div className="absolute left-[14%] top-[28%] h-[42%] w-[40%] rounded-xl border-2 border-white/90 shadow-[0_0_0_4px_oklch(0.53_0.23_286/0.35)] motion-safe:animate-pulse">
                <span className="absolute -top-7 left-0 whitespace-nowrap rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-foreground shadow">black hoodie · 96%</span>
              </div>
              <div className="absolute right-[10%] top-[56%] h-[22%] w-[24%] rounded-xl border-2 border-white/90 shadow-[0_0_0_4px_oklch(0.56_0.19_252/0.35)]">
                <span className="absolute -top-7 left-0 whitespace-nowrap rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-foreground shadow">mug · 91%</span>
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {CARDS.map((c) => (
                <li
                  key={c.title}
                  className="rounded-xl border bg-card p-2.5 shadow-sm motion-safe:animate-[rail-in_600ms_ease-out_both]"
                  style={{ animationDelay: c.delay }}
                >
                  <div className="flex gap-2.5">
                    <ProductThumb title={c.title} className="size-11" />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{c.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{c.merchant}</p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums">{c.price}</p>
                    </div>
                  </div>
                  <span className="mt-2 block rounded-lg bg-paypal py-1.5 text-center text-xs font-bold text-paypal-ink">Buy with PayPal</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <section aria-labelledby="how" className="border-y bg-card">
        <div className="mx-auto w-full max-w-6xl px-4 py-16">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">How it works</p>
          <h2 id="how" className="mt-2 text-3xl font-semibold">From frame to payout in three steps</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative">
                <div className="flex items-center gap-3">
                  <span className="brand-bg grid size-10 place-items-center rounded-xl text-white shadow-sm" aria-hidden>
                    <s.icon className="size-5" />
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">Step {i + 1}</span>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="why" className="mx-auto w-full max-w-6xl px-4 py-16">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Why PayPal</p>
        <h2 id="why" className="mt-2 text-3xl font-semibold">Checkout and payouts on one rail</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {WHY.map((w) => (
            <div key={w.title} className="surface p-6 transition hover:-translate-y-0.5 hover:shadow-lift">
              <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground" aria-hidden>
                <w.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{w.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <Logo />
            <p>Built for &quot;Build What&apos;s Next with PayPal and AI&quot;. Runs on free tiers.</p>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="Built with">
            {STACK.map((s) => (
              <li key={s} className="rounded-full border bg-background px-2.5 py-0.5 text-xs">
                {s}
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </main>
  );
}
