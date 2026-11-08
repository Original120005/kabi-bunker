/** One finished party, scored once. `firstOut` / `secondOut` are the exile order, not raid deaths. */
export type PartyOutcome = "bunker" | "firstOut" | "secondOut" | "none";

export interface SettlementRow {
  playerId: string;
  /** Profile id. Null for players without an account (local bots): they change status, but get no rating. */
  profileId: string | null;
  outcome: PartyOutcome;
  delta: number;
}

export interface Settlement {
  id: string;
  rows: SettlementRow[];
}

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
