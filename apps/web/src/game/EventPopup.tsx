import { useState } from "react";
import { RAID, type RoomView } from "@bunker/shared";
import { Avatar } from "./PlayersTable.tsx";
import { Reel, useSpinDone } from "./RaidPopup.tsx";

const TONE = {
  good: { label: "Удача", badge: "text-[#7fc99c]", border: "border-[#0f4a2c]" },
  bad: { label: "Угроза", badge: "text-[#ff8a80]", border: "border-[#8a2a22]" },
  mixed: { label: "Развилка", badge: "text-accent-2", border: "border-accent/50" },
} as const;

/** Full-screen event. A player reel, when there is one, uses the same spin as a raid. Each player closes it only for themselves. */
export function EventPopup({ view }: { view: RoomView }) {
  const event = view.event;
  const [hidden, setHidden] = useState<number | null>(null);
  const spin = event?.spin ?? null;
  const done = useSpinDone(spin?.at ?? Number.MAX_SAFE_INTEGER, RAID.pickSpinMs);
  if (!event || hidden === event.id) return null;
  const tone = TONE[event.tone];
  const closable = !spin || done;
  const name = (id: string) => view.game?.players.find((p) => p.id === id)?.nickname ?? "Игрок";
  const avatarOf = (id: string) => view.game?.players.find((p) => p.id === id)?.avatarUrl ?? null;
  const winner = spin ? spin.reel[RAID.reelWinIndex] : null;
  const close = () => {
    if (closable) setHidden(event.id);
  };

  return (
    <div className="overlay-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`pop-in no-scrollbar flex max-h-[92vh] w-full max-w-xl flex-col overflow-y-auto rounded-3xl border bg-panel shadow-2xl shadow-black/70 ${tone.border}`}
      >
        {event.image && <img src={event.image} alt="" className="h-40 w-full shrink-0 object-cover sm:h-48" />}
        <div className="px-6 pb-6 pt-5">
          <p className={`text-xs font-bold uppercase tracking-[0.18em] ${tone.badge}`}>{tone.label}</p>
          <h2 className="mt-2 text-2xl font-extrabold leading-tight">{event.title}</h2>
          {spin && (
            <div className="mt-4">
              <p className="mb-2 text-center text-sm font-semibold text-muted">{spin.effect.kind === "health" ? "Кто получит это в здоровье" : "Кому это достанется в рюкзак"}</p>
              <Reel
                cellWidth={132}
                startAt={spin.at}
                duration={RAID.pickSpinMs}
                offset={spin.offset}
                done={done}
                cells={spin.reel.map((id, i) => (
                  <div key={i} className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-panel-2 px-1">
                    <Avatar name={name(id)} src={avatarOf(id)} />
                    <span className="w-full truncate text-center text-sm font-bold">{name(id)}</span>
                  </div>
                ))}
              />
              <div className="mt-3 flex h-10 items-center justify-center text-center text-sm font-extrabold">
                {done && winner && (
                  <span className="pop-in">
                    <span className="text-accent-2">{name(winner)}</span>
                    {spin.effect.kind === "health" ? ` — в здоровье: ${spin.effect.title}` : ` получает «${spin.effect.title}»`}
                  </span>
                )}
              </div>
            </div>
          )}
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-white/90">{event.text}</p>
          {closable && (
            <button onClick={close} className="mt-6 w-full rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm font-bold hover:border-accent hover:text-accent-2">
              Понятно
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
