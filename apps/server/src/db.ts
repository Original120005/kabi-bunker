import { mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { DATA_DIR } from "./paths.ts";

mkdirSync(DATA_DIR, { recursive: true });

export const prisma = new PrismaClient();

export async function initDb() {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
}
