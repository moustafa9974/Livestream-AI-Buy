import type {
  CreateOrderBody,
  CreatePayoutBody,
  Money,
  PayPalGateway,
  PayPalOrder,
  PayPalRefund,
  PayoutBatch,
  PayoutItemStatus,
} from "../paypal/gateway";
import { randomUUID } from "node:crypto";
import { PayPalApiError } from "../paypal/http";

/**
 * In-memory PayPal for tests. Mimics the behaviours our safety depends on:
 * PayPal-Request-Id idempotency (same key → same response, no new side effect) and
 * ORDER_ALREADY_CAPTURED on a second capture with a different key.
 */
export class FakePayPal implements PayPalGateway {
  readonly sideEffects: string[] = []; // one entry per *real* (non-replayed) money operation
  payoutItemStatus: PayoutItemStatus = "SUCCESS";
  failNextPayoutWith: string | null = null;

  private seq = 0;
  // Unique per instance so IDs never collide with other tests' rows in the shared DB.
  private readonly tag = randomUUID().slice(0, 8);
  private idem = new Map<string, unknown>();
  private orders = new Map<string, { body: CreateOrderBody; captureId?: string }>();
  private batches = new Map<string, CreatePayoutBody>();

  private once<T>(requestId: string, fn: () => T): T {
    if (this.idem.has(requestId)) return this.idem.get(requestId) as T;
    const v = fn();
    this.idem.set(requestId, v);
    return v;
  }

  private orderView(id: string): PayPalOrder {
    const o = this.orders.get(id)!;
    const pu = o.body.purchase_units[0];
    return {
      id,
      status: o.captureId ? "COMPLETED" : "APPROVED",
      purchase_units: [
        {
          custom_id: pu.custom_id,
          payments: o.captureId
            ? { captures: [{ id: o.captureId, status: "COMPLETED", amount: { currency_code: pu.amount.currency_code, value: pu.amount.value }, custom_id: pu.custom_id }] }
            : undefined,
        },
      ],
    };
  }

  async createOrder(body: CreateOrderBody, requestId: string) {
    return this.once(requestId, () => {
      const id = `FAKE-ORDER-${this.tag}-${++this.seq}`;
      this.orders.set(id, { body });
      this.sideEffects.push(`createOrder:${id}`);
      return { id, status: "CREATED" } as PayPalOrder;
    });
  }

  async captureOrder(id: string, requestId: string) {
    return this.once(requestId, () => {
      const o = this.orders.get(id);
      if (!o) throw new PayPalApiError(404, "RESOURCE_NOT_FOUND", "dbg", [], false);
      if (o.captureId) throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", "dbg", ["ORDER_ALREADY_CAPTURED"], false);
      o.captureId = `FAKE-CAPTURE-${this.tag}-${++this.seq}`;
      this.sideEffects.push(`capture:${id}`);
      return this.orderView(id);
    });
  }

  async getOrder(id: string) {
    return this.orderView(id);
  }

  async refundCapture(captureId: string, body: { amount: Money; custom_id: string }, requestId: string) {
    return this.once(requestId, () => {
      this.sideEffects.push(`refund:${captureId}:${body.amount.value}`);
      return {
        id: `FAKE-REFUND-${this.tag}-${++this.seq}`,
        status: "COMPLETED",
        amount: body.amount,
        custom_id: body.custom_id,
        links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }],
      } as PayPalRefund;
    });
  }

  async createPayoutBatch(body: CreatePayoutBody, requestId: string) {
    if (this.failNextPayoutWith) {
      const name = this.failNextPayoutWith;
      this.failNextPayoutWith = null;
      throw new PayPalApiError(422, name, "dbg", [name], false);
    }
    return this.once(requestId, () => {
      const id = `FAKE-BATCH-${this.tag}-${++this.seq}`;
      this.batches.set(id, body);
      this.sideEffects.push(`payout:${id}`);
      return { batch_header: { payout_batch_id: id, batch_status: "PENDING" } } as PayoutBatch;
    });
  }

  async getPayoutBatch(id: string): Promise<PayoutBatch> {
    const body = this.batches.get(id)!;
    return {
      batch_header: { payout_batch_id: id, batch_status: this.payoutItemStatus === "SUCCESS" ? "SUCCESS" : "PROCESSING" },
      items: body.items.map((it, i) => ({
        payout_item_id: `${id}-ITEM-${i}`,
        payout_batch_id: id,
        transaction_status: this.payoutItemStatus,
        payout_item: { sender_item_id: it.sender_item_id, receiver: it.receiver, amount: it.amount },
      })),
    };
  }

  async verifyWebhookSignature() {
    return true;
  }

  count(prefix: string): number {
    return this.sideEffects.filter((s) => s.startsWith(prefix)).length;
  }
}
