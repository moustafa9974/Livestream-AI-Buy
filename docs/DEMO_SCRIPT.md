# Demo script (under 3:00)

The submission video, shot by shot, plus how to get a clean demo every time. It follows
the same order as the app's step bar: **shop as a viewer → see Maya get paid → go live as Maya**.

## Before you record (15 minutes)

1. **Film a production build, not the dev server.** It's faster, shows no Next.js "N" badge
   and doesn't hit dev-cache glitches. Stop `npm run dev` (Ctrl+C), then:
   ```
   npm run film
   ```
   This builds the app, resets the demo data and starts it at http://localhost:3000.
   Wait for "Ready", then open http://localhost:3000/api/health: `"status":"ok"`.
2. **Check `.env`:** `DEMO_MODE=true`, `DEMO_CACHE=true`, `COMMISSION_HOLD_HOURS=0`,
   `ZAPIER_ENABLED=true`, `BRYNTUM_ENABLED=true`. Optional for fewer PayPal popup steps:
   `CHECKOUT_SHIPPING_PREFERENCE=NO_SHIPPING`.
3. **Zapier:** your Zap is **On** (Zapier → Zaps). Test it once: **Studio → Demo panel →
   Simulate a sale**, and the email arrives on your phone. Gmail notifications on.
4. **Make Maya live before the first take** (off camera):
   **Studio → Go live → Use demo video → tick consent → Go live**. Leave this tab open the
   whole time: it's the broadcaster. Wait about 30 s until **Detected products** shows the mug
   and lamp.
5. **Browser:** Chrome, zoom 100%, window 1920×1080 (or 1366×768), bookmarks bar hidden,
   notifications muted. Tabs in order: landing `/`, viewer `/live/maya-makes`, studio tab from step 4.
6. **Sandbox buyer** login ready (developer.paypal.com → Sandbox Accounts → ⋮ → View/Edit account).
7. **Rehearse once, then reset:** Studio → Demo panel → **Reset demo data**, then redo step 4.

**If something breaks on camera:** Studio → Demo panel → **Force detection** puts any product
on the viewer page instantly (no AI); **Simulate a sale** records a sale without a payment.

Amounts on this setup: mug **$22.00** → Maya earns **$2.20**; lamp **$54.00** → **$5.40**.

## The script

### 0:00–0:15 · Hook
- **Screen:** landing page. Let the hero animation play once (boxes lock onto products,
  cards slide in, "Maya earned $4.50").
- **Voice:** "Live shopping is huge, but outside closed apps it's still 'link in bio'.
  Viewers lose the impulse, and creators wait weeks to get paid. Seen fixes both."
- **Click:** **Start the demo as a viewer**.

### 0:15–0:50 · Shop as a viewer
- **Screen:** Maya's live video plays, with **Speckled Stoneware Mug** and **Arc LED Desk Lamp**
  in the product rail and "Shop this moment" under the video.
- **Voice:** "Nobody tagged anything. Seen's AI watched the video and found the mug and the
  lamp, matched to real store products."
- **Click:** mug card → **Buy now** → **PayPal** button → log in as the sandbox buyer → pay.
- **Screen:** the checkmark draws itself; toast: *"Your purchase supports Maya Makes, who earns
  $2.20 commission."*
- **Voice:** "One tap with PayPal, and the video never stopped."

### 0:50–1:10 · The shopping agent (agentic commerce)
- **Click:** **Ask about these products** → **"Is the mug cheaper anywhere else?"**
- **Screen:** the agent names a similar mug, the store and the price, and says only buying here supports Maya.
- **Type:** "OK, buy the lamp" → a **Buy now** card appears.
- **Voice:** "The agent shops for the viewer: it compares real prices and prepares checkout.
  But it never pays on its own. The viewer always approves in PayPal."

### 1:10–1:45 · See Maya get paid
- **Click:** the toast's **See Maya Makes's side →** (or the step bar's **See Maya get paid**).
- **Screen:** Earnings. The mug sale glows at the top of the ledger, the Totals row flashes, and
  a toast reads "New sale… You earned $2.20".
- **Show your phone:** the Zapier email "New sale: Speckled Stoneware Mug".
- **Click:** **Pay me now** → "Payout processing…" → **paid**. Point at "Payouts by PayPal".
- **Voice:** "The sale lands in Maya's ledger in real time, and PayPal Payouts sends her
  commission in one click. Minutes, not weeks."

### 1:45–2:15 · Go live as Maya
- **Click:** step bar **Go live as Maya** (the studio tab).
- **Screen:** the video plays in the studio with **Detected products**: mug, lamp, laptop,
  mouse, glass dome rose.
- **Click:** **Hide** (eye icon) on the glass dome rose. Switch to the viewer tab: it's gone.
- **Voice:** "Maya just streams. Gemini spots products in real time, viewers watch her video live,
  browser to browser, and she stays in control: hide anything, instantly."
- *Optional (2 s):* the KERNEL live view, "it can even watch a stream URL in a cloud browser."

### 2:15–2:35 · Brand slots
- **Click:** **Schedule** → drag across an empty future day → pick **Northloop Apparel**,
  a product → **Request slot** → **Approve**.
- **Voice:** "Brands book a slot to have Maya feature their product, and she approves.
  New revenue on top of commission."

### 2:35–2:50 · Why PayPal
- **Screen:** landing page → scroll to the stats band, then the **PayPal** "Why PayPal" section.
- **Voice:** "Every video becomes a PayPal checkout moment, and creators get paid worldwide
  with PayPal Payouts. The AI never touches the money: prices and payouts come from the ledger."

### 2:50–3:00 · Close
- **Screen:** hero with the tagline (and your Devpost/GitHub link if you add a title card).
- **Voice:** "Seen. If it's on screen, it's shoppable, and the creator gets paid."

## Recording tips

- Record each section as its own take; stitch them in an editor. Voice-over can be recorded
  separately and laid on top.
- No copyrighted music (YouTube Audio Library is free). The demo clip is Pexels (free license)
  and PayPal's logo is PayPal's own file.
- Keep it under 3:00: judges aren't required to watch past that.

## After recording

- Studio → Demo panel → **Reset demo data**, then restart `npm run dev` for normal work.
