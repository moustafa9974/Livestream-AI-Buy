import { ZodError } from "zod";
import { CheckoutError } from "./commerce/checkout";
import { featureStatus } from "./flags";
import { PayPalApiError } from "./paypal/http";

/** Uniform JSON errors. Messages are safe for the browser; internals go to the server log only. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    return Response.json({ error: "Invalid request", fields: err.issues.map((i) => i.path.join(".")) }, { status: 400 });
  }
  if (err instanceof CheckoutError) {
    const status = { NOT_FOUND: 404, OUT_OF_STOCK: 409, BAD_QUANTITY: 400, PAYPAL_UNAVAILABLE: 503, INVALID_STATE: 409 }[err.code];
    return Response.json({ error: err.message, code: err.code }, { status });
  }
  if (err instanceof PayPalApiError) {
    // name + debug_id are what PayPal support needs; no bodies, no tokens.
    console.error("[paypal]", err.message);
    return Response.json(
      { error: "PayPal request failed", code: err.paypalName, debugId: err.debugId },
      { status: err.status === 0 || err.retryable ? 503 : 502 },
    );
  }
  console.error("[api]", err instanceof Error ? err.message : err);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}

/** 503 with the feature's "unavailable" reason when PayPal isn't configured. */
export function requirePayPal(): Response | null {
  const s = featureStatus("paypal");
  return s.enabled ? null : Response.json({ error: "PayPal is unavailable", reason: s.reason }, { status: 503 });
}
