import { describe, expect, it } from "vitest";
import type { ContentDb, ContentItem } from "@bunker/shared";
import { applyAction, createRoom, joinRoom, players } from "./room.ts";
import { projectRoom } from "./projection.ts";
import type { ActionContext, RoomState } from "./types.ts";

function item(type: string, title: string, extra: Partial<ContentItem> = {}): ContentItem {
  return { id: `${type}:${title}`, packId: "p", type, title, description: `описание ${title}`, weight: 1, tags: [], constraints: [], modifierRules: { disable: [], allowedLevels: {}, ranges: {} }, abilities: [], data: {}, ...extra };
}

const content: ContentDb = {
  characteristics: [
    {
      key: "gender", name: "Пол", sort: 1, contentType: "gender", revealable: true, specialCard: false, countPerPlayer: 1, onSteal: "regenerate", rotatable: true, enabled: true,
      modifiers: [{ kind: "age", key: "age", min: 16, max: 85, groups: [{ key: "y", label: "Молодой", min: 16, max: 34 }, { key: "a", label: "Взрослый", min: 35, max: 59 }, { key: "o", label: "Пожилой", min: 60, max: 85 }] }],
    },
    {
      key: "profession", name: "Профессия", sort: 2, contentType: "profession", revealable: true, specialCard: false, countPerPlayer: 1, onSteal: "empty", rotatable: true, enabled: true,
      modifiers: [{ kind: "scale", key: "experience", ageBound: true, format: "({label})", levels: [{ key: "n", label: "Новичок", minYears: 0 }, { key: "e", label: "Эксперт", minYears: 10 }] }],
    },
    { key: "special", name: "Спец. возможность", sort: 3, contentType: "special", revealable: true, specialCard: true, countPerPlayer: 2, onSteal: "regenerate", rotatable: false, enabled: true, modifiers: [] },
  ],
  bunkerFields: [{ key: "items", name: "Предметы", sort: 1, contentType: "bunkerItem", count: 2, placement: "list", enabled: true }],
  pools: {
    gender: [[item("gender", "Мужчина"), item("gender", "Женщина")]],
    profession: [Array.from({ length: 20 }, (_, i) => item("profession", `Профессия-${i}`, { abilities: [{ name: "Проф. возможность", text: `[секрет-${i}]`, kind: "active" }] }))],
    special: [Array.from({ length: 30 }, (_, i) => item("special", `Карта-${i}`))],
    catastrophe: [[item("catastrophe", "Потоп", { data: { population: 1000 } })]],
    bunkerItem: [[item("bunkerItem", "Радио"), item("bunkerItem", "Генератор"), item("bunkerItem", "Аптечка")]],
  },
};

let idCounter = 0;
const ctx = (actorId: string): ActionContext => ({ actorId, now: 1000, newId: () => `id${++idCounter}`, loadContent: () => content });

function roomWith(n: number): RoomState {
  let state = createRoom({ code: "ABCDE", hostId: "p0", tokenHash: "h0", nickname: "Ведущий", now: 0, seed: 42, packSlugs: ["base"] });
  for (let i = 1; i < n; i++) state = joinRoom(state, { id: `p${i}`, tokenHash: `h${i}`, nickname: `Игрок ${i}`, now: i }).state;
  return state;
}

describe("лобби", () => {
  it("переподключение по токену не создаёт нового участника", () => {
    const state = roomWith(3);
    const again = joinRoom(state, { id: "new", tokenHash: "h1", nickname: "Другое имя", now: 5 });
    expect(again.changed).toBe(false);
    expect(again.participantId).toBe("p1");
  });

  it("одинаковые ники получают номер", () => {
    let state = roomWith(1);
    state = joinRoom(state, { id: "x", tokenHash: "hx", nickname: "Ведущий", now: 1 }).state;
    expect(state.participants[1].nickname).toBe("Ведущий 2");
  });

  it("нельзя начать меньше чем с 6 игроками", () => {
    expect(() => applyAction(roomWith(5), { type: "lobby.start" }, ctx("p0"))).toThrow(/минимум 6/);
  });

  it("только ведущий начинает игру", () => {
    expect(() => applyAction(roomWith(6), { type: "lobby.start" }, ctx("p1"))).toThrow(/только ведущий/);
  });

  it("заблокированный не может вернуться", () => {
    const state = applyAction(roomWith(6), { type: "lobby.kick", participantId: "p2", ban: true }, ctx("p0"));
    expect(state.participants.some((p) => p.id === "p2")).toBe(false);
    expect(() => joinRoom(state, { id: "z", tokenHash: "h2", nickname: "Снова", now: 9 })).toThrow(/запретил/);
  });

  it("при выходе ведущего права переходят старейшему участнику", () => {
    const state = applyAction(roomWith(3), { type: "lobby.leave" }, ctx("p0"));
    expect(state.participants.find((p) => p.isHost)?.id).toBe("p1");
  });

  it("проверка готовности с автостартом запускает игру", () => {
    let state = applyAction(roomWith(6), { type: "lobby.setAutoStart", value: true }, ctx("p0"));
    state = applyAction(state, { type: "lobby.startReadyCheck" }, ctx("p0"));
    for (let i = 0; i < 6; i++) state = applyAction(state, { type: "lobby.setReady", ready: true }, ctx(`p${i}`));
    expect(state.status).toBe("playing");
  });

  it("ведущий-зритель не получает персонажа", () => {
    let state = roomWith(7);
    state = applyAction(state, { type: "lobby.setHostPlays", value: false }, ctx("p0"));
    state = applyAction(state, { type: "lobby.start" }, ctx("p0"));
    expect(players(state)).toHaveLength(6);
    expect(state.game!.seatOrder).not.toContain("p0");
  });

  it("редьюсер не меняет предыдущее состояние", () => {
    const before = roomWith(6);
    const copy = structuredClone(before);
    applyAction(before, { type: "lobby.start" }, ctx("p0"));
    expect(before).toEqual(copy);
  });
});

describe("раздача", () => {
  const started = () => applyAction(roomWith(8), { type: "lobby.start" }, ctx("p0"));

  it("у каждого игрока полный набор карт и 2 разные спец. карты", () => {
    const game = started().game!;
    expect(game.bunker.seats).toBe(4);
    for (const id of game.seatOrder) {
      const hand = game.hands[id];
      expect(hand.gender).toHaveLength(1);
      expect(hand.profession).toHaveLength(1);
      expect(hand.special).toHaveLength(2);
      const [a, b] = hand.special.map((cid) => game.cards[cid].contentId);
      expect(a).not.toBe(b);
    }
  });

  it("профессии не повторяются, пока хватает пула", () => {
    const game = started().game!;
    const ids = game.seatOrder.map((id) => game.cards[game.hands[id].profession[0]].contentId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("стаж не превышает возраст минус 16 лет", () => {
    for (let seed = 0; seed < 30; seed++) {
      const state = roomWith(6);
      state.rngState = seed;
      const game = applyAction(state, { type: "lobby.start" }, ctx("p0")).game!;
      for (const id of game.seatOrder) {
        const age = game.cards[game.hands[id].gender[0]].modifiers.age as number;
        const exp = game.cards[game.hands[id].profession[0]].modifiers.experience;
        if (exp === "e") expect(age - 16).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("одинаковое зерно даёт одинаковую раздачу", () => {
    const a = started().game!;
    const b = started().game!;
    expect(a.seatOrder).toEqual(b.seatOrder);
    const titles = (g: typeof a) => g.seatOrder.map((id) => g.cards[g.hands[id].profession[0]].title);
    expect(titles(a)).toEqual(titles(b));
  });
});

describe("проекция", () => {
  it("закрытые карты других игроков не попадают в данные клиента", () => {
    let state = applyAction(roomWith(6), { type: "lobby.start" }, ctx("p0"));
    const game = state.game!;
    const p1Gender = game.hands.p1.gender[0];
    state = applyAction(state, { type: "card.setRevealed", cardId: p1Gender, revealed: true }, ctx("p1"));
    const online = new Set<string>();

    for (const viewer of state.participants) {
      const view = projectRoom(state, viewer.id, online, 0);
      const json = JSON.stringify(view);
      expect(json).not.toContain("rngState");
      expect(json).not.toContain("tokenHash");
      for (const card of Object.values(state.game!.cards)) {
        if (card.contentId) expect(json).not.toContain(card.contentId);
        const visible = card.ownerId === viewer.id || card.revealed;
        if (visible) continue;
        const projected = view.game!.players.flatMap((p) => Object.values(p.cards).flat()).find((c) => c.id === card.id);
        expect(projected).toEqual({ id: card.id, charKey: card.charKey, hidden: true });
        for (const a of card.abilities) expect(json).not.toContain(a.text);
      }
    }

    const p2View = projectRoom(state, "p2", online, 0);
    const p1 = p2View.game!.players.find((p) => p.id === "p1")!;
    expect(p1.cards.gender[0].hidden).toBe(false);
    expect(p1.cards.profession[0]).toEqual({ id: game.hands.p1.profession[0], charKey: "profession", hidden: true });
  });

  it("свои закрытые карты видны владельцу", () => {
    const state = applyAction(roomWith(6), { type: "lobby.start" }, ctx("p0"));
    const view = projectRoom(state, "p3", new Set(), 0);
    const me = view.game!.players.find((p) => p.id === "p3")!;
    expect(me.cards.profession[0].hidden).toBe(false);
  });

  it("чужую карту открыть нельзя, скрыть может только ведущий", () => {
    const state = applyAction(roomWith(6), { type: "lobby.start" }, ctx("p0"));
    const card = state.game!.hands.p1.profession[0];
    expect(() => applyAction(state, { type: "card.setRevealed", cardId: card, revealed: true }, ctx("p2"))).toThrow(/свои карты/);
    const opened = applyAction(state, { type: "card.setRevealed", cardId: card, revealed: true }, ctx("p1"));
    expect(() => applyAction(opened, { type: "card.setRevealed", cardId: card, revealed: false }, ctx("p1"))).toThrow(/ведущий/);
    expect(applyAction(opened, { type: "card.setRevealed", cardId: card, revealed: false }, ctx("p0")).game!.cards[card].revealed).toBe(false);
  });

  it("список заблокированных видит только ведущий", () => {
    const state = applyAction(roomWith(6), { type: "lobby.kick", participantId: "p5", ban: true }, ctx("p0"));
    expect(projectRoom(state, "p0", new Set(), 0).banned).toHaveLength(1);
    expect(projectRoom(state, "p1", new Set(), 0).banned).toHaveLength(0);
  });
});

describe("аккаунт и итоги партии", () => {
  it("один профиль — один участник, даже с новым токеном", () => {
    let state = joinRoom(roomWith(1), { id: "a", tokenHash: "ha", nickname: "Дима", now: 1, profileId: "d1", avatarUrl: "http://a" }).state;
    const again = joinRoom(state, { id: "b", tokenHash: "hb", nickname: "Новый Дима", now: 2, profileId: "d1", avatarUrl: "http://b" });
    expect(again.participantId).toBe("a");
    expect(again.changed).toBe(true);
    const person = again.state.participants.find((p) => p.id === "a")!;
    expect(person.nickname).toBe("Новый Дима");
    expect(person.avatarUrl).toBe("http://b");
    expect(again.state.participants.filter((p) => p.profileId === "d1")).toHaveLength(1);
    state = applyAction(again.state, { type: "lobby.kick", participantId: "a", ban: true }, ctx("p0"));
    expect(() => joinRoom(state, { id: "c", tokenHash: "hc", nickname: "Дима", now: 3, profileId: "d1", avatarUrl: null })).toThrow(/запретил/);
  });

  it("итоги: бункер +20 (+10, если выжил), первый изгнанный −20, второй −10, гибель 0, повторно нельзя", () => {
    let state = applyAction(roomWith(6), { type: "lobby.start" }, ctx("p0"));
    state.participants[1].profileId = "prof1";
    state = applyAction(state, { type: "host.exile", playerId: "p1" }, ctx("p0"));
    state = applyAction(state, { type: "host.exile", playerId: "p2" }, ctx("p0"));
    state = applyAction(state, { type: "host.return", playerId: "p1" }, ctx("p0"));
    state = applyAction(state, { type: "host.exile", playerId: "p3" }, ctx("p0"));
    state.game!.statuses.p4 = "dead";
    state = applyAction(state, { type: "host.finish" }, ctx("p0"));
    const rows = Object.fromEntries(state.game!.settlement!.rows.map((r) => [r.playerId, r]));
    const inside = state.game!.settlement!.finale!.survived ? 30 : 20;
    expect(rows.p2).toMatchObject({ outcome: "firstOut", delta: -20 });
    expect(rows.p3).toMatchObject({ outcome: "secondOut", delta: -10 });
    expect(rows.p1).toMatchObject({ outcome: "bunker", delta: inside, profileId: "prof1" });
    expect(rows.p0).toMatchObject({ outcome: "bunker", delta: inside });
    expect(rows.p4).toMatchObject({ outcome: "none", delta: 0 });
    expect(rows.p5).toMatchObject({ outcome: "bunker", delta: inside });
    expect(state.game!.statuses.p0).toBe("inBunker");
    expect(state.game!.statuses.p4).toBe("dead");
    expect(projectRoom(state, "p0", new Set(), 0).game!.settled).toBe(true);
    expect(() => applyAction(state, { type: "host.finish" }, ctx("p0"))).toThrow(/уже/);
    expect(() => applyAction(state, { type: "host.undo" }, ctx("p0"))).toThrow(/нельзя/);
    expect(() => applyAction(state, { type: "host.exile", playerId: "p5" }, ctx("p0"))).toThrow(/завершена/);
    const restarted = applyAction(state, { type: "host.restart" }, ctx("p0"));
    expect(restarted.game!.settlement).toBeNull();
    expect(restarted.game!.statuses.p0).toBe("alive");
  });
});
