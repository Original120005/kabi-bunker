import type {
  AbilityDef,
  BunkerFieldDef,
  CharacteristicDef,
  ContentDb,
  ModifierValues,
  ParticipantRole,
  PlayerStatus,
  RaidLoot,
  RaidStage,
  RaidStep,
  RoomStatus,
  Settlement,
  SpecialEffect,
} from "@bunker/shared";
import type { RuleSet } from "./rules.ts";

export interface Participant {
  id: string;
  tokenHash: string;
  /** Stable account. Null for local bots, which are not written to the leaderboard. */
  profileId: string | null;
  nickname: string;
  avatarUrl: string | null;
  role: ParticipantRole;
  isHost: boolean;
  ready: boolean;
  joinedAt: number;
}

export interface Card {
  id: string;
  charKey: string;
  ownerId: string;
  /** Null for the «Пусто» value left after a steal. */
  contentId: string | null;
  title: string;
  description: string;
  modifiers: ModifierValues;
  abilities: AbilityDef[];
  /** Article about this condition, when the card is a disease. */
  link?: string;
  revealed: boolean;
  /** Special cards and professions: effect copied from the content at deal time. Missing in games started before effects existed. */
  effect?: SpecialEffect | null;
  /** Special cards and professions: applied by the host (the mark travels with the card). */
  used?: boolean;
}

export interface GameState {
  startedAt: number;
  rules: RuleSet;
  /** Definitions are copied at start so content edits do not affect a running game. */
  characteristics: CharacteristicDef[];
  bunkerFields: BunkerFieldDef[];
  /** Player ids in seat order («Желающие попасть в бункер»). */
  seatOrder: string[];
  statuses: Record<string, PlayerStatus>;
  /** Player ids in the order they were exiled. A return removes the player, so a later exile can become first. */
  exileOrder: string[];
  /** Set once by the host. The server turns it into profile stats and never applies the same id twice. */
  settlement: Settlement | null;
  /** playerId → characteristic key → card ids. A characteristic may hold several cards. */
  hands: Record<string, Record<string, string[]>>;
  cards: Record<string, Card>;
  catastrophe: { contentId: string | null; title: string; description: string; population: number | null; timerMinutes: number | null; image: string | null };
  bunker: { fields: Record<string, { contentId: string | null; title: string }[]>; seats: number };
  /** Body types available in the content, for the host panel. */
  bodies: string[];
}

export interface LogEntry {
  at: number;
  text: string;
}

export type NoticeColor = "gold" | "green" | "red" | "white";

/** Pop-up for players: host messages and dice rolls. `to` is a participant id or "all". */
export interface Notice {
  id: number;
  at: number;
  to: string;
  color: NoticeColor;
  title: string;
  text: string;
}

export interface UndoEntry {
  label: string;
  game: GameState;
  rngState: number;
  /** Cards open right after the action; cards opened later by players stay open on undo. */
  revealedAfter?: string[];
  /** Set when the action was a special card application, for «Отменить спец. возможность». */
  special?: { ownerId: string; cardId: string };
}

export interface RoomSettings {
  hostPlays: boolean;
  autoStart: boolean;
  packSlugs: string[];
}

export type EventEffect =
  | { kind: "health"; title: string; description: string; severity: "light" | "medium" | "heavy" | "critical"; link?: string }
  | { kind: "item"; title: string; description: string };

/** Player reel for an event. `winnerId` stays on the server; clients only get the reel, same as a raid. */
export interface EventSpin {
  at: number;
  reel: string[];
  offset: number;
  winnerId: string;
  effect: EventEffect;
  applied: boolean;
}

export interface RoomState {
  code: string;
  version: number;
  status: RoomStatus;
  createdAt: number;
  settings: RoomSettings;
  rules: RuleSet;
  participants: Participant[];
  banned: { id: string; tokenHash: string; nickname: string; profileId: string | null }[];
  game: GameState | null;
  log: LogEntry[];
  rngState: number;
  notices: Notice[];
  /** Games before the latest host actions, for «Отменить предыдущее действие». Never sent to clients. */
  undo: UndoEntry[];
  /** Kept outside the game so undo does not affect them. */
  timer: Timer | null;
  vote: Vote | null;
  raid: Raid | null;
  /** Shown to everyone until the host launches another. Lives outside the game, so undo does not touch the text. The card it grants is inside the game and can be undone. */
  event: {
    id: number;
    title: string;
    text: string;
    tone: "good" | "bad" | "mixed";
    image: string;
    /** Set when the event gives one living player a health line or a backpack item. The card is written when the reel stops. */
    spin: EventSpin | null;
  } | null;
  /** Keys already shown. Cleared after the whole pool has been used, so one event does not return early. */
  eventUsed: string[];
  /** Events launched in the current party, for «Итоги партии». Reset when a party starts. */
  partyEvents?: string[];
}

/**
 * «Вылазка». All outcomes are rolled on the server when a stage starts; `revealed` counts the steps whose animation
 * has begun, so clients never learn results ahead of the roulette. Lives outside the game, so undo does not touch it.
 */
export interface Raid {
  id: number;
  stage: RaidStage;
  startedAt: number;
  votingEndsAt: number;
  eligible: string[];
  /** player id → «Да» / «Нет». */
  answers: Record<string, boolean>;
  cancelledAt?: number;
  playerId: string | null;
  pick?: { at: number; reel: string[]; offset: number };
  survival?: { chance: number; modifiers: { label: string; delta: number }[] };
  steps: RaidStep[];
  revealed: number;
  endsAt?: number;
  survived?: boolean;
  loot: RaidLoot[];
}

export interface Timer {
  id: number;
  seconds: number;
  startedAt: number;
  endsAt: number;
}

export interface Vote {
  id: number;
  status: "open" | "closed";
  startedAt: number;
  voters: string[];
  candidates: string[];
  /** voter id → candidate id. */
  ballots: Record<string, string>;
}

export interface ActionContext {
  actorId: string;
  now: number;
  newId: () => string;
  /** Loads content for the room's packs; only needed when a game starts. */
  loadContent: (packSlugs: string[]) => ContentDb;
}
