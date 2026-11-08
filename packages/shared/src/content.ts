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
/** self — the card owner; other — a chosen player except the owner; any — any chosen player; all — everyone in the camp. */
const EffectTarget = z.enum(["self", "other", "any", "all"]);

/**
 * What a special card does, stored in `data.effect`. The host applies it with one click from the special table;
 * cards without an effect, or with `manual`, are only marked as used.
 */
export const SpecialEffect = z.discriminatedUnion("op", [
  z.object({ op: z.literal("bunker.reroll"), field: EffectKey }),
  z.object({ op: z.literal("bunker.addItem") }),
  z.object({ op: z.literal("catastrophe.reroll") }),
  z.object({ op: z.literal("seats"), delta: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ op: z.literal("rotate"), charKey: EffectKey, dir: z.enum(["cw", "ccw"]) }),
  z.object({ op: z.literal("nullify"), charKey: EffectKey }),
  z.object({ op: z.literal("reroll"), charKey: EffectKey, target: EffectTarget }),
  z.object({ op: z.literal("modifier.step"), charKey: EffectKey, modifierKey: EffectKey, delta: z.union([z.literal(1), z.literal(-1)]), target: EffectTarget.exclude(["all"]) }),
  z.object({ op: z.literal("swap"), charKey: EffectKey }),
  z.object({ op: z.literal("steal"), charKey: EffectKey }),
  z.object({ op: z.literal("healthy"), target: EffectTarget.exclude(["all"]) }),
  z.object({ op: z.literal("return") }),
  z.object({ op: z.literal("reveal") }),
  z.object({ op: z.literal("cancelSpecial") }),
  z.object({ op: z.literal("manual"), note: z.string().min(1).max(300) }),
]);
export type SpecialEffect = z.infer<typeof SpecialEffect>;

/** Which choice the host makes when applying an effect. */
export function effectInput(effect: SpecialEffect | null): "none" | "other" | "any" | "exiled" | "reveal" {
  if (!effect) return "none";
  switch (effect.op) {
    case "swap":
    case "steal":
      return "other";
    case "return":
      return "exiled";
    case "reveal":
      return "reveal";
    case "reroll":
    case "modifier.step":
    case "healthy":
      return effect.target === "other" || effect.target === "any" ? effect.target : "none";
    default:
      return "none";
  }
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
      if (!r.success) ctx.addIssue({ code: "custom", path: ["effect"], message: `Неверный эффект спец. карты: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
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
