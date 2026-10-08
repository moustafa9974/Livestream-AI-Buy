# PayPal sandbox setup (free)

Everything here uses PayPal's **sandbox**. No real money moves.

## 1. App credentials

1. Log in at <https://developer.paypal.com/dashboard/>.
2. **Apps & Credentials** → make sure the toggle says **Sandbox** → **Create App** (type: Merchant).
3. Copy **Client ID** and **Secret** into `.env`:
   ```
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   ```
4. On the app page, under **Features**, tick **Payouts** and save. "Pay me now" needs it.

## 2. Sandbox accounts

**Testing Tools → Sandbox Accounts** has a default business (the platform, which receives payments) and a default personal account (a viewer who buys).

- Create one more **Personal** account to receive creator payouts, then put its email in `.env` as `DEMO_CREATOR_PAYOUT_EMAIL` and run `npm run demo:reset`.
- To log in as a buyer in the PayPal popup, use a personal account's email. Its password is under **⋮ → View/Edit account**.
- **Guest card checkout:** use PayPal's sandbox card generator (**Testing Tools → Credit Card Generator**) to get a test card number.

## 3. Webhooks (local dev, via a free tunnel)

PayPal needs a public HTTPS URL to deliver webhooks. Cloudflare's quick tunnel is free and needs no account.

1. Install cloudflared: `winget install --id Cloudflare.cloudflared` (or download it from <https://github.com/cloudflare/cloudflared/releases>).
2. Run the app (`npm run dev`), then in a second terminal:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
   It prints a URL like `https://random-words.trycloudflare.com`.
3. In your sandbox app, under **Webhooks** → **Add Webhook**:
   - URL: `https://random-words.trycloudflare.com/api/webhooks/paypal`
   - Events:
     - `CHECKOUT.ORDER.APPROVED`
     - `PAYMENT.CAPTURE.COMPLETED`
     - `PAYMENT.CAPTURE.PENDING`
     - `PAYMENT.CAPTURE.DENIED`
     - `PAYMENT.CAPTURE.REFUNDED`
     - `PAYMENT.PAYOUTSBATCH.SUCCESS`
     - `PAYMENT.PAYOUTSBATCH.DENIED`
     - `PAYMENT.PAYOUTSBATCH.PROCESSING`
     - `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`
     - `PAYMENT.PAYOUTS-ITEM.FAILED`
     - `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`
     - `PAYMENT.PAYOUTS-ITEM.RETURNED`
     - `PAYMENT.PAYOUTS-ITEM.BLOCKED`
     - `PAYMENT.PAYOUTS-ITEM.CANCELED`
     - `PAYMENT.PAYOUTS-ITEM.HELD`
     - `PAYMENT.PAYOUTS-ITEM.REFUNDED`
4. Copy the **Webhook ID** into `.env` as `PAYPAL_WEBHOOK_ID` and restart the app.

Quick-tunnel URLs change on every run, so update the webhook URL each time (or skip webhooks; see below).

**Webhooks are optional for the core loop.** The browser captures the order and the earnings page polls payout status, so everything works without them. Webhooks add robustness: a capture still happens if the viewer closes the tab after approving, and refunds made in the PayPal dashboard are picked up.

**Security:** `/api/webhooks/paypal` verifies every event with PayPal (`/v1/notifications/verify-webhook-signature`) and rejects anything that fails, including everything when `PAYPAL_WEBHOOK_ID` is unset. PayPal's simulator "mock" events can't be verified (PayPal's docs say so), so they're rejected too; use real sandbox purchases instead.

## 4. Phase 2 acceptance test (manual, about 5 minutes)

1. `npm run dev`, then open <http://localhost:3000/live/maya-makes>.
2. Click **Buy with PayPal** on the hoodie ($45). In the drawer, click the PayPal button, log in as the sandbox *buyer* personal account, and pay. You should see the toast **"Paid ✅ — Maya Makes earned $4.50 from your purchase."**
3. Buy another item using **Debit or Credit Card** with a generated sandbox card (guest checkout).
4. Open <http://localhost:3000/studio/earnings>. The new sales show as `eligible`, and the timeline shows `order.captured` and `commission.created`.
5. Click **Pay me now**. The status goes to `payout sent`, then `paid`. Log in to <https://www.sandbox.paypal.com> as the creator's personal account to see the money arrive.
6. Make one more purchase, then click **Refund** on it in the ledger. The order shows as refunded and the commission as `reversed`.
7. With webhooks configured: look at the timeline and the `WebhookEvent` table (`npx prisma studio`). Each PayPal event appears once, and duplicates are reported as `duplicate`, not processed again.

## Automated tests

- `npm test`: unit tests (money math, state machines, PayPal client retry/idempotency rules, webhook raw-body verification).
- `npm run test:db`: money-flow integration tests against your `DATABASE_URL`, using a fake PayPal. They cover replayed captures, concurrent capture + webhook, refund replays, partial refunds, double-click payouts, rejected payouts, refunds during an in-flight payout, and unclaimed → paid. Test data is created with `test_` IDs and deleted afterwards.
