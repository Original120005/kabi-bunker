import { BunkerFieldDef, CharacteristicDef, ModifierRules, type ContentDb, type ContentItem, type PackInfo } from "@bunker/shared";
import type { PrismaClient } from "@prisma/client";

interface PackSnapshot {
  info: PackInfo;
  characteristics: CharacteristicDef[];
  bunkerFields: BunkerFieldDef[];
  items: ContentItem[];
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** In-memory snapshot of enabled content. Games read from it synchronously; call `reload()` after edits. */
export class ContentService {
  private packs: PackSnapshot[] = [];

  constructor(private prisma: PrismaClient) {}

  async reload() {
    const rows = await this.prisma.pack.findMany({
      include: { definitions: true, items: { where: { enabled: true } } },
      orderBy: { priority: "asc" },
    });
    this.packs = rows.map((p) => ({
      info: { id: p.id, slug: p.slug, name: p.name, description: p.description, kind: p.kind as PackInfo["kind"], priority: p.priority, enabled: p.enabled },
      characteristics: p.definitions.filter((d) => d.kind === "characteristic").map((d) => CharacteristicDef.parse(JSON.parse(d.json))),
      bunkerFields: p.definitions.filter((d) => d.kind === "bunkerField").map((d) => BunkerFieldDef.parse(JSON.parse(d.json))),
      items: p.items.map((i) => ({
        id: i.id,
        packId: p.id,
        type: i.type,
        title: i.title,
        description: i.description,
        weight: i.weight,
        tags: parseJson(i.tags, []),
        constraints: parseJson(i.constraints, []),
        modifierRules: ModifierRules.parse(parseJson(i.modifierRules, {})),
        abilities: parseJson(i.abilities, []),
        data: parseJson(i.data, {}),
      })),
    }));
  }

  listPacks(): PackInfo[] {
    return this.packs.map((p) => p.info);
  }

  defaultPackSlugs(): string[] {
    return this.packs.filter((p) => p.info.enabled && p.info.kind === "base").map((p) => p.info.slug);
  }

  /** Base packs are always included so that missing values are filled from them, as in the original. */
  build(slugs: string[]): ContentDb {
    const selected = this.packs.filter((p) => p.info.enabled && (p.info.kind === "base" || slugs.includes(p.info.slug)));
    if (selected.length === 0) throw new Error("Нет включённых паков контента. Запустите npm run seed.");

    const chars = new Map<string, CharacteristicDef>();
    const fields = new Map<string, BunkerFieldDef>();
    for (const p of selected) {
      for (const c of p.characteristics) chars.set(c.key, c);
      for (const f of p.bunkerFields) fields.set(f.key, f);
    }

    const pools: ContentDb["pools"] = {};
    for (const p of [...selected].reverse()) {
      const byType = new Map<string, ContentItem[]>();
      for (const item of p.items) {
        if (!byType.has(item.type)) byType.set(item.type, []);
        byType.get(item.type)!.push(item);
      }
      for (const [type, items] of byType) (pools[type] ??= []).push(items);
    }
    return { characteristics: [...chars.values()], bunkerFields: [...fields.values()], pools };
  }
}
