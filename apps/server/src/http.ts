import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GameError } from "@bunker/engine";
import { beginDiscord, discordConfigured, finishDiscord, identityFromSocket, leaderboard, logout, sessionUser } from "./auth.ts";
import type { RoomManager } from "./rooms/manager.ts";
import { WEB_DIST } from "./paths.ts";

export async function registerHttp(app: FastifyInstance, rooms: RoomManager) {
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/auth/status", async (req) => ({ configured: discordConfigured(), user: await sessionUser(req) }));
  app.get("/api/auth/discord", beginDiscord);
  app.get("/api/auth/discord/callback", finishDiscord);
  app.post("/api/auth/logout", logout);
  app.get("/api/leaderboard", async (req) => {
    const q = z.object({ q: z.string().max(40).optional() }).safeParse(req.query);
    return leaderboard(q.success ? (q.data.q ?? "") : "");
  });

  app.post("/api/rooms", async (req, reply) => {
    try {
      const member = await identityFromSocket(req.headers.cookie, {});
      const code = await rooms.create(member);
      return { code };
    } catch (e) {
      const message = e instanceof GameError ? e.message : "Войдите через Discord";
      return reply.code(401).send({ error: message });
    }
  });

  app.get("/api/rooms/:code", async (req) => {
    const { code } = z.object({ code: z.string() }).parse(req.params);
    const status = rooms.exists(code.toUpperCase());
    return { exists: status !== null && status !== "closed", status };
  });

  if (existsSync(WEB_DIST)) {
    // wildcard routing reads files on every request; with wildcard: false the list is frozen at startup and a rebuild breaks the page.
    await app.register(fastifyStatic, { root: WEB_DIST });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/socket.io/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Не найдено" });
    });
  } else {
    app.get("/", async () => ({ message: "Клиент не собран. Для разработки откройте адрес Vite (npm run dev), для игры запустите npm run play." }));
  }
}
