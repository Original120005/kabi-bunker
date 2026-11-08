import { describe, expect, it } from "vitest";
import { applyAction, createRoom, GameError, joinRoom, projectRoom, upgradeRoom, type ActionContext, type Card, type RoomState } from "@bunker/engine";
import { effectNeeds, SpecialEffect, type ClientAction, type ContentItem } from "@bunker/shared";
import { baseContent } from "./test-content.ts";

const content = baseContent();
const professions = content.pools.profession.flat();
const specials = content.pools.special.flat();
let n = 0;
const ctx = (actorId = "p0"): ActionContext => ({ actorId, now: 1, newId: () => `pr${++n}`, loadContent: () => content });
const act = (s: RoomState, a: ClientAction, actor = "p0") => applyAction(s, a, ctx(actor));
const hand = (s: RoomState, p: string, key: string): Card[] => s.game!.hands[p][key].map((id) => s.game!.cards[id]);
const byTitle = (title: string) => professions.find((i) => i.title === title)!;
const disease = content.pools.health.flat().find((i) => !i.tags.includes("health:none"))!;

/** Makes the player's first health line a real disease of the given severity. */
function sick(s: RoomState, playerId: string, severity: string): Card {
  const card = hand(s, playerId, "health")[0];
  Object.assign(card, { contentId: disease.id, title: disease.title, modifiers: { severity } });
  return card;
}

function started(): RoomState {
  let s = createRoom({ code: "PROF1", hostId: "p0", tokenHash: "h0", nickname: "Ведущий", now: 0, seed: 21, packSlugs: ["base"] });
  for (let i = 1; i < 7; i++) s = joinRoom(s, { id: `p${i}`, tokenHash: `h${i}`, nickname: `Игрок ${i}`, now: i }).state;
  return applyAction(s, { type: "lobby.start" }, ctx());
}

/** Gives the player this profession, opened to everyone, as if it was dealt. */
function giveProfession(s: RoomState, playerId: string, item: ContentItem): Card {
  const card = hand(s, playerId, "profession")[0];
  card.contentId = item.id;
  card.title = item.title;
  card.abilities = item.abilities;
  card.effect = item.data.effect === undefined ? null : SpecialEffect.parse(item.data.effect);
  card.used = false;
  card.revealed = true;
  return card;
}

function consistent(s: RoomState) {
  const g = s.game!;
  for (const [pid, h] of Object.entries(g.hands)) {
    for (const [key, ids] of Object.entries(h)) {
      expect(ids.length, `${pid}.${key}`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(g.cards[id]?.ownerId).toBe(pid);
        expect(g.cards[id]?.charKey).toBe(key);
      }
    }
  }
}

/** A table where most abilities can work: an exiled player, adults with medium diseases and some experience. */
function prepared(): RoomState {
  let s = act(started(), { type: "host.exile", playerId: "p5" });
  for (const p of s.game!.seatOrder) {
    hand(s, p, "gender")[0].modifiers.age = 45;
    for (const c of hand(s, p, "health")) if ("severity" in c.modifiers) c.modifiers.severity = "medium";
    hand(s, p, "profession")[0].modifiers.experience = "amateur";
  }
  for (const c of hand(s, "p5", "bigInventory")) c.revealed = true;
  for (const c of hand(s, "p5", "health")) c.revealed = true;
  return s;
}

function inputs(s: RoomState, effect: SpecialEffect | null, option: number) {
  const needs = effectNeeds(effect, option);
  const ring = s.game!.seatOrder.filter((id) => id === "p1" || s.game!.statuses[id] === "alive");
  const neighbor = ring[(ring.indexOf("p1") + 1) % ring.length];
  const target = { none: undefined, other: "p2", any: "p2", exiled: "p5", neighbor }[needs.player];
  return {
    ...(effect?.op === "choice" ? { option } : {}),
    ...(target ? { target } : {}),
    ...(needs.player2 ? { target2: "p3" } : {}),
    ...(needs.chars !== null ? { charKey: needs.chars[0] ?? "hobby" } : {}),
    ...(needs.text ? { text: needs.text.options?.[0] ?? (needs.text.initial || "Тест") } : {}),
    ...(needs.value === "ageGroup" ? { text: "young" } : needs.value === "body" ? { text: "Атлетическое" } : {}),
  };
}

describe("способности профессий", () => {
  it("у каждой профессии со способностью есть корректный эффект", () => {
    expect(professions.length).toBeGreaterThan(300);
    for (const item of professions) {
      if (!item.abilities.length) continue;
      expect(item.data.effect, item.title).toBeDefined();
      expect(SpecialEffect.safeParse(item.data.effect).success, item.title).toBe(true);
    }
  });

  it("новые профессии получают эффект при раздаче", () => {
    const s = started();
    for (const p of s.game!.seatOrder) for (const c of hand(s, p, "profession")) expect(c.effect, c.title).not.toBeUndefined();
  });

  it("каждая способность применяется или понятно отказывает, и откатывается полностью", () => {
    let applied = 0;
    let total = 0;
    for (const item of professions) {
      const effect = item.data.effect === undefined ? null : SpecialEffect.parse(item.data.effect);
      if (!item.abilities.length || effect?.op === "info" || effect?.op === "cancelSpecial") continue;
      const options = effect?.op === "choice" ? effect.options.length : 1;
      for (let option = 0; option < options; option++) {
        total++;
        let s = prepared();
        const card = giveProfession(s, "p1", item);
        const before = structuredClone(s.game!);
        const action = { type: "host.special.apply" as const, cardId: card.id, ...inputs(s, effect, option) };
        try {
          s = act(s, action);
        } catch (e) {
          // Conditions of the text (age, level, «only revealed») may not hold on this table; that must be a clear game error.
          expect(e, `${item.title}: ${String(e)}`).toBeInstanceOf(GameError);
          continue;
        }
        applied++;
        expect(s.game!.cards[card.id]?.used ?? true, item.title).toBe(true);
        expect(s.log.at(-1)!.text, item.title).toContain(`способность профессии «${item.title}»`);
        consistent(s);
        expect(() => act(s, action), item.title).toThrow();
        s = act(s, { type: "host.undo" });
        expect(s.game, item.title).toEqual(before);
      }
    }
    expect(applied / total).toBeGreaterThan(0.9);
  });

  it("постоянные свойства не применяются", () => {
    const s = prepared();
    const card = giveProfession(s, "p1", byTitle("Пилот"));
    expect(() => act(s, { type: "host.special.apply", cardId: card.id })).toThrow(/постоянное свойство/);
  });

  it("профессию нужно сначала открыть", () => {
    const s = prepared();
    const card = giveProfession(s, "p1", byTitle("Вор"));
    card.revealed = false;
    expect(() => act(s, { type: "host.special.apply", cardId: card.id, target: "p2" })).toThrow(/открыть профессию/);
  });

  it("предмет попадает в рюкзак с текстом ведущего", () => {
    let s = prepared();
    const card = giveProfession(s, "p1", byTitle("Биофизик"));
    s = act(s, { type: "host.special.apply", cardId: card.id, text: "Микроскоп с подсветкой" });
    expect(hand(s, "p1", "backpack").map((c) => c.title)).toContain("Микроскоп с подсветкой");
  });

  it("отметка «использовано» переходит вместе с профессией, а Учёный получает чужую неиспользованной", () => {
    let s = prepared();
    const teacher = giveProfession(s, "p2", byTitle("Педагог"));
    s = act(s, { type: "host.special.apply", cardId: teacher.id, target: "p3" });
    expect(s.game!.cards[teacher.id].used).toBe(true);

    const swap = specials.find((i) => i.title === "Поменяться профессией с любым игроком")!;
    const sp = hand(s, "p4", "special")[0];
    Object.assign(sp, { contentId: swap.id, title: swap.title, abilities: swap.abilities, effect: SpecialEffect.parse(swap.data.effect), used: false, revealed: true });
    s = act(s, { type: "host.special.apply", cardId: sp.id, target: "p2" });
    expect(hand(s, "p4", "profession")[0].id).toBe(teacher.id);
    expect(hand(s, "p4", "profession")[0].used).toBe(true);

    const scientist = giveProfession(s, "p1", byTitle("Ученый"));
    s = act(s, { type: "host.special.apply", cardId: scientist.id, target: "p4" });
    expect(hand(s, "p1", "profession")[0].id).toBe(teacher.id);
    expect(hand(s, "p1", "profession")[0].used).toBe(false);
    expect(hand(s, "p4", "profession")[0].used).toBe(true);
  });

  it("«Отменить спец. возможность» не отменяет способности профессий", () => {
    let s = prepared();
    const thief = giveProfession(s, "p1", byTitle("Вор"));
    s = act(s, { type: "host.special.apply", cardId: thief.id, target: "p2" });
    const lobbyist = giveProfession(s, "p3", byTitle("Лоббист"));
    expect(() => act(s, { type: "host.special.apply", cardId: lobbyist.id })).toThrow(/не спец. возможность/);
  });

  it("врач лечит одну болезнь из двух и учитывает степень", () => {
    let s = prepared();
    const doctor = giveProfession(s, "p1", byTitle("Доктор"));
    const first = sick(s, "p2", "critical");
    const extra: Card = { ...structuredClone(first), id: "extra-line", contentId: null, title: "Ангина", modifiers: { severity: "light" } };
    s.game!.cards[extra.id] = extra;
    s.game!.hands.p2.health = [...s.game!.hands.p2.health, extra.id];
    s = act(s, { type: "host.special.apply", cardId: doctor.id, target: "p2" });
    expect(hand(s, "p2", "health").map((c) => c.title)).toEqual([first.title]);

    const nurse = giveProfession(s, "p3", byTitle("Медсестра/Медбрат"));
    expect(() => act(s, { type: "host.special.apply", cardId: nurse.id, target: "p2" })).toThrow(/слишком высокая/);
  });

  it("снижение степени меняет только те строки, которые можно снизить", () => {
    let s = prepared();
    const therapist = giveProfession(s, "p1", byTitle("Реабилитолог"));
    const first = sick(s, "p2", "light");
    const extra: Card = { ...structuredClone(first), id: "extra-line2", contentId: null, title: "Перелом", modifiers: { severity: "heavy" } };
    s.game!.cards[extra.id] = extra;
    s.game!.hands.p2.health = [...s.game!.hands.p2.health, extra.id];
    s = act(s, { type: "host.special.apply", cardId: therapist.id, target: "p2" });
    expect(hand(s, "p2", "health").map((c) => c.modifiers.severity)).toEqual(["light", "medium"]);
  });

  it("соседи и изгнанные выбираются по правилам", () => {
    let s = prepared();
    const croupier = giveProfession(s, "p1", byTitle("Крупье"));
    const ring = s.game!.seatOrder.filter((id) => id === "p1" || s.game!.statuses[id] === "alive");
    const i = ring.indexOf("p1");
    const far = ring.find((id, j) => id !== "p1" && j !== (i + 1) % ring.length && j !== (i - 1 + ring.length) % ring.length)!;
    expect(() => act(s, { type: "host.special.apply", cardId: croupier.id, target: far })).toThrow(/соседа/);
    const director = giveProfession(s, "p2", byTitle("Директор"));
    expect(() => act(s, { type: "host.special.apply", cardId: director.id, target: "p3" })).toThrow(/не изгнан/);
    s = act(s, { type: "host.special.apply", cardId: director.id, target: "p5" });
    expect(hand(s, "p5", "profession")[0].id).toBe(director.id);
  });

  it("эффект и отметка видны в проекции открытой профессии", () => {
    let s = prepared();
    const card = giveProfession(s, "p1", byTitle("Вор"));
    s = act(s, { type: "host.special.apply", cardId: card.id, target: "p2" });
    const view = projectRoom(s, "p3", new Set(), 0);
    const seen = view.game!.players.find((p) => p.id === "p1")!.cards.profession.find((c) => c.id === card.id)!;
    expect(seen.hidden).toBe(false);
    if (!seen.hidden) {
      expect(seen.used).toBe(true);
      expect(seen.effect).toEqual({ op: "steal", charKey: "backpack" });
    }
  });

  it("старые партии получают эффекты профессий при восстановлении", () => {
    const s = started();
    for (const c of Object.values(s.game!.cards)) if (c.charKey === "profession") delete c.effect;
    const restored = upgradeRoom(JSON.parse(JSON.stringify(s)), () => content);
    for (const c of Object.values(restored.game!.cards)) if (c.charKey === "profession") expect(c.effect, c.title).not.toBeUndefined();
  });
});
