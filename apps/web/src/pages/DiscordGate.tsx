import { Link } from "react-router-dom";

/** Shown instead of a nickname form. The return path is only a local route, checked again on the server. */
export function DiscordGate({ next, configured }: { next: string; configured: boolean }) {
  const href = `/api/auth/discord?next=${encodeURIComponent(next)}`;
  return (
    <div className="hero-bg flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 text-center shadow-2xl">
        <img src="/logo.png" alt="" className="mx-auto mb-4 h-20 w-20 rounded-full" />
        <h1 className="text-2xl font-extrabold">Вход в игру</h1>
        <p className="mt-2 text-sm text-white/75">Игроки входят через Discord. Ник и аватарка берутся из аккаунта и сохраняются между комнатами.</p>
        {configured ? (
          <a href={href} className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-accent to-accent-2 px-4 py-3 text-base font-semibold text-black hover:brightness-110">
            Войти через Discord
          </a>
        ) : (
          <p className="mt-5 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-left text-sm text-accent-2">
            Discord ещё не подключён. В файл .env нужно добавить DISCORD_CLIENT_ID и DISCORD_CLIENT_SECRET, затем перезапустить игру.
          </p>
        )}
        <Link to="/leaders" className="mt-4 inline-block text-sm font-semibold text-accent-2 hover:underline">
          Таблица лидеров
        </Link>
      </div>
    </div>
  );
}
