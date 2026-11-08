import { z } from "zod";

/** Source of a content element: original site data, content written by the project author, or added by the user. */
export const ContentSource = z.enum(["original", "author", "user"]);
export type ContentSource = z.infer<typeof ContentSource>;

export const ScaleLevel = z.object({
  key: z.string(),
  label: z.string(),
  /** Minimum years of experience the level requires; used to bind experience to age. */
  minYears: z.number().optional(),
  hint: z.string().optional(),
});
export type ScaleLevel = z.infer<typeof ScaleLevel>;

export const AgeGroup = z.object({ key: z.string(), label: z.string(), min: z.number(), max: z.number() });

export const ModifierDef = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("age"),
    key: z.string(),
    min: z.number(),
    max: z.number(),
    groups: z.array(AgeGroup),
  }),
  z.object({
    kind: z.literal("range"),
    key: z.string(),
    min: z.number(),
    max: z.number(),
    /** Display template, `{n}` is replaced with the value. */
    format: z.string(),
    /**
     * Bell curve instead of an even spread: values near `mean` are common, the edges of [min, max] are rare.
     * `byGender` overrides it by the gender card title (e.g. men are taller on average).
     */
    normal: z
      .object({
        mean: z.number(),
        sd: z.number().positive(),
        byGender: z.record(z.string(), z.object({ mean: z.number(), sd: z.number().positive() })).optional(),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal("scale"),
    key: z.string(),
    levels: z.array(ScaleLevel).min(1),
    /** Level's `minYears` must not exceed the character's age minus the work start age (16). */
    ageBound: z.boolean().default(false),
    format: z.string().default("({label})"),
  }),
  z.object({
    kind: z.literal("flag"),
    key: z.string(),
    chance: z.number().min(0).max(1),
    label: z.string(),
  }),
]);
export type ModifierDef = z.infer<typeof ModifierDef>;

export const CharacteristicDef = z.object({
  key: z.string().regex(/^[a-zA-Z][\w]*$/),
  name: z.string(),
  sort: z.number(),
  /** Content type the values are drawn from. */
  contentType: z.string(),
  revealable: z.boolean().default(true),
  specialCard: z.boolean().default(false),
  countPerPlayer: z.number().int().min(1).default(1),
  onSteal: z.enum(["regenerate", "empty"]).default("regenerate"),
  rotatable: z.boolean().default(true),
  modifiers: z.array(ModifierDef).default([]),
  hint: z.string().optional(),
  enabled: z.boolean().default(true),
});
export type CharacteristicDef = z.infer<typeof CharacteristicDef>;

export const BunkerFieldDef = z.object({
  key: z.string(),
  name: z.string(),
  sort: z.number(),
  contentType: z.string(),
  /** How many values are drawn; lists such as bunker items take several. */
  count: z.number().int().min(1).default(1),
  /** Where the field is rendered on the bunker card. */
  placement: z.enum(["text", "list", "tile"]).default("text"),
  icon: z.string().optional(),
  enabled: z.boolean().default(true),
});
export type BunkerFieldDef = z.infer<typeof BunkerFieldDef>;

export const DefinitionsFile = z.object({
  characteristics: z.array(CharacteristicDef).default([]),
  bunkerFields: z.array(BunkerFieldDef).default([]),
});
export type DefinitionsFile = z.infer<typeof DefinitionsFile>;

export const AbilityDef = z.object({
  name: z.string(),
  text: z.string(),
  kind: z.enum(["active", "passive", "narrative"]).default("active"),
});
export type AbilityDef = z.infer<typeof AbilityDef>;

export const Constraint = z.object({
  field: z.enum(["gender", "age"]),
  op: z.enum(["in", "notIn", "gte", "lte"]),
  value: z.union([z.number(), z.array(z.string())]),
});
export type Constraint = z.infer<typeof Constraint>;

export const ModifierRules = z.object({
  /** Modifiers that do not apply to this element, e.g. «Идеально здоров» has no severity. */
  disable: z.array(z.string()).default([]),
  /** Restricts a scale modifier to some levels: `{ severity: ["light", "medium"] }`. */
  allowedLevels: z.record(z.string(), z.array(z.string())).default({}),
  /** Narrows a range modifier for this element, e.g. a gas mask comes in 1–2 pieces: `{ quantity: { min: 1, max: 2 } }`. */
  ranges: z.record(z.string(), z.object({ min: z.number().int(), max: z.number().int() })).default({}),
});
export type ModifierRules = z.infer<typeof ModifierRules>;

const EffectKey = z.string().min(1).max(40);
/** «*» in charKey/group/title means the host picks the value while applying. */
const Note = z.string().min(1).max(300);
/**
 * self — the card owner; other — a chosen player except the owner; any — any chosen player; all — everyone in the camp;
 * neighbor — the chosen player sitting right before or after the owner; neighbors — both of them.
 */
const EffectTarget = z.enum(["self", "other", "any", "all", "neighbor", "neighbors"]);
const OneTarget = z.enum(["self", "other", "any", "neighbor"]);
const Delta = z.union([z.literal(1), z.literal(-1)]);

/** `note` is a reminder for the host shown before applying (e.g. which diseases a doctor may cure). */
const fx = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, note: Note.optional() });

/** One action applied by the host. */
export const SimpleEffect = z.discriminatedUnion("op", [
  fx({ op: z.literal("bunker.reroll"), field: EffectKey }),
  fx({ op: z.literal("bunker.set"), field: EffectKey, options: z.array(z.string().min(1).max(200)).max(12).optional() }),
  fx({ op: z.literal("bunker.addItem") }),
  fx({ op: z.literal("catastrophe.reroll") }),
  fx({ op: z.literal("seats"), delta: Delta }),
  fx({ op: z.literal("rotate"), charKey: EffectKey, dir: z.enum(["cw", "ccw"]) }),
  fx({ op: z.literal("nullify"), charKey: EffectKey }),
  fx({
    op: z.literal("reroll"),
    charKey: EffectKey,
    target: EffectTarget.exclude(["neighbors"]),
    choices: z.array(EffectKey).optional(),
    onlyClosed: z.boolean().optional(),
    requireHealthy: z.boolean().optional(),
    minAge: z.number().int().optional(),
  }),
  fx({ op: z.literal("modifier.step"), charKey: EffectKey, modifierKey: EffectKey, delta: Delta, target: OneTarget, notFrom: z.array(EffectKey).optional() }),
  fx({ op: z.literal("modifier.set"), charKey: EffectKey, modifierKey: EffectKey, level: EffectKey, target: OneTarget, from: z.array(EffectKey).optional() }),
  fx({ op: z.literal("swap"), charKey: EffectKey, from: z.enum(["alive", "exiled"]).optional(), resetUsed: z.boolean().optional(), choices: z.array(EffectKey).optional() }),
  fx({ op: z.literal("swap.pair"), charKey: EffectKey, choices: z.array(EffectKey).optional() }),
  fx({ op: z.literal("steal"), charKey: EffectKey, from: z.enum(["alive", "exiled", "neighbor"]).optional(), onlyRevealed: z.boolean().optional(), choices: z.array(EffectKey).optional() }),
  fx({ op: z.literal("healthy"), target: OneTarget, maxSeverity: EffectKey.optional() }),
  fx({ op: z.literal("return") }),
  fx({ op: z.literal("reveal"), charKey: EffectKey.optional(), target: OneTarget.exclude(["neighbor"]).optional(), halfOpen: z.boolean().optional() }),
  fx({ op: z.literal("give"), charKey: EffectKey, text: z.string().min(1).max(300), target: OneTarget }),
  fx({ op: z.literal("add"), charKey: EffectKey, target: EffectTarget.exclude(["all"]) }),
  fx({ op: z.literal("remove"), charKey: EffectKey, target: OneTarget }),
  fx({ op: z.literal("gender.flip"), target: OneTarget }),
  fx({ op: z.literal("childfree"), target: OneTarget }),
  fx({ op: z.literal("curePhobia"), target: OneTarget }),
  fx({ op: z.literal("ageGroup"), group: EffectKey, target: OneTarget, from: z.array(EffectKey).optional() }),
  fx({ op: z.literal("body"), title: EffectKey, target: OneTarget, from: z.array(EffectKey).optional() }),
  fx({ op: z.literal("cancelSpecial") }),
  fx({ op: z.literal("manual"), note: Note }),
  /** A permanent property: nothing to apply, the card shows no button. */
  fx({ op: z.literal("info"), note: Note }),
]);
export type SimpleEffect = z.infer<typeof SimpleEffect>;

/**
 * What a special card or a profession ability does, stored in `data.effect`. The host applies it with one click;
 * cards without an effect, or with `manual`, are only marked as used. `choice` — the host picks one of the variants
 * («или»), `multi` — all steps are applied in order («и»).
 */
export const SpecialEffect = z.union([
  SimpleEffect,
  z.object({ op: z.literal("choice"), options: z.array(z.object({ label: z.string().min(1).max(80), effect: SimpleEffect })).min(2).max(4) }),
  z.object({ op: z.literal("multi"), steps: z.array(SimpleEffect).min(2).max(3) }),
]);
export type SpecialEffect = z.infer<typeof SpecialEffect>;

/** Characteristics whose cards can carry an effect applied by the host: special cards and professions. */
export const ABILITY_CHAR_KEYS = ["profession"] as const;
export function hasAbilityEffect(def: { key: string; specialCard?: boolean }): boolean {
  return def.specialCard === true || (ABILITY_CHAR_KEYS as readonly string[]).includes(def.key);
}

/** What the host has to choose before applying an effect. */
export interface EffectNeeds {
  /** Which player to pick, if any. */
  player: "none" | "other" | "any" | "exiled" | "neighbor";
  /** A second player is needed (swap between two other players). */
  player2: boolean;
  /** Characteristic keys to pick from; null — fixed by the effect. Empty array — any non-special one. */
  chars: string[] | null;
  /** Free text with its default (an item, a new bunker value). */
  text: { initial: string; options?: string[]; label: string } | null;
  /** A level / group / body title to pick: which list. */
  value: "ageGroup" | "body" | null;
  /** The ability changes one health line; the host may pick it when several are visible. */
  healthLine: boolean;
}

function needsOf(e: SimpleEffect): EffectNeeds {
  const n: EffectNeeds = { player: "none", player2: false, chars: null, text: null, value: null, healthLine: false };
  const t = (target: string) => (target === "other" || target === "any" || target === "neighbor" ? target : "none") as EffectNeeds["player"];
  const choose = (key: string, choices?: string[]) => (key === "*" ? (choices ?? []) : null);
  switch (e.op) {
    case "swap":
      n.player = e.from === "exiled" ? "exiled" : "other";
      n.chars = choose(e.charKey, e.choices);
      break;
    case "swap.pair":
      n.player = "other";
      n.player2 = true;
      n.chars = choose(e.charKey, e.choices);
      break;
    case "steal":
      n.player = e.from === "exiled" ? "exiled" : e.from === "neighbor" ? "neighbor" : "other";
      n.chars = choose(e.charKey, e.choices);
      break;
    case "return":
      n.player = "exiled";
      break;
    case "reveal":
      n.player = t(e.target ?? "other");
      n.chars = e.charKey ? choose(e.charKey) : [];
      break;
    case "reroll":
      n.player = t(e.target);
      n.chars = choose(e.charKey, e.choices);
      break;
    case "modifier.step":
    case "modifier.set":
      n.player = t(e.target);
      n.healthLine = e.charKey === "health";
      break;
    case "healthy":
      n.player = t(e.target);
      n.healthLine = e.maxSeverity !== undefined;
      break;
    case "give":
      n.player = t(e.target);
      n.text = { initial: e.text, label: "Что добавить" };
      break;
    case "add":
      n.player = t(e.target);
      break;
    case "remove":
    case "gender.flip":
    case "childfree":
    case "curePhobia":
      n.player = t(e.target);
      break;
    case "ageGroup":
      n.player = t(e.target);
      if (e.group === "*") n.value = "ageGroup";
      break;
    case "body":
      n.player = t(e.target);
      if (e.title === "*") n.value = "body";
      break;
    case "bunker.set":
      n.text = { initial: e.options?.[0] ?? "", options: e.options, label: "Новое значение" };
      break;
  }
  return n;
}

/** Needs of the effect; for `choice` — of the picked variant, for `multi` — of all steps together. */
export function effectNeeds(effect: SpecialEffect | null, option = 0): EffectNeeds {
  const none: EffectNeeds = { player: "none", player2: false, chars: null, text: null, value: null, healthLine: false };
  if (!effect) return none;
  if (effect.op === "choice") return needsOf(effect.options[Math.min(option, effect.options.length - 1)].effect);
  if (effect.op === "multi") {
    return effect.steps.map(needsOf).reduce((a, b) => ({
      player: a.player !== "none" ? a.player : b.player,
      player2: a.player2 || b.player2,
      chars: a.chars ?? b.chars,
      text: a.text ?? b.text,
      value: a.value ?? b.value,
      healthLine: a.healthLine || b.healthLine,
    }));
  }
  return needsOf(effect);
}

/** Which choice the host makes when applying an effect (kept for older callers). */
export function effectInput(effect: SpecialEffect | null): "none" | "other" | "any" | "exiled" | "reveal" {
  const n = effectNeeds(effect);
  if (effect?.op === "reveal") return "reveal";
  return n.player === "neighbor" ? "other" : n.player;
}

/** Abilities that are only a reminder and have nothing to apply. */
export function isInfoEffect(effect: SpecialEffect | null): boolean {
  return effect?.op === "info";
}

export const ContentItemFile = z.object({
  /** Stable key inside the pack; used for idempotent import. Defaults to the title. */
  key: z.string().optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  weight: z.number().min(0).default(1),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  constraints: z.array(Constraint).default([]),
  modifierRules: ModifierRules.prefault({}),
  abilities: z.array(AbilityDef).default([]),
  data: z
    .record(z.string(), z.unknown())
    .default({})
    .superRefine((data, ctx) => {
      if (data.effect === undefined) return;
      const r = SpecialEffect.safeParse(data.effect);
      if (!r.success) ctx.addIssue({ code: "custom", path: ["effect"], message: `Неверный эффект карты: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    }),
  source: ContentSource.default("user"),
});
export type ContentItemFile = z.infer<typeof ContentItemFile>;

export const PackFile = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string().default(""),
  kind: z.enum(["base", "addon", "custom"]).default("addon"),
  priority: z.number().default(0),
  enabled: z.boolean().default(true),
});
export type PackFile = z.infer<typeof PackFile>;

/** Content element as the engine sees it after loading from the database. */
export interface ContentItem {
  id: string;
  packId: string;
  type: string;
  title: string;
  description: string;
  weight: number;
  tags: string[];
  constraints: Constraint[];
  modifierRules: ModifierRules;
  abilities: AbilityDef[];
  data: Record<string, unknown>;
}

export interface PackInfo {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: "base" | "addon" | "custom";
  priority: number;
  enabled: boolean;
}

/** Everything the generator needs: definitions plus element pools of the selected packs, ordered by pack priority. */
export interface ContentDb {
  characteristics: CharacteristicDef[];
  bunkerFields: BunkerFieldDef[];
  /** Pools by content type. Each pool is a list of tiers: higher-priority packs first, base packs last. */
  pools: Record<string, ContentItem[][]>;
}
