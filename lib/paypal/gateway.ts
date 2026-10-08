/**
 * The PayPal operations Seen uses, as one injectable interface. Services depend on
 * this (not on fetch), so tests can swap in a fake and the money logic is exercised
 * without network calls.
 *
 * Field names follow the official OpenAPI specs (checked 2026-10-08):
 *   Orders v2      developer.paypal.com/api/orders/v2/schema.json
 *   Payments v2    developer.paypal.com/api/payments/v2/schema.json
 *   Payouts v1     developer.paypal.com/api/payments.payouts-batch/v1/schema.json
 *   Webhooks v1    developer.paypal.com/api/webhooks/v1/schema.json
 * We only type the fields we read.
 */
import { paypalHttp, type PayPalHttp } from "./http";

export interface Money {
  currency_code: string;
  value: string;
}

// ── Orders v2 ──
export interface CreateOrderBody {
  intent: "CAPTURE";
  purchase_units: Array<{
    reference_id?: string;
    custom_id: string; // our Order.id; carried onto the capture and into webhooks
    invoice_id?: string;
    description?: string;
    amount: Money & { breakdown: { item_total: Money } };
    items: Array<{
      name: string;
      quantity: string;
      unit_amount: Money;
      sku?: string;
      category: "PHYSICAL_GOODS";
    }>;
  }>;
  payment_source?: {
    paypal: {
      experience_context: {
        brand_name?: string;
        shipping_preference: "GET_FROM_FILE" | "NO_SHIPPING";
        user_action: "PAY_NOW" | "CONTINUE";
        return_url?: string;
        cancel_url?: string;
      };
    };
  };
}

export interface PayPalCapture {
  id: string;
  status: "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";
  amount?: Money;
  custom_id?: string;
}

export interface PayPalOrder {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  purchase_units?: Array<{
    custom_id?: string;
    payments?: { captures?: PayPalCapture[] };
  }>;
}

// ── Payments v2: refunds ──
export interface PayPalRefund {
  id: string;
  status: "CANCELLED" | "FAILED" | "PENDING" | "COMPLETED";
  amount?: Money;
  custom_id?: string;
  links?: Array<{ href: string; rel: string }>;
}

// ── Payouts v1 ──
export interface CreatePayoutBody {
  sender_batch_header: {
    sender_batch_id: string;
    recipient_type: "EMAIL";
    email_subject?: string;
    email_message?: string;
  };
  items: Array<{
    recipient_type: "EMAIL";
    receiver: string;
    amount: { currency: string; value: string }; // NB: Payouts uses `currency`, not `currency_code`
    sender_item_id: string; // our Commission.id
    note?: string;
  }>;
}

export type PayoutBatchStatus = "DENIED" | "PENDING" | "PROCESSING" | "SUCCESS" | "CANCELED";
export type PayoutItemStatus =
  | "SUCCESS" | "FAILED" | "PENDING" | "UNCLAIMED" | "RETURNED"
  | "ONHOLD" | "BLOCKED" | "REFUNDED" | "REVERSED";

export interface PayoutItem {
  payout_item_id: string;
  payout_batch_id: string;
  transaction_id?: string;
  transaction_status?: PayoutItemStatus;
  payout_item: { sender_item_id?: string; receiver: string; amount: { currency: string; value: string } };
}

export interface PayoutBatch {
  batch_header: {
    payout_batch_id: string;
    batch_status: PayoutBatchStatus;
    sender_batch_header?: { sender_batch_id?: string };
  };
  items?: PayoutItem[];
}

// ── Webhooks ──
export interface WebhookHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

export interface PayPalGateway {
  createOrder(body: CreateOrderBody, requestId: string): Promise<PayPalOrder>;
  captureOrder(paypalOrderId: string, requestId: string): Promise<PayPalOrder>;
  getOrder(paypalOrderId: string): Promise<PayPalOrder>;
  refundCapture(
    captureId: string,
    body: { amount: Money; custom_id: string; note_to_payer?: string },
    requestId: string,
  ): Promise<PayPalRefund>;
  createPayoutBatch(body: CreatePayoutBody, requestId: string): Promise<PayoutBatch>;
  getPayoutBatch(payoutBatchId: string): Promise<PayoutBatch>;
  /** Posts the RAW event body back to PayPal, as the docs require. */
  verifyWebhookSignature(headers: WebhookHeaders, rawBody: string, webhookId: string): Promise<boolean>;
}

export function createGateway(http: PayPalHttp): PayPalGateway {
  return {
    createOrder: (body, requestId) =>
      http.request({ method: "POST", path: "/v2/checkout/orders", body, requestId, preferRepresentation: true }),

    captureOrder: (id, requestId) =>
      http.request({
        method: "POST",
        path: `/v2/checkout/orders/${encodeURIComponent(id)}/capture`,
        body: {},
        requestId,
        preferRepresentation: true,
      }),

    getOrder: (id) => http.request({ method: "GET", path: `/v2/checkout/orders/${encodeURIComponent(id)}` }),

    refundCapture: (captureId, body, requestId) =>
      http.request({
        method: "POST",
        path: `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
        body,
        requestId,
        preferRepresentation: true,
      }),

    createPayoutBatch: (body, requestId) =>
      http.request({ method: "POST", path: "/v1/payments/payouts", body, requestId }),

    getPayoutBatch: (id) =>
      http.request({ method: "GET", path: `/v1/payments/payouts/${encodeURIComponent(id)}` }),

    async verifyWebhookSignature(h, rawBody, webhookId) {
      // Splice the raw body in verbatim: re-serializing parsed JSON can change bytes
      // and fail verification. rawBody is a JSON object string from PayPal.
      const prefix = JSON.stringify({
        auth_algo: h.authAlgo,
        cert_url: h.certUrl,
        transmission_id: h.transmissionId,
        transmission_sig: h.transmissionSig,
        transmission_time: h.transmissionTime,
        webhook_id: webhookId,
      });
      const body = `${prefix.slice(0, -1)},"webhook_event":${rawBody}}`;
      const res = await http.request<{ verification_status: "SUCCESS" | "FAILURE" }>({
        method: "POST",
        path: "/v1/notifications/verify-webhook-signature",
        rawBody: body,
      });
      return res.verification_status === "SUCCESS";
    },
  };
}

let shared: PayPalGateway | undefined;
let override: PayPalGateway | undefined;

export function paypal(): PayPalGateway {
  if (override) return override;
  return (shared ??= createGateway(paypalHttp()));
}

/** Tests only: route all service calls to a fake gateway. */
export function setPayPalGatewayForTests(fake: PayPalGateway | undefined): void {
  override = fake;
}
