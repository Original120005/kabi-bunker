import { useState, type ReactNode } from "react";
import { pluralRu, type RoomView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";
import { ask } from "../ui/Confirm.tsx";
import { Avatar } from "./PlayersTable.tsx";

/** `closeOnCard` closes on a tap anywhere, otherwise only on the dimmed backdrop. */
function Shell({ children, wide, onClose, closeOnCard }: { children: ReactNode; wide?: boolean; onClose: () => void; closeOnCard?: boolean }) {
  return (
    <div className="overlay-in fixed inset-0 z-[55] flex items-center justify-center bg-black/80 p-3" onClick={onClose}>
      <div
        onClick={closeOnCard ? undefined : (e) => e.stopPropagation()}
        className={`pop-in no-scrollbar max-h-[96vh] w-full overflow-y-auto rounded-3xl border border-accent/30 bg-panel shadow-2xl shadow-black/70 ${closeOnCard ? "cursor-pointer" : ""} ${wide ? "max-w-3xl" : "max-w-xl"}`}
      >
        {children}
      </div>
    </div>
  );
}

function Ballot({ view, onLater }: { view: RoomView; onLater: () => void }) {
  const send = useRoom((s) => s.send);
  const vote = view.vote!;
  const game = view.game!;
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = game.players.filter((p) => vote.candidates.includes(p.id) && p.id !== view.me?.id);

  const cast = async () => {
    if (!choice) return;
    setBusy(true);
    await send({ type: "vote.cast", candidateId: choice });
    setBusy(false);
  };

  return (
    <Shell onClose={onLater}>
      <div className="hero-bg px-6 pb-4 pt-6 text-center">
        <h2 className="text-2xl font-extrabold drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">Голосование</h2>
        <p className="mt-1 text-sm text-white/80">Кого вы не хотите видеть в бункере?</p>
        <p className="mt-2 text-xs text-white/60">
          Проголосовали {vote.voted.length} из {vote.voters.length}
        </p>
      </div>
      <div className="px-5 pb-5 pt-4 sm:px-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.map((p) => (
            <button
              key={p.id}
              onClick={() => setChoice(p.id)}
              className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left transition ${
                choice === p.id ? "border-danger bg-danger/20 ring-1 ring-danger" : "border-line bg-panel-2/70 hover:border-white/30"
              }`}
            >
              <Avatar name={p.nickname} src={p.avatarUrl} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{p.nickname}</span>
                <span className="text-xs text-muted">№ {p.seat}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-[auto_1fr] gap-2">
          <button onClick={onLater} className="rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm font-semibold hover:border-white/30">
            Позже
          </button>
          <button
            onClick={cast}
            disabled={!choice || busy}
            className="rounded-xl bg-danger px-4 py-3 text-base font-bold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {choice ? `Голосовать против ${options.find((p) => p.id === choice)?.nickname}` : "Выберите игрока"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Results({ view, onClose }: { view: RoomView; onClose: () => void }) {
  const send = useRoom((s) => s.send);
  const vote = view.vote!;
  const game = view.game!;
  const isHost = view.me?.isHost === true;
  const name = (id: string) => game.players.find((p) => p.id === id)?.nickname ?? "Игрок";
  const results = vote.results ?? [];
  const max = Math.max(1, ...results.map((r) => r.voters.length));
  const top = results[0]?.voters.length ?? 0;
  const leaders = results.filter((r) => r.voters.length === top && top > 0);
  const missing = vote.voters.filter((v) => !vote.voted.includes(v));

  const exile = async (id: string) => {
    if (await ask(`Изгнать игрока ${name(id)}?`, { confirmLabel: "Изгнать", tone: "danger" })) send({ type: "host.exile", playerId: id });
  };

  const many = results.length > 4;

  return (
    <Shell wide={many} onClose={onClose} closeOnCard>
      <div className="hero-bg px-6 pb-3 pt-5 text-center">
        <h2 className="text-2xl font-extrabold drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">Результаты голосования</h2>
        <p className="mt-1 text-sm text-white/85">
          {leaders.length === 0
            ? "Никто не проголосовал"
            : leaders.length === 1
              ? `Больше всего голосов против: ${name(leaders[0].candidateId)}`
              : `Ничья: ${leaders.map((l) => name(l.candidateId)).join(", ")}`}
        </p>
        {missing.length > 0 && <p className="mt-1 text-xs text-white/60">Не проголосовали: {missing.map(name).join(", ")}</p>}
      </div>
      <div className="px-4 pb-4 pt-3 sm:px-5">
        <div className={`grid gap-1.5 ${many ? "grid-cols-2" : "grid-cols-1"}`}>
          {results.map((r) => {
            const p = game.players.find((x) => x.id === r.candidateId);
            const leader = r.voters.length === top && top > 0;
            return (
              <div key={r.candidateId} className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 ${leader ? "border-danger/50 bg-danger/10" : "border-line bg-panel-2/60"}`}>
                <span className="hidden sm:block">
                  <Avatar name={name(r.candidateId)} src={p?.avatarUrl} size="sm" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-bold">{name(r.candidateId)}</span>
                    <span className={`shrink-0 text-xs font-extrabold ${leader ? "text-[#ff7b70]" : "text-muted"}`}>
                      {r.voters.length} {pluralRu(r.voters.length, "голос", "голоса", "голосов")}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
                    <div className={`h-full rounded-full ${leader ? "bg-danger" : "bg-white/30"}`} style={{ width: `${(r.voters.length / max) * 100}%` }} />
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted" title={r.voters.map(name).join(", ")}>
                    {r.voters.length > 0 ? r.voters.map(name).join(", ") : "—"}
                  </div>
                </div>
                {isHost && p?.status === "alive" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      exile(r.candidateId);
                    }}
                    className="shrink-0 rounded-lg border border-danger/50 px-2 py-1 text-xs font-bold text-[#ff8a80] hover:bg-danger/20"
                  >
                    Изгнать
                  </button>
                )}
                {p?.status === "exiled" && <span className="shrink-0 rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#ff8a80]">изгнан</span>}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button onClick={onClose} className="min-w-44 rounded-xl border border-line bg-panel-2 px-5 py-2.5 text-sm font-semibold hover:border-white/30">
            Закрыть окно
          </button>
          {isHost && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                send({ type: "host.vote.clear" });
              }}
              className="min-w-44 rounded-xl bg-gradient-to-r from-accent to-accent-2 px-5 py-2.5 text-sm font-bold text-black hover:brightness-110"
            >
              Убрать результаты у всех
            </button>
          )}
        </div>      </div>
    </Shell>
  );
}

/** Popup for the current vote: ballot for those who have not voted, progress for others, results when closed. */
export function VotePopup({ view }: { view: RoomView }) {
  const vote = view.vote;
  const [laterId, setLaterId] = useState<number | null>(null);
  const [closedId, setClosedId] = useState<number | null>(null);
  if (!vote || !view.game) return null;
  const meId = view.me?.id ?? "";
  const canVote = vote.status === "open" && vote.voters.includes(meId) && !vote.voted.includes(meId);

  if (vote.status === "closed") {
    if (closedId === vote.id) return null;
    return <Results view={view} onClose={() => setClosedId(vote.id)} />;
  }
  if (canVote && laterId !== vote.id) return <Ballot view={view} onLater={() => setLaterId(vote.id)} />;

  const mine = vote.myVote && view.game.players.find((p) => p.id === vote.myVote)?.nickname;
  return (
    <div className="fixed bottom-4 left-1/2 z-[45] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-accent/40 bg-panel/95 px-4 py-3 shadow-2xl shadow-black/60">
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">
            Голосование: {vote.voted.length} из {vote.voters.length}
          </div>
          <div className="truncate text-xs text-muted">{mine ? `Ваш голос: против ${mine}` : canVote ? "Вы ещё не проголосовали" : "Ждём, пока проголосуют все"}</div>
        </div>
        {canVote && (
          <button onClick={() => setLaterId(null)} className="shrink-0 rounded-lg bg-danger px-3 py-1.5 text-sm font-bold text-white hover:brightness-110">
            Голосовать
          </button>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-all" style={{ width: `${(vote.voted.length / Math.max(1, vote.voters.length)) * 100}%` }} />
      </div>
    </div>
  );
}
