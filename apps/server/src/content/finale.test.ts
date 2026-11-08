import { describe, expect, it } from "vitest";
import { advanceRoom, applyAction, createRoom, joinRoom, parseMonths, professionSkills, projectRoom, Rng, simulateBunker, type ActionContext, type Card, type RoomState } from "@bunker/engine";
import type { ClientAction } from "@bunker/shared";
import { baseContent } from "./test-content.ts";

const content = baseContent();
let n = 0;
const ctx = (now = 1): ActionContext => ({ actorId: "p0", now, newId: () => `fi${++n}`, loadContent: () => content });
const act = (s: RoomState, a: ClientAction, now = 1) => applyAction(s, a, ctx(now));
const hand = (s: RoomState, p: string, key: string): Card[] => s.game!.hands[p][key].map((id) => s.game!.cards[id]);

function started(seed = 3): RoomState {
  let s = createRoom({ code: "FIN1", hostId: "p0", tokenHash: "h0", nickname: "Ведущий", now: 0, seed, packSlugs: ["base"] });
  for (let i = 1; i < 8; i++) s = joinRoom(s, { id: `p${i}`, tokenHash: `h${i}`, nickname: `Игрок ${i}`, now: i, profileId: i < 6 ? `prof${i}` : undefined }).state;
  return applyAction(s, { type: "lobby.start" }, ctx());
}

/** Exiles players until those left fit into the seats. */
function trimmed(seed = 3): RoomState {
  let s = started(seed);
  const order = s.game!.seatOrder;
  for (let i = s.game!.bunker.seats; i < order.length; i++) s = act(s, { type: "host.exile", playerId: order[i] });
  return s;
}

function setPerson(s: RoomState, p: string, o: { gender: string; age: number; childfree?: boolean; body?: string }) {
  const g = hand(s, p, "gender")[0];
  g.title = o.gender;
  g.contentId = o.gender;
  g.modifiers.age = o.age;
  g.modifiers.childfree = o.childfree ?? false;
  if (o.body) hand(s, p, "body")[0].title = o.body;
  for (const c of hand(s, p, "extraInfo")) c.title = "Левша";
}

describe("итоги партии: симуляция бункера", () => {
  it("нельзя подвести итоги, если в лагере больше людей, чем мест", () => {
    const s = started();
    expect(() => act(s, { type: "host.finish" })).toThrow(/изгоните лишних/);
  });

  it("вердикт и рейтинг приходят игрокам только в момент раскрытия, бонус +10 выжившим", () => {
    let s = trimmed();
    s = act(s, { type: "host.finish" }, 1000);
    const f = s.game!.settlement!.finale!;
    expect(f.factors.length).toBeGreaterThan(5);
    const early = projectRoom(s, "p1", new Set(), 1000).game!.finale!;
    expect(early.survived).toBeNull();
    expect(early.rows).toBeNull();
    expect(JSON.stringify(early)).not.toContain("delta");
    expect(JSON.stringify(early)).not.toContain("chance");
    expect(advanceRoom(s, { now: f.revealAt - 1, newId: () => "z" })).toBe(s);
    const later = advanceRoom(s, { now: f.revealAt, newId: () => "z" });
    expect(later.game!.settlement!.finale!.revealed).toBe(true);
    const view = projectRoom(later, "p1", new Set(), f.revealAt).game!.finale!;
    expect(view.survived).toBe(f.survived);
    const inside = s.game!.settlement!.rows.filter((r) => r.outcome === "bunker");
    expect(inside.length).toBeGreaterThan(0);
    for (const r of inside) expect(r.delta).toBe(f.survived ? 30 : 20);
    const first = s.game!.settlement!.rows.find((r) => r.outcome === "firstOut")!;
    expect(first.delta).toBe(-20);
    expect(view.rows!.find((r) => r.playerId === "p6")!.rated).toBe(false);
    expect(later.log.at(-1)!.text).toMatch(/Итоги партии: бункер/);
  });

  it("исход бывает разным, а шанс зависит от состава", () => {
    const results = new Set<boolean>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = trimmed(seed);
      results.add(act(s, { type: "host.finish" }).game!.settlement!.finale!.survived);
    }
    expect(results.size).toBe(2);
  });

  it("продолжение рода: женщина 16–50 без ч/ф, не хрупкая и без сильного ожирения, и мужчина без ч/ф", () => {
    const s = trimmed();
    const inside = s.game!.seatOrder.filter((id) => s.game!.statuses[id] === "alive");
    const [a, b, ...rest] = inside;
    for (const p of rest) setPerson(s, p, { gender: "Мужчина", age: 70, childfree: true });
    const factor = () => simulateBunker(s, s.game!, inside, new Rng(1), 0).factors.find((f) => f.label === "Продолжение рода")!;
    setPerson(s, a, { gender: "Женщина", age: 30, body: "Атлетическое" });
    setPerson(s, b, { gender: "Мужчина", age: 40 });
    expect(factor().delta).toBeGreaterThan(0);
    setPerson(s, a, { gender: "Женщина", age: 51, body: "Атлетическое" });
    expect(factor().delta).toBeLessThan(0);
    setPerson(s, a, { gender: "Женщина", age: 50, body: "Хрупкое" });
    expect(factor().delta).toBeLessThan(0);
    setPerson(s, a, { gender: "Женщина", age: 50, body: "Ожирение-сильное" });
    expect(factor().delta).toBeLessThan(0);
    setPerson(s, a, { gender: "Женщина", age: 16, childfree: true, body: "Полное" });
    expect(factor().delta).toBeLessThan(0);
    setPerson(s, a, { gender: "Женщина", age: 16, body: "Полное" });
    expect(factor().delta).toBeGreaterThan(0);
    setPerson(s, b, { gender: "Мужчина", age: 40, childfree: true });
    expect(factor().delta).toBeLessThan(0);
  });

  it("поломки и ивенты решаются профессией или предметом", () => {
    const s = trimmed();
    const inside = s.game!.seatOrder.filter((id) => s.game!.statuses[id] === "alive");
    s.game!.bunker.fields.history = [{ contentId: null, title: "Построен военными в 1970-х. Нет электричества" }];
    for (const p of inside) {
      hand(s, p, "profession")[0].title = "Философ";
      for (const c of [...hand(s, p, "backpack"), ...hand(s, p, "bigInventory")]) c.title = "Книга";
    }
    s.game!.bunker.fields.items = [{ contentId: null, title: "Двуспальная кровать" }];
    s.partyEvents = ["looters"];
    const factors = () => simulateBunker(s, s.game!, inside, new Rng(1), 0).factors;
    expect(factors().find((f) => f.label.includes("нет электричества"))!.delta).toBeLessThan(0);
    expect(factors().find((f) => f.label.includes("Мародёры"))!.delta).toBeLessThan(0);
    hand(s, inside[0], "profession")[0].title = "Электрик";
    hand(s, inside[1], "backpack")[0].title = "Пистолет и 28 патронов";
    expect(factors().find((f) => f.label.includes("нет электричества"))!.delta).toBe(0);
    expect(factors().find((f) => f.label.includes("Мародёры"))!.delta).toBe(0);
  });

  it("сроки и навыки распознаются", () => {
    expect(parseMonths("на год и 9 месяцев")).toBe(21);
    expect(parseMonths("2 года 3 месяца")).toBe(27);
    expect(parseMonths("на полгода")).toBe(6);
    expect(parseMonths("еды нет, воды на 2 месяца")).toBe(0);
    expect(parseMonths("на 3 года, только консервы")).toBe(36);
    expect(parseMonths("1 год")).toBe(12);
    expect(professionSkills("Хирург")).toContain("med");
    expect(professionSkills("Электрик")).toContain("tech");
    expect(professionSkills("Фермер")).toContain("food");
    expect(professionSkills("Военнослужащий")).toContain("defense");
  });

  it("ивенты партии запоминаются и сбрасываются при новой игре", () => {
    let s = trimmed();
    s = act(s, { type: "host.event" });
    expect(s.partyEvents!.length).toBe(1);
    s = act(s, { type: "host.restart" });
    expect(s.partyEvents).toEqual([]);
  });
});
