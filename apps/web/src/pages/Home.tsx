import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.ts";
import { recentRooms } from "../lib/recent.ts";
import { useSession } from "../lib/session.ts";
import { Button } from "../ui/Button.tsx";
import { toast } from "../store/toasts.ts";
import { Avatar } from "../game/PlayersTable.tsx";
import { DiscordGate } from "./DiscordGate.tsx";

export function Home() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const session = useSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const recent = recentRooms();

  useEffect(() => {
    if (params.get("auth") === "failed") toast("error", "Не удалось войти через Discord. Попробуйте ещё раз.");
  }, [params]);

  const create = async () => {
    setBusy(true);
    try {
      const { code: room } = await api.createRoom();
      navigate(`/room/${room}`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase().replace(/.*\/ROOM\//, "");
    if (clean) navigate(`/room/${clean}`);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    session.refresh();
  };

  return (
    <div>
      <section className="hero-bg px-4 pb-16 pt-10 text-center sm:pb-24">
        <img src="/logo.png" alt="Каби-бункер" className="mx-auto mb-6 h-40 w-40 rounded-full shadow-[0_0_60px_rgba(240,160,48,0.35)] sm:h-52 sm:w-52" />
        <h1 className="text-3xl font-extrabold sm:text-5xl">
          Каби-бункер! <span className="block text-accent sm:inline">Докажи всем,</span>
        </h1>
        <p className="mt-3 text-lg text-white/80 sm:text-2xl">что именно ты должен попасть в бункер</p>
      </section>

      <section className="mx-auto -mt-10 max-w-xl px-4">
        {!session.ready ? (
          <div className="rounded-2xl border border-line bg-panel p-6 text-center text-muted">Проверка входа…</div>
        ) : !session.user ? (
          <DiscordGate next="/" configured={session.configured} />
        ) : (
          <div className="rounded-2xl border border-line bg-panel p-6 shadow-2xl">
            <div className="mb-5 flex items-center gap-3">
              <Avatar name={session.user.displayName} src={session.user.avatarUrl} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-bold">{session.user.displayName}</div>
                <div className="text-xs text-muted">
                  Рейтинг {session.user.rating} · игр {session.user.games} · выживаемость {session.user.survivalPercent}%
                </div>
              </div>
              <button onClick={logout} className="text-xs font-semibold text-muted hover:text-white">
                Выйти
              </button>
            </div>
            <h2 className="mb-4 text-center text-xl font-bold">Создание игровой комнаты</h2>
            <Button variant="primary" className="w-full py-3 text-base" disabled={busy} onClick={create}>
              Создать игру
            </Button>
            <form onSubmit={join} className="mt-4 flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Введите ID игры для присоединения"
                className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-4 py-3 uppercase outline-none placeholder:normal-case focus:border-accent"
              />
              <Button type="submit">Войти</Button>
            </form>
            {recent.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-sm text-muted">Мои комнаты</h3>
                <div className="flex flex-wrap gap-2">
                  {recent.map((c) => (
                    <Button key={c} onClick={() => navigate(`/room/${c}`)} className="font-mono">
                      {c}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <Link to="/leaders" className="mt-5 block text-center text-sm font-semibold text-accent-2 hover:underline">
              Таблица лидеров
            </Link>
          </div>
        )}
      </section>

      <section className="mx-auto mt-10 max-w-3xl px-4 pb-10">
        <h2 className="mb-3 text-xl font-bold">Как играть?</h2>
        <div className="space-y-2 text-sm leading-relaxed text-white/80">
          <p>Произошла катастрофа. Свободных мест в бункере в два раза меньше, чем желающих туда попасть.</p>
          <p>
            Каждый получает случайного персонажа: пол и возраст, телосложение, черту характера, профессию, здоровье, хобби, фобию, инвентарь,
            рюкзак, дополнительное сведение и две специальные возможности. Сначала эти карты знает только владелец.
          </p>
          <p>Каждый раунд игроки открывают часть карт и доказывают, почему именно они нужны бункеру. Затем голосованием изгоняют самых бесполезных.</p>
          <p>Создайте комнату, отправьте ссылку друзьям и начните игру, когда соберётся от 6 до 15 человек.</p>
        </div>
      </section>
    </div>
  );
}
