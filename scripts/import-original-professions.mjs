// Converts docs/research/original-professions.json into the base pack format.
// Ability kind is a heuristic by wording; review it in the content editor where needed.
import { readFileSync, writeFileSync } from "node:fs";

const src = JSON.parse(readFileSync(new URL("../docs/research/original-professions.json", import.meta.url), "utf8"));

function kindOf(text) {
  const t = text.toLowerCase();
  if (/^(может|можете|способен)/.test(t)) return "active";
  if (/знает|при прохождении/.test(t)) return "narrative";
  return "passive";
}

const items = src.map((p) => ({
  key: p.name,
  title: p.name,
  abilities: [{ name: "Проф. возможность", text: p.ability, kind: kindOf(p.ability) }],
  data: { nameEn: p.nameEn, abilityEn: p.abilityEn },
  source: "original",
}));

writeFileSync(new URL("../content/packs/base/items/profession.json", import.meta.url), JSON.stringify({ type: "profession", items }, null, 2) + "\n");
console.log(`profession.json: ${items.length}`);
