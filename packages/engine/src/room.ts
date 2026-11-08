import { hasAbilityEffect, type ClientAction, type ContentDb, type HostAction } from "@bunker/shared";
import { ensure, GameError } from "./errors.ts";
import { effectOf, generateGame } from "./generation.ts";
import { applyHostAction } from "./host.ts";
import { answerRaid } from "./raid.ts";
import { Rng } from "./rng.ts";
import { DEFAULT_RULES } from "./rules.ts";
import type { ActionContext, Participant, RoomState } from "./types.ts";

const LOG_LIMIT = 200;

function log(state: RoomState, now: number, text: string) {
  state.log.push({ at: now, text });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

export function players(state: RoomState): Participant[] {
  return state.participants.filter((p) => p.role === "player");
}

export function hostOf(state: RoomState): Participant | undefined {
  return state.participants.find((p) => p.isHost);
}

export interface CreateRoomParams {
  code: string;
  hostId: string;
  tokenHash: string;
  nickname: string;
  now: number;
  seed: number;
  packSlugs: string[];
  profileId?: string | null;
  avatarUrl?: string | null;
}

export function createRoom(p: CreateRoomParams): RoomState {
  return {
    code: p.code,
    version: 1,
    status: "lobby",
    createdAt: p.now,
    settings: { hostPlays: true, autoStart: false, packSlugs: p.packSlugs },
    rules: DEFAULT_RULES,
    participants: [{ id: p.hostId, tokenHash: p.tokenHash, profileId: p.profileId ?? null, nickname: p.nickname, avatarUrl: p.avatarUrl ?? null, role: "player", isHost: true, ready: false, joinedAt: p.now }],
    banned: [],
    game: null,
    log: [{ at: p.now, text: `Комната создана. Ведущий — ${p.nickname}` }],
    rngState: p.seed | 0,
    notices: [],
    undo: [],
    timer: null,
    vote: null,
    raid: null,
    event: null,
    eventUsed: [],
  };
}

/** Fills fields added after a room was saved, so rooms from older versions still load. */
export function upgradeRoom(state: RoomState, loadContent?: (packSlugs: string[]) => ContentDb): RoomState {
  state.notices ??= [];
  state.undo ??= [];
  state.timer ??= null;
  state.vote ??= null;
  state.raid ??= null;
  state.event ??= null;
  state.eventUsed ??= [];
  if (state.event) {
    state.event.image ??= "";
    state.event.spin ??= null;
  }
  for (const p of state.participants) {
    p.profileId ??= null;
    p.avatarUrl ??= null;
  }
  for (const b of state.banned) b.profileId ??= null;
  if (state.game) {
    state.game.exileOrder ??= [];
    state.game.settlement ??= null;
    state.game.catastrophe.image ??= null;
    state.game.bodies ??= [];
    const game = state.game;
    const specialKeys = new Set(game.characteristics.filter((c) => hasAbilityEffect(c)).map((c) => c.key));
    const missing = Object.values(game.cards).filter((c) => specialKeys.has(c.charKey) && c.effect === undefined);
    if (missing.length && loadContent) {
      const items = new Map(Object.values(loadContent(state.settings.packSlugs).pools).flat(2).map((i) => [i.id, i]));
      for (const c of missing) {
        c.effect = effectOf(c.contentId ? (items.get(c.contentId) ?? null) : null);
        c.used ??= false;
      }
    }
  }
  return state;
}

export interface JoinParams {
  id: string;
  tokenHash: string;
  nickname: string;
  now: number;
  profileId?: string | null;
  avatarUrl?: string | null;
}

function rename(state: RoomState, person: Participant, wanted: string) {
  const taken = new Set(state.participants.filter((p) => p.id !== person.id).map((p) => p.nickname.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) {
    person.nickname = wanted;
    return;
  }
  for (let i = 2; ; i++) {
    const candidate = `${wanted} ${i}`;
    if (!taken.has(candidate.toLowerCase())) {
      person.nickname = candidate;
      return;
    }
  }
}

/** Joins a new participant or reconnects an existing one by token. New people become spectators once the game is running or full. */
export function joinRoom(prev: RoomState, p: JoinParams): { state: RoomState; participantId: string; changed: boolean } {
  ensure(prev.status !== "closed", "Комната закрыта");
  const profileId = p.profileId ?? null;
  const existing = (profileId ? prev.participants.find((x) => x.profileId === profileId) : undefined) ?? prev.participants.find((x) => x.tokenHash === p.tokenHash);
  if (existing) {
    const nextAvatar = p.avatarUrl ?? null;
    const sameToken = existing.tokenHash === p.tokenHash;
    const sameAvatar = (existing.avatarUrl ?? null) === nextAvatar;
    const sameName = !profileId || existing.nickname === p.nickname;
    if (sameToken && sameAvatar && sameName) return { state: prev, participantId: existing.id, changed: false };
    const state = structuredClone(prev);
    const person = state.participants.find((x) => x.id === existing.id)!;
    const previousName = person.nickname;
    person.tokenHash = p.tokenHash;
    person.avatarUrl = nextAvatar;
    if (profileId) {
      person.profileId = profileId;
      rename(state, person, p.nickname);
      if (person.nickname !== previousName) log(state, p.now, `${previousName} теперь ${person.nickname}`);
    }
    state.version++;
    return { state, participantId: existing.id, changed: true };
  }
  ensure(!prev.banned.some((b) => b.tokenHash === p.tokenHash || (profileId !== null && b.profileId === profileId)), "Ведущий запретил вам вход в эту комнату");

  const state = structuredClone(prev);
  const nickname = uniqueNickname(state, p.nickname);
  const canPlay = state.status === "lobby" && players(state).length < state.rules.players.max;
  state.participants.push({
    id: p.id,
    tokenHash: p.tokenHash,
    profileId,
    nickname,
    avatarUrl: p.avatarUrl ?? null,
    role: canPlay ? "player" : "spectator",
    isHost: false,
    ready: false,
    joinedAt: p.now,
  });
  log(state, p.now, canPlay ? `${nickname} присоединился к комнате` : `${nickname} присоединился как зритель`);
  state.version++;
  return { state, participantId: p.id, changed: true };
}

function uniqueNickname(state: RoomState, wanted: string): string {
  const taken = new Set(state.participants.map((p) => p.nickname.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let i = 2; ; i++) {
    const candidate = `${wanted} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function requireHost(state: RoomState, ctx: ActionContext) {
  ensure(hostOf(state)?.id === ctx.actorId, "Это может сделать только ведущий");
}

function requireLobby(state: RoomState) {
  ensure(state.status === "lobby" || state.status === "readyCheck", "Игра уже началась");
}

function removeParticipant(state: RoomState, id: string, now: number) {
  const leaving = state.participants.find((p) => p.id === id);
  if (!leaving) return;
  state.participants = state.participants.filter((p) => p.id !== id);
  if (leaving.isHost) {
    const next = [...state.participants].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) {
      next.isHost = true;
      if (!state.settings.hostPlays && state.status !== "playing") next.role = "spectator";
      log(state, now, `Ведущим стал ${next.nickname}`);
    } else {
      state.status = "closed";
    }
  }
}

function startGame(state: RoomState, ctx: ActionContext) {
  const list = players(state);
  ensure(list.length >= state.rules.players.min, `Для начала нужно минимум ${state.rules.players.min} игроков`);
  ensure(list.length <= state.rules.players.max, `Максимум игроков — ${state.rules.players.max}`);
  const rng = new Rng(state.rngState);
  const order = rng.shuffle(list);
  state.undo = [];
  state.game = generateGame({
    playerIds: order.map((p) => p.id),
    content: ctx.loadContent(state.settings.packSlugs),
    rules: state.rules,
    rng,
    newId: ctx.newId,
    now: ctx.now,
  });
  state.rngState = rng.state;
  state.timer = null;
  state.vote = null;
  state.raid = null;
  state.status = "playing";
  for (const p of state.participants) p.ready = false;
  log(state, ctx.now, `Игра началась. Игроков: ${list.length}, мест в бункере: ${state.game.bunker.seats}`);
}

/** Pure reducer: returns a new state or throws GameError. The previous state is never mutated. */
export function applyAction(prev: RoomState, action: ClientAction, ctx: ActionContext): RoomState {
  const state = structuredClone(prev);
  const actor = state.participants.find((p) => p.id === ctx.actorId);
  ensure(actor, "Вы не участник этой комнаты");
  ensure(state.status !== "closed", "Комната закрыта");

  if (action.type.startsWith("host.")) {
    applyHostAction(state, prev, action as HostAction, ctx);
    if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
    state.version = prev.version + 1;
    return state;
  }

  switch (action.type) {
    case "lobby.setHostPlays": {
      requireHost(state, ctx);
      requireLobby(state);
      state.settings.hostPlays = action.value;
      if (action.value) {
        ensure(actor.role === "player" || players(state).length < state.rules.players.max, "Нет свободных мест для игроков");
        actor.role = "player";
      } else {
        actor.role = "spectator";
      }
      actor.ready = false;
      log(state, ctx.now, action.value ? "Ведущий участвует в игре" : "Ведущий не участвует в игре");
      break;
    }
    case "lobby.setAutoStart":
      requireHost(state, ctx);
      requireLobby(state);
      state.settings.autoStart = action.value;
      break;
    case "lobby.kick": {
      requireHost(state, ctx);
      ensure(action.participantId !== actor.id, "Нельзя исключить себя");
      const target = state.participants.find((p) => p.id === action.participantId);
      ensure(target, "Участник не найден");
      ensure(state.status !== "playing" || target.role === "spectator", "Исключение игроков во время игры будет в панели ведущего");
      removeParticipant(state, target.id, ctx.now);
      if (action.ban) state.banned.push({ id: target.id, tokenHash: target.tokenHash, nickname: target.nickname, profileId: target.profileId ?? null });
      log(state, ctx.now, action.ban ? `${target.nickname} исключён и заблокирован` : `${target.nickname} исключён`);
      break;
    }
    case "lobby.unban":
      requireHost(state, ctx);
      state.banned = state.banned.filter((b) => b.id !== action.id);
      break;
    case "lobby.leave":
      if (state.status === "playing" && actor.role === "player") throw new GameError("Во время игры можно просто закрыть вкладку и вернуться по ссылке");
      removeParticipant(state, actor.id, ctx.now);
      log(state, ctx.now, `${actor.nickname} покинул комнату`);
      break;
    case "lobby.startReadyCheck":
      requireHost(state, ctx);
      ensure(state.status === "lobby", "Проверка готовности уже идёт");
      ensure(players(state).length >= state.rules.players.min, `Для начала нужно минимум ${state.rules.players.min} игроков`);
      state.status = "readyCheck";
      for (const p of state.participants) p.ready = false;
      log(state, ctx.now, "Ведущий начал проверку готовности");
      break;
    case "lobby.cancelReadyCheck":
      requireHost(state, ctx);
      ensure(state.status === "readyCheck", "Проверка готовности не идёт");
      state.status = "lobby";
      for (const p of state.participants) p.ready = false;
      break;
    case "lobby.setReady": {
      ensure(state.status === "readyCheck", "Проверка готовности не идёт");
      ensure(actor.role === "player", "Зрителям не нужно подтверждать готовность");
      actor.ready = action.ready;
      const all = players(state).every((p) => p.ready);
      if (all && state.settings.autoStart) startGame(state, ctx);
      break;
    }
    case "lobby.start":
      requireHost(state, ctx);
      requireLobby(state);
      if (state.status === "readyCheck") ensure(players(state).every((p) => p.ready), "Не все игроки подтвердили готовность");
      startGame(state, ctx);
      break;
    case "room.close":
      requireHost(state, ctx);
      state.status = "closed";
      log(state, ctx.now, "Ведущий закрыл комнату");
      break;
    case "card.setRevealed": {
      ensure(state.status === "playing" && state.game, "Игра не идёт");
      const card = state.game.cards[action.cardId];
      ensure(card, "Карта не найдена");
      const isOwner = card.ownerId === actor.id;
      if (action.revealed && !actor.isHost) {
        ensure(isOwner, "Открывать можно только свои карты");
        ensure(state.game.statuses[actor.id] === "alive", "Изгнанные игроки не открывают карты");
      } else if (!action.revealed) {
        ensure(hostOf(state)?.id === actor.id, "Скрыть карту может только ведущий");
      }
      if (card.revealed === action.revealed) return prev;
      card.revealed = action.revealed;
      const def = state.game.characteristics.find((c) => c.key === card.charKey);
      const owner = state.participants.find((p) => p.id === card.ownerId)?.nickname ?? "Игрок";
      const name = def?.name ?? card.charKey;
      log(
        state,
        ctx.now,
        !action.revealed ? `Ведущий скрыл карту «${name}» игрока ${owner}` : isOwner ? `${owner} открыл: ${name}` : `Ведущий открыл карту «${name}» игрока ${owner}`,
      );
      break;
    }
    case "vote.cast": {
      const vote = state.vote;
      ensure(vote && vote.status === "open", "Голосование не идёт");
      ensure(vote.voters.includes(actor.id), "Вы не участвуете в этом голосовании");
      ensure(!(actor.id in vote.ballots), "Вы уже проголосовали");
      ensure(action.candidateId !== actor.id, "Нельзя голосовать против себя");
      ensure(vote.candidates.includes(action.candidateId), "За этого игрока нельзя голосовать");
      vote.ballots[actor.id] = action.candidateId;
      log(state, ctx.now, `${actor.nickname} проголосовал`);
      if (vote.voters.every((id) => id in vote.ballots)) {
        vote.status = "closed";
        log(state, ctx.now, "Все проголосовали — результаты открыты");
      }
      break;
    }
    case "raid.answer":
      ensure(state.status === "playing" && state.game, "Игра не идёт");
      answerRaid(state, actor.id, action.yes, ctx.now);
      break;
  }

  state.version = prev.version + 1;
  return state;
}
