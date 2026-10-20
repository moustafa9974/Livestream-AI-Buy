import Link from "next/link";

// Landing (SPEC §8). Static: no data access, so it prerenders and loads instantly even
// while a sleeping free Render instance wakes up behind it.

const STEPS = [
  { n: "1", title: "Go live", body: "Stream, screen-share or upload a video. Seen samples frames and spots the products on screen." },
  { n: "2", title: "Tap to buy", body: "Viewers see cards next to the video and pay with PayPal (or a card) without leaving it." },
  { n: "3", title: "Get paid", body: "Every sale credits the creator's commission. One tap sends it out with PayPal Payouts." },
];

const CARDS = [
  { title: "Oversized Hoodie: Black", price: "$45.00", tag: "Exact match", delay: "0s" },
  { title: "Clip-On Wireless Mic Kit", price: "$69.00", tag: "Exact match", delay: "1.2s" },
  { title: "Speckled Stoneware Mug", price: "$22.00", tag: "Similar", delay: "2.4s" },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-2 md:py-20">
        <div className="space-y-6">
          <p className="text-sm font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">Seen · shoppable video</p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            If it&apos;s on screen, it&apos;s shoppable, and the creator gets paid.
          </h1>
          <p className="text-lg text-muted-foreground">
            An AI watches a creator&apos;s stream, recognizes the products on screen in real time, and pins one-tap PayPal checkout next to the video.
            Creators earn commission, paid out with PayPal Payouts.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/live/maya-makes" className="rounded-lg bg-violet-600 px-5 py-3 font-semibold text-white hover:bg-violet-700 focus-visible:outline-2">
              Watch as Viewer
            </Link>
            <Link href="/studio" className="rounded-lg border px-5 py-3 font-semibold hover:bg-muted focus-visible:outline-2">
              Open Creator Studio
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">No signup. The studio opens as demo creator Maya Makes. Payments run in the PayPal sandbox.</p>
        </div>

        {/* Product cards "popping in" next to a video: a static stand-in for the hero clip. */}
        <div aria-hidden className="relative grid gap-3 rounded-2xl border bg-muted/40 p-4 sm:grid-cols-[1fr_200px]">
          <div className="relative aspect-video overflow-hidden rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-950">
            <span className="absolute left-3 top-3 rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">● LIVE</span>
            <div className="absolute left-[18%] top-[30%] h-[45%] w-[34%] rounded-lg border-2 border-yellow-300 motion-safe:animate-pulse">
              <span className="absolute -top-6 left-0 rounded bg-yellow-300 px-1.5 text-xs font-medium text-black">black hoodie</span>
            </div>
            <div className="absolute right-[12%] top-[46%] h-[28%] w-[18%] rounded-lg border-2 border-yellow-300">
              <span className="absolute -top-6 left-0 rounded bg-yellow-300 px-1.5 text-xs font-medium text-black">mug</span>
            </div>
          </div>
          <ul className="flex flex-col gap-2">
            {CARDS.map((c) => (
              <li
                key={c.title}
                className="rounded-xl border bg-background p-3 shadow-sm motion-safe:animate-[rail-in_600ms_ease-out_both]"
                style={{ animationDelay: c.delay }}
              >
                <p className="truncate text-sm font-semibold">{c.title}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm font-bold">{c.price}</span>
                  <span className="rounded-full bg-violet-100 px-2 text-[10px] font-medium text-violet-800 dark:bg-violet-900 dark:text-violet-100">{c.tag}</span>
                </div>
                <span className="mt-2 block rounded-md bg-[#ffc439] py-1 text-center text-xs font-bold text-[#003087]">Buy with PayPal</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="how" className="border-t bg-muted/30">
        <div className="mx-auto w-full max-w-6xl px-4 py-14">
          <h2 id="how" className="text-2xl font-bold tracking-tight">How it works</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-xl border bg-background p-5">
                <span className="flex size-8 items-center justify-center rounded-full bg-violet-600 font-bold text-white">{s.n}</span>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="why" className="mx-auto w-full max-w-6xl px-4 py-14">
        <h2 id="why" className="text-2xl font-bold tracking-tight">Why PayPal</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border p-5">
            <h3 className="font-semibold">New checkout moments</h3>
            <p className="mt-1 text-sm text-muted-foreground">Every frame of every video becomes a place to buy. PayPal or guest card, without leaving the stream.</p>
          </div>
          <div className="rounded-xl border p-5">
            <h3 className="font-semibold">Payouts to creators</h3>
            <p className="mt-1 text-sm text-muted-foreground">Commission is tracked per stream moment and paid with PayPal Payouts. No waiting weeks for an affiliate network.</p>
          </div>
          <div className="rounded-xl border p-5">
            <h3 className="font-semibold">Any platform, any language</h3>
            <p className="mt-1 text-sm text-muted-foreground">Seen watches pixels, not platform APIs, so it works for creators anywhere PayPal does.</p>
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground">
          <p>Built for &quot;Build What&apos;s Next with PayPal and AI&quot;. Runs on free tiers.</p>
          <p>PayPal · Gemini · Channel3 · Elastic · KERNEL · Astropods · Zapier · AG Grid · Bryntum · Render · Neon</p>
        </div>
      </footer>
    </main>
  );
}
