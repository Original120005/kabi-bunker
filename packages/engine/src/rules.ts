export interface RuleSet {
  players: { min: number; max: number };
  maxRounds: number;
  /** Rows of the original reveal table; `perRound[i]` is the number of cards opened in round i + 1. */
  revealTable: { players: [number, number]; perRound: number[] }[];
  firstRoundMandatory: string[];
  workStartAge: number;
  hostSeesHidden: boolean;
}

export const DEFAULT_RULES: RuleSet = {
  players: { min: 6, max: 15 },
  maxRounds: 7,
  revealTable: [
    { players: [6, 6], perRound: [3, 3, 2] },
    { players: [7, 8], perRound: [3, 2, 2, 1, 1, 1, 1] },
    { players: [9, 10], perRound: [3, 2, 1, 1, 1, 1, 1] },
    { players: [11, 12], perRound: [2, 2, 1, 1, 1, 1, 1] },
    { players: [13, 15], perRound: [2, 1, 1, 1, 1, 1, 1] },
  ],
  firstRoundMandatory: ["profession"],
  workStartAge: 16,
  hostSeesHidden: false,
};

/** Places in the bunker: half of the candidates, rounded down. */
export function seatsFor(players: number): number {
  return Math.floor(players / 2);
}

export function revealPlanFor(rules: RuleSet, players: number): number[] {
  const row = rules.revealTable.find((r) => players >= r.players[0] && players <= r.players[1]);
  return row ? row.perRound : [];
}
