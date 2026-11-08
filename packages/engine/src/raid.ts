import { RAID, RAID_RARITY, RaidItemData, SURVIVAL_RULES, raidStepMs, type ContentDb, type RaidLoot, type RaidStep } from "@bunker/shared";
import { pendingEventAt, settleEvent } from "./events.ts";
import { ensure } from "./errors.ts";
import { makeCard } from "./generation.ts";
import { Rng } from "./rng.ts";
import type { ActionContext, Card, GameState, Raid, RoomState } from "./types.ts";

const UNDO_LIMIT = 10;
/** Stages during which the chosen player cannot be exiled or put up for a vote. */
const PROTECTED = new Set<Raid["stage"]>(["picking", "away", "returning"]);
/** Stages that take over the screen; a regular vote cannot run at the same time. */
const BUSY = new Set<Raid["stage"]>(["voting", "picking", "returning"]);

export function raidProtects(state: RoomState, playerId: string): boolean {
  const r = state.raid;
  return !!r && r.playerId === playerId && PROTECTED.has(r.stage);
}

export function raidBusy(state: RoomState): boolean {
  return !!state.raid && BUSY.has(state.raid.stage);
}

function cardsOf(game: GameState, playerId: string, key: string): Card[] {
  return (game.hands[playerId]?.[key] ?? []).map((id) => game.cards[id]).filter(Boolean);
}

function nameOf(state: RoomState, id: string) {
  return state.participants.find((p) => p.id === id)?.nickname ?? "Игрок";
}

function log(state: RoomState, now: number, text: string) {
  state.log.push({ at: now, text });
}

/** 50% plus the modifiers of body, age and health; clamped to 0–100. */
export function survivalChance(game: GameState, playerId: string): { chance: number; modifiers: { label: string; delta: number }[] } {
  const modifiers: { label: string; delta: number }[] = [];
  const body = cardsOf(game, playerId, "body")[0];
  const bodyDelta = body ? SURVIVAL_RULES.body[body.title] : undefined;
  if (body && bodyDelta) modifiers.push({ label: `Телосложение: ${body.title.toLowerCase()}`, delta: bodyDelta });

  const age = cardsOf(game, playerId, "gender")[0]?.modifiers.age;
  if (typeof age === "number") {
    const rule = SURVIVAL_RULES.age.find((r) => age >= r.min && age <= r.max);
    if (rule) modifiers.push({ label: `Возраст: ${rule.label}`, delta: rule.delta });
  }

  const health = cardsOf(game, playerId, "health")[0];
  if (health?.title === SURVIVAL_RULES.healthy.title) {
    modifiers.push({ label: "Здоровье: идеально здоров", delta: SURVIVAL_RULES.healthy.delta });
  } else if (health?.contentId) {
    const severity = health.modifiers.severity;
    const rule = typeof severity === "string" ? SURVIVAL_RULES.severity[severity] : undefined;
    if (rule) modifiers.push({ label: `Здоровье: ${rule.label}`, delta: rule.delta });
  }

  const chance = Math.max(0, Math.min(100, SURVIVAL_RULES.base + modifiers.reduce((s, m) => s + m.delta, 0)));
  return { chance, modifiers };
}

interface LootEntry {
  loot: RaidLoot;
  weight: number;
}

export function lootPool(content: ContentDb): LootEntry[] {
  return (content.pools.raidItem ?? []).flat().flatMap((item) => {
    const data = RaidItemData.safeParse(item.data);
    if (!data.success || item.weight <= 0) return [];
    const d = data.data;
    return [
      {
        weight: item.weight,
        loot: { id: item.id, title: item.title, description: item.description, category: d.category, rarity: d.rarity ?? RAID_RARITY[d.tier], value: d.value, icon: d.icon, tier: d.tier, ...(d.image ? { image: d.image } : {}) },
      },
    ];
  });
}

function pickLoot(rng: Rng, entries: LootEntry[], taken: Set<string>): RaidLoot {
  const fresh = entries.filter((e) => !taken.has(e.loot.id));
  const list = fresh.length ? fresh : entries;
  return list[rng.weightedIndex(list.map((e) => e.weight))].loot;
}

export function spinReel<T>(rng: Rng, options: readonly T[], winner: T): { reel: T[]; offset: number } {
  return { reel: reelOf(rng, options, winner), offset: reelOffset(rng) };
}

function reelOf<T>(rng: Rng, options: readonly T[], winner: T): T[] {
  const reel = Array.from({ length: RAID.reelLength }, () => rng.pick(options));
  reel[RAID.reelWinIndex] = winner;
  return reel;
}

/** Where inside the winning cell the reel stops, so it does not always land dead centre. */
function reelOffset(rng: Rng) {
  return 0.15 + rng.next() * 0.7;
}

function nextId(prev: number | undefined, now: number): number {
  return Math.max((prev ?? 0) + 1, now);
}

export function startRaid(state: RoomState, now: number) {
  const game = state.game!;
  ensure(!raidBusy(state) && state.raid?.stage !== "away", "Вылазка уже идёт");
  ensure(!state.event?.spin || state.event.spin.applied, "Дождитесь конца рулетки ивента");
  ensure(state.vote?.status !== "open", "Сначала завершите голосование");
  const eligible = game.seatOrder.filter((id) => game.statuses[id] === "alive");
  ensure(eligible.length > 0, "Некому идти на вылазку");
  state.raid = {
    id: nextId(state.raid?.id, now),
    stage: "voting",
    startedAt: now,
    votingEndsAt: now + RAID.voteMs,
    eligible,
    answers: {},
    playerId: null,
    steps: [],
    revealed: 0,
    loot: [],
  };
}

export function answerRaid(state: RoomState, playerId: string, yes: boolean, now: number) {
  const r = state.raid;
  ensure(r && r.stage === "voting" && now < r.votingEndsAt, "Голосование за вылазку не идёт");
  ensure(r.eligible.includes(playerId), "Вы не можете отправиться на вылазку");
  ensure(!(playerId in r.answers), "Вы уже ответили");
  r.answers[playerId] = yes;
  log(state, now, `${nameOf(state, playerId)} ${yes ? "согласился" : "отказался"} пойти на вылазку`);
}

/** «Игрок вернулся»: rolls survival and every loot step at once; clients replay them one by one. */
export function returnRaid(state: RoomState, rng: Rng, content: ContentDb, now: number) {
  const r = state.raid;
  ensure(r && r.stage === "away" && r.playerId, "Сейчас никто не на вылазке");
  const game = state.game!;
  const survival = survivalChance(game, r.playerId);
  const pool = lootPool(content);
  ensure(pool.length > 0, "В контенте нет предметов для вылазки (raidItem)");

  const steps: RaidStep[] = [];
  let at = now + 600;
  const push = (step: RaidStep) => {
    steps.push(step);
    at += raidStepMs(step);
  };
  const roll = (chance: number) => {
    const value = rng.next();
    return { roll: value, success: value < chance / 100 };
  };

  const alive = roll(survival.chance);
  push({ kind: "survival", at, chance: survival.chance, ...alive });
  const loot: RaidLoot[] = [];
  if (alive.success) {
    const taken = new Set<string>();
    for (let i = 0; i < RAID.lootChances.length; i++) {
      const tier = i + 1;
      if (i > 0) {
        const chance = RAID.lootChances[i];
        const check = roll(chance);
        push({ kind: "chance", at, tier, chance, ...check });
        if (!check.success) break;
      }
      // The guaranteed find is a middle-tier item, so a single drop is worth carrying.
      const band = i === 0 ? pool.filter((e) => e.loot.tier === 3) : pool.filter((e) => e.loot.tier === tier);
      const options = band.length ? band : pool;
      const item = pickLoot(rng, options, taken);
      taken.add(item.id);
      loot.push(item);
      push({ kind: "item", at, tier, item, reel: reelOf(rng, options.map((e) => e.loot), item), offset: reelOffset(rng) });
    }
  }

  r.stage = "returning";
  r.survival = survival;
  r.steps = steps;
  r.revealed = 0;
  r.endsAt = at;
  r.survived = alive.success;
  r.loot = loot;
}

/** When the raid itself needs the server clock, ignoring events. */
function raidWakeAt(state: RoomState): number | null {
  const r = state.raid;
  if (!r || state.status !== "playing" || !state.game) return null;
  switch (r.stage) {
    case "voting":
      return r.votingEndsAt;
    case "cancelled":
      return (r.cancelledAt ?? r.votingEndsAt) + RAID.cancelledMs;
    case "picking":
      return r.pick ? r.pick.at + RAID.pickSpinMs + RAID.pickHoldMs : r.votingEndsAt;
    case "returning":
      return r.revealed < r.steps.length ? r.steps[r.revealed].at : (r.endsAt ?? 0);
    default:
      return null;
  }
}

/** When the server should call `advanceRoom` next, or null when nothing is pending. */
export function nextWakeAt(state: RoomState): number | null {
  const times = [raidWakeAt(state), pendingEventAt(state)].filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}

/** Time-driven transitions; returns `prev` when nothing is due. Pure, like `applyAction`. */
export function advanceRoom(prev: RoomState, ctx: Pick<ActionContext, "now" | "newId">): RoomState {
  const raidAt = raidWakeAt(prev);
  const eventAt = pendingEventAt(prev);
  const raidDue = raidAt !== null && ctx.now >= raidAt;
  const eventDue = eventAt !== null && ctx.now >= eventAt;
  if (!raidDue && !eventDue) return prev;
  const state = structuredClone(prev);
  if (eventDue && (!raidDue || eventAt! <= raidAt!)) {
    settleEvent(state, prev, ctx.newId, ctx.now);
    state.version = prev.version + 1;
    return state;
  }
  const r = state.raid!;
  const game = state.game!;
  const rng = new Rng(state.rngState);

  switch (r.stage) {
    case "voting": {
      const volunteers = r.eligible.filter((id) => r.answers[id] === true && game.statuses[id] === "alive" && game.seatOrder.includes(id));
      if (volunteers.length === 0) {
        r.stage = "cancelled";
        r.cancelledAt = ctx.now;
        log(state, ctx.now, "Вылазка отменена: никто не согласился");
      } else {
        const winner = rng.pick(volunteers);
        r.stage = "picking";
        r.playerId = winner;
        r.pick = { at: ctx.now + RAID.pickDelayMs, reel: reelOf(rng, volunteers, winner), offset: reelOffset(rng) };
      }
      break;
    }
    case "cancelled":
      state.raid = null;
      break;
    case "picking":
      r.stage = "away";
      log(state, ctx.now, `${nameOf(state, r.playerId!)} отправился на вылазку`);
      break;
    case "returning": {
      while (r.revealed < r.steps.length && r.steps[r.revealed].at <= ctx.now) r.revealed++;
      if (r.revealed === r.steps.length && ctx.now >= (r.endsAt ?? 0)) finishRaid(state, prev, ctx.newId, ctx.now);
      break;
    }
  }

  state.rngState = rng.state;
  state.version = prev.version + 1;
  return state;
}

/** Applies the outcome to the game; it becomes an undo entry so the host can roll it back like any action. */
function finishRaid(state: RoomState, prev: RoomState, newId: () => string, now: number) {
  const r = state.raid!;
  const game = state.game!;
  const playerId = r.playerId!;
  const name = nameOf(state, playerId);
  r.stage = "done";
  if (!game.seatOrder.includes(playerId)) return;

  let label: string;
  if (!r.survived) {
    game.statuses[playerId] = "dead";
    label = `Итог вылазки: ${name} погиб`;
    log(state, now, `${name} не пережил вылазку`);
  } else {
    const def = game.characteristics.find((c) => c.key === "backpack");
    if (def && r.loot.length) {
      const existing = cardsOf(game, playerId, def.key).filter((c) => c.contentId || c.title !== "Пусто");
      const found = r.loot.map((item) => ({ ...makeCard(def, null, playerId, {}, newId()), title: item.title, description: item.description, revealed: true }));
      for (const c of found) game.cards[c.id] = c;
      const keep = new Set(existing.map((c) => c.id));
      for (const id of game.hands[playerId][def.key] ?? []) if (!keep.has(id)) delete game.cards[id];
      game.hands[playerId][def.key] = [...existing, ...found].map((c) => c.id);
    }
    label = `Итог вылазки: ${name} принёс ${r.loot.length} шт.`;
    log(state, now, `${name} вернулся с вылазки: ${r.loot.map((l) => l.title).join(", ")}`);
  }

  if (prev.game) {
    const revealedAfter = Object.values(game.cards).filter((c) => c.revealed).map((c) => c.id);
    state.undo.push({ label, game: prev.game, rngState: prev.rngState, revealedAfter });
    if (state.undo.length > UNDO_LIMIT) state.undo.shift();
  }
}
