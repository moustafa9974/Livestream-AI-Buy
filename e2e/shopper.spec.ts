import { expect, test } from "@playwright/test";

/**
 * Viewer shopping agent: ask it to buy something on screen, get a Buy card, and land in
 * the same PayPal checkout as the product cards. Works whether Gemini answers or the
 * no-AI fallback does (both use the same stream-scoped tools). Needs the seeded demo
 * (`npm run db:seed`) so the replay has the mug on it.
 */
test("viewer asks the shopping agent to buy the mug and lands in PayPal checkout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/live/maya-makes");
  await page.getByRole("button", { name: "Ask about these products" }).click();
  await page.getByRole("button", { name: "Buy the mug" }).click();

  const dialog = page.getByRole("dialog", { name: /Shopping assistant/ });
  const buy = dialog.getByRole("button", { name: "Buy now" });
  await expect(buy).toBeVisible({ timeout: 45_000 });
  await expect(dialog.getByText("$22.00").last()).toBeVisible(); // price from the DB, not the AI
  await buy.click();

  // The regular checkout drawer opens for that product, with PayPal's own buttons.
  await expect(page.getByRole("dialog").getByText("Speckled Stoneware Mug").first()).toBeVisible();
  await expect(page.getByText("Loading PayPal…")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("paypal-button, paypal-basic-card-button").first()).toBeAttached();
  expect(errors).toEqual([]);
});
