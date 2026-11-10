import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { BookingError, createBooking, listBookings } from "@/lib/bookings";
import { getCurrentCreator } from "@/lib/session";

const Body = z.object({
  merchantId: z.string().min(1),
  productId: z.string().min(1),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  note: z.string().max(280).optional(),
});

export async function GET() {
  const creator = await getCurrentCreator();
  if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
  return Response.json({ bookings: await listBookings(creator.id) });
}

/** A brand feature-slot request on the creator's schedule (from a calendar drag or the form). */
export async function POST(req: Request) {
  try {
    const creator = await getCurrentCreator();
    if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
    const b = Body.parse(await req.json());
    const booking = await createBooking({
      creatorId: creator.id,
      merchantId: b.merchantId,
      productId: b.productId,
      startsAt: new Date(b.startsAt),
      endsAt: new Date(b.endsAt),
      note: b.note,
    });
    return Response.json({ booking });
  } catch (err) {
    if (err instanceof BookingError) return Response.json({ error: err.message }, { status: err.status });
    return errorResponse(err);
  }
}
