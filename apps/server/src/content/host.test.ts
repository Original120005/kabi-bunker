import { describe, expect, it } from "vitest";
import { applyAction, createRoom, joinRoom, projectRoom, type ActionContext, type RoomState } from "@bunker/engine";
import type { ClientAction } from "@bunker/shared";
import { baseContent } from "./test-content.ts";

const content = baseContent();
let n = 0;
const ctx = (actorId = "p0"): ActionContext => ({ actorId, now: 1, newId: () => `id${++n}`, loadContent: () => content });

function started(players = 7): RoomState {
  let s = createRoom({ code: "HOST1", hostId: "p0", tokenHash: "h0", nickname: "Ведущий", now: 0, seed: 3, packSlugs: ["base"] });
  for (let i = 1; i < players; i++) s = joinRoom(s, { id: `p${i}`, tokenHash: `h${i}`, nickname: `Игрок ${i}`, now: i }).state;
  return applyAction(s, { type: "lobby.start" }, ctx());
}

const act = (s: RoomState, a: ClientAction, actor = "p0") => applyAction(s, a, ctx(actor));
const hand = (s: RoomState, p: string, key: string) => s.game!.hands[p][key].map((id) => s.game!.cards[id]);

function consistent(s: RoomState) {
  const g = s.game!;
  for (const [pid, h] of Object.entries(g.hands)) {
    for (const [key, ids] of Object.entries(h)) {
      expect(ids.length, `${pid}.${key}`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(g.cards[id], `карта ${id}`).toBeDefined();
        expect(g.cards[id].ownerId).toBe(pid);
        expect(g.cards[id].charKey).toBe(key);
      }
    }
  }
}

describe("панель ведущего", () => {
  it("только ведущий может пользоваться панелью", () => {
    expect(() => act(started(), { type: "host.dice", sides: 6 }, "p1")).toThrow(/только ведущий/);
  });

  it("изгнать и вернуть", () => {
    let s = act(started(), { type: "host.exile", playerId: "p2" });
    expect(s.game!.statuses.p2).toBe("exiled");
    s = act(s, { type: "host.return", playerId: "p2" });
    expect(s.game!.statuses.p2).toBe("alive");
  });

  it("изменить характеристику всем меняет значения и сохраняет открытость", () => {
    let s = started();
    const card = hand(s, "p1", "health")[0];
    s = act(s, { type: "card.setRevealed", cardId: card.id, revealed: true }, "p1");
    const before = s.game!.seatOrder.map((p) => hand(s, p, "profession")[0].title);
    s = act(s, { type: "host.char.reroll", target: "all", charKey: "profession" });
    const after = s.game!.seatOrder.map((p) => hand(s, p, "profession")[0].title);
    expect(after).not.toEqual(before);
    s = act(s, { type: "host.char.reroll", target: "p1", charKey: "health" });
    expect(hand(s, "p1", "health")[0].revealed).toBe(true);
    consistent(s);
  });

  it("обмен не теряет карты", () => {
    let s = started();
    const a = hand(s, "p1", "hobby")[0].id;
    const b = hand(s, "p2", "hobby")[0].id;
    s = act(s, { type: "host.char.swap", a: "p1", b: "p2", charKey: "hobby" });
    expect(hand(s, "p1", "hobby")[0].id).toBe(b);
    expect(hand(s, "p2", "hobby")[0].id).toBe(a);
    consistent(s);
  });

  it("кража оставляет жертве «Пусто» или новое значение по правилам характеристики", () => {
    let s = act(started(), { type: "host.char.steal", thief: "p1", victim: "p2", charKey: "bigInventory" });
    expect(hand(s, "p2", "bigInventory")[0].title).toBe("Пусто");
    expect(hand(s, "p1", "bigInventory")).toHaveLength(2);
    s = act(s, { type: "host.char.steal", thief: "p1", victim: "p3", charKey: "health" });
    expect(hand(s, "p3", "health")[0].title).not.toBe("Пусто");
    consistent(s);
  });

  it("по часовой стрелке передаёт значение соседу", () => {
    const s0 = started();
    const order = s0.game!.seatOrder;
    const before = order.map((p) => hand(s0, p, "extraInfo")[0].id);
    const s = act(s0, { type: "host.rotate", charKey: "extraInfo", dir: "cw" });
    order.forEach((p, i) => expect(hand(s, p, "extraInfo")[0].id).toBe(before[(i - 1 + order.length) % order.length]));
    consistent(s);
  });

  it("стаж нельзя поставить выше, чем позволяет возраст", () => {
    let s = act(started(), { type: "host.ageGroup", target: "p1", group: "young" });
    s.game!.cards[hand(s, "p1", "gender")[0].id].modifiers.age = 18;
    expect(() => act(s, { type: "host.modifier.set", target: "p1", charKey: "profession", modifierKey: "experience", level: "expert" })).toThrow(/Возраст/);
    s = act(s, { type: "host.modifier.set", target: "p1", charKey: "profession", modifierKey: "experience", level: "novice" });
    expect(hand(s, "p1", "profession")[0].modifiers.experience).toBe("novice");
  });

  it("вылечить, чайлдфри, пол, телосложение, возраст", () => {
    let s = act(started(), { type: "host.cure", target: "p1", op: "healthy" });
    expect(hand(s, "p1", "health")[0].title).toBe("Идеально здоров");
    s = act(s, { type: "host.cure", target: "p1", op: "childfree" });
    expect(hand(s, "p1", "gender")[0].modifiers.childfree).toBe(true);
    const g = hand(s, "p1", "gender")[0].title;
    s = act(s, { type: "host.gender.flip", target: "p1" });
    expect(hand(s, "p1", "gender")[0].title).not.toBe(g);
    s = act(s, { type: "host.body", target: "all", title: "Хрупкое" });
    expect(s.game!.seatOrder.every((p) => hand(s, p, "body")[0].title === "Хрупкое")).toBe(true);
    s = act(s, { type: "host.ageGroup", target: "p1", group: "old" });
    expect(hand(s, "p1", "gender")[0].modifiers.age).toBeGreaterThanOrEqual(60);
  });

  it("перенос рюкзака в бункер и аннулирование", () => {
    const s0 = started();
    const item = hand(s0, "p1", "backpack")[0].title;
    let s = act(s0, { type: "host.char.toBunker", target: "p1", charKey: "backpack" });
    expect(s.game!.bunker.fields.items.some((v) => v.title.startsWith(item))).toBe(true);
    expect(hand(s, "p1", "backpack")[0].title).toBe("Пусто");
    s = act(s, { type: "host.nullify", charKey: "profession" });
    expect(s.game!.seatOrder.every((p) => hand(s, p, "profession")[0].title === "Пусто")).toBe(true);
    consistent(s);
  });

  it("бункер, места, катастрофа", () => {
    const s0 = started();
    let s = act(s0, { type: "host.seats", delta: 1 });
    expect(s.game!.bunker.seats).toBe(s0.game!.bunker.seats + 1);
    s = act(s, { type: "host.catastrophe.reroll" });
    expect(s.game!.catastrophe.title).not.toBe(s0.game!.catastrophe.title);
    s = act(s, { type: "host.bunker.set", field: "location", text: "На Луне" });
    expect(s.game!.bunker.fields.location[0].title).toBe("На Луне");
    s = act(s, { type: "host.bunker.addItem", text: "Танк" });
    expect(s.game!.bunker.fields.items.at(-1)!.title).toBe("Танк");
  });

  it("отмена возвращает предыдущее состояние", () => {
    const s0 = started();
    let s = act(s0, { type: "host.char.reroll", target: "all", charKey: "all" });
    s = act(s, { type: "host.undo" });
    expect(s.game).toEqual(s0.game);
    expect(() => act(s, { type: "host.undo" })).toThrow(/Нечего/);
  });

  it("сообщение и кубик видят только адресаты", () => {
    let s = act(started(), { type: "host.message", to: "p2", color: "red", title: "Тайно", text: "Только тебе" });
    s = act(s, { type: "host.dice", sides: 20 });
    expect(projectRoom(s, "p2", new Set(), 0).notices).toHaveLength(2);
    expect(projectRoom(s, "p1", new Set(), 0).notices.map((x) => x.title)).toEqual(["Кубик d20"]);
  });

  it("передача прав ведущего", () => {
    const s = act(started(), { type: "host.transfer", participantId: "p3" });
    expect(s.participants.find((p) => p.isHost)!.id).toBe("p3");
    expect(() => act(s, { type: "host.dice", sides: 6 })).toThrow(/только ведущий/);
  });

  it("история отмены не уходит клиентам", () => {
    const s = act(started(), { type: "host.revealAll" });
    expect(JSON.stringify(projectRoom(s, "p0", new Set(), 0))).not.toContain('"undo"');
  });
});
