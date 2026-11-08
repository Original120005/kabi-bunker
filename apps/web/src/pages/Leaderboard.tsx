import { useEffect, useState } from "react";
import { Avatar } from "../game/PlayersTable.tsx";

interface Row {
  place: number;
  displayName: string;
  avatarUrl: string | null;
  games: number;
  survivalPercent: number;
  rating: number;
}

const PLACE: Record<number, string> = {
  1: "border-accent/80 bg-accent/15 shadow-[0_0_24px_rgba(240,160,48,0.18)]",
  2: "border-white/35 bg-white/[0.04]",
  3: "border-[#c4844a]/80 bg-[#c4844a]/10",
};

const PLACE_TEXT: Record<number, string> = {
  1: "text-accent-2",
  2: "text-white",
  3: "text-[#e0a36a]",
};

export function Leaderboard({ onClose }: { onClose?: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    const timer = setTimeout(() => {
      const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      fetch(`/api/leaderboard${params}`)
        .then((r) => {
          if (!r.ok) throw new Error("fail");
          return r.json();
        })
        .then((d: { players: Row[]; total: number }) => {
          if (stop) return;
          setRows(d.players);
          setTotal(d.total);
          setError("");
        })
        .catch(() => {
          if (!stop) setError("Не удалось загрузить таблицу");
        });
    }, 180);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [q]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Таблица лидеров</h1>
          <p className="mt-1 text-sm text-muted">Общий рейтинг всех игроков. Он не зависит от комнаты.</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded-xl border border-line px-3 py-2 text-sm font-semibold hover:border-white/30">
            Закрыть
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск игрока по нику"
          className="w-full rounded-xl border border-line bg-panel px-4 py-3 outline-none focus:border-accent sm:max-w-sm"
        />
        <p className="text-sm text-muted">{total === 0 ? "Пока никого нет" : `Игроков: ${total}`}</p>
      </div>

      {error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-[#ffaaa3]">{error}</p>}

      {rows && rows.length === 0 && !error && (
        <div className="rounded-2xl border border-line bg-panel px-6 py-14 text-center">
          <img src="/logo.png" alt="" className="mx-auto mb-4 h-16 w-16 rounded-full opacity-80" />
          <p className="text-lg font-bold">{q.trim() ? "Никого не нашли" : "Рейтинг ещё пуст"}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            {q.trim() ? "Попробуйте другую часть ника." : "После первой завершённой партии здесь появятся игроки, их аватарки и рейтинг."}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {rows?.map((p) => (
          <div key={`${p.place}-${p.displayName}`} className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${PLACE[p.place] ?? "border-line bg-panel-2/50"}`}>
            <div className={`w-8 shrink-0 text-center text-lg font-black ${PLACE_TEXT[p.place] ?? "text-muted"}`}>{p.place}</div>
            <Avatar name={p.displayName} src={p.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-bold">{p.displayName}</div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                <span>
                  Игр <b className="text-white">{p.games}</b>
                </span>
                <span>
                  Выживаемость <b className="text-white">{p.survivalPercent}%</b>
                </span>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Рейтинг</div>
              <div className={`text-xl font-black tabular-nums ${p.rating < 0 ? "text-[#ff8a80]" : "text-accent-2"}`}>{p.rating}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
