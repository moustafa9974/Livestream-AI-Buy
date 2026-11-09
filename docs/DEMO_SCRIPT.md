# Demo script (under 3:00)

The submission video, with every click, and how to get a perfect demo state every time.

## Before you record (10 minutes)

1. **Flags** in `.env` (or on Render):
   ```
   DEMO_MODE=true
   DEMO_CACHE=true            # demo video works even with no Gemini quota
   COMMISSION_HOLD_HOURS=0    # sales are payable immediately
   PAYPAL_ENABLED=true
   CHANNEL3_ENABLED=true      # with CHANNEL3_API_KEY set
   ELASTIC_ENABLED=true       # with ELASTIC_URL / ELASTIC_API_KEY (else Postgres fallback, still fine)
   ZAPIER_ENABLED=true        # with a Catch Hook URL saved in Studio → Settings
   KERNEL_ENABLED=true        # only for the 2-second live-view flash
   CHECKOUT_SHIPPING_PREFERENCE=NO_SHIPPING   # fewer popup steps on camera
   ```
2. **Reset:** `npm run demo:reset`, or on the live site **Studio → Demo → Reset demo data**.
3. **Wake the server:** open `/api/health`. You should see `"status":"ok"`, and every sponsor feature you need should say `enabled`.
4. **Two browser windows:**
   - left: desktop width, `/studio/live`;
   - right: DevTools device mode at 375 px, `/live/maya-makes`.
5. **Be signed in:**
   - sandbox buyer password ready (developer.paypal.com → Sandbox Accounts → ⋮ → View/Edit account);
   - your phone showing the Zapier notification app or email;
   - a KERNEL live-view tab and the Astropods trace view open in background tabs.
6. **Rehearse once, then reset again.** The rehearsal creates sales and a payout.

**If something breaks on camera:** go to **Studio → Demo**. **Force detection** puts any product on the rail with zero AI calls. **Simulate sale** records a sale without PayPal. Use them, then carry on.

## The script

### 0:00–0:15 Hook
- **Screen:** the phone-width viewer, video playing. Tap the **hoodie** card → **Buy now** → PayPal button → log in → pay.
- **Toast:** "Paid ✅ — Maya Makes earned $4.50 from your purchase."
- **Voice:** "That hoodie wasn't tagged. Nobody set up a link. Seen saw it."

### 0:15–0:35 Problem
- **Screen:** landing page `/`, scroll slowly through "How it works".
- **Voice:** "Live shopping is exploding, but outside closed apps it's manual tags and 'link in bio'. Viewers lose the impulse, and creators wait weeks for affiliate money."

### 0:35–1:20 Creator Studio
1. `/studio/live` → **Use demo video** → tick the consent box → **Go live**.
2. AI boxes appear on the items. Cards pop into **Detected products**. Point at the "Exact match" chip and the Channel3 line "$X less than similar items".
3. Click **Hide** on one item, e.g. the sunglasses. It disappears from the viewer window on the right.
4. Flash the KERNEL live-view tab (2 s), then the Astropods trace (2 s).
- **Voice:** "Gemini reads the frames, Elastic matches them to partner stores, Channel3 compares prices. The creator stays in control: hide anything, live."

### 1:20–2:00 Viewer
1. Right window: the viewer sees Maya's video **in real time** (the "Real-time video" badge), and the rail updates as products appear.
2. Tap the **mug** → the drawer opens and the video keeps playing → **Debit or Credit Card** (guest, sandbox card) or the PayPal button.
3. Success toast.
4. Agentic commerce (10 s): **Ask about these products** → "Is the mug cheaper anywhere else?" → "OK, buy the mug" → Buy card → PayPal. Say: "The agent shops for the viewer, but never pays on its own."
- **Voice:** "One tap, PayPal or any card, without leaving the video. Prices come from the store's database. The AI never touches money."

### 2:00–2:30 Creator gets paid
1. `/studio/earnings`: the new sales are in the AG Grid ledger. Show the **Timeline** briefly (`order.captured` → `commission.created`).
2. Phone: the Zapier "New sale" ping.
3. **Pay me now** → "Payout processing…" → paid.
4. Back in `/studio/live`: **End stream** → **Recap ↗**. Show the shareable recap page (`/recap/<streamId>`).
- **Voice:** "Commissions land in a real ledger, and PayPal Payouts sends them to the creator in one click. No 30-day wait."

### 2:30–2:50 Why PayPal
- **Screen:** landing page "Why PayPal" section, then the "Built with" sponsor row.
- **Voice:** "Every video becomes a new checkout moment for PayPal. Payouts reach creators worldwide. And it all runs on free tiers."

### 2:50–3:00 Close
- **Screen:** tagline and URL.
- **Voice:** "Seen. If it's on screen, it's shoppable, and the creator gets paid."

## After recording

- `npm run demo:reset` (or the Demo panel) so judges find a clean state.
- Leave `DEMO_MODE=true` on Render, with `DEMO_PANEL_KEY` set, so strangers can't reset it mid-judging.
