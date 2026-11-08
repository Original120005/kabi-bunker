import { describe, expect, it } from "vitest";
import { formatCardLabel, pluralRu } from "./format.ts";
import type { CharacteristicDef } from "./content.ts";

const gender: CharacteristicDef = {
  key: "gender", name: "Пол", sort: 1, contentType: "gender", revealable: true, specialCard: false, countPerPlayer: 1, onSteal: "regenerate", rotatable: true, enabled: true,
  modifiers: [
    { kind: "age", key: "age", min: 16, max: 85, groups: [{ key: "a", label: "Взрослый", min: 35, max: 59 }] },
    { kind: "flag", key: "childfree", chance: 0.1, label: "ч/ф" },
  ],
};

describe("format", () => {
  it("склоняет «год»", () => {
    expect([1, 2, 5, 11, 21, 22, 47].map((n) => pluralRu(n, "год", "года", "лет"))).toEqual(["год", "года", "лет", "лет", "год", "года", "лет"]);
  });

  it("собирает подпись карты как в оригинале", () => {
    expect(formatCardLabel(gender, "Мужчина", { age: 47, childfree: false })).toBe("Мужчина 47 лет (Взрослый)");
    expect(formatCardLabel(gender, "Женщина", { age: 41, childfree: true })).toBe("Женщина 41 год (Взрослый) ·\u00a0ч/\u2060ф");
  });
});
