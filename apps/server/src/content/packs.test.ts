import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyAction, createRoom, joinRoom, projectRoom } from "@bunker/engine";
import type { ContentDb } from "@bunker/shared";
import { PACKS_DIR } from "../paths.ts";
import { readPackDir } from "./packs.ts";

const base = readPackDir(path.join(PACKS_DIR, "base"));

function toContentDb(): ContentDb {
  const pools: ContentDb["pools"] = {};
  base.items.forEach(({ type, item }, i) => {
    (pools[type] ??= [[]])[0].push({ id: `c${i}`, packId: "base", type, ...item });
  });
  return { characteristics: base.definitions.characteristics, bunkerFields: base.definitions.bunkerFields, pools };
}

describe("базовый пак", () => {
  it("проходит проверку формата и содержит 318 профессий", () => {
    expect(base.items.filter((i) => i.type === "profession")).toHaveLength(318);
  });

  it("у каждой характеристики и поля бункера есть хотя бы один элемент", () => {
    const types = new Set(base.items.map((i) => i.type));
    for (const c of base.definitions.characteristics) expect(types, c.key).toContain(c.contentType);
    for (const f of base.definitions.bunkerFields) expect(types, f.key).toContain(f.contentType);
    expect(types).toContain("catastrophe");
  });

  it("раздаёт 15 игрокам без утечек закрытых карт", () => {
    const content = toContentDb();
    let state = createRoom({ code: "TEST1", hostId: "p0", tokenHash: "h0", nickname: "Ведущий", now: 0, seed: 7, packSlugs: ["base"] });
    for (let i = 1; i < 15; i++) state = joinRoom(state, { id: `p${i}`, tokenHash: `h${i}`, nickname: `Игрок ${i}`, now: i }).state;
    let n = 0;
    state = applyAction(state, { type: "lobby.start" }, { actorId: "p0", now: 1, newId: () => `card${++n}`, loadContent: () => content });
    const game = state.game!;
    expect(game.bunker.seats).toBe(7);
    expect(game.catastrophe.population).toBeGreaterThan(0);

    for (const viewer of state.participants) {
      const view = projectRoom(state, viewer.id, new Set(), 0);
      for (const p of view.game!.players) {
        for (const cards of Object.values(p.cards)) {
          for (const c of cards) expect(c.hidden).toBe(p.id !== viewer.id);
        }
      }
    }
  });
});
