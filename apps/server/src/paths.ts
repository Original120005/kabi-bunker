import { fileURLToPath } from "node:url";
import path from "node:path";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const PACKS_DIR = path.join(REPO_ROOT, "content", "packs");
export const WEB_DIST = path.join(REPO_ROOT, "apps", "web", "dist");
