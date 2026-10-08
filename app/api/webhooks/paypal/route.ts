import { z } from "zod";
import { handleWebhookEvent } from "@/lib/commerce/webhooks";
import { getEnv } from "@/lib/env";
import { paypal } from "@/lib/paypal/gateway";

const EventShape = z.object({ id: z.string().min(1), event_type: z.string().min(1), resource: z.unknown() });

/**
 * PayPal webhook receiver. Fails closed: no PAYPAL_WEBHOOK_ID or a bad signature means
 * the event is rejected and nothing changes. Verification uses the RAW body, exactly
 * as received (PayPal's docs warn that re-serialized JSON can fail verification).
 */
export async function POST(req: Request) {
  const env = getEnv();
  if (!env.PAYPAL_WEBHOOK_ID || !env.PAYPAL_CLIENT_ID) {
    return Response.json({ error: "Webhooks not configured" }, { status: 503 });
  }

  const raw = await req.text();
  const h = req.headers;
  const headers = {
    authAlgo: h.get("paypal-auth-algo") ?? "",
    certUrl: h.get("paypal-cert-url") ?? "",
    transmissionId: h.get("paypal-transmission-id") ?? "",
    transmissionSig: h.get("paypal-transmission-sig") ?? "",
    transmissionTime: h.get("paypal-transmission-time") ?? "",
  };
  if (Object.values(headers).some((v) => !v)) {
    return Response.json({ error: "Missing PayPal signature headers" }, { status: 400 });
  }

  let event: z.infer<typeof EventShape>;
  try {
    event = EventShape.parse(JSON.parse(raw));
  } catch {
    return Response.json({ error: "Invalid event body" }, { status: 400 });
  }

  try {
    const ok = await paypal().verifyWebhookSignature(headers, raw, env.PAYPAL_WEBHOOK_ID);
    if (!ok) {
      console.warn("[webhook] signature verification failed", event.event_type);
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
  } catch (err) {
    // Couldn't reach PayPal to verify: ask PayPal to retry later.
    console.error("[webhook] verification error", err instanceof Error ? err.message : err);
    return Response.json({ error: "Verification unavailable" }, { status: 503 });
  }

  try {
    const outcome = await handleWebhookEvent(event);
    return Response.json({ outcome });
  } catch (err) {
    // Non-2xx → PayPal redelivers; handlers are idempotent so that's safe.
    console.error("[webhook] processing failed", event.event_type, err instanceof Error ? err.message : err);
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
