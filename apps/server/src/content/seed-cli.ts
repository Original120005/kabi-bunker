import { prisma } from "../db.ts";
import { PACKS_DIR } from "../paths.ts";
import { importPack, readAllPacks } from "./packs.ts";

// PowerShell passes `npm run seed -- --update` to npm itself, which exposes it as npm_config_update.
const update = process.argv.includes("--update") || process.env.npm_config_update === "true";

try {
  const packs = readAllPacks(PACKS_DIR);
  for (const p of packs) {
    const s = await importPack(prisma, p, update);
    console.log(`Пак «${p.pack.name}» (${s.slug}): добавлено ${s.created}, обновлено ${s.updated}, без изменений ${s.skipped}`);
  }
  if (!update) console.log("Существующие элементы не перезаписаны. Чтобы применить правки из JSON к ним, запустите: npm run seed:update");
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
