import type { FinaleFactor } from "./finale.ts";

/** One finished party, scored once. `firstOut` / `secondOut` are the exile order, not raid deaths. */
export type PartyOutcome = "bunker" | "firstOut" | "secondOut" | "none";

export interface SettlementRow {
  playerId: string;
  /** Profile id. Null for players without an account (local bots): they change status, but get no rating. */
  profileId: string | null;
  outcome: PartyOutcome;
  delta: number;
  /** Shown in the results table. */
  reason?: string;
}

export interface Settlement {
  id: string;
  rows: SettlementRow[];
  /** Simulation of the bunker's fate; missing in parties scored before it existed. */
  finale?: FinaleResult;
}

/** Server-side result of «Итоги партии». Deltas and the chance never reach clients. */
export interface FinaleResult {
  at: number;
  revealAt: number;
  /** Set by the server clock at `revealAt`; until then the verdict is not sent. */
  revealed: boolean;
  factors: FinaleFactor[];
  finalEvent: { key: string; title: string; text: string; image: string; tone: "good" | "bad" | "mixed"; outcome: string; solved: boolean | null } | null;
  chance: number;
  survived: boolean;
}

/** Extra rating for everyone inside when the bunker survives. */
export const SURVIVAL_BONUS = 10;

/** Bunker +20, first exile −20, second exile −10, anything else 0. Rating may go below zero. */
export function ratingFor(inBunker: boolean, exileIndex: number | null): { outcome: PartyOutcome; delta: number } {
  if (inBunker) return { outcome: "bunker", delta: 20 };
  if (exileIndex === 0) return { outcome: "firstOut", delta: -20 };
  if (exileIndex === 1) return { outcome: "secondOut", delta: -10 };
  return { outcome: "none", delta: 0 };
}

/** Round((bunker entries / games) × 100). Zero games is 0%, not a division by zero. */
export function survivalPercent(bunkerEntries: number, games: number): number {
  if (games <= 0) return 0;
  return Math.round((bunkerEntries / games) * 100);
}
