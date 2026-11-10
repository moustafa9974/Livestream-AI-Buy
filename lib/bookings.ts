import { slotProblem, canTransition, SLOT_PROBLEM_MESSAGE, type BookingStatus } from "./bookings-rules";
import { audit } from "./commerce/db";
import { prisma } from "./db";

/** Creator-facing errors with a message safe to show in the UI. */
export class BookingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export interface BookingView {
  id: string;
  merchantId: string;
  merchant: string;
  productId: string;
  product: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  note: string | null;
}

const include = { merchant: true, product: true } as const;

type Row = Awaited<ReturnType<typeof prisma.brandBooking.findFirstOrThrow<{ include: typeof include }>>>;

function view(b: Row): BookingView {
  return {
    id: b.id,
    merchantId: b.merchantId,
    merchant: b.merchant.name,
    productId: b.productId,
    product: b.product.title,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    status: b.status,
    note: b.note,
  };
}

export async function listBookings(creatorId: string): Promise<BookingView[]> {
  const rows = await prisma.brandBooking.findMany({ where: { creatorId }, include, orderBy: { startsAt: "asc" } });
  return rows.map(view);
}

export async function createBooking(input: {
  creatorId: string;
  merchantId: string;
  productId: string;
  startsAt: Date;
  endsAt: Date;
  note?: string;
}): Promise<BookingView> {
  const product = await prisma.partnerProduct.findUnique({ where: { id: input.productId } });
  // The product must really be that brand's: the client can't pair any brand with any product.
  if (!product || product.merchantId !== input.merchantId) throw new BookingError("That product isn't sold by this brand.");

  const active = await prisma.brandBooking.findMany({
    where: { creatorId: input.creatorId, status: { not: "DECLINED" }, endsAt: { gt: new Date() } },
    select: { startsAt: true, endsAt: true },
  });
  const problem = slotProblem({ startsAt: input.startsAt, endsAt: input.endsAt }, active);
  if (problem) throw new BookingError(SLOT_PROBLEM_MESSAGE[problem], problem === "OVERLAP" ? 409 : 400);

  const b = await prisma.brandBooking.create({
    data: {
      creatorId: input.creatorId,
      merchantId: input.merchantId,
      productId: input.productId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      note: input.note?.trim() || null,
    },
    include,
  });
  await audit(prisma, { entityType: "BrandBooking", entityId: b.id, type: "booking.requested", source: "creator", payload: { merchant: b.merchant.name } });
  return view(b);
}

export async function setBookingStatus(creatorId: string, id: string, to: BookingStatus): Promise<BookingView> {
  const b = await prisma.brandBooking.findUnique({ where: { id }, include });
  if (!b || b.creatorId !== creatorId) throw new BookingError("Booking not found.", 404);
  if (!canTransition(b.status, to)) throw new BookingError(`A ${b.status.toLowerCase()} slot can't be ${to.toLowerCase()}.`, 409);
  // Conditional update: two clicks racing can't both apply (the loser matches 0 rows).
  const res = await prisma.brandBooking.updateMany({ where: { id, status: b.status }, data: { status: to } });
  if (res.count === 0) throw new BookingError("That slot just changed. Refresh and try again.", 409);
  await audit(prisma, { entityType: "BrandBooking", entityId: id, type: `booking.${to.toLowerCase()}`, source: "creator" });
  return view({ ...b, status: to });
}
