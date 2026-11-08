import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import { SocketEvents, type ActionAck, type ClientAction, type NoticeView, type RoomView } from "@bunker/shared";
import { toast, type ToastKind } from "./toasts.ts";

export type Connection = "idle" | "connecting" | "online" | "reconnecting";

interface RoomStore {
  code: string | null;
  view: RoomView | null;
  connection: Connection;
  /** Set when the server ends the session: kicked, banned, closed or unknown room. */
  ended: string | null;
  /** serverTime − Date.now(), for countdowns. */
  clockOffset: number;
  /** A timer the host just started; shown as a full-screen splash. */
  timerSplash: { id: number; seconds: number } | null;
  hideTimerSplash: () => void;
  connect: (code: string) => void;
  disconnect: () => void;
  send: (action: ClientAction) => Promise<boolean>;
}

let socket: Socket | null = null;
/** Notices up to this id were already shown; null until the first state, so old notices are not replayed. */
let lastNoticeId: number | null = null;
let lastTimerId: number | null = null;

const NOTICE_KIND: Record<NoticeView["color"], ToastKind> = { gold: "info", green: "ok", red: "error", white: "white" };

export const useRoom = create<RoomStore>((set, get) => ({
  code: null,
  view: null,
  connection: "idle",
  ended: null,
  clockOffset: 0,
  timerSplash: null,
  hideTimerSplash: () => set({ timerSplash: null }),

  connect: (code) => {
    get().disconnect();
    lastNoticeId = null;
    lastTimerId = null;
    set({ code, view: null, ended: null, connection: "connecting", timerSplash: null });
    const s = io({ withCredentials: true, auth: { code }, reconnectionDelayMax: 3000 });
    socket = s;
    s.on("connect", () => set({ connection: "online" }));
    s.on("disconnect", () => {
      if (!get().ended) set({ connection: "reconnecting" });
    });
    s.on("connect_error", () => set({ connection: "reconnecting" }));
    s.on(SocketEvents.state, (view: RoomView) => {
      const current = get().view;
      if (current && current.version > view.version) return;
      const maxId = Math.max(0, ...view.notices.map((n) => n.id));
      if (lastNoticeId !== null) {
        for (const n of view.notices) if (n.id > lastNoticeId) toast(NOTICE_KIND[n.color], n.text, n.title, 8000);
      }
      lastNoticeId = Math.max(lastNoticeId ?? 0, maxId);
      const timerId = view.timer?.id ?? 0;
      if (lastTimerId !== null && view.timer && timerId > lastTimerId && view.timer.endsAt > view.serverTime) {
        set({ timerSplash: { id: timerId, seconds: view.timer.seconds } });
      }
      lastTimerId = Math.max(lastTimerId ?? 0, timerId);
      set({ view, clockOffset: view.serverTime - Date.now() });
    });
    s.on(SocketEvents.kicked, (reason: string) => {
      set({ ended: reason, connection: "idle" });
      s.disconnect();
    });
    s.on(SocketEvents.error, (text: string) => toast("error", text));
  },

  disconnect: () => {
    socket?.removeAllListeners();
    socket?.disconnect();
    socket = null;
    set({ connection: "idle" });
  },

  send: (action) =>
    new Promise((resolve) => {
      if (!socket?.connected) {
        toast("error", "Нет соединения с сервером");
        return resolve(false);
      }
      socket.timeout(10_000).emit(SocketEvents.action, action, (err: Error | null, res?: ActionAck) => {
        if (err || !res) {
          toast("error", "Сервер не ответил. Проверьте соединение.");
          return resolve(false);
        }
        if (!res.ok) toast("error", res.error);
        resolve(res.ok);
      });
    }),
}));
