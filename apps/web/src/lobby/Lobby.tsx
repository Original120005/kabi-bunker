import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ParticipantView, RoomView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";
import { toast } from "../store/toasts.ts";
import { Button } from "../ui/Button.tsx";
import { Modal } from "../ui/Modal.tsx";
import { ask } from "../ui/Confirm.tsx";
import { ReadyCheck } from "./ReadyCheck.tsx";
import { Avatar } from "../game/PlayersTable.tsx";
import { Leaderboard } from "../pages/Leaderboard.tsx";

function KickDialog({ target, onClose }: { target: ParticipantView; onClose: () => void }) {
  const send = useRoom((s) => s.send);
  const kick = async (ban: boolean) => {
    if (await send({ type: "lobby.kick", participantId: target.id, ban })) onClose();
  };
  return (
    <Modal title={`Исключить ${target.nickname}?`} onClose={onClose}>
      <p className="mb-5 text-center text-sm text-muted">Исключённый может вернуться по ссылке, заблокированный — нет.</p>
      <div className="flex flex-col gap-2">
        <Button onClick={() => kick(false)}>Исключить</Button>
        <Button variant="danger" onClick={() => kick(true)}>
          Исключить и заблокировать
        </Button>
        <Button onClick={onClose}>Отмена</Button>
      </div>
    </Modal>
  );
}

function Candidate({ p, isMe, canKick, onKick }: { p: ParticipantView; isMe: boolean; canKick: boolean; onKick: () => void }) {
  return (
    <div className={`relative flex w-32 shrink-0 flex-col items-center gap-2 rounded-xl border p-3 ${isMe ? "border-accent/70" : "border-line"} bg-panel-2`}>
      {canKick && (
        <button onClick={onKick} className="absolute right-1 top-1 h-6 w-6 rounded text-muted hover:bg-danger hover:text-white" aria-label="Исключить">
          ×
        </button>
      )}
      <Avatar name={p.nickname} src={p.avatarUrl} online={p.online} size="lg" />
      <div className="w-full truncate text-center text-sm font-semibold">{p.nickname}</div>
      <div className="text-xs text-muted">{isMe ? "Это вы" : p.isHost ? "Ведущий" : p.online ? "В сети" : "Не в сети"}</div>
    </div>
  );
}

export function Lobby({ view }: { view: RoomView }) {
  const { send } = useRoom();
  const navigate = useNavigate();
  const [kickTarget, setKickTarget] = useState<ParticipantView | null>(null);
  const [leaders, setLeaders] = useState(false);
  const me = view.me;
  const isHost = me?.isHost === true;
  const players = view.participants.filter((p) => p.role === "player");
  const spectators = view.participants.filter((p) => p.role === "spectator");
  const { minPlayers, maxPlayers } = view.settings;
  const link = `${location.origin}/room/${view.code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("ok", "Ссылка скопирована");
    } catch {
      toast("error", "Не удалось скопировать — выделите ссылку вручную");
    }
  };

  const leave = async () => {
    if (await send({ type: "lobby.leave" })) navigate("/");
  };

  const close = async () => {
    if (await ask("Закрыть комнату?", { text: "Все участники будут отключены.", confirmLabel: "Закрыть", tone: "danger" })) await send({ type: "room.close" });
  };

  return (
    <div>
      <section className="hero-bg flex min-h-[460px] flex-col items-center justify-center px-4 py-14 text-center">
        <h1 className="mb-4 text-3xl font-extrabold drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] sm:text-4xl">Ожидание игроков</h1>
        <Button className="mb-6" onClick={() => setLeaders(true)}>
          Таблица лидеров
        </Button>
        {isHost ? (
          <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/70 p-6 shadow-2xl">
            <p>Пригласите пользователей по ссылке ниже</p>
            <div className="flex w-full gap-2">
              <input readOnly value={link} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-lg border border-line bg-bg/80 px-3 py-2 font-mono text-sm" />
              <Button variant="primary" onClick={copy}>
                Копировать
              </Button>
            </div>
            <p className="text-sm text-white/80">
              Код комнаты: <span className="font-mono font-bold text-accent">{view.code}</span>
            </p>
            <p>
              Чтобы начать игру, нужно как минимум {minPlayers} человек.{" "}
              <span className="font-bold text-accent">
                ({players.length}/{maxPlayers})
              </span>
            </p>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-[#f0a030]" checked={view.settings.hostPlays} onChange={(e) => send({ type: "lobby.setHostPlays", value: e.target.checked })} />
              Ведущий также и игрок
            </label>
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="danger" onClick={close}>
                Закрыть комнату
              </Button>
              <Button variant="ok" disabled={players.length < minPlayers} onClick={() => send({ type: "lobby.startReadyCheck" })}>
                Начать игру
              </Button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/70 p-6 shadow-2xl">
            {me?.role === "player" ? (
              <p>
                Вы успешно зарегистрировались в игру, <span className="font-bold text-accent">{me.nickname}</span>!
              </p>
            ) : (
              <p>Вы наблюдаете за комнатой как зритель.</p>
            )}
            <p className="text-sm">
              Ожидаем других игроков… ({players.length}/{maxPlayers})
            </p>
            <p className="mt-2">Минимальное количество игроков: {minPlayers}</p>
            <p>Максимальное количество игроков: {maxPlayers}</p>
            <p className="text-sm text-white/70">Только ведущий может начать игру</p>
            <Button className="mt-2" onClick={leave}>
              Выйти из очереди
            </Button>
          </div>
        )}
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8">
        <h2 className="mb-4 text-center text-xl font-bold">Кандидаты в бункер</h2>
        <div className="flex flex-wrap justify-center gap-3">
          {players.map((p) => (
            <Candidate key={p.id} p={p} isMe={p.id === me?.id} canKick={isHost && p.id !== me?.id} onKick={() => setKickTarget(p)} />
          ))}
          {players.length === 0 && <p className="w-full text-center text-muted">Пока никого нет</p>}
        </div>

        {spectators.length > 0 && (
          <>
            <h3 className="mb-3 mt-8 text-center font-bold text-muted">Зрители</h3>
            <div className="flex flex-wrap justify-center gap-3">
              {spectators.map((p) => (
                <Candidate key={p.id} p={p} isMe={p.id === me?.id} canKick={isHost && p.id !== me?.id} onKick={() => setKickTarget(p)} />
              ))}
            </div>
          </>
        )}

        {isHost && view.banned.length > 0 && (
          <div className="mx-auto mt-8 max-w-md rounded-xl border border-line bg-panel p-4">
            <h3 className="mb-2 font-bold">Заблокированные</h3>
            {view.banned.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-1 text-sm">
                <span>{b.nickname}</span>
                <Button className="px-3 py-1" onClick={() => send({ type: "lobby.unban", id: b.id })}>
                  Разблокировать
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {view.status === "readyCheck" && <ReadyCheck view={view} />}
      {kickTarget && <KickDialog target={kickTarget} onClose={() => setKickTarget(null)} />}
      {leaders && (
        <div className="overlay-in fixed inset-0 z-50 overflow-y-auto bg-bg">
          <Leaderboard onClose={() => setLeaders(false)} />
        </div>
      )}
    </div>
  );
}
