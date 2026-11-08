import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { GameError } from "@bunker/engine";
import { ClientAction, JoinAuth, SocketEvents, type ActionAck } from "@bunker/shared";
import { identityFromSocket } from "./auth.ts";
import type { RoomManager } from "./rooms/manager.ts";

function errorText(e: unknown): string {
  if (e instanceof GameError) return e.message;
  console.error(e);
  return "Ошибка сервера. Попробуйте ещё раз.";
}

export function attachSockets(httpServer: HttpServer, rooms: RoomManager) {
  const io = new Server(httpServer, {
    serveClient: false,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  io.on("connection", async (socket) => {
    const auth = JoinAuth.safeParse({ ...socket.handshake.auth, code: String(socket.handshake.auth?.code ?? "").toUpperCase() });
    if (!auth.success) {
      socket.emit(SocketEvents.error, "Некорректные данные для входа");
      socket.disconnect(true);
      return;
    }
    const { code } = auth.data;

    let session: Awaited<ReturnType<RoomManager["connect"]>>;
    try {
      const rawCookie = socket.handshake.headers.cookie;
      const member = await identityFromSocket(Array.isArray(rawCookie) ? rawCookie.join("; ") : rawCookie, auth.data);
      session = await rooms.connect(code, member, (participantId) => ({
        participantId,
        send: (view) => socket.emit(SocketEvents.state, view),
        kick: (reason) => {
          socket.emit(SocketEvents.kicked, reason);
          // Delay so the acknowledgement of the actor's own action (leave, close) is still delivered.
          setTimeout(() => socket.disconnect(true), 300);
        },
      }));
    } catch (e) {
      socket.emit(SocketEvents.kicked, errorText(e));
      socket.disconnect(true);
      return;
    }
    if (socket.disconnected) {
      session.detach();
      return;
    }

    socket.on(SocketEvents.action, async (raw: unknown, ack?: (r: ActionAck) => void) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const parsed = ClientAction.safeParse(raw);
      if (!parsed.success) return reply({ ok: false, error: "Неизвестное действие" });
      try {
        await rooms.act(code, session.participantId, parsed.data);
        reply({ ok: true });
      } catch (e) {
        reply({ ok: false, error: errorText(e) });
      }
    });

    socket.on("disconnect", () => session.detach());
  });

  return io;
}
