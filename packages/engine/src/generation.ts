import { hasAbilityEffect, SpecialEffect, type CharacteristicDef, type ContentDb, type ContentItem, type ModifierValues } from "@bunker/shared";
import type { Rng } from "./rng.ts";
import { seatsFor, type RuleSet } from "./rules.ts";
import type { Card, GameState } from "./types.ts";

/** Facts about a character that later characteristics may depend on (constraints, age-bound experience). */
export interface CharacterContext {
  gender?: string;
  age?: number;
}

function matchesConstraints(item: ContentItem, ctx: CharacterContext): boolean {
  return item.constraints.every((c) => {
    const actual = c.field === "gender" ? ctx.gender : ctx.age;
    if (actual === undefined) return true;
    switch (c.op) {
      case "in":
        return Array.isArray(c.value) && c.value.includes(String(actual));
      case "notIn":
        return Array.isArray(c.value) && !c.value.includes(String(actual));
      case "gte":
        return typeof c.value === "number" && Number(actual) >= c.value;
      case "lte":
        return typeof c.value === "number" && Number(actual) <= c.value;
    }
  });
}

/** Доля карт здоровья «Идеально здоров». Остальные болезни делят остаток поровну, а здоровых в партии может быть несколько. */
const HEALTHY_CHANCE = 0.3;

/**
 * Draws elements without repeats within a game. Tiers are tried in priority order, so a custom pack is used first
 * and base packs fill the gap, as in the original. When every element is used, repeats are allowed.
 */

export class Picker {
  private used = new Set<string>();

  constructor(
    private pools: Record<string, ContentItem[][]>,
    private rng: Rng,
  ) {}

  markUsed(ids: Iterable<string | null>) {
    for (const id of ids) if (id) this.used.add(id);
  }

  pick(type: string, ctx: CharacterContext = {}, exclude: Set<string> = new Set()): ContentItem | null {
    const tiers = this.pools[type] ?? [];
    if (type === "health" && this.rng.chance(HEALTHY_CHANCE)) {
      const healthy = tiers.flat().find((i) => i.tags.includes("health:none") && i.weight > 0 && !exclude.has(i.id));
      if (healthy) {
        this.used.add(healthy.id);
        return healthy;
      }
    }
    const candidates = (allowUsed: boolean) =>
      tiers.map((tier) =>
        tier.filter((i) => i.weight > 0 && !exclude.has(i.id) && (allowUsed || !this.used.has(i.id)) && matchesConstraints(i, ctx) && !(type === "health" && i.tags.includes("health:none"))),
      );
    for (const allowUsed of [false, true]) {
      for (const tier of candidates(allowUsed)) {
        if (tier.length === 0) continue;
        const item = type === "health" ? this.rng.pick(tier) : tier[this.rng.weightedIndex(tier.map((i) => i.weight))];
        this.used.add(item.id);
        return item;
      }
    }
    return null;
  }
}

export function generateModifiers(def: CharacteristicDef, item: ContentItem | null, ctx: CharacterContext, rules: RuleSet, rng: Rng): ModifierValues {
  const values: ModifierValues = {};
  for (const m of def.modifiers) {
    if (item?.modifierRules.disable.includes(m.key)) continue;
    switch (m.kind) {
      case "age": {
        const age = rng.int(m.min, m.max);
        values[m.key] = age;
        ctx.age = age;
        break;
      }
      case "range": {
        const r = item?.modifierRules.ranges?.[m.key];
        const min = Math.max(m.min, r?.min ?? m.min);
        const max = Math.max(min, Math.min(m.max, r?.max ?? m.max));
        values[m.key] = rng.int(min, max);
        break;
      }
      case "scale": {
        let levels = m.levels;
        const allowed = item?.modifierRules.allowedLevels[m.key];
        if (allowed?.length) levels = levels.filter((l) => allowed.includes(l.key));
        if (m.ageBound && ctx.age !== undefined) {
          const years = ctx.age - rules.workStartAge;
          const fitting = levels.filter((l) => (l.minYears ?? 0) <= years);
          levels = fitting.length ? fitting : levels.slice(0, 1);
        }
        if (levels.length) values[m.key] = rng.pick(levels).key;
        break;
      }
      case "flag":
        values[m.key] = rng.chance(m.chance);
        break;
    }
  }
  return values;
}

export function makeCard(def: CharacteristicDef, item: ContentItem | null, ownerId: string, modifiers: ModifierValues, id: string): Card {
  return {
    id,
    charKey: def.key,
    ownerId,
    contentId: item?.id ?? null,
    title: item?.title ?? "Пусто",
    description: item?.description ?? "",
    modifiers,
    abilities: item?.abilities ?? [],
    link: typeof item?.data.link === "string" ? item.data.link : undefined,
    revealed: false,
    ...(hasAbilityEffect(def) ? { effect: effectOf(item), used: false } : {}),
  };
}

export function effectOf(item: ContentItem | null): SpecialEffect | null {
  const r = SpecialEffect.safeParse(item?.data.effect);
  return r.success ? r.data : null;
}

export interface GenerateParams {
  playerIds: string[];
  content: ContentDb;
  rules: RuleSet;
  rng: Rng;
  newId: () => string;
  now: number;
}

export function generateGame({ playerIds, content, rules, rng, newId, now }: GenerateParams): GameState {
  const picker = new Picker(content.pools, rng);
  const characteristics = content.characteristics.filter((c) => c.enabled).sort((a, b) => a.sort - b.sort);
  const bunkerFields = content.bunkerFields.filter((f) => f.enabled).sort((a, b) => a.sort - b.sort);

  const cards: Record<string, Card> = {};
  const hands: GameState["hands"] = {};
  const statuses: GameState["statuses"] = {};

  for (const playerId of playerIds) {
    const ctx: CharacterContext = {};
    hands[playerId] = {};
    statuses[playerId] = "alive";
    for (const def of characteristics) {
      const own = new Set<string>();
      hands[playerId][def.key] = [];
      for (let i = 0; i < def.countPerPlayer; i++) {
        const item = picker.pick(def.contentType, ctx, own);
        if (item) own.add(item.id);
        if (def.key === "gender" && item) ctx.gender = item.title;
        const card = makeCard(def, item, playerId, generateModifiers(def, item, ctx, rules, rng), newId());
        cards[card.id] = card;
        hands[playerId][def.key].push(card.id);
      }
    }
  }

  const cat = picker.pick("catastrophe");

  const fields: GameState["bunker"]["fields"] = {};
  for (const field of bunkerFields) {
    const own = new Set<string>();
    fields[field.key] = [];
    for (let i = 0; i < field.count; i++) {
      const item = picker.pick(field.contentType, {}, own);
      if (!item) break;
      own.add(item.id);
      fields[field.key].push({ contentId: item.id, title: item.title });
    }
  }

  return {
    startedAt: now,
    rules,
    characteristics,
    bunkerFields,
    seatOrder: [...playerIds],
    statuses,
    exileOrder: [],
    settlement: null,
    hands,
    cards,
    catastrophe: catastropheFrom(cat),
    bunker: { fields, seats: seatsFor(playerIds.length) },
    bodies: [...new Set((content.pools[characteristics.find((c) => c.key === "body")?.contentType ?? ""] ?? []).flat().map((i) => i.title))],
  };
}

export function catastropheFrom(item: ContentItem | null): GameState["catastrophe"] {
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    contentId: item?.id ?? null,
    title: item?.title ?? "Катастрофа не задана",
    description: item?.description ?? "Добавьте катастрофы в редакторе контента.",
    population: num(item?.data.population),
    timerMinutes: num(item?.data.timerMinutes),
    image: typeof item?.data.image === "string" ? item.data.image : null,
  };
}
