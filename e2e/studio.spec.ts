import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 5 studio through a real browser: demo panel → viewer rail, simulated sale →
 * ticker + notifications, assistant, AG Grid pages, schedule, settings, recap.
 * Uses the demo panel's zero-quota actions; the assistant costs 1–2 Gemini text calls.
 */

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return () => errors.filter((e) => !/favicon|Failed to load resource.*404|Bryntum/i.test(e));
}

test.beforeAll(async ({ request }) => {
  const res = await request.post("/api/demo", { data: { action: "reset" } });
  expect(res.ok()).toBe(true);
});

test("demo panel drives the viewer rail, ticker and notifications", async ({ browser }) => {
  const studio = await browser.newPage();
  const viewer = await browser.newPage();
  const studioErrors = trackErrors(studio);
  const viewerErrors = trackErrors(viewer);

  await studio.goto("/studio/demo");
  await expect(studio.getByRole("heading", { name: "Demo control panel" })).toBeVisible();
  await viewer.goto("/live/maya-makes");

  // Force a detection (no AI): the viewer's rail gets the buyable card live.
  await studio.getByLabel("Product").selectOption({ label: "Arc LED Desk Lamp" });
  await studio.getByRole("button", { name: "Force detection" }).click();
  await expect(studio.getByText("Detection added to the live rail")).toBeVisible();
  await expect(viewer.getByRole("listitem").filter({ hasText: "Arc LED Desk Lamp" })).toBeVisible({ timeout: 30_000 });

  // Simulated sale (no money) → ticker and notification bell.
  await studio.getByRole("button", { name: "Simulate a sale (no money)" }).click();
  await expect(studio.getByText("Simulated sale recorded")).toBeVisible();
  await studio.goto("/studio");
  await expect(studio.getByText("Earned today")).toBeVisible();
  // The seeded history also has a lamp sale, so match the newest entry.
  await expect(studio.getByRole("region", { name: "Today" }).getByText("Arc LED Desk Lamp").first()).toBeVisible({ timeout: 20_000 });
  await expect(studio.getByText("Sales today")).toBeVisible();
  await expect(studio.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible({ timeout: 20_000 });
  await studio.getByRole("button", { name: /Notifications/ }).click();
  await expect(studio.getByRole("dialog").getByText("New sale: Arc LED Desk Lamp")).toBeVisible();
  await studio.keyboard.press("Escape");

  expect(studioErrors()).toEqual([]);
  expect(viewerErrors()).toEqual([]);
});

test("assistant answers from the ledger", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/studio");
  await page.getByRole("button", { name: "Ask Seen" }).click();
  await page.getByRole("button", { name: "How much did I earn this week?" }).click();
  // Either Gemini or the no-AI quick answer must reply with an amount from the ledger.
  const answer = page.getByRole("dialog").locator("[data-role=assistant]").last();
  await expect(answer).toContainText("$", { timeout: 90_000 });
  console.log(`assistant: ${await answer.innerText()}`);
  expect(errors()).toEqual([]);
});

test("earnings and detections grids, schedule, settings", async ({ page, request }) => {
  const errors = trackErrors(page);
  // Own setup (tests must not depend on each other): a forced detection + a simulated sale.
  const lamp = "seed_prod_desk_lamp";
  await request.post("/api/demo", { data: { action: "force_detection", productId: lamp } });
  await request.post("/api/demo", { data: { action: "simulate_sale", productId: lamp } });
  await page.goto("/studio/earnings");
  await expect(page.getByRole("region", { name: "Products" }).getByText("Arc LED Desk Lamp")).toBeVisible();
  await expect(page.getByRole("region", { name: "Sales ledger" }).getByRole("gridcell", { name: "paid" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Pay me now/ })).toBeVisible();

  await page.goto("/studio/detections");
  await expect(page).toHaveURL(/\/studio\/stream\/.+\/detections/);
  await expect(page.getByRole("region", { name: "Detections" }).getByText("arc led desk lamp").first()).toBeVisible();

  await page.goto("/studio/schedule");
  await expect(page.getByText("Fall fits try-on (live)")).toBeVisible();
  await expect(page.getByText("Automatic payout run").first()).toBeVisible();

  await page.goto("/studio/settings");
  await expect(page.getByLabel("Zapier Catch Hook URL")).toBeVisible();
  await page.getByLabel("Zapier Catch Hook URL").fill("https://example.com/not-zapier");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("That isn't a Zapier Catch Hook URL")).toBeVisible();
  // The rejected URL above is a deliberate 400; nothing else may error.
  expect(errors().filter((e) => !/status of 400/.test(e))).toEqual([]);
});

test("ending a stream produces a shareable recap", async ({ page, request }) => {
  const errors = trackErrors(page);
  // A forced detection also puts the demo stream live.
  await request.post("/api/demo", { data: { action: "force_detection", productId: "seed_prod_wireless_mic" } });
  await page.goto("/studio");
  await expect(page.getByText("Live now")).toBeVisible();
  await page.getByRole("button", { name: "End stream" }).click();
  await page.getByRole("link", { name: "Recap ↗" }).click();
  await expect(page.getByText(/A \d+-min stream: \d+ products shown, \d+ sold/)).toBeVisible();
  // Public page: the creator's earnings must not be shown.
  await expect(page.getByText("Earned", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Shop the replay" })).toBeVisible();
  await request.post("/api/demo", { data: { action: "reset" } });
  expect(errors()).toEqual([]);
});
