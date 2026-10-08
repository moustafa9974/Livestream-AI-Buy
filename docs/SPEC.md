# Seen: Build Prompt for Claude Code ($0 budget edition)

## How to use this file

Create an empty folder (e.g. seen/), open it in VS Code, run git init.
Copy this file into the folder as docs/SPEC.md.
Open Claude Code and send the Kickoff message at the bottom of this file.
Work phase by phase. Review each phase's acceptance checks before saying "next phase".

## 0. Your role and working rules

You are the lead engineer building Seen for the PayPal "Build What's Next with PayPal and AI" hackathon (Devpost). I am a solo developer with a hard budget of $0. We are optimizing for: a flawless, viral-feeling 3-minute demo, a live hosted URL judges can click, and clean, documented, open-source code.

Rules you must follow for the whole project:

- **$0 rule.** Only use services that are free, free-tier, free-trial, or hackathon-credited (see section 2). Never add a dependency or service that requires payment. If something would cost money, stop and tell me, and offer a free alternative.
- **Never invent API shapes.** For PayPal, Gemini, Channel3, KERNEL, Astropods, Elastic, Zapier, Bryntum, AG Grid, Neon, and Render, read the current official docs before writing integration code. If this spec conflicts with the docs, the docs win. Tell me what changed. Model names and free-tier limits change often; verify them and put them in env vars.
- **Work in phases** (section 10). At the end of each phase: run the app, run the tests, show me what works, list anything stubbed, and commit with a clear message. Do not start the next phase until I say so.
- **Ask before** adding a dependency not in this spec, changing the stack, or deleting files. Small helper libs (zod, date-fns, nanoid) are fine.
- **Secrets only in .env** (gitignored). Maintain .env.example with every variable, a comment explaining it, and where to get it for free. Never log tokens, secrets, or payer details.
- **Money is never decided by the AI.** Prices, totals, currency, commission rates, and payout amounts come from the database and are computed server-side in integer minor units. The AI only identifies what is on screen.
- **Graceful degradation.** Every sponsor integration sits behind a feature flag (env var). If a service is down, out of free quota, or unconfigured, the core loop (frame → detection → product card → PayPal checkout → creator commission payout) must still work, and that feature shows a clear "unavailable" state.
- **Demo reliability first.** Deterministic seeded data, a pre-recorded demo video as a guaranteed source, and `npm run demo:reset` restores a perfect demo state.
- TypeScript strict, no unexplained `any`, small files, comments explain why.

## 1. Product summary

**One line:** An AI that watches a creator's live stream or video, recognizes the products on screen in real time, pins one-tap PayPal buy buttons next to the video, and automatically pays the creator a commission via PayPal Payouts.

**Tagline:** "If it's on screen, it's shoppable, and the creator gets paid."

**The problem:**

- Live and video shopping is huge (dominant in China and Southeast Asia, fast-growing in the US, LatAm, and MENA), but outside closed platforms it requires manual product tagging, affiliate link juggling, and "link in bio". Viewers lose the impulse; creators lose revenue.
- Creator affiliate payouts are slow, opaque, and fragmented across networks.

**The insight:** Vision AI can now turn video into structured product data in seconds. PayPal already has the two missing pieces: trusted one-tap checkout for viewers worldwide and Payouts to pay creators in many countries and currencies. Seen connects them.

**Why PayPal cares:** new checkout moments (in-video impulse buys), Payouts volume from creators, a creator-positive story, and global reach (any language and any platform, since the AI watches pixels and audio rather than relying on platform APIs).

**Users:**

- Creator: connects a stream/video, sees live detections, approves/hides products, tracks earnings and payouts.
- Viewer: watches, taps a product card, pays with PayPal without leaving the video.
- Merchant (demo partner stores): seeded sandbox merchants whose catalog is sold via Seen.
- Judge: must try viewer + creator flows in under 60 seconds, no signup.

## 2. Free stack ($0) — fixed unless I approve a change

| Layer | Choice | Free how |
|---|---|---|
| App | Next.js (latest stable, App Router) + TypeScript | Open source |
| UI | Tailwind CSS + shadcn/ui | Open source |
| DB | PostgreSQL on Neon free tier (prod) / Docker Postgres (dev), Prisma ORM | Neon free tier doesn't expire like Render's free Postgres. Verify current limits. |
| Vector fallback | pgvector on Neon | Free, used if Elastic is unavailable |
| AI: vision + reasoning | Google Gemini API free tier: current Flash multimodal model for frame analysis, current Flash-Lite (or equivalent) for cheap text tasks | Free quota with rate limits. Model names in env. Note: free-tier inputs may be used by Google to improve products, so only send demo/own content. |
| AI: embeddings | Gemini embeddings model (free tier) | For product similarity + dedupe |
| AI: local fallback | Ollama with a vision model (e.g. Qwen2.5-VL) | `AI_PROVIDER=gemini\|ollama\|claude` |
| AI: optional | Anthropic Claude API | `AI_PROVIDER=claude`, off by default (paid). Implement the adapter but don't require it. |
| Payments | PayPal REST API sandbox: Orders v2 (intent CAPTURE), Payouts v1, Webhooks, Refunds + PayPal JS SDK + PayPal Agent Toolkit | Sandbox is free |
| Product data | Channel3 API | 20,000 free credits with code PAYPAL-HACKATHON-2026 |
| Search | Elastic: local Docker (free) for dev; Elastic Cloud 14-day trial for the hosted demo, started in the final week | Fallback: Postgres FTS + pgvector |
| Cloud browser | KERNEL | $50 hackathon credits. Strict usage caps (section 7). |
| Agent hosting | Astropods free tier | Hosts the "stream watcher" agent. This doubles as our free background worker. |
| Automation | Zapier: free plan + Pro trial started in the final week (Webhooks by Zapier is a premium app) | Fallback: in-app notifications |
| Data grid | AG Grid Community | Open source (MIT) |
| Calendar | Bryntum Calendar/Scheduler trial | Optional and feature-flagged. Check whether trial packages can be used in a public repo; if not, document install steps instead of committing them. |
| Hosting | Render free web service | Sleeps after idle (cold start ~30–60s). No paid workers: background work runs on Astropods or in-process. |
| API testing | Postman free | Collection committed to repo |
| Dev tooling | APIMatic context plugins (hackathon access) | For PayPal API context while coding |
| Tests | Vitest + Playwright | Open source |
| Video/stream | OBS Studio (free), browser getDisplayMedia/`<video>` capture | Free |
| Repo & video | GitHub + YouTube | Free |

**Free-tier protections (implement as code, not just docs):**

- `lib/budget.ts`: per-provider counters (requests/min, requests/day) persisted in DB, with limits from env (`GEMINI_MAX_RPM`, `GEMINI_MAX_RPD`, `KERNEL_MAX_SESSION_MINUTES`, `KERNEL_MAX_SESSIONS_PER_DAY`, `CHANNEL3_MAX_CALLS_PER_DAY`). When a limit is near, degrade (lower frame rate → cached results only) and show a small "free-tier saver mode" badge. Never hard-crash.
- Cache everything that costs quota: detections by frame hash, Channel3 results by normalized query, embeddings by text hash.

## 3. How the core loop works

```
Video source ──► Frame sampler ──► Change filter ──► Vision AI ──► Detection tracker ──► Product matcher ──► Live product rail ──► PayPal checkout ──► Commission ──► PayPal Payout
(upload/YouTube/   (every N sec)   (perceptual hash,  (Gemini:       (stabilize: need     (Elastic partner      (SSE to viewers)    (Orders v2)       (ledger)        (Payouts v1)
 screen/KERNEL)                     skip near-dupes)   JSON items)    2 hits, dedupe)      catalog + Channel3)
```

**Video sources (implement in this order):**

1. **Demo file / own upload (guaranteed):** an .mp4 I record myself (wearing/using items that exist in the seeded partner catalog). Frames captured client-side in the creator's browser by drawing the `<video>` to a `<canvas>` → JPEG (≤ 768px wide, quality ~0.7) → POST to server. Free, reliable, no ToS issues.
2. **Screen/OBS capture:** creator studio uses `getDisplayMedia()` (or OBS Virtual Camera via `getUserMedia`) → same canvas pipeline. This is the "live" mode.
3. **YouTube embed** of the creator's own video/stream for the viewer page (playback only). Frame capture for this source uses the creator's browser screen capture, not scraping.
4. **KERNEL "watch a URL" mode:** for a creator's own public stream page on any platform, a KERNEL cloud browser opens the URL and screenshots the player region every N seconds. Capped hard (section 7). Creator must confirm they own the stream (checkbox + stored consent).

**Audio context (stretch):** browser Web Speech API (free, Chrome) transcribes the creator's speech locally; the last ~20s transcript is sent with frames so the AI knows "this mic" = the thing being talked about. Flag `AUDIO_CONTEXT`.

**Change filter:** compute a 64-bit dHash per frame in the browser; only send if Hamming distance from the last sent frame > threshold (env), or every `MAX_STALE_SECONDS` regardless. Default sample interval 4s, auto-adjusts with budget.

**Vision prompt contract** (Gemini, structured JSON output with a schema):

```jsonc
{
  "items": [
    {
      "label": "black hooded sweatshirt",
      "category": "apparel/hoodie",
      "brand_guess": "unknown",
      "attributes": {"color": "black", "material": "cotton fleece", "style": "oversized"},
      "bbox": [x, y, w, h],          // normalized 0–1
      "prominence": 0.0-1.0,          // how central/featured
      "confidence": 0.0-1.0,
      "mentioned_in_audio": true|false
    }
  ],
  "scene": "short description"
}
```

Rules in the prompt: only physical, purchasable products; ignore people's faces/identity (never identify or describe people); ignore logos you're unsure about (`brand_guess: "unknown"`); max 5 items, most prominent first. Validate with zod; drop invalid output.

**Detection tracker (stabilization):**

- Normalize label → embedding; cluster with existing active detections in this stream (cosine > threshold) to dedupe.
- A detection becomes visible only after ≥ 2 hits within 15s and confidence ≥ threshold. It stays visible for a cooldown after last seen; for VOD it's pinned to timestamps ("shop this moment").
- Creator can pin, hide, or correct any detection live (hidden products never show again for this stream).

**Product matcher:**

- Partner catalog (buyable via PayPal): Elastic hybrid search (BM25 on label/attributes + vector similarity) over seeded partner merchants' products. If score ≥ threshold → "Buy with PayPal" card.
- Open-web matches (Channel3): search Channel3 with the label + attributes → show up to 3 "similar items" with price range and retailer. These are "View similar" links (no PayPal checkout, since we're not the merchant), plus a price comparison on partner cards ("$12 less than similar items").
- Show a match-confidence chip ("Exact match" / "Similar") and never claim an exact match below threshold.

## 4. Money model (PayPal sandbox, keep it honest)

- **Merchant of record in the demo:** "Seen Partner Stores": 2–3 seeded partner merchants represented by one PayPal sandbox business account (the platform). Partner catalog products are sold through Seen's checkout.
- **Viewer checkout:** Orders v2 with `intent: "CAPTURE"`, built server-side from DB. `custom_id` = our order id; `items[]` itemized; `PayPal-Request-Id` idempotency on every POST. PayPal JS SDK buttons rendered in an overlay/drawer on the viewer page so the video keeps playing. Guest card checkout enabled (no PayPal account needed). Check docs for the currently recommended JS SDK version and follow it.
- **Attribution:** each card click creates an Attribution (stream, detection, timestamp, viewer session). Order links to the attribution, so the commission goes to the right creator for the right moment.
- **Commission:** `rateBps` per creator (default 1000 = 10%) × captured item total, computed server-side, stored in Commission with status PENDING → ELIGIBLE → PAID (or REVERSED on refund).
- ELIGIBLE after a hold window (env `COMMISSION_HOLD_HOURS`, default 0 in demo mode, e.g. 72h in "realistic" mode) to absorb refunds.
- **Payouts:** `POST /v1/payments/payouts` batch to the creator's sandbox personal account email (`recipient_type: EMAIL`), `sender_batch_id` = idempotency key, `sender_item_id` = commission id. Track via batch status polling + webhooks (`PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, …FAILED, …UNCLAIMED, …RETURNED). Verify current event names in docs. Creator dashboard has "Pay me now" (demo) and auto-payout schedule (Bryntum).
- **Refunds:** `POST /v2/payments/captures/{id}/refund` (full/partial) → commission REVERSED (or clawback recorded if already paid).
- **Webhooks:** `/api/webhooks/paypal`, verify signatures via `POST /v1/notifications/verify-webhook-signature`, store events by unique event id (idempotent). Handle `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, payouts events. The webhook path and the synchronous path converge on the same state machine with no double-processing.
- **Production note (README only):** in production, merchants would be onboarded via PayPal's multiparty/marketplace solution so funds go directly to merchants and Seen takes a platform fee. The sandbox demo uses the single-platform model because multiparty requires partner approval. Say this clearly; don't fake it.
- **Agent Toolkit:** use `@paypal/agent-toolkit` (or PayPal MCP server) for the creator assistant tools (e.g. "how much did I earn this week?", "list my last orders", "refund order 1042") where supported. Keep the checkout/payout money path in our own typed client. Document the split in docs/SPONSORS.md.
- **Currency:** USD by default; per-creator payout currency configurable among PayPal-supported currencies (verify in docs). Money = integer minor units. Never floats.
- **Order state machine:** CREATED → APPROVED → CAPTURED → (PARTIALLY_)REFUNDED, plus FAILED/CANCELLED. **Commission state machine:** PENDING → ELIGIBLE → PAYOUT_SENT → PAID | FAILED | UNCLAIMED | RETURNED, → REVERSED on refund. Enforce transitions in one place each, unit-tested.

## 5. Data model (Prisma)

- **Creator:** id, slug, displayName, avatarUrl, payoutEmail (sandbox), payoutCurrency, commissionRateBps, language, zapierWebhookUrl?, createdAt.
- **Stream:** id, creatorId, title, sourceType (upload|screen|youtube|kernel_url), sourceUrl?, videoAssetUrl?, status (idle|live|ended), consentOwnContent (bool + timestamp), startedAt, endedAt, frameIntervalSec.
- **Frame:** id, streamId, tsSec, dHash, imageUrl? (keep only last N for debugging/demo), processed, provider, latencyMs, createdAt.
- **Detection:** id, streamId, label, category, attributes (json), embedding (vector), bestFrameId, bbox (json), confidence, hits, firstSeenSec, lastSeenSec, state (candidate|visible|pinned|hidden), mentionedInAudio.
- **ProductMatch:** id, detectionId, source (partner|channel3), partnerProductId?, externalRef (json: title, price, retailer, url, image), score, kind (exact|similar).
- **Merchant:** id, name, logoUrl. **PartnerProduct:** id, merchantId, title, description, category, images[], priceMinor, currency, attributes (json), stock, embedding (vector).
- **ViewerSession:** id, anonymous id cookie, locale.
- **Attribution:** id, streamId, detectionId, partnerProductId, viewerSessionId, tsSec, createdAt.
- **Order:** id, viewerSessionId, attributionId, items (json snapshot), subtotalMinor, totalMinor, currency, status, paypalOrderId, paypalCaptureId, createdAt, updatedAt.
- **Commission:** id, orderId, creatorId, baseMinor, rateBps, amountMinor, currency, status, eligibleAt, payoutBatchId?, payoutItemId?, createdAt.
- **PayoutBatch:** id, paypalBatchId, senderBatchId, status, totalMinor, currency, createdAt.
- **WebhookEvent:** id, paypalEventId (unique), type, payload, processedAt.
- **AuditEvent:** id, entityType, entityId, type, payload, source (ai|webhook|creator|viewer|system|kernel), createdAt. This is the timeline shown in the UI.
- **UsageCounter:** provider, window, count (for the budget guard).

## 6. AI components

1. **Frame analyzer** (`lib/ai/vision.ts`): provider-agnostic interface `analyzeFrame(image, context) → VisionResult`. Implementations: Gemini (default), Ollama (local), Claude (optional, off). Structured output + zod validation + retry once with a "fix your JSON" message. Record latency and provider in Frame.
2. **Stream watcher agent** (deployed on Astropods): the orchestrator that pulls pending frames, calls the analyzer, runs the tracker and matcher, and pushes updates. Defined via Astropods' declarative spec in `astropods/` with tools: `get_pending_frames`, `analyze_frame`, `upsert_detection`, `match_products`, `publish_rail_update`. Uses Astropods observability for traces. Local fallback: the same logic runs in-process (`WATCHER_RUNTIME=local|astropods`) so the demo never depends on one service.
3. **Creator assistant** (chat panel in creator dashboard): Gemini text model with tools wrapping our DB + PayPal Agent Toolkit: earnings summaries, top products this stream, "hide all sunglasses detections", "pay me now", refund lookups. Tool handlers scope by the logged-in creatorId. Never from model output.
4. **Stream recap** (after a stream ends): AI writes a shareable recap: "Your 42-min stream: 9 products, 31 sales, $184 earned. Best moment: 12:40, the mic." with a "shoppable replay" link. Sent via Zapier.
5. **Guardrails (code-enforced):** AI output can never set prices/commission/payout amounts; prompt-injection resistance (text visible in frames, e.g. a sign saying "ignore instructions", is data, not instructions); no face/person identification ever; content safety check: skip detections in categories from a denylist (weapons, drugs, adult, etc.); confidence thresholds; per-stream max visible products.

## 7. Sponsor integrations (each real and visible)

- **PayPal:** sections 4 and 6. The heart of the project.
- **Channel3** (`lib/channel3/`): sign up at trychannel3.com/developers, promo PAYPAL-HACKATHON-2026. Read docs + MCP setup. Use for (a) "similar items" on open web per detection, (b) price comparison on partner products, (c) attribute enrichment for partner catalog seeding. Cache by normalized query (24h). Daily cap via budget guard. Never block the rail if it fails.
- **KERNEL** (`lib/kernel/`): get the $50 credits link from the hackathon page; read kernel.sh/docs. Used for the "Watch my stream URL" source: launch a browser, open the creator's own stream URL, locate the video element, screenshot its region every N seconds, feed into the same frame pipeline. Also optional: "verify partner product page" check (stock/price) once per day. Hard caps: max session minutes, max sessions/day, auto-stop on stream end or idle, kill switch in demo panel. Show the KERNEL live-view link in creator studio for the demo "wow".
- **Elastic** (`lib/elastic/`): index `partner_products` (title, description, attributes, category, semantic/dense vector field using Gemini embeddings so it works on the free local license, or Elastic's built-in semantic option if available on the chosen deployment; document which). Hybrid query (BM25 + kNN, RRF if available on the license; otherwise a weighted combine in code). Index detections for "search past streams" ("when did I show the blue mug?"). Fallback: Postgres FTS + pgvector with the same interface `ProductSearch`.
- **Astropods:** section 6.2. `astropods/` folder with spec, tools, model config, deploy instructions; README shows a screenshot of the trace view.
- **Zapier** (`lib/zapier/`): outgoing webhooks to a creator's Catch Hook Zap. Events: `sale.created`, `commission.paid`, `payout.failed`, `stream.recap`, `budget.saver_mode`. docs/SPONSORS.md contains exact Zap recipes (→ Gmail/Slack/Discord/SMS, → Google Sheets earnings log, → post "Top product of the stream" to Discord). Fallback: in-app notification center. Note: start the Zapier Pro trial in the final week.
- **AG Grid Community** (creator `/studio/earnings` and `/studio/stream/[id]/detections`): earnings grid (product, moment, clicks, sales, conversion %, commission, payout status pill) with quick filters and CSV export; detections grid (label, confidence, hits, state, match, actions: pin/hide/correct).
- **Bryntum** (`/studio/schedule`, feature-flagged): creator's upcoming streams, automatic payout runs, commission eligibility dates; brands can "book a product feature" slot in an upcoming stream (stretch). If the trial can't be committed publicly, keep it behind `BRYNTUM_ENABLED` with documented install steps.
- **Render:** `render.yaml` Blueprint with free web service only; DB = Neon (env `DATABASE_URL`). Health check `/api/health`. Background work = Astropods watcher or in-process loop while a stream is live (no paid worker). README warns about cold starts and gives judges a "wake up" tip.
- **Postman:** `postman/seen.postman_collection.json` + environment: Auth, Orders (create → capture), Refund, Payouts (create batch → get status), Webhook simulation, Demo controls; with tests. Publish to a public Postman workspace; link in README.
- **APIMatic:** use APIMatic context plugins for PayPal API context during development; document exactly how in README/SPONSORS.md.

## 8. Screens & UX (mobile-first, polished, globally friendly)

- **Landing `/`:** 10-second looping hero clip of products popping up beside a video; headline + tagline; buttons Watch as Viewer / Open Creator Studio (auto-login demo creator "Maya Makes"); "How it works" 3 steps; "Why PayPal" (checkout + payouts in many countries); language toggle (EN + AR + ES to show global; i18n with next-intl or similar; RTL support).
- **Viewer page `/live/[creatorSlug]`:** video player (demo mp4 or YouTube embed) with a product rail (desktop: right side; mobile: bottom sheet) updating live via SSE. Cards animate in with image, title, price, "Exact match"/"Similar" chip, "Buy with PayPal" button. Optional subtle bbox highlight on the video when hovering a card. Checkout opens as a drawer over the video (video keeps playing). Success toast: "Paid ✅ — Maya earned $4.50 from your purchase." "Shop this moment" timeline for replays.
- **Creator Studio `/studio`:** source picker (upload / screen / own stream URL via KERNEL), Go Live button, live preview with detection boxes, detections list (pin/hide/correct), live sales ticker, earnings today, budget/saver-mode indicator, KERNEL live-view link.
- **Earnings `/studio/earnings`:** AG Grid + KPI tiles (sales, commission pending/paid, top product) + Pay me now button → PayPal Payout → status updates live.
- **Schedule `/studio/schedule`:** Bryntum.
- **Creator assistant:** slide-over chat in studio.
- **Stream recap `/recap/[streamId]`:** shareable page with best moments + shoppable replay. This is the marketing asset.
- **Demo control panel** (only `DEMO_MODE=true`): reset demo, inject a known frame, force detection, simulate webhook, set commission hold to 0, toggle providers, kill KERNEL sessions.
- **Design:** modern creator-economy aesthetic: clean, bold, energetic, one accent color, smooth card animations (respect prefers-reduced-motion), accessible contrast, keyboard navigable, works at 375px. Follow PayPal brand guidelines for PayPal buttons/marks; don't imitate PayPal's own branding elsewhere.

## 9. Demo assets I will create (remind me)

- A 60–90s self-recorded demo video (me, my room, no copyrighted music/logos in focus) showing 5–6 items that exist in the seeded partner catalog: e.g. black hoodie, wireless mic, ceramic mug, desk lamp, sneakers, sunglasses.
- Photos of those items for the partner catalog seed (my own photos, or license-safe images).
- PayPal sandbox accounts: 1 business (platform), 1 personal (creator payout recipient), 1 personal (viewer).
- Sign-ups: Gemini API key (Google AI Studio), Channel3, KERNEL credits, Astropods, Neon, Render, Postman, Elastic Cloud trial (final week), Zapier Pro trial (final week), Bryntum trial.
- Seed script (`prisma/seed.ts`): creator "Maya Makes", 3 partner merchants, ~20 partner products (including the 6 demo items with attributes matching what the AI will see), a past ended stream with detections + orders + a paid commission (so dashboards aren't empty), and cached vision results for the demo video's key frames (so the demo works even if Gemini quota is exhausted: `DEMO_CACHE=true`).

## 10. Build phases (stop after each for my review)

- **Phase 1: Skeleton & money core.** Next.js, Tailwind, shadcn, Prisma + Docker Postgres (pgvector), Neon config, feature flags (`lib/flags.ts`), budget guard (`lib/budget.ts`), `money.ts`, order + commission state machines with unit tests, seed script, .env.example. ✅ `npm run dev`, `npm run db:seed`, tests green.
- **Phase 2: PayPal end-to-end (most important).** Typed PayPal client (token cache, idempotency), create/capture orders, checkout drawer with JS SDK, refunds, commission ledger, Payouts batch + status tracking, verified webhooks with idempotency, audit timeline. Minimal earnings page with "Pay me now". ✅ Viewer buys a partner product with sandbox personal account and guest card → capture → commission created → "Pay me now" → payout visible in the creator's sandbox account; refund reverses commission; webhooks (tunnel via cloudflared/ngrok free, documented) don't double-process.
- **Phase 3: Vision pipeline.** Client-side frame capture (upload + screen), dHash change filter, Gemini analyzer with structured output, provider adapters (Gemini/Ollama/Claude-off), tracker + stabilization, demo cache, budget degradation. ✅ Playing the demo video produces stable detections (no flicker), stays within free-tier rate limits, and works offline from cache when `DEMO_CACHE=true`.
- **Phase 4: Matching & live rail.** Elastic index + hybrid search (with Postgres fallback), Channel3 similar items + price comparison, product rail via SSE, viewer page polish, attribution on click. ✅ Within ~5–10s of an item appearing on screen, a correct partner card appears; buying it attributes the commission to the right stream moment.
- **Phase 5: Creator Studio & sponsors.** Studio (go live, detections management), AG Grid grids, Bryntum schedule, creator assistant with Agent Toolkit tools, Zapier events + recipes, stream recap page, KERNEL "watch my URL" source with caps + live-view link. ✅ Every sponsor visible somewhere; each can be disabled by flag without breaking the core loop.
- **Phase 6: Astropods + Render deploy.** Deploy the watcher on Astropods (`WATCHER_RUNTIME=astropods`), Render free web service via Blueprint, Neon prod DB, production webhook URLs, health check. ✅ Live URL works from a fresh browser; "Watch as Viewer" and "Open Creator Studio" need zero setup; cold start documented.
- **Phase 7: Polish, tests, docs.** Playwright E2E (demo video → detection (cached) → buy (mock approval in test) → commission → payout (mocked)), Postman collection, README, docs/ARCHITECTURE.md (Mermaid), docs/SPONSORS.md, docs/DEMO_SCRIPT.md, docs/FREE_TIER.md (every service, its free limit, how we stay under it), LICENSE (MIT), a11y + Lighthouse pass, secret scan, dead-code removal. ✅ A stranger can clone and run locally in <10 minutes for $0; `npm run demo:reset` restores a perfect demo.

## 11. README must include (judges read this)

- Title, tagline, live demo URL, video link, hero GIF.
- The problem (video shopping friction + slow creator payouts) in 3–4 sentences.
- How it works (diagram from section 3) and why PayPal Checkout + Payouts is the backbone.
- Try it in 60 seconds (viewer path, creator path, sandbox guidance: guest card via PayPal's sandbox test card generator or your own sandbox account; no committed credentials).
- Features.
- Architecture (Mermaid) + lifecycle of one sale (frame → detection → match → order → commission → payout).
- Built with / Sponsor tools table: tool → what it does in Seen → file paths.
- AI usage (required): models/providers, what each does, structured output, guardrails, privacy (no face identification, own-content consent).
- Runs for $0: summary + link to docs/FREE_TIER.md.
- Local setup: prerequisites, `cp .env.example .env`, `docker compose up`, migrate, seed, run, webhook tunnel, every env var.
- Deploy (Render Blueprint button + Neon).
- Testing (unit, E2E, Postman).
- Limitations & roadmap (multiparty merchant onboarding, native platform integrations, Venmo, real-time audio product mentions, brand marketplace).
- License (MIT).

## 12. Demo video script (build exactly this; under 3:00)

- 0:00–0:15 Hook: viewer watching a creator, taps the hoodie on screen → paid with PayPal in 2 taps. "That hoodie wasn't tagged. Nobody set up a link. Seen saw it."
- 0:15–0:35 Problem: live shopping is exploding, but outside closed apps it's manual tags and "link in bio"; creators wait weeks for affiliate money.
- 0:35–1:20 Creator Studio: Go Live with the demo video → AI boxes appear on items → product cards pop in (Elastic match + Channel3 price comparison) → creator hides one item live. Flash the KERNEL live-view and Astropods trace for 2 seconds each.
- 1:20–2:00 Viewer: phone-width view, rail updates, "Buy with PayPal" in a drawer while video keeps playing → success toast "Maya earned $4.50".
- 2:00–2:30 Creator: AG Grid earnings update live, Zapier ping on phone, Pay me now → PayPal Payout succeeds, recap page shared.
- 2:30–2:50 Why PayPal: new checkout moments in every video, payouts to creators worldwide, creator-first. Runs on free tiers. Sponsor logos/tool list.
- 2:50–3:00 Tagline + URL.

Write this into docs/DEMO_SCRIPT.md with exact clicks, which flags to set, and the demo:reset step.

## 13. Definition of done

- No TS errors, ESLint clean, tests green, no browser console errors.
- No secrets in git history; .env.example complete.
- Every money operation idempotent and auditable; webhooks verified.
- Every external call has a timeout, safe retry policy, quota guard, and friendly fallback.
- Detections stable (no flicker), never identify people, respect creator hides.
- Works at 375px width; RTL renders correctly.
- Fresh clone → running locally for $0 in <10 minutes.
- Live URL survives a judge clicking around for 5 minutes, including when Gemini quota is exhausted (demo cache).

## Kickoff message (send this to Claude Code)

> Read docs/SPEC.md fully. It is the source of truth for this project, and the budget is strictly $0.
> Before writing any code:
> 1. Summarize the product, the core loop, and the money flow (checkout → commission → payout) in 6 bullets.
> 2. Check the official docs and list anything in the spec that is wrong, risky, or outdated, especially: current Gemini model names and free-tier limits, PayPal JS SDK version, PayPal Payouts sandbox setup and webhook event names, Channel3 API, KERNEL SDK, Astropods spec format, Elastic hybrid search on the free license, Neon and Render free-tier limits, Zapier free vs premium apps, Bryntum trial licensing for a public repo.
> 3. List every free account/key I need, in the order I'll need them, and which ones to delay until the final week.
> 4. Create CLAUDE.md with the working rules from section 0 (including the $0 rule) and the phase checklist.
>
> Then start Phase 1 only. Stop at the end of Phase 1 and show me the acceptance checks.
