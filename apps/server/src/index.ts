import Fastify from "fastify";
import { loadEnv } from "./env.ts";
import { ContentService } from "./content/service.ts";
import { initDb, prisma } from "./db.ts";
import { registerHttp } from "./http.ts";
import { RoomManager } from "./rooms/manager.ts";
import { attachSockets } from "./sockets.ts";

loadEnv();
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

await initDb();
const content = new ContentService(prisma);
await content.reload();
if (content.listPacks().length === 0) console.warn("В базе нет паков контента. Запустите: npm run seed");

const rooms = new RoomManager(prisma, content);
const restored = await rooms.restore();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "warn" }, trustProxy: true });
await registerHttp(app, rooms);
await app.ready();
attachSockets(app.server, rooms);
await app.listen({ port: PORT, host: HOST });

console.log(`Сервер запущен на http://localhost:${PORT}. Восстановлено комнат: ${restored}`);

async function shutdown() {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
