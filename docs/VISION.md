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
