import { useState } from "react";
import { FINALE_TIMING, type FinaleFactorView, type FinaleView, type RoomView } from "@bunker/shared";
import { Avatar } from "./PlayersTable.tsx";
import { useServerNow } from "./RaidPopup.tsx";

const LEVEL_COLOR: Record<string, string> = {
  "очень высокий": "text-[#74c495]",
  высокий: "text-[#9fd8a8]",
  средний: "text-accent-2",
  низкий: "text-[#ff9a80]",
  "очень низкий": "text-[#ff7b70]",
};

function Marks({ tone, strength }: { tone: FinaleFactorView["tone"]; strength: 1 | 2 | 3 }) {
  if (tone === "neutral") return <span className="w-12 shrink-0 text-center text-sm font-black text-white/40">•</span>;
  const sign = tone === "good" ? "▲" : "▼";
  return (
    <span className={`w-12 shrink-0 text-center text-sm font-black tracking-tight ${tone === "good" ? "text-[#74c495]" : "text-[#ff7b70]"}`} aria-label={`${tone === "good" ? "плюс" : "минус"}, сила ${strength} из 3`}>
      {sign.repeat(strength)}
    </span>
  );
}

function FactorRow({ f }: { f: FinaleFactorView }) {
  const border = f.tone === "good" ? "border-[#0f4a2c]/80" : f.tone === "bad" ? "border-[#8a2a22]/80" : "border-line";
  return (
    <li className={`pop-in flex items-start gap-2 rounded-xl border bg-panel-2/60 px-3 py-2 ${border}`}>
      <Marks tone={f.tone} strength={f.strength} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold leading-snug text-white">{f.label}</div>
        {f.detail && <div className="mt-0.5 text-xs leading-snug text-white/65">{f.detail}</div>}
      </div>
    </li>
  );
}

function Rows({ finale }: { finale: FinaleView }) {
  const rows = [...(finale.rows ?? [])].sort((a, b) => b.delta - a.delta);
  return (
    <div className="pop-in mt-5">
      <h3 className="mb-2 text-center text-sm font-bold uppercase tracking-wider text-muted">Рейтинг за партию</h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.playerId} className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/60 px-3 py-2">
            <Avatar name={r.nickname} src={r.avatarUrl} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{r.nickname}</div>
              <div className="text-xs text-muted">{r.reason}</div>
            </div>
            {r.rated ? (
              <span className={`text-lg font-black ${r.delta > 0 ? "text-[#74c495]" : r.delta < 0 ? "text-[#ff7b70]" : "text-white/50"}`}>{r.delta > 0 ? `+${r.delta}` : r.delta}</span>
            ) : (
              <span className="text-xs text-muted">без рейтинга</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * «Итоги партии» for everyone: factors appear one by one, then the last event inside the bunker,
 * the chance in words, the verdict and the rating table. The server sends the verdict only when it is due.
 */
export function FinalePopup({ view }: { view: RoomView }) {
  const finale = view.game?.finale ?? null;
  const [hidden, setHidden] = useState<string | null>(null);
  const now = useServerNow(250);
  if (!finale) return null;
  if (hidden === finale.id) {
    return (
      <button
        onClick={() => setHidden(null)}
        className="fixed bottom-4 left-1/2 z-[30] -translate-x-1/2 rounded-full border border-accent/50 bg-panel/95 px-5 py-2.5 text-sm font-bold text-accent-2 shadow-xl shadow-black/60 hover:bg-accent/15"
      >
        Итоги партии: {finale.survived ? "бункер выжил" : "бункер не выжил"} — показать
      </button>
    );
  }

  const t = now - finale.at - FINALE_TIMING.startDelayMs;
  const shown = Math.max(0, Math.min(finale.factors.length, Math.floor(t / FINALE_TIMING.factorMs) + 1));
  const listEnd = finale.factors.length * FINALE_TIMING.factorMs;
  const showEvent = t >= listEnd;
  const showLevel = t >= listEnd + FINALE_TIMING.eventMs;
  const verdict = finale.survived;
  const close = () => setHidden(finale.id);

  return (
    <div className="overlay-in fixed inset-0 z-[62] flex items-center justify-center bg-black/85 p-3" onClick={verdict !== null ? close : undefined}>
      <div onClick={(e) => e.stopPropagation()} className="pop-in no-scrollbar flex max-h-[94vh] w-full max-w-2xl flex-col overflow-y-auto rounded-3xl border border-accent/30 bg-panel shadow-2xl shadow-black/70">
        <div className="px-5 pb-6 pt-5 sm:px-7">
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-accent">Итоги партии</p>
          <h2 className="mt-1 text-center text-2xl font-extrabold">Выживет ли бункер?</h2>

          <ul className="mt-5 flex flex-col gap-1.5">
            {finale.factors.slice(0, shown).map((f, i) => (
              <FactorRow key={i} f={f} />
            ))}
          </ul>

          {showEvent && finale.finalEvent && (
            <div className={`pop-in mt-4 overflow-hidden rounded-2xl border ${finale.finalEvent.tone === "good" ? "border-[#0f4a2c]" : "border-[#8a2a22]"} bg-panel-2/70`}>
              {finale.finalEvent.image && <img src={finale.finalEvent.image} alt="" className="h-28 w-full object-cover" />}
              <div className="px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Уже в бункере</p>
                <div className="text-base font-extrabold">{finale.finalEvent.title}</div>
                <p className="mt-1 text-sm leading-snug text-white/80">{finale.finalEvent.text}</p>
                <p className={`mt-2 text-sm font-bold ${finale.finalEvent.solved === false ? "text-[#ff7b70]" : "text-[#74c495]"}`}>{finale.finalEvent.outcome}</p>
              </div>
            </div>
          )}

          {showLevel && (
            <p className="pop-in mt-5 text-center text-lg font-bold">
              Шанс выжить: <span className={LEVEL_COLOR[finale.level] ?? "text-white"}>{finale.level}</span>
            </p>
          )}

          {verdict === null && showLevel && <p className="mt-3 animate-pulse text-center text-sm text-muted">Решается судьба бункера…</p>}

          {verdict !== null && (
            <>
              <div className={`pop-in mt-4 rounded-2xl border px-4 py-4 text-center ${verdict ? "border-[#0f4a2c] bg-[#0c2416]" : "border-[#8a2a22] bg-[#2a0f0c]"}`}>
                <div className={`text-3xl font-black ${verdict ? "text-[#74c495]" : "text-[#ff7b70]"}`}>{verdict ? "Бункер выжил!" : "Бункер не выжил"}</div>
                <p className="mt-1 text-sm text-white/75">{verdict ? "Люди дождались выхода на поверхность. Каждому внутри +10 к рейтингу." : "Бункер не справился с испытаниями."}</p>
              </div>
              <Rows finale={finale} />
              <button onClick={close} className="mt-6 w-full rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm font-bold hover:border-accent hover:text-accent-2">
                Закрыть
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
