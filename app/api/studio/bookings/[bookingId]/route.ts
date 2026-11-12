import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { BookingError, setBookingStatus } from "@/lib/bookings";
import { getCurrentCreator } from "@/lib/session";

const Body = z.object({ status: z.enum(["APPROVED", "DECLINED"]) });

/** The creator approves or declines a brand slot. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/studio/bookings/[bookingId]">) {
  try {
    const creator = await getCurrentCreator();
    if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
    const { bookingId } = await ctx.params;
    const { status } = Body.parse(await req.json());
    return Response.json({ booking: await setBookingStatus(creator.id, bookingId, status) });
  } catch (err) {
    if (err instanceof BookingError) return Response.json({ error: err.message }, { status: err.status });
    return errorResponse(err);
  }
}
