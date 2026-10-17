import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { isEnabled } from "./flags";
import { isZapierHookUrl } from "./zapier-url";

export { isZapierHookUrl };

/**
 * Creator notifications (SPEC §7 Zapier). Every event lands in the in-app notification
 * center; if Zapier is on and the creator saved a Catch Hook URL, it's also POSTed
 * there for their Zaps (Gmail/Slack/Discord/Sheets…). Never throws: a broken Zap must
 * never break a sale or a payout. Payloads carry no payer details.
 */

export type NotifyEvent = "sale.created" | "commission.paid" | "payout.failed" | "stream.recap" | "budget.saver_mode";

export interface NotifyInput {
  title: string;
  body: string;
  /** IDs, amounts (minor units + currency), labels. Never buyer names/emails. */
  data?: Record<string, string | number | boolean | null>;
}

export async function notify(creatorId: string, type: NotifyEvent, input: NotifyInput): Promise<void> {
  try {
    const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
    if (!creator) return;
    const n = await prisma.notification.create({
      data: { creatorId, type, title: input.title, body: input.body, payload: (input.data ?? {}) as Prisma.InputJsonValue },
    });

    const url = creator.zapierWebhookUrl;
    if (!isEnabled("zapier") || !url || !isZapierHookUrl(url)) {
      await prisma.notification.update({ where: { id: n.id }, data: { zapierStatus: "skipped" } });
      return;
    }
    const delivered = await postToZapier(url, {
      event: type,
      occurred_at: n.createdAt.toISOString(),
      creator: { slug: creator.slug, name: creator.displayName },
      title: input.title,
      body: input.body,
      data: input.data ?? {},
    });
    await prisma.notification.update({ where: { id: n.id }, data: { zapierStatus: delivered ? "delivered" : "failed" } });
  } catch (err) {
    console.warn("[notify]", type, err instanceof Error ? err.message : err);
  }
}

export async function postToZapier(url: string, payload: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
