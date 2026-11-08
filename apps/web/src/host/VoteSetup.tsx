import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { GameView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";
import { Avatar } from "../game/PlayersTable.tsx";

/** Host picks which players are put up for the vote before it starts. */
export function VoteSetup({ game, protectedId, onClose }: { game: GameView; protectedId: string | null; onClose: () => void }) {
  const send = useRoom((s) => s.send);
  const alive = game.players.filter((p) => p.status === "alive" && p.id !== protectedId);
  const away = game.players.find((p) => p.id === protectedId);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const all = picked.length === alive.length;

  const start = async () => {
    setBusy(true);
    const ok = await send({ type: "host.vote.start", candidates: alive.filter((p) => picked.includes(p.id)).map((p) => p.id) });
    setBusy(false);
    if (ok) onClose();
  };

  return createPortal(
    <div className="overlay-in fixed inset-0 z-[65] flex items-center justify-center bg-black/80 p-3" onClick={onClose}>
      <div role="dialog" aria-modal onClick={(e) => e.stopPropagation()} className="pop-in w-full max-w-xl overflow-hidden rounded-3xl border border-accent/30 bg-panel shadow-2xl shadow-black/70">
        <div className="hero-bg px-6 pb-4 pt-5 text-center">
          <h2 className="text-2xl font-extrabold drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">Кто выставлен на голосование?</h2>
          <p className="mt-1 text-sm text-white/80">Отметьте игроков — голосовать будут только против них</p>
        </div>
        <div className="px-5 pb-5 pt-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted">Выбрано {picked.length} из {alive.length}</span>
            <button onClick={() => setPicked(all ? [] : alive.map((p) => p.id))} className="font-semibold text-accent-2 hover:underline">
              {all ? "Снять всех" : "Выбрать всех"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {alive.map((p) => {
              const on = picked.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                    on ? "border-danger bg-danger/20 ring-1 ring-danger" : "border-line bg-panel-2/70 hover:border-white/30"
                  }`}
                >
                  <Avatar name={p.nickname} src={p.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{p.nickname}</span>
                    <span className="text-xs text-muted">№ {p.seat}</span>
                  </span>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-black ${on ? "border-danger bg-danger text-white" : "border-line"}`}>
                    {on ? "✓" : ""}
                  </span>
                </button>
              );
            })}
            {away && (
              <div className="flex min-w-0 cursor-not-allowed items-center gap-2 rounded-xl border border-line bg-panel-2/40 px-2.5 py-2 opacity-50" title="Игрок на вылазке — выставить нельзя">
                <Avatar name={away.nickname} src={away.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{away.nickname}</span>
                  <span className="text-xs text-accent-2">на вылазке</span>
                </span>
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
            <button onClick={onClose} className="rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm font-semibold hover:border-white/30">
              Отмена
            </button>
            <button
              onClick={start}
              disabled={busy || picked.length === 0}
              className="rounded-xl bg-danger px-4 py-3 text-base font-bold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {picked.length === 0 ? "Выберите игроков" : `Начать голосование (${picked.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
