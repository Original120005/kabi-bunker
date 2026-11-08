import { describe, expect, it } from "vitest";
import { applyAction, createRoom, joinRoom, projectRoom, upgradeRoom, type ActionContext, type Card, type RoomState } from "@bunker/engine";
import { SpecialEffect, type ClientAction, type ContentItem } from "@bunker/shared";
import { baseContent } from "./test-content.ts";

const content = baseContent();
const specials = content.pools.special.flat();
let n = 0;
const ctx = (actorId = "p0"): ActionContext => ({ actorId, now: 1, newId: () => `sp${++n}`, loadContent: () => content });
const act = (s: RoomState, a: ClientAction, actor = "p0") => applyAction(s, a, ctx(actor));
const hand = (s: RoomState, p: string, key: string): Card[] => s.game!.hands[p][key].map((id) => s.game!.cards[id]);

function started(): RoomState {
  let s = createRoom({ code: "SPEC1", hostId: "p0", tokenHash: "h0", nickname: "Ведущий", now: 0, seed: 11, packSlugs: ["base"] });
  for (let i = 1; i < 7; i++) s = joinRoom(s, { id: `p${i}`, tokenHash: `h${i}`, nickname: `Игрок ${i}`, now: i }).state;
  return applyAction(s, { type: "lobby.start" }, ctx());
}

/** Puts the given special card into the player's first special slot, opened to everyone. */
function giveSpecial(s: RoomState, playerId: string, item: ContentItem, slot = 0): Card {
  const card = hand(s, playerId, "special")[slot];
  card.contentId = item.id;
  card.title = item.title;
  card.abilities = item.abilities;
  card.effect = SpecialEffect.parse(item.data.effect);
  card.used = false;
  card.revealed = true;
  return card;
}

const byOp = (op: string) => specials.find((i) => (i.data.effect as { op: string }).op === op)!;
const byTitle = (title: string) => specials.find((i) => i.title === title)!;

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

describe("умное применение спец. возможностей", () => {
  it("у каждой спец. карты базового пака есть корректный эффект", () => {
    expect(specials.length).toBeGreaterThan(0);
    for (const item of specials) expect(SpecialEffect.safeParse(item.data.effect).success, item.title).toBe(true);
  });

  it("новые карты получают эффект при раздаче", () => {
    const s = started();
    for (const p of s.game!.seatOrder) for (const c of hand(s, p, "special")) expect(c.effect, c.title).not.toBeUndefined();
  });

  it("каждая карта применяется и полностью откатывается", () => {
    for (const item of specials) {
      const effect = SpecialEffect.parse(item.data.effect);
      if (effect.op === "cancelSpecial") continue;
      let s = started();
      if (effect.op === "return") s = act(s, { type: "host.exile", playerId: "p3" });
      if (effect.op === "modifier.step") {
        for (const p of ["p1", "p2"]) {
          hand(s, p, "gender")[0].modifiers.age = 45;
          for (const c of hand(s, p, effect.charKey)) c.modifiers[effect.modifierKey] = effect.charKey === "health" ? "medium" : "amateur";
        }
      }
      const card = giveSpecial(s, "p1", item);
      const before = structuredClone(s.game!);
      const target = effect.op === "return" ? "p3" : "p2";
      s = act(s, { type: "host.special.apply", cardId: card.id, target, charKey: effect.op === "reveal" ? "health" : undefined });
      expect(s.game!.cards[card.id]?.used ?? true, item.title).toBe(true);
      expect(s.log.at(-1)!.text, item.title).toContain(`«${item.title}»`);
      consistent(s);
      expect(() => act(s, { type: "host.special.apply", cardId: card.id, target }), item.title).toThrow();
      s = act(s, { type: "host.undo" });
      expect(s.game, item.title).toEqual(before);
    }
  });

  it("результаты эффектов соответствуют тексту карт", () => {
    let s = started();
    const swap = giveSpecial(s, "p1", byTitle("Поменяться здоровьем с любым игроком"));
    const h1 = hand(s, "p1", "health")[0].id;
    const h2 = hand(s, "p2", "health")[0].id;
    s = act(s, { type: "host.special.apply", cardId: swap.id, target: "p2" });
    expect(hand(s, "p1", "health")[0].id).toBe(h2);
    expect(hand(s, "p2", "health")[0].id).toBe(h1);

    const seats = s.game!.bunker.seats;
    s = act(s, { type: "host.special.apply", cardId: giveSpecial(s, "p2", byTitle("Добавить место в бункере")).id });
    expect(s.game!.bunker.seats).toBe(seats + 1);

    s = act(s, { type: "host.special.apply", cardId: giveSpecial(s, "p3", byTitle("Аннулировать все специальности")).id });
    for (const p of s.game!.seatOrder) expect(hand(s, p, "profession")[0].title).toBe("Пусто");

    const reveal = giveSpecial(s, "p4", byOp("reveal"));
    expect(hand(s, "p5", "phobia")[0].revealed).toBe(false);
    s = act(s, { type: "host.special.apply", cardId: reveal.id, target: "p5", charKey: "phobia" });
    expect(hand(s, "p5", "phobia")[0].revealed).toBe(true);

    s = act(s, { type: "host.exile", playerId: "p6" });
    s = act(s, { type: "host.special.apply", cardId: giveSpecial(s, "p5", byOp("return")).id, target: "p6" });
    expect(s.game!.statuses.p6).toBe("alive");
    consistent(s);
  });

  it("проверяет цель и состояние карты", () => {
    let s = started();
    const swap = giveSpecial(s, "p1", byTitle("Поменяться профессией с любым игроком"));
    expect(() => act(s, { type: "host.special.apply", cardId: swap.id })).toThrow(/Выберите игрока/);
    expect(() => act(s, { type: "host.special.apply", cardId: swap.id, target: "p1" })).toThrow(/другого игрока/);
    expect(() => act(s, { type: "host.special.apply", cardId: swap.id, target: "p2" }, "p1")).toThrow(/только ведущий/);
    expect(() => act(s, { type: "host.special.apply", cardId: hand(s, "p1", "profession")[0].id })).toThrow(/Спец. карта не найдена/);
    swap.revealed = false;
    expect(() => act(s, { type: "host.special.apply", cardId: swap.id, target: "p2" })).toThrow(/открыть/);
    swap.revealed = true;
    s = act(s, { type: "host.exile", playerId: "p2" });
    expect(() => act(s, { type: "host.special.apply", cardId: swap.id, target: "p2" })).toThrow(/в лагере/);

    const up = giveSpecial(s, "p3", byTitle("Повысить стаж профессии на 1"));
    hand(s, "p3", "gender")[0].modifiers.age = s.game!.rules.workStartAge + 1;
    hand(s, "p3", "profession")[0].modifiers.experience = "amateur";
    expect(() => act(s, { type: "host.special.apply", cardId: up.id })).toThrow(/Возраст/);
    hand(s, "p3", "gender")[0].modifiers.age = 60;
    hand(s, "p3", "profession")[0].modifiers.experience = "expert";
    expect(() => act(s, { type: "host.special.apply", cardId: up.id })).toThrow(/максимальный/);
    hand(s, "p3", "profession")[0].modifiers.experience = "professional";
    s = act(s, { type: "host.special.apply", cardId: up.id });
    expect(hand(s, "p3", "profession")[0].modifiers.experience).toBe("expert");
  });

  it("откат не закрывает карты, которые игроки открыли после применения", () => {
    let s = started();
    const card = giveSpecial(s, "p1", byTitle("Поменяться хобби с любым игроком"));
    s = act(s, { type: "host.special.apply", cardId: card.id, target: "p2" });
    const later = hand(s, "p4", "trait")[0];
    s = act(s, { type: "card.setRevealed", cardId: later.id, revealed: true }, "p4");
    s = act(s, { type: "host.undo" });
    expect(s.game!.cards[later.id].revealed).toBe(true);
    expect(s.game!.cards[card.id].used).toBe(false);

    s = act(s, { type: "host.revealAll" });
    s = act(s, { type: "host.undo" });
    expect(hand(s, "p5", "phobia")[0].revealed).toBe(false);
    expect(s.game!.cards[later.id].revealed).toBe(true);
  });

  it("«Отменить спец. возможность» откатывает последнюю карту другого игрока, и это тоже можно отменить", () => {
    let s = started();
    const cancel = giveSpecial(s, "p2", byOp("cancelSpecial"));
    expect(() => act(s, { type: "host.special.apply", cardId: cancel.id })).toThrow(/не спец. возможность/);

    const own = giveSpecial(s, "p2", byTitle("Добавить место в бункере"), 1);
    s = act(s, { type: "host.special.apply", cardId: own.id });
    expect(() => act(s, { type: "host.special.apply", cardId: cancel.id })).toThrow(/не спец. возможность другого/);
    s = act(s, { type: "host.undo" });

    const swap = giveSpecial(s, "p1", byTitle("Поменяться рюкзаком с любым игроком"));
    const b1 = hand(s, "p1", "backpack")[0].id;
    s = act(s, { type: "host.special.apply", cardId: swap.id, target: "p3" });
    expect(hand(s, "p1", "backpack")[0].id).not.toBe(b1);
    s = act(s, { type: "host.special.apply", cardId: cancel.id });
    expect(hand(s, "p1", "backpack")[0].id).toBe(b1);
    expect(s.game!.cards[swap.id].used).toBe(true);
    expect(s.game!.cards[cancel.id].used).toBe(true);
    consistent(s);

    s = act(s, { type: "host.undo" });
    expect(hand(s, "p1", "backpack")[0].id).not.toBe(b1);
    expect(s.game!.cards[cancel.id].used).toBe(false);
  });

  it("эффект и отметка «применено» видны только у видимых карт", () => {
    let s = started();
    const card = giveSpecial(s, "p1", byTitle("Добавить предмет в бункер"));
    const closed = hand(s, "p1", "special")[1];
    s = act(s, { type: "host.special.apply", cardId: card.id });
    const view = projectRoom(s, "p2", new Set(), 0);
    const cards = view.game!.players.find((p) => p.id === "p1")!.cards.special;
    const open = cards.find((c) => c.id === card.id)!;
    expect(open.hidden).toBe(false);
    if (!open.hidden) {
      expect(open.used).toBe(true);
      expect(open.effect).toEqual({ op: "bunker.addItem" });
    }
    expect(cards.find((c) => c.id === closed.id)).toEqual({ id: closed.id, charKey: "special", hidden: true });
  });

  it("старые партии получают эффекты при восстановлении", () => {
    const s = started();
    for (const c of Object.values(s.game!.cards)) if (c.charKey === "special") delete c.effect;
    const restored = upgradeRoom(JSON.parse(JSON.stringify(s)), () => content);
    for (const c of Object.values(restored.game!.cards)) if (c.charKey === "special") expect(c.effect, c.title).not.toBeUndefined();
  });
});
