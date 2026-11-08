import { useEffect, useState } from "react";
import type { RoomView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";
import { Button } from "../ui/Button.tsx";
import { Avatar } from "../game/PlayersTable.tsx";

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/80 px-3 py-2.5 text-center">
      <div className={`text-xl font-extrabold ${accent ? "text-accent" : "text-white"}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

/** Grows from zero on mount and eases between values, so each «ready» glides instead of jumping. */
function ProgressBar({ share }: { share: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(share));
    return () => cancelAnimationFrame(id);
  }, [share]);
  return (
    <div className="mb-4 h-2.5 overflow-hidden rounded-full bg-line">
      <div
        className="h-full w-full origin-left rounded-full bg-ok transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
        style={{ transform: `scaleX(${shown})` }}
      />
    </div>
  );
}

export function ReadyCheck({ view }: { view: RoomView }) {
  const send = useRoom((s) => s.send);
  const me = view.me;
  const isHost = me?.isHost === true;
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  useEffect(() => setOptimistic(null), [me?.ready]);
  const myReady = optimistic ?? me?.ready ?? false;
  const toggleReady = async () => {
    setOptimistic(!myReady);
    if (!(await send({ type: "lobby.setReady", ready: !myReady }))) setOptimistic(null);
  };
  const players = view.participants.filter((p) => p.role === "player").map((p) => (p.id === me?.id ? { ...p, ready: myReady } : p));
  const ready = players.filter((p) => p.ready).length;
  const allReady = ready === players.length;
  const seats = Math.floor(players.length / 2);

  return (
    <div className="overlay-in fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-3">
      <div className="pop-in w-full max-w-xl overflow-hidden rounded-3xl border border-accent/30 bg-panel shadow-2xl shadow-black/70">
        <div className="hero-bg px-6 pb-5 pt-6 text-center">
          <h2 className="text-2xl font-extrabold drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">Игра скоро начнётся</h2>
          <p className="mt-1 text-sm text-white/75">Проверьте параметры и подтвердите готовность</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label="Игроков" value={players.length} />
            <Stat label="Мест в бункере" value={seats} accent />
            <Stat label="Ведущий играет" value={view.settings.hostPlays ? "Да" : "Нет"} />
          </div>
          <p className="mt-2 text-xs text-white/60">Паки: {view.settings.packSlugs.join(", ") || "базовый"}</p>
        </div>

        <div className="px-5 pb-5 pt-4 sm:px-6">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold">Готовность</span>
            <span className={allReady ? "font-bold text-ok" : "text-muted"}>
              {ready} из {players.length}
            </span>
          </div>
          <ProgressBar share={players.length ? ready / players.length : 0} />

          <ul className="mb-5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {players.map((p) => (
              <li
                key={p.id}
                className={`flex min-w-0 items-center gap-2 rounded-xl border px-2 py-1.5 transition-colors duration-200 ${p.ready ? "border-ok/40 bg-ok/10" : "border-line bg-panel-2/60"} ${p.id === me?.id ? "ring-1 ring-accent/60" : ""}`}
              >
                <Avatar name={p.nickname} src={p.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.nickname}</span>
                <span className={`shrink-0 text-base ${p.ready ? "text-[#5fb784]" : "text-white/25"}`} title={p.ready ? "Готов" : "Не готов"}>
                  {p.ready ? "✓" : "…"}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2">
            {me?.role === "player" && (
              <Button className="py-3 text-base" variant={myReady ? "ghost" : "ok"} onClick={toggleReady}>
                {myReady ? "Я не готов" : "Я готов"}
              </Button>
            )}
            {isHost && (
              <>
                <label className="my-1 flex cursor-pointer items-center justify-center gap-2 text-sm text-white/85">
                  <input type="checkbox" className="h-4 w-4 accent-[#f0a030]" checked={view.settings.autoStart} onChange={(e) => send({ type: "lobby.setAutoStart", value: e.target.checked })} />
                  Начать автоматически, когда все будут готовы
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => send({ type: "lobby.cancelReadyCheck" })}>Отменить</Button>
                  <Button variant="primary" disabled={!allReady} onClick={() => send({ type: "lobby.start" })}>
                    Начать игру
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
