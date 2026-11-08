import { hasAbilityEffect, isInfoEffect, ratingFor, SURVIVAL_BONUS, type CharacteristicDef, type ContentDb, type ContentItem, type HostAction, type SimpleEffect, type SpecialEffect } from "@bunker/shared";
import { ensure, GameError } from "./errors.ts";
import { catastropheFrom, effectOf, generateGame, generateModifiers, makeCard, Picker, type CharacterContext } from "./generation.ts";
import { BUNKER_EVENTS } from "./events.ts";
import { simulateBunker } from "./finale.ts";
import { raidBusy, raidProtects, returnRaid, spinReel, startRaid } from "./raid.ts";
import { Rng } from "./rng.ts";
import type { ActionContext, Card, EventSpin, GameState, NoticeColor, RoomState, UndoEntry } from "./types.ts";

const UNDO_LIMIT = 10;
const NOTICE_LIMIT = 30;
const EMPTY = "Пусто";

/** Actions that do not change the game and therefore are not undoable. */
const NOT_UNDOABLE = new Set<HostAction["type"]>([
  "host.dice",
  "host.message",
  "host.transfer",
  "host.undo",
  "host.timer",
  "host.timer.stop",
  "host.vote.start",
  "host.vote.finish",
  "host.vote.clear",
  "host.raid.start",
  "host.raid.return",
  "host.raid.cancel",
  "host.raid.clear",
  "host.finish",
  "host.event",
]);

interface Env {
  state: RoomState;
  game: GameState;
  ctx: ActionContext;
  rng: Rng;
  content: () => ContentDb;
  picker: () => Picker;
  name: (playerId: string) => string;
  log: (text: string) => void;
}

/** Ids of timers and votes keep growing after a stop or clear, so clients can tell a new one from one already shown. */
function nextId(prev: number | undefined, now: number): number {
  return Math.max((prev ?? 0) + 1, now);
}

function def(game: GameState, key: string): CharacteristicDef {
  const d = game.characteristics.find((c) => c.key === key);
  ensure(d, `Характеристика «${key}» не найдена`);
  return d;
}

function alive(game: GameState): string[] {
  return game.seatOrder.filter((id) => game.statuses[id] === "alive");
}

function targets(game: GameState, target: string): string[] {
  if (target === "all") return alive(game);
  ensure(game.seatOrder.includes(target), "Игрок не найден");
  return [target];
}

function cards(game: GameState, playerId: string, key: string): Card[] {
  return (game.hands[playerId]?.[key] ?? []).map((id) => game.cards[id]);
}

function setCards(game: GameState, playerId: string, key: string, list: Card[]) {
  for (const c of list) {
    c.ownerId = playerId;
    c.charKey = key;
    game.cards[c.id] = c;
  }
  game.hands[playerId][key] = list.map((c) => c.id);
}

/** Drops cards that are no longer in any hand; runs after an action so moved cards are not lost mid-way. */
function collectGarbage(game: GameState) {
  const inHands = new Set(Object.values(game.hands).flatMap((h) => Object.values(h).flat()));
  for (const id of Object.keys(game.cards)) if (!inHands.has(id)) delete game.cards[id];
}

function characterOf(game: GameState, playerId: string): CharacterContext {
  const gender = cards(game, playerId, "gender")[0];
  const age = gender?.modifiers.age;
  return { gender: gender && gender.contentId ? gender.title : undefined, age: typeof age === "number" ? age : undefined };
}

function draw(env: Env, d: CharacteristicDef, playerId: string, exclude: Set<string> = new Set()): Card {
  const ctx = characterOf(env.game, playerId);
  const item = env.picker().pick(d.contentType, ctx, exclude) ?? env.picker().pick(d.contentType, ctx);
  if (!item) throw new GameError(`Нет элементов для «${d.name}». Добавьте их в контент.`);
  return makeCard(d, item, playerId, generateModifiers(d, item, ctx, env.game.rules, env.rng), env.ctx.newId());
}

function emptyCard(env: Env, d: CharacteristicDef, playerId: string, title = EMPTY): Card {
  return { ...makeCard(d, null, playerId, {}, env.ctx.newId()), title };
}

function textCard(env: Env, d: CharacteristicDef, playerId: string, text: string): Card {
  return { ...makeCard(d, null, playerId, {}, env.ctx.newId()), title: text };
}

/** Keeps the «открыто» state of the replaced card, as the original does. */
function keepRevealed(next: Card[], prev: Card[]): Card[] {
  const revealed = prev.some((c) => c.revealed);
  for (const c of next) c.revealed = revealed;
  return next;
}

function scaleLevels(d: CharacteristicDef, modifierKey: string) {
  const m = d.modifiers.find((x) => x.key === modifierKey);
  ensure(m && m.kind === "scale", `У «${d.name}» нет шкалы «${modifierKey}»`);
  return m;
}

/** After an age change experience may become impossible; it is lowered to the highest allowed level. */
function clampExperience(game: GameState, playerId: string) {
  const age = characterOf(game, playerId).age;
  if (age === undefined) return;
  for (const d of game.characteristics) {
    for (const m of d.modifiers) {
      if (m.kind !== "scale" || !m.ageBound) continue;
      for (const card of cards(game, playerId, d.key)) {
        const current = m.levels.findIndex((l) => l.key === card.modifiers[m.key]);
        if (current < 0) continue;
        let allowed = current;
        while (allowed > 0 && (m.levels[allowed].minYears ?? 0) > age - game.rules.workStartAge) allowed--;
        card.modifiers[m.key] = m.levels[allowed].key;
      }
    }
  }
}

function pool(env: Env, type: string): ContentItem[] {
  return (env.content().pools[type] ?? []).flat();
}

function itemsField(game: GameState) {
  const f = game.bunkerFields.find((x) => x.placement === "list");
  ensure(f, "В бункере нет списка предметов");
  return f;
}

function pushNotice(state: RoomState, now: number, to: string, color: NoticeColor, title: string, text: string) {
  const id = (state.notices.at(-1)?.id ?? 0) + 1;
  state.notices.push({ id, at: now, to, color, title, text });
  if (state.notices.length > NOTICE_LIMIT) state.notices.splice(0, state.notices.length - NOTICE_LIMIT);
}

function forTargets(env: Env, target: string, fn: (playerId: string) => void) {
  for (const id of targets(env.game, target)) fn(id);
}

function who(env: Env, target: string) {
  return target === "all" ? "всем игрокам" : `игроку ${env.name(target)}`;
}

export function applyHostAction(state: RoomState, prev: RoomState, action: HostAction, ctx: ActionContext) {
  ensure(state.participants.find((p) => p.isHost)?.id === ctx.actorId, "Это может сделать только ведущий");

  if (action.type === "host.transfer") {
    const next = state.participants.find((p) => p.id === action.participantId);
    ensure(next, "Участник не найден");
    ensure(!next.isHost, "Он уже ведущий");
    for (const p of state.participants) p.isHost = p.id === next.id;
    state.log.push({ at: ctx.now, text: `Ведущим стал ${next.nickname}` });
    return;
  }

  ensure(state.status === "playing" && state.game, "Игра не идёт");
  const game = state.game;
  if (game.settlement && action.type !== "host.restart" && action.type !== "host.message" && action.type !== "host.dice" && action.type !== "host.timer" && action.type !== "host.timer.stop" && action.type !== "host.event") {
    ensure(false, action.type === "host.undo" ? "Итоги партии уже подведены — отменить их нельзя" : "Партия уже завершена. Начните игру заново.");
  }
  const rng = new Rng(state.rngState);
  let contentDb: ContentDb | null = null;
  let picker: Picker | null = null;
  const env: Env = {
    state,
    game,
    ctx,
    rng,
    content: () => (contentDb ??= ctx.loadContent(state.settings.packSlugs)),
    picker: () => {
      if (!picker) {
        picker = new Picker(env.content().pools, rng);
        picker.markUsed(Object.values(game.cards).map((c) => c.contentId));
        picker.markUsed([game.catastrophe.contentId, ...Object.values(game.bunker.fields).flat().map((v) => v.contentId)]);
      }
      return picker;
    },
    name: (id) => state.participants.find((p) => p.id === id)?.nickname ?? "Игрок",
    log: (text) => state.log.push({ at: ctx.now, text: `Ведущий: ${text}` }),
  };

  if (action.type === "host.undo") {
    const last = state.undo.pop();
    ensure(last, "Нечего отменять");
    state.game = restore(last, game);
    // The random generator is not rewound: redoing an undone action gives a new result, not the same one again.
    env.log(`отменил действие «${last.label}»`);
    return;
  }

  let special: UndoEntry["special"];
  let label: string;
  if (action.type === "host.special.apply") {
    const card = game.cards[action.cardId];
    const cardDef = card && game.characteristics.find((c) => c.key === card.charKey);
    ensure(card && cardDef && hasAbilityEffect(cardDef), "Карта со способностью не найдена");
    const isSpecial = cardDef.specialCard;
    ensure(card.revealed, isSpecial ? "Сначала игрок должен открыть эту карту" : "Сначала игрок должен открыть профессию");
    ensure(!card.used, isSpecial ? "Эта спец. возможность уже применена" : "Способность этой профессии уже использована");
    const effect = card.effect !== undefined ? card.effect : effectOf(pool(env, cardDef.contentType).find((i) => i.id === card.contentId) ?? null);
    ensure(!isInfoEffect(effect), "Это постоянное свойство профессии — применять его не нужно");
    // Only special cards can be cancelled by «Отменить спец. возможность».
    if (isSpecial) special = { ownerId: card.ownerId, cardId: card.id };
    if (effect?.op === "cancelSpecial") {
      label = cancelLastSpecial(env, card);
    } else {
      label = applySpecial(env, card, effect, action);
      const applied = state.game!.cards[card.id];
      if (applied) applied.used = true;
    }
  } else {
    label = run(env, action);
  }

  if (state.game) collectGarbage(state.game);
  state.rngState = rng.state;
  if (!NOT_UNDOABLE.has(action.type) && prev.game) {
    const revealedAfter = state.game ? Object.values(state.game.cards).filter((c) => c.revealed).map((c) => c.id) : [];
    state.undo.push({ label, game: prev.game, rngState: prev.rngState, revealedAfter, ...(special ? { special } : {}) });
    if (state.undo.length > UNDO_LIMIT) state.undo.shift();
  }
}

/** Game from an undo entry; cards that players opened after that action stay open. */
function restore(entry: UndoEntry, current: GameState): GameState {
  const game = structuredClone(entry.game);
  const openedByAction = entry.revealedAfter ? new Set(entry.revealedAfter) : null;
  for (const [id, now] of Object.entries(current.cards)) {
    const card = game.cards[id];
    if (card && now.revealed && !card.revealed && openedByAction && !openedByAction.has(id)) card.revealed = true;
  }
  return game;
}

/** «Отменить спец. возможность»: rolls back the last host action if it was another player's special card. */
function cancelLastSpecial(env: Env, card: Card): string {
  const { state } = env;
  const top = state.undo.at(-1);
  ensure(
    top?.special && top.special.ownerId !== card.ownerId,
    "Последнее действие ведущего — не спец. возможность другого игрока. Если нужно, отмените вручную: «Отменить предыдущее действие».",
  );
  const game = restore(top, env.game);
  const own = game.cards[card.id];
  ensure(own, "Карта отмены не найдена после отката");
  own.revealed = true;
  own.used = true;
  const cancelled = game.cards[top.special.cardId];
  if (cancelled) cancelled.used = true;
  state.game = game;
  const text = `применил «${card.title}» (${env.name(card.ownerId)}): отменено «${top.label}»`;
  env.log(text);
  return text;
}

type ApplyAction = Extract<HostAction, { type: "host.special.apply" }>;

/** Applies a special card or a profession ability through the regular host tools, so every check and the undo work the same way. */
function applySpecial(env: Env, card: Card, effect: SpecialEffect | null, action: ApplyAction): string {
  const isSpecial = def(env.game, card.charKey).specialCard;
  let result: string;
  if (!effect || effect.op === "manual") {
    result = effect ? `отмечено как использованное (${effect.note})` : "отмечено как использованное";
  } else if (effect.op === "choice") {
    const picked = effect.options[action.option ?? 0];
    ensure(picked, "Выберите вариант");
    result = `${picked.label.toLowerCase()} — ${applySimple(env, card.ownerId, picked.effect, action)}`;
  } else if (effect.op === "multi") {
    result = effect.steps.map((step) => applySimple(env, card.ownerId, step, action)).join("; ");
  } else {
    result = applySimple(env, card.ownerId, effect, action);
  }
  const what = isSpecial ? `«${card.title}»` : `способность профессии «${card.title}»`;
  const text = `применил ${what} (${env.name(card.ownerId)}): ${result}`;
  env.log(text);
  return text;
}

/** Players sitting right before and after the owner among those in the camp. */
function neighborsOf(game: GameState, owner: string): string[] {
  const ring = game.seatOrder.filter((id) => id === owner || game.statuses[id] === "alive");
  const i = ring.indexOf(owner);
  if (i < 0 || ring.length < 2) return [];
  return [...new Set([ring[(i - 1 + ring.length) % ring.length], ring[(i + 1) % ring.length]])].filter((id) => id !== owner);
}

function healthyItem(env: Env): ContentItem {
  const item = pool(env, def(env.game, "health").contentType).find((i) => i.tags.includes("health:none"));
  ensure(item, "В контенте нет значения «Идеально здоров» (тег health:none)");
  return item;
}

function ageGroupOf(game: GameState, playerId: string): string | null {
  const m = def(game, "gender").modifiers.find((x) => x.kind === "age");
  const age = characterOf(game, playerId).age;
  if (!m || m.kind !== "age" || age === undefined) return null;
  return m.groups.find((g) => age >= g.min && age <= g.max)?.key ?? null;
}

function applySimple(env: Env, owner: string, effect: SimpleEffect, action: ApplyAction): string {
  const { game } = env;
  const quiet: Env = { ...env, log: () => {} };
  const via = (a: HostAction) => run(quiet, a);
  const chosen = (kind: "other" | "any" | "exiled" | "neighbor", t = action.target) => {
    ensure(t, "Выберите игрока");
    ensure(game.seatOrder.includes(t), "Игрок не найден");
    if (kind === "exiled") ensure(game.statuses[t] === "exiled", "Этот игрок не изгнан");
    else ensure(game.statuses[t] === "alive", "Игрок должен быть в лагере");
    if (kind !== "any") ensure(t !== owner, "Выберите другого игрока");
    if (kind === "neighbor") ensure(neighborsOf(game, owner).includes(t), "Выберите соседа: игрока сразу до или после владельца карты");
    return t;
  };
  const target = (t: "self" | "other" | "any" | "all" | "neighbor") => (t === "self" ? owner : t === "all" ? "all" : chosen(t));
  const pickChar = (key: string, choices?: string[]) => {
    if (key !== "*") return def(game, key).key;
    ensure(action.charKey, "Выберите характеристику");
    const d = def(game, action.charKey);
    ensure(!d.specialCard, "Спец. возможности так менять нельзя");
    if (choices?.length) ensure(choices.includes(d.key), "Эту характеристику выбрать нельзя");
    return d.key;
  };

  switch (effect.op) {
    case "manual":
      return `отмечено как использованное (${effect.note})`;
    case "info":
      throw new GameError("Это постоянное свойство — применять его не нужно");
    case "cancelSpecial":
      throw new GameError("Отмену спец. возможности нельзя совмещать с другими действиями");
    case "bunker.reroll":
      return via({ type: "host.bunker.reroll", field: effect.field });
    case "bunker.set": {
      ensure(action.text, "Впишите новое значение");
      if (effect.options?.length) ensure(effect.options.includes(action.text), "Выберите один из вариантов");
      return via({ type: "host.bunker.set", field: effect.field, text: action.text });
    }
    case "bunker.addItem":
      return via({ type: "host.bunker.addItem" });
    case "catastrophe.reroll":
      return via({ type: "host.catastrophe.reroll" });
    case "seats":
      return via({ type: "host.seats", delta: effect.delta });
    case "rotate":
      return via({ type: "host.rotate", charKey: effect.charKey, dir: effect.dir });
    case "nullify":
      return via({ type: "host.nullify", charKey: effect.charKey });
    case "reroll": {
      const who = target(effect.target);
      const key = pickChar(effect.charKey, effect.choices);
      if (who !== "all") {
        if (effect.minAge !== undefined) {
          const age = characterOf(game, who).age;
          ensure(age !== undefined && age >= effect.minAge, `Нужен возраст от ${effect.minAge} лет`);
        }
        if (effect.requireHealthy) {
          const healthy = healthyItem(env);
          ensure(cards(game, who, "health").every((c) => c.contentId === healthy.id), `${env.name(who)} не идеально здоров`);
        }
        if (effect.onlyClosed) ensure(cards(game, who, key).some((c) => !c.revealed), "Эта характеристика у игрока уже открыта — можно менять только закрытую");
      }
      return via({ type: "host.char.reroll", target: who, charKey: key });
    }
    case "modifier.step":
      return stepModifier(env, target(effect.target), effect.charKey, effect.modifierKey, effect.delta, { notFrom: effect.notFrom, lineId: action.lineId });
    case "modifier.set":
      return setModifier(env, target(effect.target), effect.charKey, effect.modifierKey, effect.level, { from: effect.from, lineId: action.lineId });
    case "swap": {
      const key = pickChar(effect.charKey, effect.choices);
      const other = chosen(effect.from === "exiled" ? "exiled" : "other");
      const result = via({ type: "host.char.swap", a: owner, b: other, charKey: key });
      if (effect.resetUsed) for (const c of cards(game, owner, key)) c.used = false;
      return result;
    }
    case "swap.pair": {
      const key = pickChar(effect.charKey, effect.choices);
      const a = chosen("other", action.target);
      const b = chosen("other", action.target2);
      ensure(a !== b, "Выберите двух разных игроков");
      return via({ type: "host.char.swap", a, b, charKey: key });
    }
    case "steal": {
      const key = pickChar(effect.charKey, effect.choices);
      const victim = chosen(effect.from === "exiled" ? "exiled" : effect.from === "neighbor" ? "neighbor" : "other");
      if (effect.onlyRevealed) ensure(cards(game, victim, key).some((c) => c.revealed), "Эта характеристика у игрока ещё не открыта");
      return via({ type: "host.char.steal", thief: owner, victim, charKey: key });
    }
    case "healthy": {
      const who = target(effect.target);
      if (effect.maxSeverity === undefined && !action.lineId) return via({ type: "host.cure", target: who, op: "healthy" });
      return cureLine(env, who, effect.maxSeverity, action.lineId);
    }
    case "return":
      return via({ type: "host.return", playerId: chosen("exiled") });
    case "reveal": {
      const who = effect.target ? target(effect.target) : chosen("other");
      const d = def(game, pickChar(effect.charKey ?? "*"));
      if (effect.halfOpen) {
        const camp = alive(game);
        const open = camp.filter((id) => cards(game, id, d.key).some((c) => c.revealed)).length;
        ensure(open * 2 >= camp.length, `«${d.name}» открыта меньше чем у половины игроков в лагере (${open} из ${camp.length})`);
      }
      const closed = cards(game, who, d.key).filter((c) => !c.revealed);
      ensure(closed.length, "Эта характеристика у игрока уже открыта");
      for (const c of closed) c.revealed = true;
      return `открыл «${d.name}» игрока ${env.name(who)}`;
    }
    case "give": {
      const text = action.text ?? effect.text;
      return via({ type: "host.char.add", target: target(effect.target), charKey: effect.charKey, text });
    }
    case "add": {
      if (effect.target === "neighbors") {
        const list = neighborsOf(game, owner);
        ensure(list.length, "Рядом нет игроков в лагере");
        return list.map((id) => via({ type: "host.char.add", target: id, charKey: effect.charKey })).join("; ");
      }
      return via({ type: "host.char.add", target: target(effect.target), charKey: effect.charKey });
    }
    case "remove":
      return via({ type: "host.char.remove", target: target(effect.target), charKey: effect.charKey });
    case "gender.flip":
      return via({ type: "host.gender.flip", target: target(effect.target) });
    case "childfree":
      return via({ type: "host.cure", target: target(effect.target), op: "childfree" });
    case "curePhobia":
      return via({ type: "host.cure", target: target(effect.target), op: "curePhobia" });
    case "ageGroup": {
      const who = target(effect.target);
      const group = effect.group === "*" ? action.text : effect.group;
      ensure(group, "Выберите возраст");
      if (effect.from) ensure(effect.from.includes(ageGroupOf(game, who) ?? ""), "Возраст игрока не подходит для этой способности");
      return via({ type: "host.ageGroup", target: who, group });
    }
    case "body": {
      const who = target(effect.target);
      const title = effect.title === "*" ? action.text : effect.title;
      ensure(title, "Выберите телосложение");
      if (effect.from) ensure(cards(game, who, "body").some((c) => effect.from!.includes(c.title)), `Подходит только телосложение: ${effect.from.join(", ")}`);
      return via({ type: "host.body", target: who, title });
    }
  }
}

/** Cures one disease line (the chosen one or the first that fits); the player becomes healthy when no disease is left. */
function cureLine(env: Env, playerId: string, maxSeverity: string | undefined, lineId: string | undefined): string {
  const { game } = env;
  const d = def(game, "health");
  const healthy = healthyItem(env);
  const m = scaleLevels(d, "severity");
  const list = cards(game, playerId, "health");
  const sick = list.filter((c) => c.contentId !== healthy.id);
  ensure(sick.length, `${env.name(playerId)} уже идеально здоров`);
  const pickable = lineId ? sick.filter((c) => c.id === lineId) : sick;
  ensure(pickable.length, "Эта строка здоровья не найдена");
  const max = maxSeverity === undefined ? m.levels.length - 1 : m.levels.findIndex((l) => l.key === maxSeverity);
  const fits = pickable.filter((c) => {
    const i = m.levels.findIndex((l) => l.key === c.modifiers[m.key]);
    return i <= max;
  });
  ensure(fits.length, `Степень болезни слишком высокая: можно вылечить не выше «${m.levels[max]?.label ?? maxSeverity}»`);
  const cured = fits[0];
  const rest = sick.filter((c) => c.id !== cured.id);
  setCards(game, playerId, "health", rest.length ? rest : keepRevealed([makeCard(d, healthy, playerId, {}, env.ctx.newId())], [cured]));
  return `вылечил «${cured.title}» игроку ${env.name(playerId)}${rest.length ? "" : " — теперь идеально здоров"}`;
}

/** Health lines that a modifier change may touch: the chosen one, or every line that has the modifier. */
function modifierLines(env: Env, playerId: string, charKey: string, modifierKey: string, lineId: string | undefined): Card[] {
  const d = def(env.game, charKey);
  let list = cards(env.game, playerId, d.key).filter((c) => modifierKey in c.modifiers);
  ensure(list.length, `У игрока ${env.name(playerId)} нет такого параметра в «${d.name}» (например, он идеально здоров)`);
  if (lineId) {
    list = list.filter((c) => c.id === lineId);
    ensure(list.length, "Эта строка не найдена у игрока");
  }
  return list;
}

/**
 * Moves a scale modifier (experience, severity) one level up or down, respecting age for experience.
 * With several lines (two diseases) every line that can move is changed; it fails only when none can.
 */
function stepModifier(env: Env, playerId: string, charKey: string, modifierKey: string, delta: 1 | -1, opts: { notFrom?: string[]; lineId?: string } = {}): string {
  const { game } = env;
  const d = def(game, charKey);
  const m = scaleLevels(d, modifierKey);
  const list = modifierLines(env, playerId, charKey, modifierKey, opts.lineId);
  const age = characterOf(game, playerId).age;
  const problem = (card: Card): string | null => {
    const current = m.levels.findIndex((l) => l.key === card.modifiers[m.key]);
    const next = current + delta;
    if (opts.notFrom?.includes(String(card.modifiers[m.key]))) return `Нельзя применить при уровне «${m.levels[current]?.label}»`;
    if (next < 0 || next >= m.levels.length) return delta > 0 ? "Уже максимальный уровень" : "Уже минимальный уровень";
    if (m.ageBound && delta > 0 && age !== undefined && (m.levels[next].minYears ?? 0) > age - game.rules.workStartAge) return "Возраст персонажа не позволяет повысить стаж";
    return null;
  };
  const movable = list.filter((c) => problem(c) === null);
  ensure(movable.length, problem(list[0]) ?? "Нельзя изменить");
  const reached: string[] = [];
  for (const card of movable) {
    const next = m.levels.findIndex((l) => l.key === card.modifiers[m.key]) + delta;
    card.modifiers[m.key] = m.levels[next].key;
    reached.push(list.length > 1 ? `${card.title} — ${m.levels[next].label}` : m.levels[next].label);
  }
  return `${delta > 0 ? "повысил" : "понизил"} «${d.name}» игроку ${env.name(playerId)} до «${reached.join("», «")}»`;
}

/** Sets a scale modifier to a level, optionally only from some levels (e.g. «Стажёр»/«Любитель» → «Новичок»). */
function setModifier(env: Env, playerId: string, charKey: string, modifierKey: string, level: string, opts: { from?: string[]; lineId?: string } = {}): string {
  const { game } = env;
  const d = def(game, charKey);
  const m = scaleLevels(d, modifierKey);
  const target = m.levels.find((l) => l.key === level);
  ensure(target, "Неизвестный уровень");
  const list = modifierLines(env, playerId, charKey, modifierKey, opts.lineId);
  const age = characterOf(game, playerId).age;
  if (m.ageBound && age !== undefined) ensure((target.minYears ?? 0) <= age - game.rules.workStartAge, "Возраст персонажа не позволяет такой стаж");
  const fits = list.filter((c) => c.modifiers[m.key] !== level && (!opts.from || opts.from.includes(String(c.modifiers[m.key]))));
  const allowed = opts.from?.map((k) => m.levels.find((l) => l.key === k)?.label ?? k).join(", ");
  ensure(fits.length, allowed ? `Подходит только уровень: ${allowed}` : `Уже «${target.label}»`);
  for (const card of fits) card.modifiers[m.key] = level;
  return `изменил «${d.name}» игроку ${env.name(playerId)} на «${target.label}»`;
}

/** Applies the action and returns a short label for the log and undo. */
function run(env: Env, action: HostAction): string {
  const { game, state, ctx } = env;
  const done = (text: string) => {
    env.log(text);
    return text;
  };

  switch (action.type) {
    case "host.exile": {
      ensure(game.statuses[action.playerId] === "alive", "Игрок уже не в лагере");
      ensure(!raidProtects(state, action.playerId), "Игрок на вылазке — его нельзя изгнать, пока он не вернётся");
      game.statuses[action.playerId] = "exiled";
      game.exileOrder = [...(game.exileOrder ?? []).filter((id) => id !== action.playerId), action.playerId];
      return done(`изгнал игрока ${env.name(action.playerId)}`);
    }
    case "host.return": {
      ensure(game.statuses[action.playerId] === "exiled", "Игрок не изгнан");
      game.statuses[action.playerId] = "alive";
      game.exileOrder = (game.exileOrder ?? []).filter((id) => id !== action.playerId);
      return done(`вернул игрока ${env.name(action.playerId)}`);
    }
    case "host.finish": {
      ensure(!game.settlement, "Итоги этой партии уже подведены");
      ensure(state.vote?.status !== "open", "Сначала завершите голосование");
      ensure(!state.raid || state.raid.stage === "done" || state.raid.stage === "cancelled", "Сначала завершите вылазку");
      ensure(!state.event?.spin || state.event.spin.applied, "Дождитесь конца рулетки ивента");
      const inside = game.seatOrder.filter((id) => game.statuses[id] === "alive" || game.statuses[id] === "inBunker");
      ensure(
        inside.length <= game.bunker.seats,
        `В лагере ${inside.length} ${inside.length === 1 ? "игрок" : "игроков"}, а мест в бункере ${game.bunker.seats}. Сначала изгоните лишних.`,
      );
      const finale = simulateBunker(state, game, inside, env.rng, ctx.now);
      const exiled = (game.exileOrder ?? []).filter((id) => game.statuses[id] === "exiled");
      const rows = game.seatOrder.map((id) => {
        const profileId = state.participants.find((p) => p.id === id)?.profileId ?? null;
        const status = game.statuses[id];
        if (inside.includes(id)) {
          game.statuses[id] = "inBunker";
          const base = ratingFor(true, null);
          return finale.survived
            ? { playerId: id, profileId, outcome: base.outcome, delta: base.delta + SURVIVAL_BONUS, reason: "в бункере, бункер выжил" }
            : { playerId: id, profileId, ...base, reason: "в бункере, бункер погиб" };
        }
        if (status === "exiled") {
          const r = ratingFor(false, exiled.indexOf(id));
          return { playerId: id, profileId, ...r, reason: r.outcome === "firstOut" ? "изгнан первым" : r.outcome === "secondOut" ? "изгнан вторым" : "изгнан" };
        }
        return { playerId: id, profileId, ...ratingFor(false, null), reason: status === "dead" ? "погиб на вылазке" : "не попал в бункер" };
      });
      game.settlement = { id: `${state.code}:${game.startedAt}`, rows, finale };
      state.undo = [];
      return done("подводит итоги: идёт симуляция бункера");
    }
    case "host.seats": {
      const next = game.bunker.seats + action.delta;
      ensure(next >= 0 && next <= game.seatOrder.length, "Недопустимое количество мест");
      game.bunker.seats = next;
      return done(`изменил количество мест в бункере на ${next}`);
    }
    case "host.catastrophe.reroll": {
      const item = env.picker().pick("catastrophe", {}, new Set([game.catastrophe.contentId ?? ""]));
      ensure(item, "Других катастроф нет");
      game.catastrophe = catastropheFrom(item);
      return done("изменил катаклизм");
    }
    case "host.char.reroll": {
      const keys = action.charKey === "all" ? game.characteristics.map((c) => c.key) : [def(game, action.charKey).key];
      forTargets(env, action.target, (pid) => {
        for (const key of keys) {
          const d = def(game, key);
          const prevCards = cards(game, pid, key);
          const fresh = prevCards.map(() => draw(env, d, pid, new Set(prevCards.map((c) => c.contentId ?? ""))));
          setCards(game, pid, key, keepRevealed(fresh.length ? fresh : [draw(env, d, pid)], prevCards));
        }
        clampExperience(game, pid);
      });
      const what = action.charKey === "all" ? "все характеристики" : `«${def(game, action.charKey).name}»`;
      return done(`изменил ${what} ${who(env, action.target)}`);
    }
    case "host.modifier.set": {
      const d = def(game, action.charKey);
      const m = scaleLevels(d, action.modifierKey);
      ensure(action.level === "random" || m.levels.some((l) => l.key === action.level), "Неизвестный уровень");
      let changed = 0;
      forTargets(env, action.target, (pid) => {
        const age = characterOf(game, pid).age;
        const allowed = m.levels.filter((l) => !m.ageBound || age === undefined || (l.minYears ?? 0) <= age - game.rules.workStartAge);
        for (const card of cards(game, pid, d.key)) {
          if (!(m.key in card.modifiers)) continue;
          let level = action.level === "random" ? env.rng.pick(allowed).key : action.level;
          if (!allowed.some((l) => l.key === level)) {
            if (action.target !== "all") throw new GameError("Возраст персонажа не позволяет такой стаж");
            level = allowed.at(-1)!.key;
          }
          card.modifiers[m.key] = level;
          changed++;
        }
      });
      ensure(changed > 0 || action.target === "all", "У этой карты нет такого параметра (например, игрок идеально здоров)");
      return done(`изменил «${d.name}» (${action.level === "random" ? "случайно" : m.levels.find((l) => l.key === action.level)!.label}) ${who(env, action.target)}`);
    }
    case "host.gender.flip": {
      const d = def(game, "gender");
      const genders = pool(env, d.contentType);
      forTargets(env, action.target, (pid) => {
        for (const card of cards(game, pid, "gender")) {
          const other = genders.find((g) => g.title !== card.title && g.weight > 0);
          ensure(other, "Нет другого пола в контенте");
          card.contentId = other.id;
          card.title = other.title;
          card.description = other.description;
          card.abilities = other.abilities;
        }
      });
      return done(`изменил пол на противоположный ${who(env, action.target)}`);
    }
    case "host.char.swap": {
      ensure(action.a !== action.b, "Выберите двух разных игроков");
      const d = def(game, action.charKey);
      targets(game, action.a);
      targets(game, action.b);
      const a = cards(game, action.a, d.key);
      const b = cards(game, action.b, d.key);
      setCards(game, action.a, d.key, b);
      setCards(game, action.b, d.key, a);
      clampExperience(game, action.a);
      clampExperience(game, action.b);
      return done(`обменял «${d.name}» между ${env.name(action.a)} и ${env.name(action.b)}`);
    }
    case "host.char.shuffle": {
      const d = def(game, action.charKey);
      const ids = alive(game);
      ensure(ids.length > 1, "Недостаточно игроков");
      const hands = ids.map((id) => cards(game, id, d.key));
      for (let i = hands.length - 1; i > 0; i--) {
        const j = env.rng.int(0, i);
        [hands[i], hands[j]] = [hands[j], hands[i]];
      }
      ids.forEach((id, i) => setCards(game, id, d.key, hands[i]));
      ids.forEach((id) => clampExperience(game, id));
      return done(`перемешал «${d.name}» между всеми игроками`);
    }
    case "host.char.steal": {
      ensure(action.thief !== action.victim, "Нельзя украсть у самого себя");
      const d = def(game, action.charKey);
      targets(game, action.thief);
      ensure(game.seatOrder.includes(action.victim), "Игрок не найден");
      const stolen = cards(game, action.victim, d.key);
      ensure(stolen.some((c) => c.contentId || c.title !== EMPTY), "Красть нечего");
      const replacement = d.onSteal === "empty" ? emptyCard(env, d, action.victim) : draw(env, d, action.victim);
      setCards(game, action.victim, d.key, keepRevealed([replacement], stolen));
      setCards(game, action.thief, d.key, [...cards(game, action.thief, d.key).filter((c) => c.contentId || c.title !== EMPTY), ...stolen]);
      return done(`${env.name(action.thief)} украл «${d.name}» у ${env.name(action.victim)}`);
    }
    case "host.cure": {
      forTargets(env, action.target, (pid) => {
        if (action.op === "healthy") {
          const d = def(game, "health");
          const healthy = pool(env, d.contentType).find((i) => i.tags.includes("health:none"));
          ensure(healthy, "В контенте нет значения «Идеально здоров» (тег health:none)");
          const prevCards = cards(game, pid, "health");
          setCards(game, pid, "health", keepRevealed([makeCard(d, healthy, pid, {}, ctx.newId())], prevCards));
        } else if (action.op === "curePhobia") {
          const d = def(game, "phobia");
          setCards(game, pid, "phobia", keepRevealed([emptyCard(env, d, pid, "Нет фобии")], cards(game, pid, "phobia")));
        } else {
          for (const card of cards(game, pid, "gender")) card.modifiers.childfree = action.op === "childfree";
        }
      });
      const text = { healthy: "сделал идеально здоровым", curePhobia: "вылечил фобию", childfree: "сделал чайлдфри", cureChildfree: "вылечил чайлдфри" }[action.op];
      return done(`${text} ${who(env, action.target)}`);
    }
    case "host.ageGroup": {
      const d = def(game, "gender");
      const m = d.modifiers.find((x) => x.kind === "age");
      ensure(m && m.kind === "age", "У пола нет возраста");
      const group = m.groups.find((g) => g.key === action.group);
      ensure(group, "Неизвестная возрастная группа");
      forTargets(env, action.target, (pid) => {
        for (const card of cards(game, pid, "gender")) card.modifiers[m.key] = env.rng.int(group.min, group.max);
        clampExperience(game, pid);
      });
      return done(`сделал возраст «${group.label}» ${who(env, action.target)}`);
    }
    case "host.body": {
      // Only the body type changes; height and other modifiers stay as they were.
      const d = def(game, "body");
      const bodies = pool(env, d.contentType).filter((i) => i.weight > 0);
      const fixed = action.title === "random" ? null : bodies.find((i) => i.title === action.title);
      ensure(action.title === "random" || fixed, "Нет такого телосложения");
      const titles: string[] = [];
      forTargets(env, action.target, (pid) => {
        for (const card of cards(game, pid, "body")) {
          const others = bodies.filter((i) => i.id !== card.contentId);
          const item = fixed ?? (others.length ? env.rng.pick(others) : bodies[0]);
          ensure(item, "Нет такого телосложения");
          card.contentId = item.id;
          card.title = item.title;
          card.description = item.description;
          card.abilities = item.abilities;
          titles.push(item.title);
        }
      });
      const what = fixed ? `«${fixed.title}»` : action.target === "all" ? "случайное" : `«${titles[0] ?? "случайное"}»`;
      return done(`сделал телосложение ${what} ${who(env, action.target)} (рост сохранён)`);
    }
    case "host.char.add": {
      const d = def(game, action.charKey);
      targets(game, action.target);
      const all = cards(game, action.target, d.key);
      const existing = all.filter((c) => c.contentId || c.title !== EMPTY);
      const own = new Set(existing.map((c) => c.contentId ?? ""));
      const added = action.text ? textCard(env, d, action.target, action.text) : draw(env, d, action.target, own);
      // When the characteristic is already open, the new line is open too, so it shows up in the players table.
      added.revealed = all.some((c) => c.revealed);
      setCards(game, action.target, d.key, [...existing, added]);
      return done(`добавил «${d.name}»${action.text ? ` («${action.text}»)` : ""} ${who(env, action.target)}`);
    }
    case "host.char.remove": {
      const d = def(game, action.charKey);
      targets(game, action.target);
      setCards(game, action.target, d.key, keepRevealed([emptyCard(env, d, action.target)], cards(game, action.target, d.key)));
      return done(`удалил «${d.name}» ${who(env, action.target)}`);
    }
    case "host.char.toBunker": {
      const d = def(game, action.charKey);
      targets(game, action.target);
      const moving = cards(game, action.target, d.key).filter((c) => c.contentId || c.title !== EMPTY);
      ensure(moving.length, "Переносить нечего");
      const field = itemsField(game);
      game.bunker.fields[field.key] = [...(game.bunker.fields[field.key] ?? []), ...moving.map((c) => ({ contentId: c.contentId, title: c.title }))];
      setCards(game, action.target, d.key, keepRevealed([emptyCard(env, d, action.target)], moving));
      return done(`перенёс «${d.name}» игрока ${env.name(action.target)} в бункер`);
    }
    case "host.rotate": {
      const d = def(game, action.charKey);
      const ids = alive(game);
      ensure(ids.length > 1, "Недостаточно игроков");
      const hands = ids.map((id) => cards(game, id, d.key));
      const shift = action.dir === "cw" ? 1 : -1;
      ids.forEach((id, i) => setCards(game, id, d.key, hands[(i - shift + ids.length) % ids.length]));
      ids.forEach((id) => clampExperience(game, id));
      return done(`передал «${d.name}» ${action.dir === "cw" ? "по часовой стрелке" : "против часовой стрелки"}`);
    }
    case "host.nullify": {
      const d = def(game, action.charKey);
      for (const id of alive(game)) setCards(game, id, d.key, keepRevealed([emptyCard(env, d, id)], cards(game, id, d.key)));
      return done(`аннулировал всем «${d.name}»`);
    }
    case "host.bunker.reroll": {
      const field = game.bunkerFields.find((f) => f.key === action.field);
      ensure(field, "Поле бункера не найдено");
      const current = new Set((game.bunker.fields[field.key] ?? []).map((v) => v.contentId ?? ""));
      const values: { contentId: string | null; title: string }[] = [];
      for (let i = 0; i < field.count; i++) {
        const item = env.picker().pick(field.contentType, {}, new Set([...current, ...values.map((v) => v.contentId ?? "")]));
        if (item) values.push({ contentId: item.id, title: item.title });
      }
      ensure(values.length, "Нет других значений для этого поля");
      game.bunker.fields[field.key] = values;
      return done(`изменил «${field.name}»`);
    }
    case "host.bunker.set": {
      const field = game.bunkerFields.find((f) => f.key === action.field);
      ensure(field, "Поле бункера не найдено");
      game.bunker.fields[field.key] = [{ contentId: null, title: action.text }];
      return done(`вписал «${field.name}»`);
    }
    case "host.bunker.addItem": {
      const field = itemsField(game);
      const list = game.bunker.fields[field.key] ?? [];
      let value: { contentId: string | null; title: string };
      if (action.text) value = { contentId: null, title: action.text };
      else {
        const item = env.picker().pick(field.contentType, {}, new Set(list.map((v) => v.contentId ?? "")));
        ensure(item, "Нет новых предметов в контенте");
        value = { contentId: item.id, title: item.title };
      }
      game.bunker.fields[field.key] = [...list, value];
      return done(`добавил в бункер «${value.title}»`);
    }
    case "host.revealAll": {
      for (const c of Object.values(game.cards)) c.revealed = true;
      return done("открыл все характеристики всем игрокам");
    }
    case "host.dice": {
      const value = env.rng.int(1, action.sides);
      pushNotice(state, ctx.now, "all", "gold", `Кубик d${action.sides}`, `Выпало: ${value}`);
      return done(`бросил кубик d${action.sides}: выпало ${value}`);
    }
    case "host.message": {
      ensure(action.to === "all" || state.participants.some((p) => p.id === action.to), "Получатель не найден");
      pushNotice(state, ctx.now, action.to, action.color, action.title || "Сообщение от ведущего", action.text);
      return action.to === "all" ? done("отправил сообщение всем") : done(`отправил сообщение игроку ${env.name(action.to)}`);
    }
    case "host.restart": {
      const ids = state.participants.filter((p) => p.role === "player").map((p) => p.id);
      state.game = generateGame({ playerIds: env.rng.shuffle(ids), content: env.content(), rules: state.rules, rng: env.rng, newId: ctx.newId, now: ctx.now });
      state.timer = null;
      state.vote = null;
      state.raid = null;
      state.event = null;
      state.partyEvents = [];
      return done("начал игру заново");
    }
    case "host.timer": {
      state.timer = { id: nextId(state.timer?.id, ctx.now), seconds: action.seconds, startedAt: ctx.now, endsAt: ctx.now + action.seconds * 1000 };
      return done(`запустил таймер на ${action.seconds} секунд`);
    }
    case "host.timer.stop": {
      ensure(state.timer && state.timer.endsAt > ctx.now, "Таймер не запущен");
      state.timer = null;
      return done("остановил таймер");
    }
    case "host.vote.start": {
      ensure(state.vote?.status !== "open", "Голосование уже идёт");
      ensure(!raidBusy(state), "Дождитесь окончания этапа вылазки");
      const ids = alive(game);
      const candidates = [...new Set(action.candidates)];
      ensure(candidates.every((c) => ids.includes(c)), "Выставлять на голосование можно только игроков в лагере");
      ensure(!candidates.some((c) => raidProtects(state, c)), "Игрок на вылазке — его нельзя выставить на голосование");
      const voters = ids.filter((v) => candidates.some((c) => c !== v));
      ensure(voters.length > 0, "Некому голосовать");
      state.vote = { id: nextId(state.vote?.id, ctx.now), status: "open", startedAt: ctx.now, voters, candidates, ballots: {} };
      return done(`начал голосование: ${candidates.map(env.name).join(", ")}`);
    }
    case "host.vote.finish": {
      ensure(state.vote?.status === "open", "Голосование не идёт");
      state.vote.status = "closed";
      return done(`завершил голосование досрочно (проголосовали ${Object.keys(state.vote.ballots).length} из ${state.vote.voters.length})`);
    }
    case "host.vote.clear": {
      ensure(state.vote, "Голосования нет");
      state.vote = null;
      return done("убрал результаты голосования");
    }
    case "host.raid.start": {
      startRaid(state, ctx.now);
      return done("запустил голосование на вылазку");
    }
    case "host.raid.return": {
      const playerId = state.raid?.playerId;
      returnRaid(state, env.rng, env.content(), ctx.now);
      return done(`отметил, что ${env.name(playerId ?? "")} вернулся с вылазки`);
    }
    case "host.raid.cancel": {
      ensure(state.raid, "Вылазки нет");
      ensure(state.raid.stage !== "returning", "Итоги вылазки уже разыгрываются — дождитесь конца");
      state.raid = null;
      return done("отменил вылазку");
    }
    case "host.event": {
      ensure(!raidBusy(state), "Дождитесь окончания этапа вылазки");
      ensure(!state.event?.spin || state.event.spin.applied, "Дождитесь конца рулетки ивента");
      const used = state.eventUsed ?? [];
      let pool = BUNKER_EVENTS.filter((e) => !used.includes(e.key));
      if (pool.length === 0) pool = BUNKER_EVENTS.filter((e) => e.key !== used[used.length - 1]);
      const picked = env.rng.pick(pool);
      state.eventUsed = used.includes(picked.key) ? [picked.key] : [...used, picked.key];
      state.partyEvents = [...(state.partyEvents ?? []), picked.key];
      const raider = state.raid && (state.raid.stage === "picking" || state.raid.stage === "away" || state.raid.stage === "returning") ? state.raid.playerId : null;
      const eligible = game.seatOrder.filter((id) => game.statuses[id] === "alive" && id !== raider);
      let spin: EventSpin | null = null;
      if (picked.effect && eligible.length) {
        const winnerId = env.rng.pick(eligible);
        const spun = spinReel(env.rng, eligible, winnerId);
        spin = { at: ctx.now, reel: spun.reel, offset: spun.offset, winnerId, effect: picked.effect, applied: false };
      }
      state.event = {
        id: nextId(state.event?.id, ctx.now),
        title: picked.title,
        text: picked.text,
        tone: picked.tone,
        image: picked.image,
        spin,
      };
      return done(state.event.spin ? `запустил ивент «${picked.title}» — рулетка выбирает игрока` : `запустил ивент «${picked.title}»`);
    }
    case "host.raid.clear": {
      ensure(state.raid && (state.raid.stage === "done" || state.raid.stage === "cancelled"), "Вылазка ещё не закончилась");
      state.raid = null;
      return done("закрыл итоги вылазки");
    }
    case "host.transfer":
    case "host.undo":
    case "host.special.apply":
      throw new GameError("Недоступно");
  }
}
