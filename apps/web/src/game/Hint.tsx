import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CharacteristicView, VisibleCardView } from "@bunker/shared";

/** Card title. Professions show their abilities; diseases show a short note and a Wikipedia link. */
export function CardTitle({ card, align = "center", className = "" }: { card: VisibleCardView; align?: "center" | "left" | "right"; className?: string }) {
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);
  const hideTimer = useRef<number | null>(null);
  const hasTip = card.abilities.length > 0 || !!card.description || !!card.link;
  if (!hasTip) return <span className={className}>{card.label}</span>;
  const title = card.title && card.label.startsWith(card.title) ? card.title : card.label;
  const cancelHide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const show = (el: HTMLElement) => {
    cancelHide();
    const r = el.getBoundingClientRect();
    const width = 288;
    let left = align === "left" ? r.left : align === "right" ? r.right - width : r.left + r.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setTip({ top: r.bottom + 8, left });
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setTip(null), 160);
  };
  return (
    <span
      tabIndex={0}
      className={`inline cursor-help outline-none ${className}`}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={scheduleHide}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={scheduleHide}
    >
      <span className="text-accent-2">{title}</span>
      {card.label.slice(title.length)}
      {tip &&
        createPortal(
          <span
            className="fixed z-[80] w-72 rounded-lg border border-line bg-bg p-3 text-left text-xs font-normal normal-case leading-snug shadow-xl shadow-black/60"
            style={{ top: tip.top, left: tip.left }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            onMouseDown={(e) => e.preventDefault()}
          >
            {card.abilities.map((a, i) => (
              <span key={i} className={`block ${i ? "mt-2" : ""}`}>
                <span className="block font-bold text-accent-2">{a.name}</span>
                <span className="text-white/85">{a.text}</span>
              </span>
            ))}
            {card.description && <span className={`block text-white/85 ${card.abilities.length ? "mt-2" : ""}`}>{card.description}</span>}
            {card.link && (
              <a href={card.link} target="_blank" rel="noopener noreferrer" className="mt-2 block font-bold text-accent-2 underline">
                Открыть в Википедии
              </a>
            )}
          </span>,
          document.body,
        )}
    </span>
  );
}

/** «i» tooltip with experience levels; opens on hover and on tap. */
export function LevelsHint({ def }: { def: CharacteristicView }) {
  if (!def.levels.length) return null;
  return (
    <span className="group relative inline-flex shrink-0 align-middle">
      <button tabIndex={0} className="h-4 w-4 rounded-full border border-muted text-[10px] leading-none text-muted" aria-label={`Стаж: ${def.name}`}>
        i
      </button>
      <span className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-56 -translate-x-1/2 rounded-lg border border-line bg-bg p-3 text-left text-xs font-normal normal-case shadow-xl group-focus-within:block group-hover:block">
        {def.levels.map((l) => (
          <span key={l.label} className="flex justify-between gap-2">
            <span className="font-semibold">{l.label}</span>
            <span className="text-muted">{l.hint}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
