import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { forgetRoom, rememberRoom } from "../lib/recent.ts";
import { useSession } from "../lib/session.ts";
import { useRoom } from "../store/room.ts";
import { Button } from "../ui/Button.tsx";
import { Lobby } from "../lobby/Lobby.tsx";
import { GameScreen } from "../game/GameScreen.tsx";
import { DiscordGate } from "./DiscordGate.tsx";

function Message({ title, text }: { title: string; text?: string }) {
  return (
    <div className="hero-bg flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      {text && <p className="text-white/80">{text}</p>}
      <Link to="/">
        <Button variant="primary">На главную</Button>
      </Link>
    </div>
  );
}

export function Room() {
  const code = (useParams().code ?? "").toUpperCase();
  const session = useSession();
  const { view, ended, connect, disconnect } = useRoom();

  useEffect(() => {
    if (!session.user) return;
    connect(code);
    return () => disconnect();
  }, [code, session.user, connect, disconnect]);

  useEffect(() => {
    if (view) rememberRoom(code);
  }, [view?.code]);

  useEffect(() => {
    if (ended) forgetRoom(code);
  }, [ended, code]);

  if (!session.ready) return <Message title="Проверка входа…" />;
  if (!session.user) return <DiscordGate next={`/room/${code}`} configured={session.configured} />;
  if (ended) return <Message title={ended} />;
  if (!view) return <Message title="Подключение к комнате…" />;
  if (view.status === "closed") return <Message title="Комната закрыта" />;
  return view.game ? <GameScreen view={view} /> : <Lobby view={view} />;
}
