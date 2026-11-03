import { runTool, type ToolContext } from "./tools";

/**
 * Answers without the AI. When Gemini is busy or out of free quota, the most common
 * questions are still answered: a keyword picks one read-only tool and its result is
 * formatted directly. Money actions are never taken here; those need the AI to confirm
 * intent, or the creator's own click on the Earnings page.
 */

export interface QuickAnswer {
  reply: string;
  tool: string | null;
  ok: boolean;
}

type Row = Record<string, unknown>;
const list = (rows: string[]) => rows.map((r) => `- ${r}`).join("\n");
const failed = (r: unknown): r is { error: string } => !!r && typeof r === "object" && "error" in r;

function period(msg: string): "today" | "week" | "all" {
  if (/\btoday\b/i.test(msg)) return "today";
  if (/\b(week|7 days)\b/i.test(msg)) return "week";
  return "all";
}

const INTENTS: Array<{ test: RegExp; run: (msg: string, ctx: ToolContext) => Promise<QuickAnswer> }> = [
  {
    // Before "earnings": "pay me now" mentions money too.
    test: /\b(pay me|payout|cash ?out|withdraw|paid out)\b/i,
    async run(_msg, ctx) {
      const r = (await runTool("payout_status", {}, ctx)) as { payable_now: string; recent_payouts: Row[] } | { error: string };
      if (failed(r)) return { reply: r.error, tool: "payout_status", ok: false };
      const recent = r.recent_payouts.map((p) => `${p.amount}: ${String(p.paypal_status).toLowerCase()} (${p.date} UTC)`);
      return {
        reply: `**${r.payable_now}** is payable now. To send it, press **Pay me now** on the Earnings page.${recent.length ? `\n\nRecent payouts:\n${list(recent)}` : ""}`,
        tool: "payout_status",
        ok: true,
      };
    },
  },
  {
    test: /\b(earn|earned|earnings|made|money|commission|revenue|income)\b/i,
    async run(msg, ctx) {
      const p = period(msg);
      const r = (await runTool("earnings_summary", { period: p }, ctx)) as Row | { error: string };
      if (failed(r)) return { reply: r.error, tool: "earnings_summary", ok: false };
      const when = p === "today" ? "Today" : p === "week" ? "In the last 7 days" : "In total";
      return {
        reply: `${when} you earned **${r.total_earned}** from ${r.sales} sale${r.sales === 1 ? "" : "s"}.\n${list([
          `Payable now: ${r.payable_now}`,
          `Pending (hold period): ${r.pending}`,
          `In payout: ${r.in_payout}`,
          `Paid to you: ${r.paid}`,
        ])}`,
        tool: "earnings_summary",
        ok: true,
      };
    },
  },
  {
    test: /\b(top|best|popular|selling|sellers?)\b/i,
    async run(_msg, ctx) {
      const r = (await runTool("top_products", { limit: 5 }, ctx)) as Row[] | { error: string };
      if (failed(r)) return { reply: r.error, tool: "top_products", ok: false };
      if (!r.length) return { reply: "No clicks yet. Products show up here after viewers tap them.", tool: "top_products", ok: true };
      return {
        reply: `Your top products:\n${list(r.map((p) => `**${p.product}**: ${p.sales} sale${p.sales === 1 ? "" : "s"}, ${p.clicks} click${p.clicks === 1 ? "" : "s"} (${p.conversion} conversion)`))}`,
        tool: "top_products",
        ok: true,
      };
    },
  },
  {
    test: /\b(orders?|purchases?|bought|sales)\b/i,
    async run(_msg, ctx) {
      const r = (await runTool("recent_orders", { limit: 5 }, ctx)) as Row[] | { error: string };
      if (failed(r)) return { reply: r.error, tool: "recent_orders", ok: false };
      if (!r.length) return { reply: "No orders yet.", tool: "recent_orders", ok: true };
      return {
        reply: `Your latest orders:\n${list(r.map((o) => `**${o.ref}** ${o.product}: ${o.total}, ${String(o.status).toLowerCase().replace(/_/g, " ")} (${o.date} UTC)`))}`,
        tool: "recent_orders",
        ok: true,
      };
    },
  },
  {
    test: /\bhide\s+(?:all\s+)?(?:the\s+)?([a-z][a-z \-]{1,40})/i,
    async run(msg, ctx) {
      const needle = (/\bhide\s+(?:all\s+)?(?:the\s+)?([a-z][a-z \-]{1,40})/i.exec(msg)?.[1] ?? "").trim().replace(/s$/i, "");
      const r = (await runTool("hide_detections", { label_contains: needle }, ctx)) as { hidden: string[] } | { error: string };
      if (failed(r)) return { reply: r.error, tool: "hide_detections", ok: false };
      return {
        reply: r.hidden.length ? `Hidden from viewers:\n${list(r.hidden)}` : `Nothing matching "${needle}" is showing right now.`,
        tool: "hide_detections",
        ok: true,
      };
    },
  },
  {
    test: /\b(schedule|upcoming|next stream|planned)\b/i,
    async run(_msg, ctx) {
      const r = (await runTool("upcoming_streams", {}, ctx)) as Row[] | { error: string };
      if (failed(r)) return { reply: r.error, tool: "upcoming_streams", ok: false };
      return {
        reply: r.length ? `Coming up:\n${list(r.map((s) => `**${s.title}**: ${s.when_utc} UTC`))}` : "Nothing scheduled yet.",
        tool: "upcoming_streams",
        ok: true,
      };
    },
  },
  {
    test: /\b(live|stream|on screen|detect|showing|viewers? see)\b/i,
    async run(_msg, ctx) {
      const r = (await runTool("stream_status", {}, ctx)) as
        | { stream: null }
        | { title: string; status: string; products_on_screen: Array<{ label: string; pinned: boolean; buyable_as: string | null }> }
        | { error: string };
      if (failed(r)) return { reply: r.error, tool: "stream_status", ok: false };
      if (!("title" in r)) return { reply: "You don't have a stream yet.", tool: "stream_status", ok: true };
      const items = r.products_on_screen.map((p) => `${p.buyable_as ?? p.label}${p.pinned ? " (pinned)" : ""}`);
      return {
        reply: `**${r.title}** is ${r.status === "live" ? "live now" : r.status}.${items.length ? `\nViewers can see:\n${list(items)}` : "\nNo products on screen yet."}`,
        tool: "stream_status",
        ok: true,
      };
    },
  },
];

export async function quickAnswer(message: string, ctx: ToolContext): Promise<QuickAnswer> {
  const intent = INTENTS.find((i) => i.test.test(message));
  if (intent) return intent.run(message, ctx);
  return {
    reply: "I can tell you about your earnings, top products, latest orders, payouts, your live stream and your schedule, or hide a product (e.g. \"hide sunglasses\").",
    tool: null,
    ok: true,
  };
}
