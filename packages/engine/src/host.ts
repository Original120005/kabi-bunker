import { ratingFor, type CharacteristicDef, type ContentDb, type ContentItem, type HostAction, type SpecialEffect } from "@bunker/shared";
import { ensure, GameError } from "./errors.ts";
import { catastropheFrom, effectOf, generateGame, generateModifiers, makeCard, Picker, type CharacterContext } from "./generation.ts";
import { BUNKER_EVENTS } from "./events.ts";
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
    state.rngState = last.rngState;
    env.log(`отменил действие «${last.label}»`);
    return;
  }

  let special: UndoEntry["special"];
  let label: string;
  if (action.type === "host.special.apply") {
    const card = game.cards[action.cardId];
    ensure(card && game.characteristics.find((c) => c.key === card.charKey)?.specialCard, "Спец. карта не найдена");
    ensure(card.revealed, "Сначала игрок должен открыть эту карту");
    ensure(!card.used, "Эта спец. возможность уже применена");
    const effect = card.effect !== undefined ? card.effect : effectOf(pool(env, def(game, card.charKey).contentType).find((i) => i.id === card.contentId) ?? null);
    special = { ownerId: card.ownerId, cardId: card.id };
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

/** Applies a special card through the regular host tools, so every check and the undo work the same way. */
function applySpecial(env: Env, card: Card, effect: SpecialEffect | null, action: Extract<HostAction, { type: "host.special.apply" }>): string {
  const { game } = env;
  const owner = card.ownerId;
  const chosen = (kind: "other" | "any" | "exiled") => {
    const t = action.target;
    ensure(t, "Выберите игрока");
    ensure(game.seatOrder.includes(t), "Игрок не найден");
    if (kind === "exiled") ensure(game.statuses[t] === "exiled", "Этот игрок не изгнан");
    else ensure(game.statuses[t] === "alive", "Игрок должен быть в лагере");
    if (kind === "other") ensure(t !== owner, "Выберите другого игрока");
    return t;
  };
  const target = (t: "self" | "other" | "any" | "all") => (t === "self" ? owner : t === "all" ? "all" : chosen(t));
  const quiet: Env = { ...env, log: () => {} };
  const via = (a: HostAction) => run(quiet, a);

  let result: string;
  if (!effect || effect.op === "manual") {
    result = effect ? `отмечено как использованное (${effect.note})` : "отмечено как использованное";
  } else {
    switch (effect.op) {
      case "bunker.reroll":
        result = via({ type: "host.bunker.reroll", field: effect.field });
        break;
      case "bunker.addItem":
        result = via({ type: "host.bunker.addItem" });
        break;
      case "catastrophe.reroll":
        result = via({ type: "host.catastrophe.reroll" });
        break;
      case "seats":
        result = via({ type: "host.seats", delta: effect.delta });
        break;
      case "rotate":
        result = via({ type: "host.rotate", charKey: effect.charKey, dir: effect.dir });
        break;
      case "nullify":
        result = via({ type: "host.nullify", charKey: effect.charKey });
        break;
      case "reroll":
        result = via({ type: "host.char.reroll", target: target(effect.target), charKey: effect.charKey });
        break;
      case "modifier.step":
        result = stepModifier(env, target(effect.target), effect.charKey, effect.modifierKey, effect.delta);
        break;
      case "swap":
        result = via({ type: "host.char.swap", a: owner, b: chosen("other"), charKey: effect.charKey });
        break;
      case "steal":
        result = via({ type: "host.char.steal", thief: owner, victim: chosen("other"), charKey: effect.charKey });
        break;
      case "healthy":
        result = via({ type: "host.cure", target: target(effect.target), op: "healthy" });
        break;
      case "return":
        result = via({ type: "host.return", playerId: chosen("exiled") });
        break;
      case "reveal": {
        const victim = chosen("other");
        ensure(action.charKey, "Выберите характеристику");
        const d = def(game, action.charKey);
        const closed = cards(game, victim, d.key).filter((c) => !c.revealed);
        ensure(closed.length, "Эта характеристика у игрока уже открыта");
        for (const c of closed) c.revealed = true;
        result = `открыл «${d.name}» игрока ${env.name(victim)}`;
        break;
      }
      case "cancelSpecial":
        throw new GameError("Недоступно");
    }
  }
  const text = `применил «${card.title}» (${env.name(owner)}): ${result}`;
  env.log(text);
  return text;
}

/** Moves a scale modifier (experience, severity) one level up or down, respecting age for experience. */
function stepModifier(env: Env, playerId: string, charKey: string, modifierKey: string, delta: 1 | -1): string {
  const { game } = env;
  const d = def(game, charKey);
  const m = scaleLevels(d, modifierKey);
  const list = cards(game, playerId, d.key).filter((c) => m.key in c.modifiers);
  ensure(list.length, `У игрока ${env.name(playerId)} нет такого параметра в «${d.name}» (например, он идеально здоров)`);
  const age = characterOf(game, playerId).age;
  let reached = "";
  for (const card of list) {
    const next = m.levels.findIndex((l) => l.key === card.modifiers[m.key]) + delta;
    ensure(next >= 0 && next < m.levels.length, delta > 0 ? "Уже максимальный уровень" : "Уже минимальный уровень");
    if (m.ageBound && delta > 0 && age !== undefined) ensure((m.levels[next].minYears ?? 0) <= age - game.rules.workStartAge, "Возраст персонажа не позволяет повысить стаж");
    card.modifiers[m.key] = m.levels[next].key;
    reached = m.levels[next].label;
  }
  return `${delta > 0 ? "повысил" : "понизил"} «${d.name}» игроку ${env.name(playerId)} до «${reached}»`;
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
      const exiled = (game.exileOrder ?? []).filter((id) => game.statuses[id] === "exiled");
      const rows = game.seatOrder.map((id) => {
        const profileId = state.participants.find((p) => p.id === id)?.profileId ?? null;
        const status = game.statuses[id];
        if (status === "alive" || status === "inBunker") {
          game.statuses[id] = "inBunker";
          return { playerId: id, profileId, ...ratingFor(true, null) };
        }
        if (status === "exiled") return { playerId: id, profileId, ...ratingFor(false, exiled.indexOf(id)) };
        return { playerId: id, profileId, ...ratingFor(false, null) };
      });
      game.settlement = { id: `${state.code}:${game.startedAt}`, rows };
      state.undo = [];
      const summary = rows.map((r) => `${env.name(r.playerId)} ${r.delta > 0 ? `+${r.delta}` : r.delta}`).join(", ");
      return done(`подвёл итоги партии (${summary})`);
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
      const d = def(game, "body");
      const item = pool(env, d.contentType).find((i) => i.title === action.title);
      ensure(item, "Нет такого телосложения");
      forTargets(env, action.target, (pid) => {
        for (const card of cards(game, pid, "body")) {
          card.contentId = item.id;
          card.title = item.title;
          card.description = item.description;
          card.abilities = item.abilities;
        }
      });
      return done(`сделал телосложение «${item.title}» ${who(env, action.target)}`);
    }
    case "host.char.add": {
      const d = def(game, action.charKey);
      targets(game, action.target);
      const existing = cards(game, action.target, d.key).filter((c) => c.contentId || c.title !== EMPTY);
      const own = new Set(existing.map((c) => c.contentId ?? ""));
      const added = action.text ? textCard(env, d, action.target, action.text) : draw(env, d, action.target, own);
      setCards(game, action.target, d.key, [...existing, added]);
      return done(`добавил «${d.name}» ${who(env, action.target)}`);
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
