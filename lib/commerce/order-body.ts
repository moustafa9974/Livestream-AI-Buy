import { toPayPalAmount } from "../money";
import type { CreateOrderBody } from "../paypal/gateway";

export interface OrderLine {
  partnerProductId: string;
  title: string;
  unitMinor: number;
  quantity: number;
}

/**
 * Builds the Orders v2 body purely from DB values. Amounts are formatted from integer
 * minor units; nothing here comes from the AI or the browser.
 */
export function buildCreateOrderBody(args: {
  orderId: string;
  lines: OrderLine[];
  totalMinor: number;
  currency: string;
  shippingPreference: "GET_FROM_FILE" | "NO_SHIPPING";
  /** PayPal wallet gets an experience_context; guest card orders must not set
   *  payment_source (matches PayPal's v6 sample integration). */
  paymentMethod: "paypal" | "card";
  brandName?: string;
}): CreateOrderBody {
  const { orderId, lines, totalMinor, currency } = args;
  const body: CreateOrderBody = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: orderId,
        custom_id: orderId,
        invoice_id: `SEEN-${orderId}`,
        description: "Seen partner store order",
        amount: {
          ...toPayPalAmount(totalMinor, currency),
          breakdown: { item_total: toPayPalAmount(totalMinor, currency) },
        },
        items: lines.map((l) => ({
          // PayPal caps item names at 127 chars.
          name: l.title.slice(0, 127),
          quantity: String(l.quantity),
          unit_amount: toPayPalAmount(l.unitMinor, currency),
          sku: l.partnerProductId,
          category: "PHYSICAL_GOODS" as const,
        })),
      },
    ],
  };
  if (args.paymentMethod === "paypal") {
    body.payment_source = {
      paypal: {
        experience_context: {
          brand_name: args.brandName ?? "Seen Partner Stores",
          shipping_preference: args.shippingPreference,
          user_action: "PAY_NOW",
        },
      },
    };
  }
  return body;
}
