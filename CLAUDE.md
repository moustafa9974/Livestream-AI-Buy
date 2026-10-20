@AGENTS.md

# Seen: working rules

Source of truth: [docs/SPEC.md](docs/SPEC.md). If the spec and official docs disagree, the docs win; say what changed.

## Rules (from SPEC §0)

- **$0 rule.** Only free, free-tier, free-trial, or hackathon-credited services. Never add a paid dependency/service. If something would cost money: stop, tell the user, offer a free alternative.
- **Never invent API shapes.** Read current official docs before writing integration code for PayPal, Gemini, Channel3, KERNEL, Astropods, Elastic, Zapier, Bryntum, AG Grid, Neon, Render. Model names and limits go in env vars.
- **Phases.** End of each phase: run the app, run tests, show what works, list what's stubbed, commit. Do not start the next phase until the user says so.
- **Ask before** adding a dependency not in the spec, changing the stack, or deleting files. Small helpers (zod, date-fns, nanoid) are fine.
- **Secrets only in `.env`** (gitignored). Keep `.env.example` complete: every variable, a comment, where to get it free. Never log tokens, secrets, or payer details.
- **AI never decides money.** Prices, totals, currency, commission rates, payout amounts come from the DB, computed server-side in integer minor units (`lib/money.ts`). The AI only identifies what's on screen.
- **Graceful degradation.** Every sponsor integration is behind a flag (`lib/flags.ts`). Missing key / down / out of quota → feature shows "unavailable"; the core loop (frame → detection → card → PayPal checkout → commission → payout) still works.
- **Demo reliability first.** Deterministic seed, pre-recorded demo video, `npm run demo:reset`.
- TypeScript strict, no unexplained `any`, small files, comments explain *why*.

## Project facts

- Next.js 16 (App Router, `cacheComponents: true`): per-request data must sit inside `<Suspense>` or use `"use cache"`. Read `node_modules/next/dist/docs/` before using unfamiliar APIs.
- Prisma 7: config in `prisma.config.ts`, client generated to `generated/prisma` (gitignored), driver adapter `@prisma/adapter-pg`. Import from `@/generated/prisma/client`. pgvector columns are `Unsupported("vector(768)")`, accessed via raw SQL.
- State changes for orders/commissions go **only** through `lib/state/order.ts` / `lib/state/commission.ts`. `transition()` returns `applied | noop | rejected`; only `applied` performs side effects (this is how webhook + sync paths converge).
- PayPal: all calls via `lib/paypal/gateway.ts` (`paypal()`), money logic in `lib/commerce/*`. Sync paths and webhooks share `applyCapture` / `applyRefund` / `settlePayoutItem`. Setup: docs/PAYPAL_SANDBOX.md. `npm run test:db` runs money-flow tests on DATABASE_URL with `FakePayPal`.
- Vision: `lib/ai/*` (providers, zod schema + guardrails, embeddings), `lib/vision/*` (dHash, tracker, cache, `processFrame`). Setup + demo cache: docs/VISION.md. Tests inject fakes via `setVisionProviderForTests`.
- Matching/rail: `lib/search` (Postgres + Elastic backends), `lib/matching` (score + two-pass match), `lib/channel3`, `lib/rail.ts`, SSE at `/api/live/[slug]/rail`. See docs/MATCHING.md. After a Prisma migration, restart `npm run dev` (stale client otherwise).
- Quota-costing calls go through `lib/budget.ts` `consume()` first.
- Dev DB is Neon (free). DATABASE_URL may be the pooled URL; prisma.config.ts derives the direct URL for migrations (or set DIRECT_DATABASE_URL).
- Studio/sponsors: notifications + Zapier `lib/notify.ts`, assistant `lib/assistant/*` (Gemini tools + PayPal Agent Toolkit, read-only), recap `lib/recap.ts`, KERNEL `lib/kernel/watcher.ts`, demo panel `app/api/demo`, runtime overrides `lib/settings.ts`, seed logic `lib/demo/seed.ts`. E2E: `npm run test:e2e`.
- Deploy: render.yaml (free, Ohio), docs/DEPLOY.md, `npm run start:prod` migrates then starts. Astropods watcher agent in astropods/ (own package; `WATCHER_RUNTIME=astropods`, Bearer `WATCHER_TOKEN`), Seen side in `app/api/watcher/*`.
- Dev server weirdness (every page reload-looping with "could not finish this Suspense boundary", or a stale Prisma client after a migration): stop `npm run dev`, delete `.next/`, restart. Happened after moving route files + migrating while the server ran.
- Shell: Windows. The project folder name has spaces, so quote paths.

## Commands

```
npm run db:up        # docker compose Postgres+pgvector (needs Docker)
npm run db:deploy    # apply migrations
npm run db:seed      # deterministic demo data
npm run demo:reset   # migrate + reseed (keeps usage counters + API cache)
npm run dev
npm test             # vitest
npm run typecheck && npm run lint
```

## Phase checklist

- [x] **1. Skeleton & money core.** Next.js, Tailwind, shadcn, Prisma + pgvector, flags, budget guard, money, state machines + tests, seed, .env.example.
- [~] **2. PayPal end-to-end.** (code + tests done; live sandbox run pending keys) Typed client (token cache, idempotency), orders create/capture, checkout drawer (JS SDK v6), refunds, commission ledger, Payouts + status, verified idempotent webhooks, audit timeline, minimal earnings + Pay me now.
- [~] **3. Vision pipeline.** (code + tests done; Gemini + recorded demo video pending) Client frame capture (upload + screen), dHash filter, Gemini structured output, Ollama/Claude adapters, tracker/stabilization, demo cache, budget degradation.
- [~] **4. Matching & live rail.** (code + tests done; browser check after dev-server restart; Channel3 key + Elastic pending) Elastic hybrid (+ Postgres fallback), Channel3 similar + price compare, SSE rail, viewer page, attribution.
- [~] **5. Studio & sponsors.** (built + tested; KERNEL/Zapier/Channel3/Elastic need keys for live tests) Go live, detections mgmt, AG Grid, Bryntum, assistant + Agent Toolkit, Zapier, recap page, KERNEL source with caps.
- [~] **6. Deploy.** (render.yaml + Astropods agent ready and tested locally; needs your GitHub/Render/Neon-branch/Astropods accounts to go live) Astropods watcher, Render Blueprint, Neon prod, prod webhooks, health check.
- [ ] **7. Polish & docs.** Playwright E2E, Postman, README, ARCHITECTURE/SPONSORS/DEMO_SCRIPT/FREE_TIER, MIT, a11y/Lighthouse, secret scan.
