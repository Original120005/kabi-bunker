import { useState } from "react";
import type { CardView, GamePlayerView, RoomView, VisibleCardView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";
import { Section } from "../ui/Section.tsx";
import { ask } from "../ui/Confirm.tsx";
import { ApplySpecial } from "../host/ApplySpecial.tsx";
import { Avatar, outOfGame } from "./PlayersTable.tsx";

function SpecialCell({ card, isHost, owner, onApply }: { card: CardView | undefined; isHost: boolean; owner: GamePlayerView; onApply: (c: VisibleCardView) => void }) {
  const send = useRoom((s) => s.send);
  if (!card) return <span className="text-white/20">—</span>;
  if (!card.hidden && card.revealed) {
    const body = (
      <>
        <div className="flex items-start gap-2">
          <span className="flex-1 font-bold leading-snug text-white">{card.label}</span>
          {card.used && <span className="shrink-0 rounded-md bg-black/30 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#7fc99c]">✓ применено</span>}
        </div>
        {card.abilities[0] && <div className="mt-0.5 text-xs leading-snug text-white/65">{card.abilities[0].text}</div>}
        {isHost && !card.used && <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-accent-2">Нажмите, чтобы применить</div>}
      </>
    );
    const cls = `block w-full rounded-lg border px-3 py-2 text-left transition ${
      card.used ? "border-ok/25 bg-[#040c08]" : "border-ok/50 bg-special"
    }`;
    return isHost ? (
      <button onClick={() => onApply(card)} className={`${cls} hover:border-accent/70 hover:brightness-110`}>
        {body}
      </button>
    ) : (
      <div className={cls}>{body}</div>
    );
  }
  const reveal = async () => {
    if (await ask(`Открыть спец. возможность игрока ${owner.nickname} всем?`, { text: "Карта откроется от имени ведущего.", confirmLabel: "Открыть", tone: "ok" })) {
      send({ type: "card.setRevealed", cardId: card.id, revealed: true });
    }
  };
  return (
    <div className="group/sp flex h-full min-h-11 items-center justify-between gap-2 rounded-lg border border-dashed border-line/80 px-3 py-2 text-xs text-white/30">
      ещё не открыта
      {isHost && (
        <button onClick={reveal} className="rounded-md px-1.5 py-0.5 font-semibold text-transparent transition group-hover/sp:text-white/40 hover:!bg-ok/15 hover:!text-[#74c495]">
          открыть
        </button>
      )}
    </div>
  );
}

export function SpecialTable({ view }: { view: RoomView }) {
  const game = view.game!;
  const [applying, setApplying] = useState<{ card: VisibleCardView; owner: GamePlayerView } | null>(null);
  const special = game.characteristics.find((c) => c.specialCard);
  if (!special) return null;
  const slots = Array.from({ length: special.countPerPlayer }, (_, i) => i);
  const online = new Set(view.participants.filter((p) => p.online).map((p) => p.id));
  const isHost = view.me?.isHost === true;
  const used = game.players.reduce((n, p) => n + (p.cards[special.key] ?? []).filter((c) => !c.hidden && c.revealed).length, 0);
  const current = applying && game.players.find((p) => p.id === applying.owner.id);
  const freshCard = current?.cards[special.key]?.find((c): c is VisibleCardView => c.id === applying!.card.id && !c.hidden);

  return (
    <Section
      id="special"
      title={
        <>
          Таблица спец. возможностей{" "}
          <span className="text-accent">
            {used}/{game.players.length * special.countPerPlayer}
          </span>
        </>
      }
    >
      {isHost && <p className="mb-3 text-center text-xs text-muted">Нажмите на открытую спец. возможность, чтобы применить её. Откат — «Отменить предыдущее действие» в панели ведущего.</p>}
      <div className="flex flex-col gap-2">
        <div className="hidden grid-cols-[2rem_minmax(8rem,12rem)_repeat(var(--slots),minmax(0,1fr))] gap-3 px-3 text-[11px] font-bold uppercase tracking-wide text-muted md:grid" style={{ ["--slots" as string]: slots.length }}>
          <span>№</span>
          <span>Имя</span>
          {slots.map((i) => (
            <span key={i}>
              {special.name} {i + 1}
            </span>
          ))}
        </div>
        {game.players.map((p) => {
          const cards = p.cards[special.key] ?? [];
          return (
            <div
              key={p.id}
              style={{ ["--slots" as string]: slots.length }}
              className={`grid grid-cols-[2rem_1fr] items-stretch gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 md:grid-cols-[2rem_minmax(8rem,12rem)_repeat(var(--slots),minmax(0,1fr))] ${
                outOfGame(p.status) ? "player-out" : p.id === view.me?.id ? "border-accent/50 bg-accent/[0.05]" : "border-line/70 bg-panel-2/50"
              }`}
            >
              <span className="self-center text-sm font-bold text-muted">{p.seat}</span>
              <div className="flex items-center gap-2">
                <Avatar name={p.nickname} src={p.avatarUrl} online={online.has(p.id)} size="sm" />
                <span className={`min-w-0 break-words text-sm font-bold ${p.id === view.me?.id ? "text-accent-2" : ""}`}>{p.nickname}</span>
              </div>
              {slots.map((i) => (
                <div key={i} className="col-span-2 text-sm md:col-span-1">
                  <SpecialCell card={cards[i]} isHost={isHost} owner={p} onApply={(card) => setApplying({ card, owner: p })} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {applying && freshCard && current && <ApplySpecial game={game} card={freshCard} owner={current} onClose={() => setApplying(null)} />}
    </Section>
  );
}
