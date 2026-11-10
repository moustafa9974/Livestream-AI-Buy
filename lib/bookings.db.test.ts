/**
 * Brand slots against the real DB and seeded catalog (run `npm run db:seed` first).
 * Run with `npm run test:db`. Uses its own test creator so the demo data isn't touched.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BookingError, createBooking, listBookings, setBookingStatus } from "./bookings";
import { prisma } from "./db";

const tag = randomUUID().slice(0, 8);
const creatorId = `test_bk_creator_${tag}`;
const otherCreatorId = `test_bk_other_${tag}`;
const inDays = (d: number, hour: number) => {
  const t = new Date(Date.now() + d * 86_400_000);
  t.setHours(hour, 0, 0, 0);
  return t;
};

beforeAll(async () => {
  await prisma.creator.createMany({
    data: [
      { id: creatorId, slug: `test-bk-${tag}`, displayName: "Test", payoutEmail: "t@example.com" },
      { id: otherCreatorId, slug: `test-bk-o-${tag}`, displayName: "Other", payoutEmail: "o@example.com" },
    ],
  });
});

afterAll(async () => {
  const ids = (await prisma.brandBooking.findMany({ where: { creatorId: { in: [creatorId, otherCreatorId] } }, select: { id: true } })).map((b) => b.id);
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.brandBooking.deleteMany({ where: { id: { in: ids } } });
  await prisma.creator.deleteMany({ where: { id: { in: [creatorId, otherCreatorId] } } });
  await prisma.$disconnect();
});

const kilnMug = { merchantId: "seed_merchant_kiln", productId: "seed_prod_ceramic_mug" };

describe("brand slots", () => {
  it("creates a request, then the creator approves it (audited)", async () => {
    const b = await createBooking({ creatorId, ...kilnMug, startsAt: inDays(3, 19), endsAt: inDays(3, 20), note: " glaze close-up " });
    expect(b).toMatchObject({ status: "REQUESTED", merchant: "Kiln & Co. Home", product: "Speckled Stoneware Mug", note: "glaze close-up" });
    const approved = await setBookingStatus(creatorId, b.id, "APPROVED");
    expect(approved.status).toBe("APPROVED");
    expect(await prisma.auditEvent.count({ where: { entityId: b.id } })).toBe(2);
  });

  it("refuses a product the brand doesn't sell", async () => {
    await expect(
      createBooking({ creatorId, merchantId: "seed_merchant_kiln", productId: "seed_prod_wireless_mic", startsAt: inDays(5, 19), endsAt: inDays(5, 20) }),
    ).rejects.toThrow(/isn't sold by this brand/);
  });

  it("refuses an overlapping slot (409) but not after a decline frees the time", async () => {
    const first = await createBooking({ creatorId, ...kilnMug, startsAt: inDays(6, 19), endsAt: inDays(6, 20) });
    const clash = createBooking({ creatorId, ...kilnMug, startsAt: inDays(6, 19), endsAt: inDays(6, 21) });
    await expect(clash).rejects.toBeInstanceOf(BookingError);
    await expect(clash).rejects.toMatchObject({ status: 409 });
    await setBookingStatus(creatorId, first.id, "DECLINED");
    await expect(createBooking({ creatorId, ...kilnMug, startsAt: inDays(6, 19), endsAt: inDays(6, 20) })).resolves.toMatchObject({ status: "REQUESTED" });
  });

  it("is scoped to the creator: nobody else can see or decide your slots", async () => {
    const b = await createBooking({ creatorId, ...kilnMug, startsAt: inDays(8, 19), endsAt: inDays(8, 20) });
    await expect(setBookingStatus(otherCreatorId, b.id, "APPROVED")).rejects.toMatchObject({ status: 404 });
    expect((await listBookings(otherCreatorId)).map((x) => x.id)).not.toContain(b.id);
  });

  it("rejects invalid status changes", async () => {
    const b = await createBooking({ creatorId, ...kilnMug, startsAt: inDays(9, 19), endsAt: inDays(9, 20) });
    await setBookingStatus(creatorId, b.id, "DECLINED");
    await expect(setBookingStatus(creatorId, b.id, "APPROVED")).rejects.toMatchObject({ status: 409 });
  });
});
