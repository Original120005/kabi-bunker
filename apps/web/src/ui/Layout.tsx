import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useRoom } from "../store/room.ts";

function ConnectionBadge() {
  const connection = useRoom((s) => s.connection);
  if (connection === "idle" || connection === "online") return null;
  return (
    <span className="rounded-full border border-accent/50 px-3 py-1 text-xs text-accent">
      {connection === "connecting" ? "Подключение…" : "Переподключение…"}
    </span>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const inRoom = useLocation().pathname.startsWith("/room/");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <div className="flex items-center gap-4 px-4 py-3 xl:pl-14">
          <Link to="/" className="flex items-center gap-2 text-lg font-extrabold tracking-widest">
            <img src="/logo.png" alt="" className="h-9 w-9 rounded-full" />
            <span>
              <span className="text-accent">КАБИ</span>-БУНКЕР
            </span>
          </Link>
          <div className="flex-1" />
          {!inRoom && (
            <Link to="/leaders" className="text-sm font-semibold text-accent-2 hover:underline">
              Таблица лидеров
            </Link>
          )}
          <ConnectionBadge />
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line px-4 py-6 text-center text-xs text-muted">
        Каби-бункер — игра для своих. Фанатский проект, не связан с bunker-online.com.
      </footer>
    </div>
  );
}
