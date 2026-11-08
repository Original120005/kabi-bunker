import { useEffect, useState } from "react";
import { effectInput, type GamePlayerView, type GameView, type SpecialEffect, type VisibleCardView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";
import { toast } from "../store/toasts.ts";
import { Avatar } from "../game/PlayersTable.tsx";

function charName(game: GameView, key: string) {
  return game.characteristics.find((c) => c.key === key)?.name ?? key;
}

function fieldName(game: GameView, key: string) {
  return game.bunker.fields.find((f) => f.key === key)?.name ?? key;
}

/** Plain-language result of the effect, shown before the host confirms. */
function describe(effect: SpecialEffect | null, game: GameView, owner: string): string {
  if (!effect) return "У этой карты нет автоматического действия. Выполните написанное вручную и отметьте карту как применённую.";
  const who = (t: string) => (t === "self" ? owner : t === "all" ? "всем игрокам в лагере" : "выбранному игроку");
  switch (effect.op) {
    case "bunker.reroll":
      return `«${fieldName(game, effect.field)}» в бункере заменится на случайное значение.`;
    case "bunker.addItem":
      return "В бункер добавится случайный предмет.";
    case "catastrophe.reroll":
      return "Катаклизм заменится на случайный.";
    case "seats":
      return `Мест в бункере станет ${game.bunker.seats + effect.delta}.`;
    case "rotate":
      return `Все игроки в лагере передадут «${charName(game, effect.charKey)}» соседу ${effect.dir === "cw" ? "по часовой стрелке" : "против часовой стрелки"}.`;
    case "nullify":
      return `У всех игроков в лагере «${charName(game, effect.charKey)}» станет «Пусто».`;
    case "reroll":
      return `«${charName(game, effect.charKey)}» заменится на случайное — ${who(effect.target)}.`;
    case "modifier.step":
      return `${effect.delta > 0 ? "Повысить" : "Понизить"} на один уровень «${charName(game, effect.charKey)}» — ${who(effect.target)}.`;
    case "swap":
      return `${owner} и выбранный игрок обменяются картой «${charName(game, effect.charKey)}».`;
    case "steal":
      return `${owner} заберёт «${charName(game, effect.charKey)}» у выбранного игрока.`;
    case "healthy":
      return `Здоровье станет «Идеально здоров» — ${who(effect.target)}.`;
    case "return":
      return "Выбранный изгнанный игрок вернётся в игру.";
    case "reveal":
      return "Выбранная характеристика выбранного игрока откроется всем.";
    case "cancelSpecial":
      return "Отменится последняя применённая спец. возможность другого игрока — если она была последним действием ведущего.";
    case "manual":
      return `Применяется вручную: ${effect.note}. Карта будет отмечена как использованная.`;
  }
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block text-left">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ApplySpecial({ game, card, owner, onClose }: { game: GameView; card: VisibleCardView; owner: GamePlayerView; onClose: () => void }) {
  const send = useRoom((s) => s.send);
  const input = effectInput(card.effect);
  const players = game.players.filter((p) => {
    if (input === "exiled") return p.status === "exiled";
    if (p.status !== "alive") return false;
    return input === "any" || p.id !== owner.id;
  });
  const chars = game.characteristics.filter((c) => !c.specialCard);
  const [target, setTarget] = useState(players[0]?.id ?? "");
  const [charKey, setCharKey] = useState(chars[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const needsPlayer = input !== "none";
  const ability = card.abilities[0]?.text;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const apply = async () => {
    setBusy(true);
    const ok = await send({
      type: "host.special.apply",
      cardId: card.id,
      ...(needsPlayer ? { target } : {}),
      ...(input === "reveal" ? { charKey } : {}),
    });
    setBusy(false);
    if (ok) {
      toast("ok", "Откатить можно в панели ведущего: «Отменить предыдущее действие».", "Спец. возможность применена");
      onClose();
    }
  };

  return (
    <div className="overlay-in fixed inset-0 z-[65] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div role="dialog" aria-modal onClick={(e) => e.stopPropagation()} className="pop-in w-full max-w-md overflow-hidden rounded-2xl border border-ok/40 bg-panel shadow-2xl shadow-black/70">
        <div className="bg-special px-6 py-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#7fc99c]">
            <Avatar name={owner.nickname} src={owner.avatarUrl} size="sm" />
            <span>Спец. возможность · {owner.nickname}</span>
          </div>
          <h2 className="mt-1 text-lg font-extrabold leading-snug">{card.label}</h2>
          {ability && <p className="mt-1.5 text-sm text-white/80">{ability}</p>}
        </div>
        <div className="flex flex-col gap-3 px-6 py-5">
          <div className="rounded-xl border border-line bg-panel-2/70 px-4 py-3 text-sm leading-relaxed">
            <span className="font-bold text-accent-2">Что произойдёт: </span>
            {describe(card.effect, game, owner.nickname)}
          </div>
          {card.used && <p className="rounded-xl bg-danger/15 px-4 py-2.5 text-sm text-[#ffaaa3]">Эта карта уже применена. Чтобы откатить, используйте «Отменить предыдущее действие» в панели ведущего.</p>}
          {!card.used && needsPlayer && players.length === 0 && (
            <p className="rounded-xl bg-danger/15 px-4 py-2.5 text-sm text-[#ffaaa3]">{input === "exiled" ? "Нет изгнанных игроков." : "Нет подходящих игроков."}</p>
          )}
          {!card.used && needsPlayer && players.length > 0 && (
            <Select label={input === "exiled" ? "Кого вернуть" : "Игрок"} value={target} onChange={setTarget} options={players.map((p) => [p.id, `${p.seat}. ${p.nickname}`])} />
          )}
          {!card.used && input === "reveal" && <Select label="Характеристика" value={charKey} onChange={setCharKey} options={chars.map((c) => [c.key, c.name])} />}
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button onClick={onClose} className="rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm font-semibold hover:border-white/30">
              Закрыть
            </button>
            <button
              onClick={apply}
              disabled={busy || card.used || (needsPlayer && players.length === 0)}
              className="rounded-xl bg-ok px-4 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {card.effect && card.effect.op !== "manual" ? "Применить" : "Отметить применённой"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
