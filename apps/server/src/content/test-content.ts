import path from "node:path";
import type { ContentDb } from "@bunker/shared";
import { PACKS_DIR } from "../paths.ts";
import { readPackDir } from "./packs.ts";

/** Base pack as a ContentDb without the database, for tests. */
export function baseContent(): ContentDb {
  const base = readPackDir(path.join(PACKS_DIR, "base"));
  const pools: ContentDb["pools"] = {};
  base.items.forEach(({ type, item }, i) => {
    (pools[type] ??= [[]])[0].push({ id: `c${i}`, packId: "base", type, ...item });
  });
  return { characteristics: base.definitions.characteristics, bunkerFields: base.definitions.bunkerFields, pools };
}
