# Seen stream-watcher agent (Astropods)

A small always-on agent that watches creators' **own** stream pages (Twitch, YouTube Live, Kick, …) in a **KERNEL** cloud browser. It screenshots the video player every few seconds and sends the frames to Seen, which runs its normal pipeline: vision AI → stabilized detections → product match → live rail.

## Why an agent

The Seen web app runs on Render's free tier, which sleeps after 15 minutes without traffic. A creator streaming somewhere else generates no traffic to Seen, so the capture loop needs a home that stays awake. That's this agent. With `WATCHER_RUNTIME=local` (the default), the same loop runs inside the web app instead, and the demo never depends on Astropods.

## How it works (SPEC §6.2 tools → code)

| Spec tool | Where |
|---|---|
| `get_pending_frames` | `getAssignments()` → `GET /api/watcher/assignments` (which streams to watch) |
| `analyze_frame`, `upsert_detection`, `match_products`, `publish_rail_update` | `POST /api/watcher/frames`. Seen runs these in `processFrame` + `matchNewlyVisible`, the same code the browser sampler uses |
| session lifecycle | `POST /api/watcher/session` (`started` / `minute` / `stopped`) |

**Seen stays in charge:**
- every request carries `Authorization: Bearer <WATCHER_TOKEN>`;
- Seen decides which streams may be watched (live, creator consent stored, public https URL only);
- Seen spends the KERNEL caps (`kernel_sessions`, `kernel_minutes`);
- Seen can answer `{ "stop": true }` at any time: stream ended, cap reached, or the demo panel's kill switch.

The agent stops the KERNEL browser immediately when told to. KERNEL's own `timeout_seconds` deletes the browser even if the agent crashes.

## Deploy

Needs an Astropods account (free signup credit). CLI docs: https://docs.astropods.com/cli.md

```bash
# from this folder (astropods/)
ast project configure            # set inputs: SEEN_API_URL, SEEN_WATCHER_TOKEN, KERNEL_API_KEY
ast blueprint push               # publish a versioned blueprint from astropods.yml
ast blueprint deploy             # run it
ast agent logs seen-stream-watcher   # follow the JSON logs
```

Then, on the Seen app (Render → Environment):
- `WATCHER_RUNTIME=astropods`
- `KERNEL_ENABLED=true`
- `WATCHER_TOKEN` = the same value you gave the agent as `SEEN_WATCHER_TOKEN`

**Inputs** (declared in `astropods.yml`):

| Input | What |
|---|---|
| `SEEN_API_URL` | e.g. `https://seen.onrender.com` |
| `SEEN_WATCHER_TOKEN` (secret) | same as Seen's `WATCHER_TOKEN` |
| `KERNEL_API_KEY` (secret) | KERNEL key (hackathon credits) |
| `POLL_SECONDS` | how often to ask Seen for work (default 5) |

## Run it locally (no KERNEL credits needed)

`LOCAL_BROWSER=1` uses a local Chromium instead of KERNEL. Installed by `npx playwright install chromium` in the main project.

```bash
# terminal 1: Seen in astropods mode
WATCHER_RUNTIME=astropods KERNEL_ENABLED=true WATCHER_TOKEN=dev-token npm run dev
# terminal 2: the agent
cd astropods/agent && npm install
SEEN_API_URL=http://localhost:3000 SEEN_WATCHER_TOKEN=dev-token LOCAL_BROWSER=1 npm start
```

Then, in the studio: **Watch with KERNEL** → paste a public https page. The agent picks it up within a few seconds.

**Tested 2026-10-20 (local mode):** using a public Wikimedia photo page of a laptop and mug, the agent sent 5 frames, Seen detected laptop / keyboard / coffee mug, and the mug became a buyable "Speckled Stoneware Mug" card on the viewer page.

## Observability

Logs are one JSON line per event (`watcher up`, `starting`, `frame` with item count, `stopped` with reason), viewable with `ast agent logs` and in the Astropods dashboard. Astropods' trace view only covers its official integrations (currently Claude Code; see https://docs.astropods.com/monitor-external-agents.md), so this custom agent reports through logs and pod metrics rather than traces.
