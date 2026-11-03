# Deploying Seen for free

```
Judges' browsers ──► Render (free web service, Ohio) ──► Neon Postgres (free, us-east-2 / Ohio)
                          ▲     │
                          │     └─► PayPal sandbox · Gemini · Channel3 · (KERNEL)
Astropods watcher agent ──┘  (optional: KERNEL capture loop for "watch my stream URL")
```

Everything below is free. The Render web service and the Neon database sit in the same AWS region (Ohio), so database round trips take milliseconds.

## 1. Push the code to GitHub

1. On github.com → **New repository**:
   - name: `seen`;
   - Public (it's an open-source submission);
   - **don't** add a README or .gitignore.
2. In the project folder:
   ```bash
   git remote add origin https://github.com/<you>/seen.git
   git push -u origin main
   ```
   `.env` is gitignored, so no secrets are pushed. Check with `git ls-files | grep .env`: only `.env.example` should appear.

## 2. Production database (Neon branch)

Use a **separate branch** so local testing never touches what judges see.

1. Neon console → your project → **Branches** → **Create branch** → name `production` (from `main`).
2. Open the branch → **Connect**. Copy the **pooled** connection string (host contains `-pooler`). Migrations automatically use the direct host.
3. Seed it once from your machine:
   ```bash
   DATABASE_URL="<production pooled url>" npm run demo:reset
   ```
   On PowerShell: `$env:DATABASE_URL="<url>"; npm run demo:reset`

## 3. Render (Blueprint)

1. render.com → sign in with GitHub → **New → Blueprint** → pick the `seen` repo. Render reads `render.yaml`.
2. Fill in the values it asks for (everything marked `sync: false`):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Neon `production` pooled URL |
   | `APP_URL` | `https://<service-name>.onrender.com` (you can edit it after the first deploy) |
   | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | your sandbox app |
   | `PAYPAL_WEBHOOK_ID` | after step 4 |
   | `DEMO_CREATOR_PAYOUT_EMAIL` | your sandbox personal account |
   | `GEMINI_API_KEY` | AI Studio key |
   | `CHANNEL3_API_KEY`, `KERNEL_API_KEY` | optional |

   `DEMO_PANEL_KEY` and `WATCHER_TOKEN` are generated automatically. Find them under the service's **Environment** tab.
3. **Apply.**
   - The first build takes about 5–8 minutes.
   - The start command runs `prisma migrate deploy`, then `next start`.
   - The health check is `/api/health`.
4. Open `https://<service>.onrender.com/api/health`. You should see `"status":"ok"`.

**Free tier facts** (checked 2026-10):
- 750 instance hours a month;
- **sleeps after 15 minutes without traffic**;
- the first request after sleeping takes **about a minute**;
- ephemeral disk (fine: all state is in Neon).

### Wake-up tip for judges (put this in the README and Devpost)

> The live demo runs on Render's free tier and sleeps when idle. If the first load is slow, give it ~60 seconds; after that it's fast.

Before you present or record, open `/api/health` once to wake it. Optionally, a free uptime pinger hitting `/api/health` every 10 minutes keeps it awake during judging. That uses instance hours: about 730 h/month if pinged 24/7, which just fits under 750.

## 4. PayPal webhook (production)

1. developer.paypal.com → Apps & Credentials → (Sandbox) your app → **Webhooks → Add Webhook**.
2. URL: `https://<service>.onrender.com/api/webhooks/paypal`.
3. Events: the same list as in [PAYPAL_SANDBOX.md](PAYPAL_SANDBOX.md#3-webhooks-local-dev-via-a-free-tunnel).
4. Copy the **Webhook ID** into Render's `PAYPAL_WEBHOOK_ID` and redeploy (Manual Deploy → Deploy latest commit).

## 5. Optional: Astropods stream watcher

By default (`WATCHER_RUNTIME=local`), the KERNEL capture loop runs inside the web service. That's fine for a demo, but a sleeping free instance can't keep watching. To run it as an always-on agent, see [astropods/README.md](../astropods/README.md). Then set `WATCHER_RUNTIME=astropods` and `KERNEL_ENABLED=true` on Render.

## 6. Smoke test from a fresh browser

1. `/` → **Watch as Viewer** loads `/live/maya-makes`; **Open Creator Studio** loads `/studio` with no login.
2. `/studio/demo` → **Force detection** (the browser asks once for the demo key: Render → Environment → `DEMO_PANEL_KEY`). The product appears on the viewer page within a few seconds.
3. Buy it with a sandbox account or a sandbox card. Then **Pay me now** on `/studio/earnings`.

## Dependency audit (checked 2026-10-28)

- **Next.js is pinned to 16.4.3.** 16.0.0–16.4.0 have a critical advisory (unauthenticated RCE in the image optimizer with SVGs, plus a Server Actions DoS). Don't deploy an older 16.x.
- `npm audit fix` (non-breaking) was applied. The remaining findings (11 high, 1 moderate, 3 low) are all transitive. Most come through `@paypal/agent-toolkit@1.11.0` (the latest release), which pins older `ai`, `openai`, `@langchain/core`, `langsmith`, `mathjs` and `zod`. npm's suggested "fix" is a downgrade to 1.3.5, so we don't apply it.
- Exposure: Seen calls the toolkit only on the server, for two read-only lookups (`get_order`, `list_transactions`) with arguments built from our own DB. No user files, uploads or serialized objects reach those libraries, which is where the advisories apply.
- The low findings are in the `shadcn` CLI (a dev tool used to add components), not in the running app.
- Re-run `npm audit --omit=dev` before each deploy, and bump the toolkit when PayPal publishes a release with newer dependencies.

## Region note

Render's region can't be changed after creation; `render.yaml` sets `ohio` to sit next to Neon's `us-east-2`. If your Neon project is in another region, change `region:` before the first deploy (Render regions: oregon, ohio, virginia, frankfurt, singapore).
