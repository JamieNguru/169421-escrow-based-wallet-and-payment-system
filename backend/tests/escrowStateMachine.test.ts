import { HttpError } from "../src/errors";
import {
  canTransition,
  isTerminal,
  transition,
  TRANSITIONS,
  type EscrowActor,
  type EscrowEvent,
  type EscrowStatus,
} from "../src/services/escrowStateMachine";

const STATUSES: EscrowStatus[] = [
  "pending",
  "in_escrow",
  "work_submitted",
  "disputed",
  "completed",
  "refunded",
];
const EVENTS: EscrowEvent[] = [
  "fund",
  "submit_work",
  "release",
  "refund",
  "dispute",
  "resolve_release",
  "resolve_refund",
];
const ACTORS: EscrowActor[] = ["client", "worker", "admin"];

const VALID: [EscrowStatus, EscrowEvent, EscrowActor, EscrowStatus][] = [
  ["pending", "fund", "client", "in_escrow"],
  ["in_escrow", "submit_work", "worker", "work_submitted"],
  ["in_escrow", "refund", "admin", "refunded"],
  ["in_escrow", "dispute", "client", "disputed"],
  ["in_escrow", "dispute", "worker", "disputed"],
  ["work_submitted", "release", "client", "completed"],
  ["work_submitted", "release", "admin", "completed"],
  ["work_submitted", "refund", "admin", "refunded"],
  ["work_submitted", "dispute", "client", "disputed"],
  ["work_submitted", "dispute", "worker", "disputed"],
  ["disputed", "resolve_release", "admin", "completed"],
  ["disputed", "resolve_refund", "admin", "refunded"],
];

function statusOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof HttpError ? err.status : undefined;
  }
  return undefined;
}

describe("escrow state machine", () => {
  it.each(VALID)("%s --%s by %s--> %s", (from, event, actor, to) => {
    expect(transition(from, event, actor, 500).status).toBe(to);
    expect(canTransition(from, event, actor)).toBe(true);
  });

  it("rejects every state/event pair that is not in the table with 409", () => {
    for (const from of STATUSES) {
      for (const event of EVENTS) {
        if (TRANSITIONS[from]?.[event]) continue;
        expect(statusOf(() => transition(from, event, "admin", 100))).toBe(409);
        expect(canTransition(from, event, "admin")).toBe(false);
      }
    }
  });

  it("rejects every disallowed actor on a valid transition with 403", () => {
    for (const from of STATUSES) {
      for (const event of EVENTS) {
        const rule = TRANSITIONS[from]?.[event];
        if (!rule) continue;
        for (const actor of ACTORS.filter((a) => !rule.actors.includes(a))) {
          expect(statusOf(() => transition(from, event, actor, 100))).toBe(403);
          expect(canTransition(from, event, actor)).toBe(false);
        }
      }
    }
  });

  it("accepts no events from terminal states", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("refunded")).toBe(true);
    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("in_escrow")).toBe(false);
    expect(isTerminal("work_submitted")).toBe(false);
    expect(isTerminal("disputed")).toBe(false);
    for (const from of ["completed", "refunded"] as const) {
      for (const event of EVENTS) {
        for (const actor of ACTORS) {
          expect(canTransition(from, event, actor)).toBe(false);
        }
      }
    }
  });

  it.each([0, -50, NaN, Infinity])("rejects amount %p with 400", (amount) => {
    expect(statusOf(() => transition("pending", "fund", "client", amount))).toBe(400);
  });

  it("moves funds into escrow on fund", () => {
    expect(transition("pending", "fund", "client", 500).effects).toEqual([
      { party: "client", field: "balance", delta: -500 },
      { party: "client", field: "escrowBalance", delta: 500 },
    ]);
  });

  it("does not let anyone release funds before the worker submits work", () => {
    for (const actor of ACTORS) {
      expect(statusOf(() => transition("in_escrow", "release", actor, 500))).toBe(409);
    }
  });

  it("leaves balances untouched when work is submitted", () => {
    expect(transition("in_escrow", "submit_work", "worker", 500).effects).toEqual([]);
  });

  it("pays the worker on release and resolve_release", () => {
    const expected = [
      { party: "client", field: "escrowBalance", delta: -500 },
      { party: "worker", field: "balance", delta: 500 },
    ];
    expect(transition("work_submitted", "release", "client", 500).effects).toEqual(expected);
    expect(transition("disputed", "resolve_release", "admin", 500).effects).toEqual(expected);
  });

  it("returns funds to the client on refund and resolve_refund", () => {
    const expected = [
      { party: "client", field: "escrowBalance", delta: -500 },
      { party: "client", field: "balance", delta: 500 },
    ];
    expect(transition("work_submitted", "refund", "admin", 500).effects).toEqual(expected);
    expect(transition("disputed", "resolve_refund", "admin", 500).effects).toEqual(expected);
  });

  it("leaves balances untouched on dispute", () => {
    expect(transition("in_escrow", "dispute", "worker", 500).effects).toEqual([]);
  });

  it("never creates or destroys money: effects net to zero", () => {
    for (const [from, event, actor] of VALID) {
      const net = transition(from, event, actor, 123.45).effects.reduce(
        (sum, e) => sum + e.delta,
        0,
      );
      expect(net).toBeCloseTo(0);
    }
  });
});
