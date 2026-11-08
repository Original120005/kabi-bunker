import { describe, expect, it } from "vitest";
import type { ContentItem } from "@bunker/shared";
import { Picker } from "./generation.ts";
import { Rng } from "./rng.ts";

function disease(title: string, weight = 1): ContentItem {
  return {
    id: `health:${title}`,
    packId: "p",
    type: "health",
    title,
    description: "",
    weight,
    tags: title === "Идеально здоров" ? ["health:none"] : [],
    constraints: [],
    modifierRules: { disable: [], allowedLevels: {}, ranges: {} },
    abilities: [],
    data: {},
  };
}

describe("здоровье", () => {
  it("около 30% карт — «Идеально здоров», остальные болезни делятся поровну", () => {
    const pool = [[disease("Идеально здоров", 50), disease("Кашель", 0.1), disease("Мигрень", 9)]];
    const rng = new Rng(7);
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const title = new Picker({ health: pool }, rng).pick("health")!.title;
      counts.set(title, (counts.get(title) ?? 0) + 1);
    }
    expect(counts.get("Идеально здоров")! / 4000).toBeGreaterThan(0.26);
    expect(counts.get("Идеально здоров")! / 4000).toBeLessThan(0.34);
    const cough = counts.get("Кашель")!;
    const migraine = counts.get("Мигрень")!;
    expect(Math.abs(cough - migraine) / 4000).toBeLessThan(0.04);
  });

  it("«Идеально здоров» может выпасть нескольким игрокам подряд", () => {
    const picker = new Picker({ health: [[disease("Идеально здоров"), disease("Кашель")]] }, new Rng(1));
    const titles: string[] = [];
    for (let i = 0; i < 40; i++) titles.push(picker.pick("health")!.title);
    expect(titles.filter((t) => t === "Идеально здоров").length).toBeGreaterThan(1);
  });
});
