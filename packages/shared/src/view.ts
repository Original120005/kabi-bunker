import type { SpecialEffect } from "./content.ts";
import type { RaidView } from "./raid.ts";

/** What a single participant receives from the server. Hidden cards of other players never carry their values. */

export type RoomStatus = "lobby" | "readyCheck" | "playing" | "finished" | "closed";
export type ParticipantRole = "player" | "spectator";
/** `dead` — did not survive a raid. */
export type PlayerStatus = "alive" | "exiled" | "inBunker" | "dead";

export interface ParticipantView {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  role: ParticipantRole;
  isHost: boolean;
  ready: boolean;
  online: boolean;
}

export interface HiddenCardView {
  id: string;
  charKey: string;
  hidden: true;
}

export interface VisibleCardView {
  id: string;
  charKey: string;
  hidden: false;
  /** Title plus rendered modifiers, e.g. «Врач (Эксперт)». */
  label: string;
  /** Title alone, without modifiers. */
  title: string;
  description: string;
  /** Where to read what this condition is. Empty when the card has no article. */
  link: string | null;
  abilities: { name: string; text: string; kind: string }[];
  /** Whether the card is open to everybody; owners also see their closed cards. */
  revealed: boolean;
  /** Special cards and professions: what the host's one-click application does; null when it is applied by hand. */
  effect: SpecialEffect | null;
  /** Special cards and professions: already applied by the host. */
  used: boolean;
}

export type CardView = HiddenCardView | VisibleCardView;

export interface CharacteristicView {
  key: string;
  name: string;
  sort: number;
  revealable: boolean;
  specialCard: boolean;
  countPerPlayer: number;
  hint?: string;
  /** Levels of scale modifiers (experience), shown in the «i» tooltip. */
  levels: { label: string; hint?: string }[];
  /** Definitions of modifiers, used by host panel forms. */
  modifiers: ModifierView[];
}

export type ModifierView =
  | { kind: "scale"; key: string; levels: { key: string; label: string }[] }
  | { kind: "age"; key: string; groups: { key: string; label: string }[] }
  | { kind: "flag"; key: string; label: string }
  | { kind: "range"; key: string };

export interface NoticeView {
  id: number;
  at: number;
  color: "gold" | "green" | "red" | "white";
  title: string;
  text: string;
}

export interface GamePlayerView {
  id: string;
  seat: number;
  nickname: string;
  avatarUrl: string | null;
  status: PlayerStatus;
  cards: Record<string, CardView[]>;
}

export interface BunkerFieldView {
  key: string;
  name: string;
  placement: "text" | "list" | "tile";
  icon?: string;
  values: string[];
}

export interface GameView {
  catastrophe: { title: string; description: string; population: number | null; timerMinutes: number | null; image: string | null };
  bunker: { fields: BunkerFieldView[]; seats: number };
  characteristics: CharacteristicView[];
  players: GamePlayerView[];
  /** The host has scored this party. Rating is not sent to the client. */
  settled: boolean;
  /** Only for the host: values for host panel selects and the last undoable action. */
  host: { bodies: string[]; undoLabel: string | null } | null;
}

export interface LogEntryView {
  at: number;
  text: string;
}

export interface RoomView {
  code: string;
  version: number;
  status: RoomStatus;
  serverTime: number;
  me: ParticipantView | null;
  settings: { hostPlays: boolean; autoStart: boolean; minPlayers: number; maxPlayers: number; packSlugs: string[] };
  participants: ParticipantView[];
  /** Only sent to the host. */
  banned: { id: string; nickname: string }[];
  game: GameView | null;
  log: LogEntryView[];
  notices: NoticeView[];
  /** Countdown started by the host; compare endsAt with serverTime. */
  timer: { id: number; seconds: number; endsAt: number } | null;
  vote: VoteView | null;
  raid: RaidView | null;
  /** Full-screen event the host just launched. The same id stays until the next event. */
  event: RoomEventView | null;
}

export type EventTone = "good" | "bad" | "mixed";

export interface RoomEventSpinView {
  at: number;
  reel: string[];
  offset: number;
  effect: { kind: "health" | "item"; title: string };
}

export interface RoomEventView {
  id: number;
  title: string;
  text: string;
  tone: EventTone;
  image: string;
  /** Present when a living player is about to receive a health line or a backpack item. */
  spin: RoomEventSpinView | null;
}

export interface VoteView {
  id: number;
  status: "open" | "closed";
  /** Player ids that can be voted against. */
  candidates: string[];
  /** Player ids that vote. */
  voters: string[];
  /** Who has already voted; whom they voted for stays secret until the vote closes. */
  voted: string[];
  myVote: string | null;
  /** Only when closed, sorted by votes. */
  results: { candidateId: string; voters: string[] }[] | null;
}
