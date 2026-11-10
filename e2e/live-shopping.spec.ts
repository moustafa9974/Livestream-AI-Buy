import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The core loop through real browsers, as a creator and a viewer would use it:
 * creator shares a screen showing mugs → Go live → frames go to Gemini → the viewer's
 * live rail shows a buyable mug card → Buy now opens the checkout drawer.
 *
 * Headless Chromium has no screen to share, so getDisplayMedia is replaced with a
 * canvas stream showing the fixture image. Everything after that is the real app.
 * Costs ~1–3 Gemini requests per run.
 */

const FIXTURE = path.join(__dirname, "fixtures", "mug-search-screen.jpg");

async function fakeScreenShare(page: Page) {
  const dataUrl = `data:image/jpeg;base64,${readFileSync(FIXTURE).toString("base64")}`;
  await page.addInitScript((src: string) => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      // Keep painting so the track keeps producing frames, like a real screen.
      const paint = () => ctx.drawImage(img, 0, 0);
      paint();
      setInterval(paint, 200);
      return canvas.captureStream(5);
    };
  }, dataUrl);
}

// Start (and finish) off air: a stream left live by another test shows "End stream"
// instead of "Go live".
test.beforeEach(async ({ request }) => {
  await request.post("/api/streams/seed_stream_demo/live", { data: { action: "stop" } });
});
test.afterEach(async ({ request }) => {
  await request.post("/api/streams/seed_stream_demo/live", { data: { action: "stop" } });
});

test("screen share of mugs becomes a buyable card for viewers", async ({ browser }) => {
  const creator = await browser.newPage();
  const viewer = await browser.newPage();
  const consoleErrors: string[] = [];
  for (const p of [creator, viewer]) p.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

  await fakeScreenShare(creator);
  await creator.goto("/studio");
  await creator.getByRole("button", { name: "Share screen / OBS" }).click();
  await creator.getByRole("checkbox").check();
  const started = Date.now();
  await creator.getByRole("button", { name: "Go live" }).click();
  await expect(creator.getByText("Live now")).toBeVisible();

  await viewer.goto("/live/maya-makes");
  const card = viewer.getByRole("listitem").filter({ hasText: "Speckled Stoneware Mug" });
  await expect(card).toBeVisible({ timeout: 90_000 });
  console.log(`mug card visible ${((Date.now() - started) / 1000).toFixed(1)}s after Go live`);

  // Checkout drawer opens and the PayPal JS SDK loads (paying needs a human login).
  await card.getByRole("button", { name: /^Buy / }).click();
  await expect(viewer.getByRole("dialog").getByText("Speckled Stoneware Mug")).toBeVisible();
  await expect(viewer.getByText("Loading PayPal…")).toBeHidden({ timeout: 30_000 });
  await expect(viewer.locator("paypal-button, paypal-basic-card-button").first()).toBeAttached();

  await creator.getByRole("button", { name: "End stream" }).click();
  expect(consoleErrors.filter((e) => !/favicon|Failed to load resource.*404/.test(e))).toEqual([]);
});
