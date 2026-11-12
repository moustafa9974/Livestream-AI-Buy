/**
 * Rules for brand feature slots, pure so they're unit-tested on their own. A slot is a
 * window in which the creator features one brand's product; the creator approves it.
 */

export type BookingStatus = "REQUESTED" | "APPROVED" | "DECLINED";

/** Longest slot a brand can request. Features are short segments, not whole streams. */
export const MAX_SLOT_MINUTES = 180;
/** Shortest slot (a drag in month view creates a whole day; we clamp, see clampSlot). */
export const MIN_SLOT_MINUTES = 15;

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  REQUESTED: ["APPROVED", "DECLINED"],
  APPROVED: ["DECLINED"], // the creator can cancel an approved slot
  DECLINED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type SlotProblem = "IN_PAST" | "END_BEFORE_START" | "TOO_SHORT" | "TOO_LONG" | "OVERLAP";

/** Why a slot can't be booked, or null if it can. `others` are the creator's active slots. */
export function slotProblem(
  slot: { startsAt: Date; endsAt: Date },
  others: Array<{ startsAt: Date; endsAt: Date }>,
  now: Date = new Date(),
): SlotProblem | null {
  if (slot.startsAt.getTime() <= now.getTime()) return "IN_PAST";
  const minutes = (slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000;
  if (minutes <= 0) return "END_BEFORE_START";
  if (minutes < MIN_SLOT_MINUTES) return "TOO_SHORT";
  if (minutes > MAX_SLOT_MINUTES) return "TOO_LONG";
  // Half-open intervals: a slot may start exactly when another ends.
  if (others.some((o) => slot.startsAt < o.endsAt && o.startsAt < slot.endsAt)) return "OVERLAP";
  return null;
}

export const SLOT_PROBLEM_MESSAGE: Record<SlotProblem, string> = {
  IN_PAST: "Pick a time in the future.",
  END_BEFORE_START: "The slot has to end after it starts.",
  TOO_SHORT: `Slots are at least ${MIN_SLOT_MINUTES} minutes.`,
  TOO_LONG: `Slots are at most ${MAX_SLOT_MINUTES / 60} hours.`,
  OVERLAP: "That time overlaps another brand slot.",
};

/**
 * A drag on the calendar can cover a whole day (month view) or a few minutes. Turn it
 * into a sensible default slot: keep the start, cap the length at one hour, and give
 * all-day drags an evening start, when streams usually happen.
 */
export function defaultSlotFromDrag(start: Date, end: Date): { startsAt: Date; endsAt: Date } {
  const allDay = end.getTime() - start.getTime() >= 23 * 3_600_000 || (start.getHours() === 0 && start.getMinutes() === 0 && end.getTime() - start.getTime() >= 3_600_000 * 12);
  const startsAt = new Date(start);
  if (allDay) startsAt.setHours(19, 0, 0, 0);
  const lengthMs = allDay ? 3_600_000 : Math.min(Math.max(end.getTime() - start.getTime(), MIN_SLOT_MINUTES * 60_000), 3_600_000);
  return { startsAt, endsAt: new Date(startsAt.getTime() + lengthMs) };
}
