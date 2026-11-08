import type { CharacteristicDef, ModifierDef } from "./content.ts";

export type ModifierValues = Record<string, number | string | boolean>;

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}

export function ageGroupOf(def: Extract<ModifierDef, { kind: "age" }>, age: number) {
  return def.groups.find((g) => age >= g.min && age <= g.max);
}

function renderModifier(def: ModifierDef, value: number | string | boolean | undefined): string {
  if (value === undefined) return "";
  switch (def.kind) {
    case "age": {
      const age = Number(value);
      const group = ageGroupOf(def, age);
      return `${age} ${pluralRu(age, "год", "года", "лет")}${group ? ` (${group.label})` : ""}`;
    }
    case "range":
      return def.format.replace("{n}", String(value));
    case "scale": {
      const level = def.levels.find((l) => l.key === value);
      return level ? def.format.replace("{label}", level.label) : "";
    }
    case "flag":
      // Non-breaking characters keep short flags such as «ч/ф» on one line.
      return value === true ? `·\u00a0${def.label.replace(/ /g, "\u00a0").replace(/\//g, "/\u2060")}` : "";
  }
}

/** Human-readable card text, e.g. «Мужчина 47 лет (Взрослый)» or «Сушист (Эксперт)». */
export function formatCardLabel(def: CharacteristicDef | undefined, title: string, modifiers: ModifierValues): string {
  if (!def) return title;
  const parts = [title, ...def.modifiers.map((m) => renderModifier(m, modifiers[m.key]))];
  return parts.filter(Boolean).join(" ");
}
