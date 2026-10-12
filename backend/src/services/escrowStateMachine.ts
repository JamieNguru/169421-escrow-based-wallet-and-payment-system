import { HttpError } from "../errors";

export type EscrowStatus =
  | "pending"
  | "in_escrow"
  | "work_submitted"
  | "disputed"
  | "completed"
  | "refunded";
export type EscrowEvent =
  | "fund"
  | "submit_work"
  | "release"
  | "refund"
  | "dispute"
  | "resolve_release"
  | "resolve_refund";
export type EscrowActor = "client" | "worker" | "admin";

export interface WalletEffect {
  party: "client" | "worker";
  field: "balance" | "escrowBalance";
  delta: number;
}

interface TransitionRule {
  to: EscrowStatus;
  actors: readonly EscrowActor[];
  effects: (amount: number) => WalletEffect[];
}

const toEscrow = (amount: number): WalletEffect[] => [
  { party: "client", field: "balance", delta: -amount },
  { party: "client", field: "escrowBalance", delta: amount },
];

const toWorker = (amount: number): WalletEffect[] => [
  { party: "client", field: "escrowBalance", delta: -amount },
  { party: "worker", field: "balance", delta: amount },
];

const toClient = (amount: number): WalletEffect[] => [
  { party: "client", field: "escrowBalance", delta: -amount },
  { party: "client", field: "balance", delta: amount },
];

const noEffects = (): WalletEffect[] => [];

export const TRANSITIONS: Readonly<
  Partial<Record<EscrowStatus, Partial<Record<EscrowEvent, TransitionRule>>>>
> = {
  pending: {
    fund: { to: "in_escrow", actors: ["client"], effects: toEscrow },
  },
  in_escrow: {
    submit_work: { to: "work_submitted", actors: ["worker"], effects: noEffects },
    release: { to: "completed", actors: ["admin"], effects: toWorker },
    refund: { to: "refunded", actors: ["admin"], effects: toClient },
    dispute: { to: "disputed", actors: ["client", "worker"], effects: noEffects },
  },
  work_submitted: {
    release: { to: "completed", actors: ["client", "admin"], effects: toWorker },
    refund: { to: "refunded", actors: ["admin"], effects: toClient },
    dispute: { to: "disputed", actors: ["client", "worker"], effects: noEffects },
  },
  disputed: {
    resolve_release: { to: "completed", actors: ["admin"], effects: toWorker },
    resolve_refund: { to: "refunded", actors: ["admin"], effects: toClient },
  },
};

export function isTerminal(status: EscrowStatus): boolean {
  return TRANSITIONS[status] === undefined;
}

export function canTransition(
  current: EscrowStatus,
  event: EscrowEvent,
  actor: EscrowActor,
): boolean {
  return TRANSITIONS[current]?.[event]?.actors.includes(actor) ?? false;
}

// Validates a status change and returns the new status plus the wallet
// changes it implies. Pure: the caller applies the effects (e.g. in a
// Firestore transaction).
export function transition(
  current: EscrowStatus,
  event: EscrowEvent,
  actor: EscrowActor,
  amount: number,
): { status: EscrowStatus; effects: WalletEffect[] } {
  const rule = TRANSITIONS[current]?.[event];
  if (!rule) {
    throw new HttpError(409, `Cannot ${event} an escrow that is ${current}`);
  }
  if (!rule.actors.includes(actor)) {
    throw new HttpError(403, `A ${actor} cannot ${event} an escrow`);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, "Amount must be a positive number");
  }
  return { status: rule.to, effects: rule.effects(amount) };
}
