import type { CardView, CharacteristicView, GamePlayerView, GameView, VisibleCardView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";
import { Section } from "../ui/Section.tsx";
import { CardTitle, LevelsHint } from "./Hint.tsx";

export function Lock({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d={open ? "M8 11V7a4 4 0 0 1 7.6-1.8" : "M8 11V7a4 4 0 0 1 8 0v4"} />
    </svg>
  );
}

function RevealButton({ card, canReveal }: { card: VisibleCardView; canReveal: boolean }) {
  const send = useRoom((s) => s.send);
  const reveal = () => {
    if (card.revealed || !canReveal) return;
    send({ type: "card.setRevealed", cardId: card.id, revealed: true });
  };
  return (
    <button
      onClick={reveal}
      disabled={card.revealed || !canReveal}
      title={card.revealed ? "Открыто всем" : canReveal ? "Нажмите, чтобы открыть всем" : "Закрыто"}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${
        card.revealed
          ? "border-ok/50 bg-ok/15 text-[#5fb784]"
          : "border-danger/50 bg-danger/15 text-[#ff7b70] enabled:hover:bg-danger/30 enabled:hover:text-white"
      }`}
    >
      <Lock open={card.revealed} />
    </button>
  );
}

function CardValue({ card, canReveal, align }: { card: CardView; canReveal: boolean; align: "right" | "left" }) {
  if (card.hidden) return <span className="text-muted">скрыто</span>;
  return (
    <div className="flex items-center gap-2.5">
      <div className={`min-w-0 flex-1 ${align === "right" ? "sm:text-right" : ""}`}>
        {align === "right" ? (
          <div className="font-bold leading-snug text-white">
            <CardTitle card={card} align="right" />
          </div>
        ) : (
          <>
            <div className="font-bold leading-snug text-white">{card.label}</div>
            {card.abilities.map((a, i) => (
              <div key={i} className="mt-1 text-xs leading-snug text-white/80">
                <span className="font-semibold text-accent-2">{a.name}:</span> {a.text}
              </div>
            ))}
          </>
        )}
        {card.description && <div className="mt-0.5 text-xs leading-snug text-white/60">{card.description}</div>}
      </div>
      <RevealButton card={card} canReveal={canReveal} />
    </div>
  );
}

function Row({ def, cards, canReveal }: { def: CharacteristicView; cards: CardView[]; canReveal: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex shrink-0 items-center gap-1.5 text-sm font-semibold leading-tight text-muted sm:w-48">
        <span className="min-w-0">{def.name}</span>
        <LevelsHint def={def} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {cards.map((card) => (
          <CardValue key={card.id} card={card} canReveal={canReveal} align="right" />
        ))}
      </div>
    </div>
  );
}

export function MyInfo({ game, me }: { game: GameView; me: GamePlayerView }) {
  const canReveal = me.status === "alive";
  const regular = game.characteristics.filter((c) => !c.specialCard);
  const special = game.characteristics.filter((c) => c.specialCard);
  const rows = Math.ceil(regular.length / 2);

  return (
    <Section id="me" plain title={<>Информация о <span className="text-accent">{me.nickname}</span></>}>
      <div className="grid gap-2 lg:grid-flow-col lg:grid-cols-2 lg:grid-rows-[repeat(var(--rows),auto)]" style={{ ["--rows" as string]: rows }}>
        {regular.map((def) => (
          <Row key={def.key} def={def} cards={me.cards[def.key] ?? []} canReveal={canReveal} />
        ))}
      </div>
      {special.map((def) => (
        <div key={def.key} className="mt-4 grid gap-2 lg:grid-cols-2">
          {(me.cards[def.key] ?? []).map((card, i) => (
            <div key={card.id} className="rounded-xl border border-ok/50 bg-special px-3.5 py-3">
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-[#7fc99c]">
                {def.name} {i + 1}
              </div>
              <CardValue card={card} canReveal={canReveal} align="left" />
            </div>
          ))}
        </div>
      ))}
    </Section>
  );
}
