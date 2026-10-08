import { errorResponse, requirePayPal } from "@/lib/api";
import { payMeNow } from "@/lib/commerce/payouts";
import { getCurrentCreator } from "@/lib/session";

/** "Pay me now": the amount is whatever the ledger says is eligible. The client sends nothing. */
export async function POST() {
  const unavailable = requirePayPal();
  if (unavailable) return unavailable;
  try {
    const creator = await getCurrentCreator();
    if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
    return Response.json(await payMeNow(creator.id));
  } catch (err) {
    return errorResponse(err);
  }
}
