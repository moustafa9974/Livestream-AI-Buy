# Sponsor tools in Seen

Every integration sits behind a flag (`lib/flags.ts`). If a service is off, out of quota or down, its feature shows an "unavailable" state and the core loop keeps working: frame → detection → product card → PayPal checkout → commission → payout.

| Tool | What it does in Seen | Where |
|---|---|---|
| **PayPal** | Checkout (Orders v2 + JS SDK v6, PayPal button and guest card), refunds, creator commissions paid by **Payouts**, verified webhooks | `lib/paypal/`, `lib/commerce/`, `components/paypal/`, `app/api/webhooks/paypal` |
| **PayPal Agent Toolkit** | Read-only PayPal lookups for the creator assistant (order status, recent transactions) | `lib/assistant/tools.ts` |
| **Gemini** | Frame analysis, embeddings for dedupe/matching, assistant, recap headline | `lib/ai/` |
| **Channel3** | Open-web "similar items" and the "$X less than similar items" price comparison | `lib/channel3/` |
| **Elastic** | Hybrid product search (BM25 + kNN on Gemini vectors). Postgres fallback | `lib/search/elastic.ts`, `npm run search:index` |
| **KERNEL** | Cloud browser that watches a creator's own stream URL, with a live-view link | `lib/kernel/watcher.ts`, studio "Watch with KERNEL" |
| **Zapier** | Creator events sent to their Zaps | `lib/notify.ts`, Studio → Settings |
| **AG Grid Community** | Earnings (by product + ledger) and detections grids, quick filter, CSV export | `components/grid/data-grid.tsx`, `app/studio/earnings`, `app/studio/stream/[id]/detections` |
| **Bryntum Calendar** (trial) | Schedule: upcoming streams, payout runs, commission eligibility | `app/studio/schedule` |
| **Astropods** | Hosted stream-watcher agent | `astropods/` |
| **Render** | Free web service hosting | `render.yaml` |
| **Postman** | API collection with tests: Seen endpoints + direct PayPal sandbox calls | `postman/` |

## PayPal: our client vs the Agent Toolkit

- **Money moves only through our own typed client** (`lib/paypal/`): checkout, capture, refunds, payouts.
  - Every POST carries a `PayPal-Request-Id`, so retries never double-charge.
  - Amounts are computed server-side in integer minor units.
  - Every state change goes through one state machine, shared by API calls and webhooks.
- **The assistant uses the PayPal Agent Toolkit** (`@paypal/agent-toolkit`) for *read-only* lookups: `get_order` and `list_transactions`.
  - The toolkit sees the whole platform account, so results are filtered to the signed-in creator's own sales.
  - Payer details are stripped before anything reaches the AI.
- **The assistant's "pay me now" and "refund order X" call our own client.** They only run when the creator's latest message explicitly asks for that action. Amounts always come from the ledger, never from the AI.

## Zapier recipes

**Setup (once):**
1. In Zapier, create a Zap with the trigger **Webhooks by Zapier → Catch Hook**. Webhooks by Zapier is a premium app; it works during Zapier's free Pro trial.
2. Copy the hook URL into **Studio → Settings → Zapier** and click **Send test event**.
3. In Zapier, click **Test trigger**. You'll see the sample event. Add an action from a recipe below.
4. Set `ZAPIER_ENABLED=true` in `.env`.

**Every event looks like this:**

```json
{
  "event": "sale.created",
  "occurred_at": "2026-10-16T18:20:11.000Z",
  "creator": { "slug": "maya-makes", "name": "Maya Makes" },
  "title": "New sale: Everyday Oversized Hoodie: Black",
  "body": "You earned $4.50 commission.",
  "data": { "orderId": "…", "product": "Everyday Oversized Hoodie: Black", "commissionMinor": 450, "currency": "USD" }
}
```

**Events:**
- `sale.created`
- `commission.paid`
- `payout.failed`
- `stream.recap` (`data.recapPath` is the shareable recap)
- `budget.saver_mode`

No buyer names or emails are ever sent. Money is in minor units plus currency.

**Recipes.** Use a **Filter by Zapier** step on `event` so one hook can feed several Zaps.

1. **Sale alert on your phone.** Filter `event = sale.created` → **SMS by Zapier** or **Gmail: Send Email**. Message: `{{title}}: {{body}}`.
2. **Earnings log in Google Sheets.** Filter `event = sale.created` → **Google Sheets: Create Spreadsheet Row**. Columns: `occurred_at`, `data.product`, `data.commissionMinor / 100`, `data.currency`.
3. **Payout confirmations.** Filter `event = commission.paid` → **Slack: Send Channel Message** or **Gmail**.
4. **Payout problems.** Filter `event = payout.failed` → **Gmail** to yourself, subject `{{title}}`.
5. **Top product of the stream on Discord.** Filter `event = stream.recap` → **Discord: Send Channel Message**: `{{body}} Replay: https://YOUR-APP/{{data.recapPath}}`.

**If Zapier is off or down:** every event still appears in the 🔔 notification center in the studio, and each notification shows whether it reached Zapier.

## KERNEL

- **How it works:** **Studio → Watch with KERNEL** opens the creator's own public stream page in a KERNEL cloud browser. Seen connects over CDP (Playwright), finds the largest `<video>`, and screenshots just that area every few seconds. The screenshots feed the same frame pipeline as screen sharing.
- **Live view:** the studio shows an **Open KERNEL live view** link.
- **Caps** (to protect the hackathon credits):
  - `KERNEL_MAX_SESSIONS_PER_DAY`;
  - `KERNEL_MAX_SESSION_MINUTES` per session, plus a daily minute budget;
  - auto-stop when the stream ends or after 5 consecutive failures;
  - KERNEL's own `timeout_seconds` deletes the browser even if our server dies;
  - **Demo panel → Kill all KERNEL sessions** stops everything.
- **Consent:** creators must confirm it's their own channel; consent is stored with the stream. Only public `https://` URLs are accepted.
- **Cost:** KERNEL bills headful browsers per second. Idle browsers enter standby and stop billing.

## Bryntum

Bryntum Calendar is a commercial product. Its public **trial** build is for evaluation and shows a watermark. To keep this repo open source:
- no Bryntum code is committed or installed;
- with `BRYNTUM_ENABLED=true`, the schedule page loads the trial build (pinned `@bryntum/calendar-trial@7.3.7`) from jsDelivr at runtime;
- with it off, or if the CDN is unreachable, the same events render as a built-in agenda list.

**What it's used for:**
- Maya's schedule: streams, Friday payout runs, and when pending commissions become payable.
- **Brand slots:** drag across a day (`features.drag` with `creatable: true`) to request a slot. Our own form replaces Bryntum's editor (`eventEdit: false`), so every slot is validated on the server: future only, 15 min to 3 h, no overlaps, the brand must sell the product. Approve or decline from the list, and the calendar event updates in place (`eventStore.getById` → `record.set` / `remove`).
- Existing items can't be dragged, resized or deleted (`draggable: false`, `resizable: false`, `beforeEventDelete` → false), because streams and payouts come from the ledger.
- The API we use was checked against the 7.3.7 type definitions in the trial package.

## AG Grid Community

MIT-licensed `ag-grid-community` + `ag-grid-react` v36 (`AllCommunityModule`, Quartz theme), themed with the app's CSS tokens.
- **Live earnings:** the page watches a cheap version endpoint (`/api/studio/earnings/version`) and refreshes its data in place; rows are matched by `getRowId`, so a new sale is inserted (and glows via `rowClassRules`) instead of the grid redrawing.
- **Cell change flash** (`HighlightChangesModule`): commission, order total and payout status flash when they change (eligible → payout sent → paid, refunds).
- **Pinned totals row** (`PinnedRowModule`), only summed when all sales share one currency.
- Quick filter, sorting, column filters and CSV export on every grid. Detection labels are editable inline: a correction re-matches the product.
- Row grouping is AG Grid Enterprise (paid), so it isn't used.

## Elastic and Channel3

See [MATCHING.md](MATCHING.md).

## APIMatic

Use APIMatic's context plugins to give your coding assistant accurate PayPal API context (Orders v2, Payments v2, Payouts v1, Webhooks). Install the plugin per APIMatic's instructions for your editor, and point it at PayPal's official OpenAPI specs:
- `https://developer.paypal.com/api/orders/v2/schema.json`
- `https://developer.paypal.com/api/payments/v2/schema.json`
- `https://developer.paypal.com/api/payments.payouts-batch/v1/schema.json`
- `https://developer.paypal.com/api/webhooks/v1/schema.json`

These are the same specs this project's PayPal client was written against; see the comments in `lib/paypal/gateway.ts`.
