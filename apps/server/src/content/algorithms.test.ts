import { describe, expect, it } from "vitest";
import { applyAction, createRoom, joinRoom, Rng, survivalChance, type ActionContext, type Card, type RoomState } from "@bunker/engine";
import type { ClientAction } from "@bunker/shared";
import { baseContent } from "./test-content.ts";

const content = baseContent();
let n = 0;
const ctx = (actorId = "p0"): ActionContext => ({ actorId, now: 1, newId: () => `al${++n}`, loadContent: () => content });
const act = (s: RoomState, a: ClientAction, actor = "p0") => applyAction(s, a, ctx(actor));
const hand = (s: RoomState, p: string, key: string): Card[] => s.game!.hands[p][key].map((id) => s.game!.cards[id]);

function started(seed: number, players = 9): RoomState {
  let s = createRoom({ code: "ALG1", hostId: "p0", tokenHash: "h0", nickname: "Ведущий", now: 0, seed, packSlugs: ["base"] });
  for (let i = 1; i <= players; i++) s = joinRoom(s, { id: `p${i}`, tokenHash: `h${i}`, nickname: `Игрок ${i}`, now: i }).state;
  return applyAction(s, { type: "lobby.start" }, ctx());
}

describe("алгоритмы случайности", () => {
  it("рост распределён колоколом: крайние значения редки, мужчины в среднем выше", () => {
    const men: number[] = [];
    const women: number[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const s = started(seed * 7919);
      for (const p of s.game!.seatOrder) {
        const h = Number(hand(s, p, "body")[0].modifiers.height);
        expect(h).toBeGreaterThanOrEqual(150);
        expect(h).toBeLessThanOrEqual(210);
        (hand(s, p, "gender")[0].title === "Мужчина" ? men : women).push(h);
      }
    }
    const all = [...men, ...women];
    const share = (f: (h: number) => boolean) => all.filter(f).length / all.length;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(share((h) => h < 155 || h > 200)).toBeLessThan(0.03);
    expect(share((h) => h >= 160 && h <= 185)).toBeGreaterThan(0.75);
    expect(mean(men) - mean(women)).toBeGreaterThan(8);
  });

  it("смена телосложения ведущим не меняет рост", () => {
    let s = started(5);
    const before = Object.fromEntries(s.game!.seatOrder.map((p) => [p, hand(s, p, "body")[0].modifiers.height]));
    s = act(s, { type: "host.body", target: "p1", title: "Ожирение-сильное" });
    expect(hand(s, "p1", "body")[0].title).toBe("Ожирение-сильное");
    const prevTitles = Object.fromEntries(s.game!.seatOrder.map((p) => [p, hand(s, p, "body")[0].title]));
    s = act(s, { type: "host.body", target: "all", title: "random" });
    for (const p of s.game!.seatOrder) {
      expect(hand(s, p, "body")[0].modifiers.height).toBe(before[p]);
      expect(hand(s, p, "body")[0].title).not.toBe(prevTitles[p]);
    }
    expect(s.log.at(-1)!.text).toContain("рост сохранён");
  });

  it("после отмены повтор того же действия даёт новый случайный результат", () => {
    let s = started(9);
    const results = new Set<string>();
    for (let i = 0; i < 6; i++) {
      s = act(s, { type: "host.char.reroll", target: "p1", charKey: "hobby" });
      results.add(hand(s, "p1", "hobby")[0].title);
      s = act(s, { type: "host.undo" });
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it("шанс выжить на вылазке совпадает с реальной частотой выживания", () => {
    let chances = 0;
    let wins = 0;
    let count = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = started(seed * 104729);
      const rng = new Rng(seed);
      for (const p of s.game!.seatOrder) {
        const { chance } = survivalChance(s.game!, p);
        chances += chance;
        count++;
        if (rng.next() < chance / 100) wins++;
      }
    }
    expect(Math.abs(wins / count - chances / count / 100)).toBeLessThan(0.02);
  });
});
