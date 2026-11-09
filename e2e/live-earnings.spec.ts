import { expect, test } from "@playwright/test";

/**
 * The earnings page is live: a sale that happens elsewhere (here: the demo panel's
 * no-money simulated sale) appears without a reload, glows, is announced, and the pinned
 * totals row updates. AG Grid Community only (HighlightChangesModule + PinnedRowModule).
 */
// The demo panel's simulated sale puts the demo stream live; end it so later tests start
// from "Go live", not "End stream".
test.afterEach(async ({ request }) => {
  await request.post("/api/streams/seed_stream_demo/live", { data: { action: "stop" } });
});

test("a new sale slides into the open earnings page without a reload", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/studio/earnings");
  await expect(page.getByText("Live: updates as sales come in")).toBeVisible();
  const ledger = page.getByRole("region", { name: "Sales ledger" });
  const totals = ledger.locator(".ag-grid-pinned-bottom-rows-container .ag-row"); // AG Grid v36 class names
  await expect(totals).toContainText("Total");
  const before = await totals.innerText();
  const marker = await page.evaluate(() => ((window as unknown as { __noReload: number }).__noReload = Date.now()));

  const sale = await request.post("/api/demo", { data: { action: "simulate_sale", productId: "seed_prod_ceramic_mug" } });
  expect(sale.ok()).toBe(true);

  await expect(page.getByText("New sale: Speckled Stoneware Mug")).toBeVisible({ timeout: 20_000 });
  const fresh = ledger.locator(".ag-row.seen-new-row");
  await expect(fresh).toHaveCount(1);
  // The glow is really applied (not just the class): the stylesheet rule reached the page.
  expect(await fresh.evaluate((el) => getComputedStyle(el).animationName)).toBe("seen-new-row");
  await expect(totals).not.toHaveText(before); // totals moved with the new sale
  // Same page instance: it refreshed in place, it didn't navigate or reload.
  expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(marker);
  expect(errors).toEqual([]);
});
