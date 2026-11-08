import { z } from "zod";

/** «Вылазка»: timings shared by the server (which advances stages) and clients (which animate them). */
export const RAID = {
  voteMs: 30_000,
  /** «Никто не согласился» stays on screen, then the raid is cleared. */
  cancelledMs: 6_000,
  /** Pause between the end of the vote and the start of the player roulette. */
  pickDelayMs: 800,
  pickSpinMs: 7_500,
  pickHoldMs: 3_500,
  survivalSpinMs: 7_000,
  survivalHoldMs: 3_000,
  chanceSpinMs: 5_000,
  chanceHoldMs: 2_000,
  itemSpinMs: 6_500,
  itemHoldMs: 3_500,
  /** Reel strip length and the index of the winning cell. */
  reelLength: 44,
  reelWinIndex: 38,
  /** Chance in percent to find the 1st…5th item; the search stops at the first miss. */
  lootChances: [100, 70, 50, 50, 50],
} as const;

export const RAID_TIERS = [1, 2, 3, 4, 5] as const;
export const RAID_RARITY: Record<number, string> = { 1: "Обычное", 2: "Необычное", 3: "Редкое", 4: "Очень редкое", 5: "Легендарное" };

/**
 * Survival chance: always starts from `base`; modifiers of different characteristics add up.
 * Body is matched by card title, health by «Идеально здоров» or severity level, age by the gender card's age.
 */
export const SURVIVAL_RULES = {
  base: 60,
  body: {
    "Хрупкое": -10,
    "Ожирение-сильное": -10,
    "Ожирение-слабое": -5,
    "Крепкое": 5,
    "Атлетическое": 10,
  } as Record<string, number>,
  /** Checked top to bottom, only the first matching rule applies (65+ does not also get the 55+ penalty). */
  age: [
    { label: "65 лет и старше", min: 65, max: Infinity, delta: -10 },
    { label: "55 лет и старше", min: 55, max: 64, delta: -5 },
    { label: "от 25 до 40 лет", min: 25, max: 40, delta: 5 },
    { label: "младше 18 лет", min: 0, max: 17, delta: -5 },
  ],
  healthy: { title: "Идеально здоров", delta: 10 },
  severity: { critical: { label: "критическое", delta: -10 }, heavy: { label: "плохое (тяжёлая степень)", delta: -5 } } as Record<string, { label: string; delta: number }>,
};

/** `data` of a «raidItem» content element. Tier 1 is common, tier 5 is the most valuable. */
export const RaidItemData = z.object({
  tier: z.number().int().min(1).max(5),
  category: z.string().min(1).max(40),
  rarity: z.string().min(1).max(40).optional(),
  value: z.number().int().min(0),
  icon: z.string().min(1).max(16),
  /** Public path of a picture, shown instead of the emoji when present. */
  image: z.string().min(1).max(120).optional(),
});
export type RaidItemData = z.infer<typeof RaidItemData>;

export interface RaidLoot {
  id: string;
  title: string;
  description: string;
  category: string;
  rarity: string;
  value: number;
  icon: string;
  tier: number;
  image?: string;
}

/** One animated stage after the return. `roll` is in [0, 1); the result is `roll < chance / 100`. */
export type RaidStep =
  | { kind: "survival"; at: number; chance: number; roll: number; success: boolean }
  | { kind: "chance"; at: number; tier: number; chance: number; roll: number; success: boolean }
  | { kind: "item"; at: number; tier: number; item: RaidLoot; reel: RaidLoot[]; offset: number };

export function raidStepMs(step: Pick<RaidStep, "kind">): number {
  if (step.kind === "survival") return RAID.survivalSpinMs + RAID.survivalHoldMs;
  if (step.kind === "chance") return RAID.chanceSpinMs + RAID.chanceHoldMs;
  return RAID.itemSpinMs + RAID.itemHoldMs;
}

export type RaidStage = "voting" | "cancelled" | "picking" | "away" | "returning" | "done";

export interface RaidView {
  id: number;
  stage: RaidStage;
  votingEndsAt: number;
  /** Players who may answer the call. */
  eligible: string[];
  /** Answered «Да»; visible to everybody. */
  volunteers: string[];
  answered: string[];
  myAnswer: boolean | null;
  playerId: string | null;
  pick: { at: number; reel: string[]; offset: number } | null;
  survival: { chance: number; modifiers: { label: string; delta: number }[] } | null;
  /** Only steps whose animation has started; later ones stay on the server. */
  steps: RaidStep[];
  survived: boolean | null;
  loot: RaidLoot[];
}
