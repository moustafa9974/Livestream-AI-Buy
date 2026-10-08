/**
 * Tiny transition-table state machine shared by orders and commissions.
 *
 * The sync path (our API capturing an order) and the webhook path (PayPal telling us
 * the same thing later, or earlier) must converge without double-processing. So a
 * transition request has three outcomes, not two:
 *   - "applied":  a real state change; the caller performs side effects.
 *   - "noop":     already in (or past) the target; the caller does nothing.
 *   - "rejected": an illegal jump; the caller logs an audit event and stops.
 */

export type TransitionResult<S extends string> =
  | { kind: "applied"; from: S; to: S }
  | { kind: "noop"; from: S; to: S; reason: "same_state" | "stale" }
  | { kind: "rejected"; from: S; to: S };

export interface MachineDef<S extends string> {
  name: string;
  transitions: Readonly<Record<S, readonly S[]>>;
  /** Self-transitions that are real changes (e.g. a second partial refund). */
  repeatable?: readonly S[];
}

export function createMachine<S extends string>(def: MachineDef<S>) {
  // Precompute everything reachable from each state, so out-of-order events can be
  // detected as stale: if we're in X and someone asks for Y where X is reachable
  // from Y, then Y already happened.
  const reachable = new Map<S, Set<S>>();
  for (const start of Object.keys(def.transitions) as S[]) {
    const seen = new Set<S>();
    const stack = [...def.transitions[start]];
    while (stack.length) {
      const s = stack.pop()!;
      if (seen.has(s)) continue;
      seen.add(s);
      stack.push(...def.transitions[s]);
    }
    reachable.set(start, seen);
  }

  function canTransition(from: S, to: S): boolean {
    return def.transitions[from].includes(to);
  }

  function transition(from: S, to: S): TransitionResult<S> {
    if (from === to && !def.repeatable?.includes(to)) {
      return { kind: "noop", from, to, reason: "same_state" };
    }
    if (canTransition(from, to)) return { kind: "applied", from, to };
    if (reachable.get(to)?.has(from)) return { kind: "noop", from, to, reason: "stale" };
    return { kind: "rejected", from, to };
  }

  /** Throwing variant for code paths where an illegal transition is a bug. */
  function assertTransition(from: S, to: S): TransitionResult<S> {
    const r = transition(from, to);
    if (r.kind === "rejected") {
      throw new Error(`${def.name}: illegal transition ${from} → ${to}`);
    }
    return r;
  }

  return { name: def.name, canTransition, transition, assertTransition };
}
