import type { FunctionDeclaration } from "@google/genai";
import { priceComparison } from "../channel3/parse";
import { prisma } from "../db";
import { formatMoney } from "../money";
import { getRail, type RailItem } from "../rail";
import { BUY_INTENT } from "./intent";

/**
 * Viewer shopping-agent tools. Everything is scoped to the stream the viewer is watching
 * (never to anything the model says), prices come from the DB or stored Channel3 offers,
 * and nothing here moves money: prepare_checkout only offers a Buy button, and the viewer
 * still approves the payment in PayPal.
 */

export interface ShopperContext {
  streamId: string;
  creatorName: string;
  /** The viewer's latest message, used to gate prepare_checkout. */
  lastUserMessage: string;
}

/** What the client should show after the turn: a Buy card for one product on the rail. */
export interface CheckoutOffer {
  detectionId: string;
  productId: string;
  title: string;
  price: string;
}

export interface ToolOutcome {
  result: unknown;
  checkout?: CheckoutOffer;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

async function buyable(streamId: string): Promise<Array<RailItem & { partner: NonNullable<RailItem["partner"]> }>> {
  const rail = await getRail(streamId);
  return rail.items.filter((i): i is RailItem & { partner: NonNullable<RailItem["partner"]> } => !!i.partner);
}

async function findOnRail(streamId: string, productId: unknown) {
  const id = String(productId ?? "");
  return (await buyable(streamId)).find((i) => i.partner.productId === id) ?? null;
}

const notOnScreen = { error: "That product isn't on this stream. Call products_on_screen to see what is." };

export const SHOPPER_TOOLS: FunctionDeclaration[] = [
  {
    name: "products_on_screen",
    description:
      "Products the AI spotted on this stream that the viewer can buy here, with product_id, title, seller, price, match quality and the moment they appeared.",
  },
  {
    name: "product_details",
    description: "Details of one product from products_on_screen: description, attributes (colour, material, size), stock and seller.",
    parametersJsonSchema: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] },
  },
  {
    name: "compare_prices",
    description:
      "Prices of similar items at other online stores (found by Channel3) versus the price here. Buying elsewhere doesn't support the creator.",
    parametersJsonSchema: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] },
  },
  {
    name: "prepare_checkout",
    description:
      "Show the viewer a Buy button for one product so they can pay with PayPal. It does NOT charge anything; the viewer approves the payment in PayPal. ONLY call when the viewer's latest message explicitly asks to buy that product; set confirm=true only then.",
    parametersJsonSchema: {
      type: "object",
      properties: { product_id: { type: "string" }, confirm: { type: "boolean" } },
      required: ["product_id", "confirm"],
    },
  },
];

type Handler = (args: Record<string, unknown>, ctx: ShopperContext) => Promise<ToolOutcome>;

const HANDLERS: Record<string, Handler> = {
  async products_on_screen(_args, { streamId }) {
    const items = await buyable(streamId);
    if (items.length === 0) return { result: { products: [], note: "Nothing buyable on screen yet." } };
    return {
      result: {
        products: items.map((i) => ({
          product_id: i.partner.productId,
          title: i.partner.title,
          seller: i.partner.merchantName,
          price: formatMoney(i.partner.priceMinor, i.partner.currency),
          match: i.partner.kind === "exact" ? "exact match" : "similar item",
          spotted_at: mmss(i.firstSeenSec),
          pinned_by_creator: i.state === "pinned",
        })),
      },
    };
  },

  async product_details({ product_id }, { streamId }) {
    const item = await findOnRail(streamId, product_id);
    if (!item) return { result: notOnScreen };
    const p = await prisma.partnerProduct.findUnique({ where: { id: item.partner.productId }, include: { merchant: true } });
    if (!p) return { result: notOnScreen };
    const attrs = (p.attributes && typeof p.attributes === "object" && !Array.isArray(p.attributes) ? p.attributes : {}) as Record<string, unknown>;
    return {
      result: {
        product_id: p.id,
        title: p.title,
        seller: p.merchant.name,
        price: formatMoney(p.priceMinor, p.currency),
        description: p.description,
        attributes: Object.fromEntries(Object.entries(attrs).filter(([, v]) => typeof v === "string" || typeof v === "number")),
        stock: p.stock <= 0 ? "out of stock" : p.stock <= 5 ? `only ${p.stock} left` : "in stock",
      },
    };
  },

  async compare_prices({ product_id }, { streamId, creatorName }) {
    const item = await findOnRail(streamId, product_id);
    if (!item) return { result: notOnScreen };
    const { priceMinor, currency, title } = item.partner;
    const cmp = priceComparison(priceMinor, currency, item.similar);
    const sameCurrency = item.similar.filter((s) => s.currency === currency).sort((a, b) => a.priceMinor - b.priceMinor);
    return {
      result: {
        product: title,
        price_here: formatMoney(priceMinor, currency),
        elsewhere: item.similar.slice(0, 5).map((s) => ({ store: s.retailer, item: s.title, price: formatMoney(s.priceMinor, s.currency) })),
        cheapest_elsewhere: sameCurrency[0]
          ? { store: sameCurrency[0].retailer, item: sameCurrency[0].title, price: formatMoney(sameCurrency[0].priceMinor, currency) }
          : null,
        // Channel3 finds look-alikes, not this exact listing: the model must not call them the same product.
        caution: "These are similar items at other stores, not necessarily the same product.",
        here_vs_typical:
          cmp === null ? "no comparison available"
          : cmp.savingsMinor > 0 ? `${formatMoney(cmp.savingsMinor, currency)} less than the typical price elsewhere`
          : `${formatMoney(-cmp.savingsMinor, currency)} more than the typical price elsewhere`,
        note: `Only a purchase here, with PayPal, supports ${creatorName}.`,
      },
    };
  },

  async prepare_checkout({ product_id, confirm }, { streamId, lastUserMessage }) {
    const item = await findOnRail(streamId, product_id);
    if (!item) return { result: notOnScreen };
    if (confirm !== true || !BUY_INTENT.test(lastUserMessage)) {
      return { result: { error: "Not offered. The viewer has to ask to buy it (e.g. 'buy the mug')." } };
    }
    const price = formatMoney(item.partner.priceMinor, item.partner.currency);
    return {
      result: { ok: true, shown: `A Buy button for ${item.partner.title} (${price}). The viewer pays with PayPal or a card.` },
      checkout: { detectionId: item.detectionId, productId: item.partner.productId, title: item.partner.title, price },
    };
  },
};

export async function runShopperTool(name: string, args: Record<string, unknown>, ctx: ShopperContext): Promise<ToolOutcome> {
  const h = HANDLERS[name];
  if (!h) return { result: { error: `Unknown tool ${name}` } };
  try {
    return await h(args, ctx);
  } catch (err) {
    console.warn("[shopper]", name, err instanceof Error ? err.message : err);
    return { result: { error: "That lookup failed. Try again." } };
  }
}
