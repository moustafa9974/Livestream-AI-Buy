# Running Seen for $0

Every service Seen uses is free, a free trial, or covered by hackathon credits. The limits below are enforced in code (`lib/budget.ts`, `lib/flags.ts`), not just written down. Near a limit, Seen degrades (fewer frames, then cached results only, then "unavailable"). It never fails the checkout.

Free tiers change often. The "checked" dates are when we last looked. Re-check the linked pages before relying on a number.

| Service | Free how | Limit we plan around | How Seen stays under it |
|---|---|---|---|
| **PayPal REST (sandbox)** | Sandbox is free | No real money; normal sandbox rate limits | Token cached until expiry; idempotent retries only on safe errors |
| **Gemini API** | Free tier ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)) | Per model, per day. Measured 2026-10-11: Flash-Lite models usable all day, only 20/day for `gemini-3.5-flash` / `3.6-flash` | `GEMINI_MAX_RPM=8`, `GEMINI_MAX_RPD=150` (below the real quota); saver mode at 80%; dHash filter skips unchanged frames; vision results cached by frame hash; fail over across models |
| **Gemini embeddings** | Free tier | Separate quota | `GEMINI_EMBED_MAX_RPM/RPD`; embeddings cached by text hash; catalog embedded once (`npm run catalog:embed`) |
| **OpenRouter** (backup vision) | Free `:free` models | 20 req/min, 50 req/day | `OPENROUTER_MAX_RPM=15`, `OPENROUTER_MAX_RPD=45`; only used when Gemini can't answer |
| **Demo cache** | Ours | n/a | `DEMO_CACHE=true` answers the demo video's frames from `prisma/demo-vision-cache.json` with zero API calls |
| **Neon Postgres** | Free plan ([limits](https://neon.com/faqs/free-plan-limits-and-quotas)) | 0.5 GB storage and 100 CU-hours compute per project per month; scales to zero after 5 min idle (checked 2026-11) | Small seeded dataset; only the last few frames' images kept; one `production` branch for judges, `main` for dev |
| **Render** | Free web service | 750 instance hours/month; sleeps after 15 min idle; ~1 min cold start (checked 2026-10) | One service; all state in Neon; no paid workers (background loop runs in-process or on Astropods) |
| **Channel3** | 20,000 credits with code `PAYPAL-HACKATHON-2026` | Credits, not time | `CHANNEL3_MAX_CALLS_PER_DAY=300`; results cached 24 h by normalized query; never blocks the rail |
| **KERNEL** | $50 hackathon credits | Billed per browser-second (headful) | `KERNEL_MAX_SESSIONS_PER_DAY=3`, `KERNEL_MAX_SESSION_MINUTES=10`, daily minute budget, auto-stop on stream end or 5 failures, KERNEL `timeout_seconds`, kill switch in the demo panel. Off by default |
| **Astropods** | Free signup credit | Small always-on agent | Optional (`WATCHER_RUNTIME=local` is the default) |
| **Elastic** | Local Docker (free license) for dev; Elastic Cloud 14-day trial for the hosted demo | Trial length | Start the trial in the final week; Postgres FTS + pgvector fallback with the same interface |
| **Zapier** | Free plan + Pro trial (Webhooks by Zapier is premium) | Trial length; task count | Start the trial in the final week; in-app notification center is the fallback |
| **AG Grid Community** | MIT | none | n/a |
| **Bryntum Calendar** | Public trial build (watermark) | Evaluation only | Loaded from jsDelivr at runtime, never committed; agenda-list fallback. Off by default |
| **Ollama** | Local, open source | Your machine | Optional offline vision fallback |
| **Claude API** | **Paid**: off by default | n/a | Adapter exists; only used if you set `AI_PROVIDER=claude` and a key |
| **GitHub, YouTube, Postman, OBS, Playwright, Vitest** | Free | n/a | n/a |
| **Live video (WebRTC)** | Browser to browser; Google's public STUN servers are free | No media server, so no bandwidth bill. Each viewer uses the creator's upload | `WEBRTC_MAX_VIEWERS=6`; frame-snapshot fallback; optional TURN only if you add one |
| **Cloudflare quick tunnel** (local webhooks) | Free, no account | URL changes each run | Only for local webhook testing |

## What happens when a limit is hit

| Limit reached | What the user sees | What still works |
|---|---|---|
| Gemini near quota (80%) | "Free-tier saver mode" badge; frames sampled less often | Everything |
| Gemini out of quota | OpenRouter answers, else cached frames, else "AI unavailable" | Rail (existing detections), Force detection, checkout, payouts |
| Channel3 cap | "Similar items unavailable" | Partner cards and PayPal checkout |
| KERNEL cap | "KERNEL unavailable today" | Upload and screen-share sources |
| Render asleep | First load takes ~60 s | Everything afterwards |

`/api/health` lists every feature as on or off, with a reason. Reasons never include secret values.

## Privacy note on free AI tiers

Google may use free-tier Gemini inputs to improve its products. Seen only sends frames of the creator's own content, after the creator confirms consent. Frames are never analyzed for people: the prompt and the guardrails drop anything about faces or identity.
