# Vision pipeline: setup, demo video, demo cache

## How a frame flows

1. **Browser** (`components/studio/use-frame-sampler.ts`): every N seconds, draws the `<video>` to a canvas. It makes a ≤768px JPEG (quality 0.7) plus a 64-bit dHash.
   - Frames that barely changed (Hamming distance < `DHASH_MIN_DISTANCE`) are skipped, unless `MAX_STALE_SECONDS` have passed.
2. **Server** (`POST /api/streams/[id]/frames` → `lib/vision/process-frame.ts`):
   1. **Exact cache:** the same dHash returns the stored result, free.
   2. **Demo cache** (`DEMO_CACHE=true`): a dHash within `DEMO_CACHE_MAX_DISTANCE` bits of a cached frame reuses that frame's result. This is what lets the demo video run with zero quota.
   3. **AI:** the budget guard is checked first; the provider is set by `AI_PROVIDER`. Output is validated with zod, retried once with a "fix your JSON" hint, then passed through code guardrails (denylist, no people, clamped values, max 5 items).
   4. **Tracker** (`lib/vision/tracker.ts`) dedupes items into detections, using Gemini embeddings or word overlap when those are unavailable. An item only becomes **visible after 2 sightings within 15 seconds**, which stops one-frame flicker. Hidden items stay hidden; pinned items stay pinned.
3. **Pacing:** the response carries `nextIntervalSec`. In saver mode (≥80% of a limit) sampling slows to 2×. In cache-only mode the browser stops sending images, and only hashes get answered from the cache.

## Free-tier reality (measured 2026-10-11)

- The Gemini free tier allows **20 requests/day per model** for `gemini-3.5-flash` and `gemini-3.6-flash` (Google's `GenerateRequestsPerDayPerProjectPerModel-FreeTier`). Each model has its own quota.
- `gemini-3.8-flash` (the newest) was overloaded: 100 s+ answers and timeouts.
- The **Flash-Lite** models found the same products with equally accurate boxes, in 1.6–3.9 s. So the default chain is `3.5-flash-lite → 3.1-flash-lite → 3.5-flash → 3.6-flash`.
- On a 503, a 429 or a timeout, the frame fails over to the next model. A model out of daily quota is skipped until Google's reset time (from the 429's RetryInfo). When every model is out, the studio says so and only cached results are used.
- On 2026-10-22 Google was overloaded for hours: Lite took ~7 s even for a one-word text reply, and the other models answered 503. Per-model attempts now get 20 s and a frame 45 s overall.
- **Backup provider (OpenRouter, optional):** with `OPENROUTER_API_KEY` set, a frame Gemini can't answer (busy, timeout, out of quota) goes to OpenRouter's free vision models (`OPENROUTER_VISION_MODELS`, default `nvidia/nemotron-3.5-super-vl:free` then `google/gemma-4-31b-it:free`). It uses a separate free quota (20 requests/min, 50/day per [OpenRouter's limits](https://openrouter.ai/docs/api-reference/limits)), capped at 15/min and 45/day by `OPENROUTER_MAX_RPM`/`_RPD`. Gemini keeps 15 s of the frame's time free for the backup. The free model list changes, so check [openrouter.ai/models](https://openrouter.ai/models) (input: image, price: free) before the demo.
- **Budget your quota:** at most one frame every 4 s, and unchanged frames are skipped (stale resend every 30 s). Record the demo video and export the demo cache early, because replays then cost nothing.
- Frame-hash caching applies only to **uploaded/demo video files**. Live screen shares and cameras are always analysed fresh. Empty results and near-blank frames (white pages) are never cached.

## Providers

| `AI_PROVIDER` | Cost | Notes |
|---|---|---|
| `gemini` (default) | Free tier | Needs `GEMINI_API_KEY` from aistudio.google.com. Models are set in env. Free-tier inputs may be used by Google, so only send your own content. |
| `ollama` | Free, local | `ollama pull gemma3:4b` (or `qwen2.5vl:7b`). Tested with gemma3:4b on CPU: correct items, but rough boxes and roughly 1 minute per frame. Use it as an offline fallback, not for live. |
| `claude` | **Paid**, off by default | Needs `ANTHROPIC_API_KEY`. Uses the official SDK's structured outputs and server-side refusal fallback. |

## Recording the demo video (you)

- 60–90 s, your own room, your own face is fine (the AI never identifies people). Avoid copyrighted music and logos in focus.
- Show the 6 seeded items clearly, one at a time, each for 5–10 s: **black hoodie, wireless clip-on mic, speckled ceramic mug, black LED desk lamp, white low-top sneakers, round tortoiseshell sunglasses**. Hold each item still and centred, and say its name ("this mug…"). That helps the audio-context stretch feature later.
- Export as H.264 MP4, 720p or 1080p, under 30 MB. Save it as `public/demo/demo.mp4`.

## Building the demo cache (once, after recording)

1. Put your Gemini key in `.env` and run `npm run dev`.
2. Open `/studio/live`, click **Use demo video**, tick the consent box, then **Go live**. Let the whole video play once. Every analysed frame is cached by its dHash.
3. Run `npm run demo:cache:export`. This writes `prisma/demo-vision-cache.json`. Commit it.
4. From then on, `npm run demo:reset` (or a fresh clone's `db:seed`) imports it. With `DEMO_CACHE=true` the demo works even with no Gemini key, no quota, or no network to Google.

## Creator controls

In the studio's detections list: **Pin** (always shown), **Hide** (never shown again for this stream), and **Show** (undo a hide). The API also supports correcting a label: `PATCH /api/detections/[id] {"label": "…"}`. A UI for that comes in Phase 5.
