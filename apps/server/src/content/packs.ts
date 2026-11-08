import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ContentItemFile, DefinitionsFile, PackFile } from "@bunker/shared";
import type { PrismaClient } from "@prisma/client";

const ItemsFile = z.union([
  z.object({ type: z.string(), items: z.array(z.unknown()) }),
  z.object({ groups: z.array(z.object({ type: z.string(), items: z.array(z.unknown()) })) }),
]);

export interface ParsedPack {
  dir: string;
  pack: PackFile;
  definitions: DefinitionsFile;
  items: { type: string; item: ContentItemFile }[];
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: не удалось прочитать JSON (${(e as Error).message})`);
  }
}

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, value: unknown, where: string): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => `  ${i.path.join(".") || "(корень)"}: ${i.message}`).join("\n");
  throw new Error(`${where}: ошибка формата\n${issues}`);
}

export function readPackDir(dir: string): ParsedPack {
  const pack = parseOrThrow(PackFile, readJson(path.join(dir, "pack.json")), path.join(dir, "pack.json"));
  const defsFile = path.join(dir, "definitions.json");
  const definitions = existsSync(defsFile) ? parseOrThrow(DefinitionsFile, readJson(defsFile), defsFile) : { characteristics: [], bunkerFields: [] };

  const items: ParsedPack["items"] = [];
  const itemsDir = path.join(dir, "items");
  if (existsSync(itemsDir)) {
    for (const name of readdirSync(itemsDir).filter((n) => n.endsWith(".json")).sort()) {
      const file = path.join(itemsDir, name);
      const parsed = parseOrThrow(ItemsFile, readJson(file), file);
      const groups = "groups" in parsed ? parsed.groups : [parsed];
      for (const g of groups) {
        g.items.forEach((raw, i) => items.push({ type: g.type, item: parseOrThrow(ContentItemFile, raw, `${file} → ${g.type}[${i}]`) }));
      }
    }
  }

  const seen = new Set<string>();
  for (const { type, item } of items) {
    const id = `${type}:${item.key ?? item.title}`;
    if (seen.has(id)) throw new Error(`${dir}: повторяется элемент ${id}. Задайте разные "key".`);
    seen.add(id);
  }
  return { dir, pack, definitions, items };
}

export function readAllPacks(packsDir: string): ParsedPack[] {
  if (!existsSync(packsDir)) return [];
  return readdirSync(packsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(packsDir, d.name, "pack.json")))
    .map((d) => readPackDir(path.join(packsDir, d.name)));
}

export interface ImportStats {
  slug: string;
  created: number;
  updated: number;
  skipped: number;
}

/**
 * Imports a pack into the database. Existing elements are kept as they are unless `update` is set,
 * so changes made in the content editor survive a restart.
 */
export async function importPack(prisma: PrismaClient, parsed: ParsedPack, update: boolean): Promise<ImportStats> {
  const { pack } = parsed;
  const meta = { name: pack.name, description: pack.description, kind: pack.kind, priority: pack.priority, enabled: pack.enabled };
  const row = await prisma.pack.upsert({ where: { slug: pack.slug }, create: { slug: pack.slug, ...meta }, update: update ? meta : {} });

  const defs = [
    ...parsed.definitions.characteristics.map((d) => ({ kind: "characteristic", key: d.key, json: JSON.stringify(d) })),
    ...parsed.definitions.bunkerFields.map((d) => ({ kind: "bunkerField", key: d.key, json: JSON.stringify(d) })),
  ];
  for (const d of defs) {
    await prisma.definition.upsert({
      where: { packId_kind_key: { packId: row.id, kind: d.kind, key: d.key } },
      create: { packId: row.id, ...d },
      update: update ? { json: d.json } : {},
    });
  }

  const stats: ImportStats = { slug: pack.slug, created: 0, updated: 0, skipped: 0 };
  const existing = new Set(
    (await prisma.contentItem.findMany({ where: { packId: row.id }, select: { type: true, externalKey: true } })).map((r) => `${r.type}\u0000${r.externalKey}`),
  );
  await prisma.$transaction(async (tx) => {
    for (const { type, item } of parsed.items) {
      const externalKey = item.key ?? item.title;
      const fields = {
        title: item.title,
        description: item.description,
        weight: item.weight,
        enabled: item.enabled,
        tags: JSON.stringify(item.tags),
        constraints: JSON.stringify(item.constraints),
        modifierRules: JSON.stringify(item.modifierRules),
        abilities: JSON.stringify(item.abilities),
        data: JSON.stringify(item.data),
        source: item.source,
      };
      const exists = existing.has(`${type}\u0000${externalKey}`);
      if (exists && !update) {
        stats.skipped++;
        continue;
      }
      await tx.contentItem.upsert({
        where: { packId_type_externalKey: { packId: row.id, type, externalKey } },
        create: { packId: row.id, type, externalKey, ...fields },
        update: fields,
      });
      if (exists) stats.updated++;
      else stats.created++;
    }
  });
  return stats;
}
