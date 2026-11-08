import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { advanceRoom, applyAction, BUNKER_EVENTS, createRoom, joinRoom, lootPool, nextWakeAt, projectRoom, survivalChance, type ActionContext, type RoomState } from "@bunker/engine";
import { RAID, type ClientAction } from "@bunker/shared";
import { baseContent } from "./test-content.ts";

const content = baseContent();
let n = 0;
const newId = () => `r${++n}`;
const ctx = (actorId: string, now: number): ActionContext => ({ actorId, now, newId, loadContent: () => content });
const act = (s: RoomState, a: ClientAction, actor = "p0", now = 1000) => applyAction(s, a, ctx(actor, now));

function started(seed = 5): RoomState {
  let s = createRoom({ code: "RAID1", hostId: "p0", tokenHash: "h0", nickname: "Ведущий", now: 0, seed, packSlugs: ["base"] });
  for (let i = 1; i < 6; i++) s = joinRoom(s, { id: `p${i}`, tokenHash: `h${i}`, nickname: `Игрок ${i}`, now: i }).state;
  return applyAction(s, { type: "lobby.start" }, ctx("p0", 500));
}

/** Runs every due time-driven transition up to `until`, the way the server timer does. */
function runUntil(s: RoomState, until: number, stop?: (s: RoomState) => boolean): RoomState {
  for (let guard = 0; guard < 100; guard++) {
    if (stop?.(s)) return s;
    const at = nextWakeAt(s);
    if (at === null || at > until) return s;
    s = advanceRoom(s, { now: at, newId });
  }
  throw new Error("слишком много переходов");
}

function away(volunteers = ["p1", "p2"], seed = 5): RoomState {
  let s = act(started(seed), { type: "host.raid.start" });
  for (const id of volunteers) s = act(s, { type: "raid.answer", yes: true }, id, 2000);
  s = act(s, { type: "raid.answer", yes: false }, "p3", 2000);
  return runUntil(s, Infinity, (x) => x.raid?.stage === "away");
}

function returned(rngState: number): RoomState {
  let s = away();
  s = { ...s, rngState };
  s = act(s, { type: "host.raid.return" }, "p0", 100_000);
  return runUntil(s, Infinity, (x) => x.raid?.stage === "done");
}

/** Seeds of the return roll for each outcome: death, and survival with 1…5 items. */
const outcomes = new Map<string, number>();
for (let seed = 1; outcomes.size < 6 && seed < 5000; seed++) {
  const s = returned(seed);
  const key = s.raid!.survived ? `loot${s.raid!.loot.length}` : "dead";
  if (!outcomes.has(key)) outcomes.set(key, seed);
}

describe("вылазка", () => {
  it("в базе есть предметы всех пяти уровней с полными данными", () => {
    const pool = lootPool(content);
    for (const tier of [1, 2, 3, 4, 5]) expect(pool.filter((e) => e.loot.tier === tier).length).toBeGreaterThanOrEqual(10);
    for (const { loot } of pool) {
      expect(loot.title && loot.description && loot.category && loot.rarity && loot.icon).toBeTruthy();
      expect(loot.value).toBeGreaterThanOrEqual(0);
      expect(loot.image).toMatch(/^\/images\/raid\//);
      expect(existsSync(path.join(path.resolve(import.meta.dirname, "../../../.."), "apps/web/public", loot.image!.slice(1)))).toBe(true);
    }
  });

  it("голосование: один ответ на игрока, ровно 30 секунд, только ведущий запускает", () => {
    expect(() => act(started(), { type: "host.raid.start" }, "p1")).toThrow(/только ведущий/i);
    let s = act(started(), { type: "host.raid.start" });
    expect(s.raid!.votingEndsAt - 1000).toBe(RAID.voteMs);
    expect(() => act(s, { type: "host.raid.start" })).toThrow(/уже идёт/);
    s = act(s, { type: "raid.answer", yes: true }, "p1", 2000);
    expect(() => act(s, { type: "raid.answer", yes: false }, "p1", 2100)).toThrow(/уже ответили/);
    expect(() => act(s, { type: "raid.answer", yes: true }, "p2", 1000 + RAID.voteMs)).toThrow(/не идёт/);
    expect(advanceRoom(s, { now: 1000 + RAID.voteMs - 1, newId })).toBe(s);

    const view = projectRoom(s, "p2", new Set(), 2000).raid!;
    expect(view.volunteers).toEqual(["p1"]);
    expect(view.myAnswer).toBeNull();
    expect(projectRoom(s, "p1", new Set(), 2000).raid!.myAnswer).toBe(true);
  });

  it("никто не согласился — вылазка отменяется и сама исчезает", () => {
    let s = act(started(), { type: "host.raid.start" });
    s = act(s, { type: "raid.answer", yes: false }, "p1", 2000);
    s = advanceRoom(s, { now: 1000 + RAID.voteMs, newId });
    expect(s.raid!.stage).toBe("cancelled");
    expect(s.raid!.playerId).toBeNull();
    s = advanceRoom(s, { now: 1000 + RAID.voteMs + RAID.cancelledMs, newId });
    expect(s.raid).toBeNull();
  });

  it("рулетка выбирает одного из согласившихся; изгнанный во время сбора не участвует", () => {
    let s = act(started(), { type: "host.raid.start" });
    for (const id of ["p1", "p2", "p4"]) s = act(s, { type: "raid.answer", yes: true }, id, 2000);
    s = act(s, { type: "host.exile", playerId: "p4" }, "p0", 3000);
    s = advanceRoom(s, { now: 1000 + RAID.voteMs, newId });
    const r = s.raid!;
    expect(r.stage).toBe("picking");
    expect(["p1", "p2"]).toContain(r.playerId);
    expect(r.pick!.reel[RAID.reelWinIndex]).toBe(r.playerId);
    expect(r.pick!.reel.every((id) => id === "p1" || id === "p2")).toBe(true);
    expect(r.pick!.at).toBeGreaterThan(1000 + RAID.voteMs);
    expect(projectRoom(s, "p3", new Set(), r.pick!.at + 100).raid!.playerId).toBeNull();
    expect(projectRoom(s, "p3", new Set(), r.pick!.at + RAID.pickSpinMs).raid!.playerId).toBe(r.playerId);
    s = runUntil(s, Infinity, (x) => x.raid?.stage === "away");
    expect(s.raid!.stage).toBe("away");
    expect(nextWakeAt(s)).toBeNull();
  });

  it("игрока на вылазке нельзя изгнать и выставить на голосование", () => {
    const s = away();
    const id = s.raid!.playerId!;
    expect(() => act(s, { type: "host.exile", playerId: id })).toThrow(/на вылазке/);
    expect(() => act(s, { type: "host.vote.start", candidates: [id] })).toThrow(/на вылазке/);
    const other = ["p1", "p2", "p3"].find((p) => p !== id)!;
    expect(() => act(s, { type: "host.vote.start", candidates: [other] })).not.toThrow();
    const voting = act(started(), { type: "host.raid.start" });
    expect(() => act(voting, { type: "host.vote.start", candidates: ["p1"] })).toThrow(/вылазки/);
  });

  it("шанс выживания: 60% и модификаторы телосложения, возраста и здоровья, в пределах 0–100", () => {
    const s = started();
    const game = s.game!;
    const card = (key: string) => game.cards[game.hands.p1[key][0]];
    card("body").title = "Атлетическое";
    card("gender").modifiers.age = 30;
    card("health").title = "Идеально здоров";
    expect(survivalChance(game, "p1").chance).toBe(85);

    card("body").title = "Хрупкое";
    card("gender").modifiers.age = 70;
    card("health").title = "Астма";
    card("health").contentId = "x";
    card("health").modifiers.severity = "critical";
    const bad = survivalChance(game, "p1");
    expect(bad.chance).toBe(30);
    expect(bad.modifiers.map((m) => m.delta)).toEqual([-10, -10, -10]);

    card("gender").modifiers.age = 60;
    card("health").modifiers.severity = "heavy";
    expect(survivalChance(game, "p1").chance).toBe(40);
    card("gender").modifiers.age = 16;
    card("body").title = "Ожирение-слабое";
    expect(survivalChance(game, "p1").chance).toBe(45);
  });

  it("результаты не уходят клиентам раньше анимации", () => {
    let s = away();
    s = act(s, { type: "host.raid.return" }, "p0", 100_000);
    expect(projectRoom(s, "p1", new Set(), 100_000).raid!.steps).toHaveLength(0);
    expect(projectRoom(s, "p1", new Set(), 100_000).raid!.survived).toBeNull();
    expect(projectRoom(s, "p0", new Set(), 100_000).raid!.loot).toEqual([]);
    s = advanceRoom(s, { now: s.raid!.steps[0].at, newId });
    const v = projectRoom(s, "p1", new Set(), 0).raid!;
    expect(v.steps).toHaveLength(1);
    expect(v.steps[0].kind).toBe("survival");
    expect(v.survived).toBeNull();
    expect(() => act(s, { type: "host.raid.return" }, "p0", 100_001)).toThrow(/никто не на вылазке/);
    expect(() => act(s, { type: "host.raid.cancel" })).toThrow(/разыгрываются/);
  });

  it("смерть: игрок погибает и не получает предметов", () => {
    const seed = outcomes.get("dead")!;
    expect(seed).toBeDefined();
    const before = away();
    const id = before.raid!.playerId!;
    const s = returned(seed);
    expect(s.raid!.stage).toBe("done");
    expect(s.raid!.loot).toEqual([]);
    expect(s.raid!.steps.map((x) => x.kind)).toEqual(["survival"]);
    expect(s.game!.statuses[id]).toBe("dead");
    const titles = (x: RoomState) => x.game!.hands[id].backpack.map((c) => x.game!.cards[c].title);
    expect(titles(s)).toEqual(titles(before));
    expect(projectRoom(s, "p3", new Set(), 0).raid!.survived).toBe(false);
    expect(() => act(s, { type: "host.exile", playerId: id })).toThrow();
  });

  for (const count of [1, 2, 3, 4, 5]) {
    it(`выжил и нашёл ${count} шт.: предметы в рюкзаке у всех на виду, поиск остановился на промахе`, () => {
      const seed = outcomes.get(`loot${count}`)!;
      expect(seed).toBeDefined();
      const s = returned(seed);
      const r = s.raid!;
      const id = r.playerId!;
      expect(r.survived).toBe(true);
      expect(r.loot).toHaveLength(count);
      expect(r.loot[0].tier).toBe(3);
      expect(r.loot.slice(1).map((l) => l.tier)).toEqual([2, 3, 4, 5].slice(0, count - 1));
      const firstSpin = r.steps.find((s) => s.kind === "item");
      if (firstSpin?.kind === "item") expect(firstSpin.reel.every((it) => it.tier === 3)).toBe(true);
      expect(new Set(r.loot.map((l) => l.id)).size).toBe(count);

      const chances = r.steps.filter((x) => x.kind === "chance");
      expect(chances.filter((c) => c.success)).toHaveLength(count - 1);
      if (count < 5) expect(chances.at(-1)!.success).toBe(false);
      for (const step of r.steps) if (step.kind === "item") expect(step.reel[RAID.reelWinIndex].id).toBe(step.item.id);
      expect(r.steps.map((x) => x.at)).toEqual([...r.steps.map((x) => x.at)].sort((a, b) => a - b));

      expect(s.game!.statuses[id]).toBe("alive");
      const cards = s.game!.hands[id].backpack.map((cid) => s.game!.cards[cid]);
      for (const l of r.loot) expect(cards.some((c) => c.title === l.title && c.revealed)).toBe(true);
      expect(cards.some((c) => c.title === "Пусто")).toBe(false);
      const seen = projectRoom(s, "p3", new Set(), 0).game!.players.find((p) => p.id === id)!.cards.backpack;
      for (const l of r.loot) expect(seen.some((c) => !c.hidden && c.title === l.title)).toBe(true);

      expect(s.undo.at(-1)!.label).toMatch(/Итог вылазки/);
      const cleared = act(s, { type: "host.raid.clear" });
      expect(cleared.raid).toBeNull();
      expect(advanceRoom(s, { now: Number.MAX_SAFE_INTEGER, newId })).toBe(s);
    });
  }

  it("итог можно отменить, как любое действие ведущего", () => {
    const seed = outcomes.get("dead")!;
    const s = returned(seed);
    const id = s.raid!.playerId!;
    const undone = act(s, { type: "host.undo" });
    expect(undone.game!.statuses[id]).toBe("alive");
  });

  it("перезапуск сервера и переподключение: состояние сохраняется, пропущенные этапы догоняются без повторов", () => {
    const seed = outcomes.get("loot3")!;
    let s = away();
    s = { ...s, rngState: seed };
    s = act(s, { type: "host.raid.return" }, "p0", 100_000);
    s = advanceRoom(s, { now: s.raid!.steps[1].at, newId });
    const restored = JSON.parse(JSON.stringify(s)) as RoomState;
    const viewMid = projectRoom(restored, "p2", new Set(), 0).raid!;
    expect(viewMid.steps).toHaveLength(2);

    const late = advanceRoom(restored, { now: restored.raid!.endsAt! + 60_000, newId });
    expect(late.raid!.stage).toBe("done");
    expect(late.raid!.loot).toHaveLength(3);
    const id = late.raid!.playerId!;
    const titles = late.game!.hands[id].backpack.map((c) => late.game!.cards[c].title);
    for (const l of late.raid!.loot) expect(titles.filter((t) => t === l.title)).toHaveLength(1);
    expect(advanceRoom(late, { now: late.raid!.endsAt! + 120_000, newId })).toBe(late);
    expect(late.undo.filter((u) => u.label.startsWith("Итог вылазки"))).toHaveLength(1);
  });

  it("ивент видят все и он не повторяется до конца списка", () => {
    let s = started(1);
    const titles = new Set<string>();
    for (let i = 0; i < BUNKER_EVENTS.length; i++) {
      const now = 20_000 * (i + 1);
      s = act(s, { type: "host.event" }, "p0", now);
      expect(titles.has(s.event!.title)).toBe(false);
      titles.add(s.event!.title);
      const shown = projectRoom(s, "p2", new Set(["p2"]), now).event!;
      expect(shown.title).toBe(s.event!.title);
      expect(shown.text).toBe(s.event!.text);
      expect(shown.spin?.reel[RAID.reelWinIndex] ?? null).toBe(s.event!.spin?.winnerId ?? null);
      if (s.event?.spin && !s.event.spin.applied) s = advanceRoom(s, { now: s.event.spin.at + RAID.pickSpinMs, newId });
    }
    expect(titles.size).toBe(BUNKER_EVENTS.length);
    const again = act(s, { type: "host.event" }, "p0", 20_000 * (BUNKER_EVENTS.length + 3));
    expect(BUNKER_EVENTS.some((e) => e.title === again.event!.title)).toBe(true);
    expect(again.eventUsed).toEqual([BUNKER_EVENTS.find((e) => e.title === again.event!.title)!.key]);
    const restarted = act(again, { type: "host.restart" }, "p0", 20_000 * (BUNKER_EVENTS.length + 4));
    expect(restarted.event).toBeNull();
    expect(restarted.eventUsed.length).toBe(1);
  });

  it("рулетка ивента пишет болезнь второй строкой и не берёт игрока с вылазки", () => {
    let s = away();
    const raider = s.raid!.playerId!;
    for (let i = 0; i < 80 && s.event?.spin?.effect.kind !== "health"; i++) {
      s = act(s, { type: "host.event" }, "p0", 100_000 + i * 20_000);
      if (s.event?.spin && s.event.spin.effect.kind !== "health") s = advanceRoom(s, { now: s.event.spin.at + RAID.pickSpinMs, newId });
    }
    const spin = s.event!.spin!;
    expect(spin.effect.kind).toBe("health");
    expect(spin.winnerId).not.toBe(raider);
    expect(spin.reel.includes(raider)).toBe(false);
    expect(spin.reel[RAID.reelWinIndex]).toBe(spin.winnerId);
    const before = [...s.game!.hands[spin.winnerId].health];
    const settled = advanceRoom(s, { now: spin.at + RAID.pickSpinMs, newId });
    const health = settled.game!.hands[spin.winnerId].health;
    expect(health.slice(0, before.length)).toEqual(before);
    expect(health).toHaveLength(before.length + 1);
    expect(settled.game!.cards[health[health.length - 1]].title).toBe(spin.effect.title);
    expect(settled.game!.cards[health[health.length - 1]].revealed).toBe(true);

    let quiet = started(4);
    for (let i = 0; i < 40 && !quiet.event?.spin; i++) quiet = act(quiet, { type: "host.event" }, "p0", 300_000 + i * 20_000);
    expect(quiet.event?.spin?.applied).toBe(false);
    expect(() => act(quiet, { type: "host.raid.start" }, "p0", quiet.event!.spin!.at + 10)).toThrow(/рулетки/);
  });

  it("ивент не перекрывает рулетку вылазки", () => {
    const s = act(started(), { type: "host.raid.start" });
    expect(() => act(s, { type: "host.event" })).toThrow(/вылазки/);
  });

  it("ведущий может отменить вылазку, а «Начать заново» её сбрасывает", () => {
    let s = away();
    s = act(s, { type: "host.raid.cancel" });
    expect(s.raid).toBeNull();
    s = act(away(), { type: "host.restart" });
    expect(s.raid).toBeNull();
  });
});
