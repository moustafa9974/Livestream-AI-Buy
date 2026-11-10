import { describe, expect, it } from "vitest";
import { canTransition, defaultSlotFromDrag, MAX_SLOT_MINUTES, slotProblem } from "./bookings-rules";

const now = new Date("2026-11-10T12:00:00Z");
const at = (iso: string) => new Date(iso);

describe("brand slot rules", () => {
  it("accepts a future, reasonable, free slot", () => {
    expect(slotProblem({ startsAt: at("2026-11-11T19:00:00Z"), endsAt: at("2026-11-11T20:00:00Z") }, [], now)).toBeNull();
  });

  it("rejects past, backwards, too short and too long slots", () => {
    expect(slotProblem({ startsAt: at("2026-11-10T11:00:00Z"), endsAt: at("2026-11-10T13:00:00Z") }, [], now)).toBe("IN_PAST");
    expect(slotProblem({ startsAt: at("2026-11-11T20:00:00Z"), endsAt: at("2026-11-11T19:00:00Z") }, [], now)).toBe("END_BEFORE_START");
    expect(slotProblem({ startsAt: at("2026-11-11T20:00:00Z"), endsAt: at("2026-11-11T20:05:00Z") }, [], now)).toBe("TOO_SHORT");
    const tooLong = new Date(at("2026-11-11T10:00:00Z").getTime() + (MAX_SLOT_MINUTES + 1) * 60_000);
    expect(slotProblem({ startsAt: at("2026-11-11T10:00:00Z"), endsAt: tooLong }, [], now)).toBe("TOO_LONG");
  });

  it("rejects overlaps but allows back-to-back slots", () => {
    const taken = [{ startsAt: at("2026-11-11T19:00:00Z"), endsAt: at("2026-11-11T20:00:00Z") }];
    expect(slotProblem({ startsAt: at("2026-11-11T19:30:00Z"), endsAt: at("2026-11-11T20:30:00Z") }, taken, now)).toBe("OVERLAP");
    expect(slotProblem({ startsAt: at("2026-11-11T20:00:00Z"), endsAt: at("2026-11-11T21:00:00Z") }, taken, now)).toBeNull();
  });

  it("only allows sensible status changes", () => {
    expect(canTransition("REQUESTED", "APPROVED")).toBe(true);
    expect(canTransition("REQUESTED", "DECLINED")).toBe(true);
    expect(canTransition("APPROVED", "DECLINED")).toBe(true); // cancel
    expect(canTransition("DECLINED", "APPROVED")).toBe(false);
    expect(canTransition("APPROVED", "REQUESTED")).toBe(false);
  });

  it("turns a whole-day drag into an evening hour, and caps short drags at an hour", () => {
    const day = new Date(2026, 10, 12, 0, 0);
    const slot = defaultSlotFromDrag(day, new Date(2026, 10, 13, 0, 0));
    expect([slot.startsAt.getHours(), (slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000]).toEqual([19, 60]);
    const short = defaultSlotFromDrag(new Date(2026, 10, 12, 18, 0), new Date(2026, 10, 12, 18, 30));
    expect((short.endsAt.getTime() - short.startsAt.getTime()) / 60_000).toBe(30);
    const long = defaultSlotFromDrag(new Date(2026, 10, 12, 14, 0), new Date(2026, 10, 12, 18, 0));
    expect((long.endsAt.getTime() - long.startsAt.getTime()) / 60_000).toBe(60);
  });
});
