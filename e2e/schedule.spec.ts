import { expect, test, type Page } from "@playwright/test";

/**
 * Brand slots on the Bryntum schedule (BRYNTUM_ENABLED=true): drag across a future day to
 * request a slot, fill the form, then approve it. Plus the same flow from the "Request a
 * slot" button, which works without Bryntum too. Needs the seeded demo (`npm run db:seed`).
 */

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A future day in the visible month, away from the seeded slots (+3 and +5 days). */
function targetDay(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 6);
  return d;
}

async function openSchedule(page: Page) {
  await page.setViewportSize({ width: 1366, height: 1000 });
  await page.goto("/studio/schedule");
  await page.locator(".b-calendar").waitFor({ timeout: 60_000 });
}

// Free any Northloop slot left active by an earlier (possibly failed) run, so this run's
// request can't be refused as overlapping. Seeded slots are Kiln and Studio Signal.
test.beforeEach(async ({ request }) => {
  const { bookings } = (await (await request.get("/api/studio/bookings")).json()) as {
    bookings: Array<{ id: string; merchant: string; status: string }>;
  };
  for (const b of bookings.filter((x) => x.merchant === "Northloop Apparel" && x.status !== "DECLINED")) {
    await request.patch(`/api/studio/bookings/${b.id}`, { data: { status: "DECLINED" } });
  }
});

test("drag on the Bryntum calendar to request a brand slot, then approve it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openSchedule(page);

  // Rows already listed (e.g. declined slots from earlier runs), so we can find ours.
  const before = new Set(await page.locator("li[id^='slot-']").evaluateAll((els) => els.map((e) => e.id)));

  // Month view day cells (the small date picker uses .b-calendar-panel-cell; skip those).
  const day = targetDay();
  const cell = page.locator(`.b-calendar-cell[data-date="${ymd(day)}"]:not(.b-calendar-panel-cell)`).first();
  test.skip((await cell.count()) === 0, "target day is in next month's view");
  const box = (await cell.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();

  const sheet = page.getByRole("dialog", { name: "Request a brand slot" });
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await sheet.getByLabel("Brand", { exact: true }).selectOption({ label: "Northloop Apparel" });
  await sheet.getByRole("button", { name: "Request slot" }).click();

  await expect(page.getByText(/Slot requested: Northloop Apparel/)).toBeVisible();
  const ids = await page.locator("li[id^='slot-']").evaluateAll((els) => els.map((e) => e.id));
  const mine = ids.filter((i) => !before.has(i));
  expect(mine).toHaveLength(1);
  const row = page.locator(`li#${mine[0]}`);
  await expect(row).toContainText("Northloop Apparel");
  await expect(row).toContainText("requested");
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row).toContainText("approved");
  // The calendar event was updated in place, not just the list.
  await expect(page.locator(".b-calendar").getByText(/Northloop Apparel: .* \(approved\)/).first()).toBeVisible();
  expect(errors).toEqual([]);

  // Free the slot again (approved → declined) so the next run can book the same time.
  const id = (await row.getAttribute("id"))!.replace(/^slot-/, "");
  expect((await page.request.patch(`/api/studio/bookings/${id}`, { data: { status: "DECLINED" } })).ok()).toBe(true);
});

test("the server refuses an overlapping slot and the form says why", async ({ page }) => {
  await openSchedule(page);
  await page.getByRole("button", { name: "Request a slot" }).click();
  const sheet = page.getByRole("dialog", { name: "Request a brand slot" });
  // Same time as the seeded approved Kiln slot (in 3 days, 19:00–20:00 local).
  const start = new Date();
  start.setDate(start.getDate() + 3);
  start.setHours(19, 15, 0, 0);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await sheet.getByLabel("Starts").fill(local(start));
  await sheet.getByLabel("Ends").fill(local(new Date(start.getTime() + 30 * 60_000)));
  await sheet.getByRole("button", { name: "Request slot" }).click();
  await expect(page.getByText("That time overlaps another brand slot.")).toBeVisible();
  await expect(sheet).toBeVisible(); // stays open so it can be fixed
});
