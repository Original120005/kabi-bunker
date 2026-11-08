import { describe, expect, it } from "vitest";
import { applyAction, createRoom, joinRoom, projectRoom, type ActionContext, type RoomState } from "@bunker/engine";
import type { ClientAction } from "@bunker/shared";
import { baseContent } from "./test-content.ts";

const content = baseContent();
let n = 0;
const ctx = (actorId: string, now = 1000): ActionContext => ({ actorId, now, newId: () => `v${++n}`, loadContent: () => content });
const ALL = ["p0", "p1", "p2", "p3", "p4", "p5"];
const act = (s: RoomState, a: ClientAction, actor = "p0", now?: number) => applyAction(s, a, ctx(actor, now));

function started(): RoomState {
  let s = createRoom({ code: "VOTE1", hostId: "p0", tokenHash: "h0", nickname: "Ведущий", now: 0, seed: 5, packSlugs: ["base"] });
  for (let i = 1; i < 6; i++) s = joinRoom(s, { id: `p${i}`, tokenHash: `h${i}`, nickname: `Игрок ${i}`, now: i }).state;
  return applyAction(s, { type: "lobby.start" }, ctx("p0"));
}

describe("голосование", () => {
  it("закрывается автоматически, когда проголосовали все, и показывает результаты", () => {
    let s = act(started(), { type: "host.vote.start", candidates: ALL });
    const voters = s.vote!.voters;
    expect(voters).toHaveLength(6);
    for (const v of voters.slice(0, -1)) s = act(s, { type: "vote.cast", candidateId: v === "p1" ? "p2" : "p1" }, v);
    expect(s.vote!.status).toBe("open");

    const open = projectRoom(s, "p3", new Set(), 0).vote!;
    expect(open.results).toBeNull();
    expect(open.myVote).toBe("p1");
    expect(open.voted).toHaveLength(5);

    const last = voters.at(-1)!;
    s = act(s, { type: "vote.cast", candidateId: "p1" }, last);
    expect(s.vote!.status).toBe("closed");
    const results = projectRoom(s, "p4", new Set(), 0).vote!.results!;
    expect(results[0].candidateId).toBe("p1");
    expect(results[0].voters).toHaveLength(5);
    expect(s.game!.statuses.p1).toBe("alive");
  });

  it("проверяет голоса", () => {
    let s = act(started(), { type: "host.vote.start", candidates: ALL });
    expect(() => act(s, { type: "host.vote.start", candidates: ALL })).toThrow(/уже идёт/);
    expect(() => act(s, { type: "vote.cast", candidateId: "p1" }, "p1")).toThrow(/против себя/);
    s = act(s, { type: "vote.cast", candidateId: "p2" }, "p1");
    expect(() => act(s, { type: "vote.cast", candidateId: "p3" }, "p1")).toThrow(/уже проголосовали/);
    expect(() => act(s, { type: "vote.cast", candidateId: "nobody" }, "p2")).toThrow(/нельзя голосовать/);
    expect(() => act(s, { type: "host.vote.finish" }, "p1")).toThrow(/только ведущий/);
  });

  it("изгнанные не голосуют; ведущий может завершить досрочно и убрать результаты", () => {
    let s = act(started(), { type: "host.exile", playerId: "p5" });
    s = act(s, { type: "host.vote.start", candidates: ALL.slice(0, 5) });
    expect(s.vote!.voters).not.toContain("p5");
    expect(() => act(s, { type: "vote.cast", candidateId: "p1" }, "p5")).toThrow(/не участвуете/);
    s = act(s, { type: "vote.cast", candidateId: "p2" }, "p1");
    s = act(s, { type: "host.vote.finish" });
    expect(s.vote!.status).toBe("closed");
    expect(() => act(s, { type: "vote.cast", candidateId: "p2" }, "p3")).toThrow(/не идёт/);
    s = act(s, { type: "host.vote.clear" });
    expect(s.vote).toBeNull();
  });

  it("голосуют только против выставленных ведущим игроков", () => {
    let s = act(started(), { type: "host.vote.start", candidates: ["p1", "p2"] });
    expect(s.vote!.candidates).toEqual(["p1", "p2"]);
    expect(s.vote!.voters).toHaveLength(6);
    expect(() => act(s, { type: "vote.cast", candidateId: "p3" }, "p4")).toThrow(/нельзя голосовать/);
    s = act(s, { type: "vote.cast", candidateId: "p2" }, "p1");
    expect(s.vote!.ballots.p1).toBe("p2");

    let one = act(started(), { type: "host.vote.start", candidates: ["p3"] });
    expect(one.vote!.voters).not.toContain("p3");
    expect(one.vote!.voters).toHaveLength(5);

    const exiled = act(started(), { type: "host.exile", playerId: "p5" });
    expect(() => act(exiled, { type: "host.vote.start", candidates: ["p5", "p1"] })).toThrow(/только игроков в лагере/);
    expect(() => act(started(), { type: "host.vote.start", candidates: [] } as never)).toThrow();
  });

  it("отмена действия ведущего не трогает голосование", () => {
    let s = act(started(), { type: "host.seats", delta: 1 });
    s = act(s, { type: "host.vote.start", candidates: ALL });
    s = act(s, { type: "host.undo" });
    expect(s.vote?.status).toBe("open");
  });
});

describe("таймер", () => {
  it("запускается у всех, перезапускается и останавливается", () => {
    let s = act(started(), { type: "host.timer", seconds: 30 }, "p0", 5000);
    expect(projectRoom(s, "p2", new Set(), 0).timer).toEqual({ id: 5000, seconds: 30, endsAt: 35000 });
    s = act(s, { type: "host.timer", seconds: 15 }, "p0", 5000);
    expect(s.timer).toMatchObject({ id: 5001, endsAt: 20000 });
    expect(() => act(s, { type: "host.timer", seconds: 60 }, "p1")).toThrow(/только ведущий/);
    s = act(s, { type: "host.timer.stop" }, "p0", 7000);
    expect(s.timer).toBeNull();
    expect(() => act(s, { type: "host.timer.stop" })).toThrow(/не запущен/);
    expect(s.undo.at(-1)?.label ?? "").not.toMatch(/таймер/);
    s = act(s, { type: "host.timer", seconds: 15 }, "p0", 8000);
    expect(s.timer!.id).toBeGreaterThan(5001);
  });

  it("новое голосование после очистки получает новый номер", () => {
    let s = act(started(), { type: "host.vote.start", candidates: ALL }, "p0", 2000);
    const first = s.vote!.id;
    s = act(s, { type: "host.vote.clear" }, "p0", 2000);
    s = act(s, { type: "host.vote.start", candidates: ALL }, "p0", 3000);
    expect(s.vote!.id).toBeGreaterThan(first);
  });
});
