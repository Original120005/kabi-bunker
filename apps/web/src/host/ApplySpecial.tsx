import { useEffect, useMemo, useState } from "react";
import { effectNeeds, type GamePlayerView, type GameView, type SimpleEffect, type SpecialEffect, type VisibleCardView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";
import { toast } from "../store/toasts.ts";
import { Avatar } from "../game/PlayersTable.tsx";

function charName(game: GameView, key: string) {
  if (key === "*") return "выбранная характеристика";
  return game.characteristics.find((c) => c.key === key)?.name ?? key;
}

function fieldName(game: GameView, key: string) {
  return game.bunker.fields.find((f) => f.key === key)?.name ?? key;
}

function levelLabel(game: GameView, charKey: string, modifierKey: string, level: string) {
  const m = game.characteristics.find((c) => c.key === charKey)?.modifiers.find((x) => x.key === modifierKey);
  return m && m.kind === "scale" ? (m.levels.find((l) => l.key === level)?.label ?? level) : level;
}

function groupLabel(game: GameView, key: string) {
  const m = game.characteristics.find((c) => c.key === "gender")?.modifiers.find((x) => x.kind === "age");
  return m && m.kind === "age" ? (m.groups.find((g) => g.key === key)?.label ?? key) : key;
}

/** Plain-language result of one action, shown before the host confirms. */
function describeSimple(e: SimpleEffect, game: GameView, owner: string): string {
  const who = (t: string) =>
    t === "self" ? owner : t === "all" ? "всем игрокам в лагере" : t === "neighbor" ? "соседу (до или после)" : t === "neighbors" ? "обоим соседям" : "выбранному игроку";
  switch (e.op) {
    case "bunker.reroll":
      return `«${fieldName(game, e.field)}» в бункере заменится на случайное значение.`;
    case "bunker.set":
      return `«${fieldName(game, e.field)}» в бункере станет таким, как вы впишете или выберете ниже.`;
    case "bunker.addItem":
      return "В бункер добавится случайный предмет.";
    case "catastrophe.reroll":
      return "Катаклизм заменится на случайный.";
    case "seats":
      return `Мест в бункере станет ${game.bunker.seats + e.delta}.`;
    case "rotate":
      return `Все игроки в лагере передадут «${charName(game, e.charKey)}» соседу ${e.dir === "cw" ? "по часовой стрелке" : "против часовой стрелки"}.`;
    case "nullify":
      return `У всех игроков в лагере «${charName(game, e.charKey)}» станет «Пусто».`;
    case "reroll":
      return `«${charName(game, e.charKey)}» заменится на случайное — ${who(e.target)}.`;
    case "modifier.step":
      return `${e.delta > 0 ? "Повысить" : "Понизить"} на один уровень «${charName(game, e.charKey)}» — ${who(e.target)}.`;
    case "modifier.set":
      return `«${charName(game, e.charKey)}» станет «${levelLabel(game, e.charKey, e.modifierKey, e.level)}» — ${who(e.target)}.`;
    case "swap":
      return `${owner} и выбранный ${e.from === "exiled" ? "изгнанный " : ""}игрок обменяются: «${charName(game, e.charKey)}».${e.resetUsed ? " Полученную способность можно будет использовать." : ""}`;
    case "swap.pair":
      return `Два выбранных игрока обменяются: «${charName(game, e.charKey)}».`;
    case "steal":
      return `${owner} заберёт «${charName(game, e.charKey)}» у выбранного ${e.from === "exiled" ? "изгнанного " : e.from === "neighbor" ? "соседа " : ""}игрока.`;
    case "healthy":
      return e.maxSeverity
        ? `Вылечить болезнь — ${who(e.target)} (не выше «${levelLabel(game, "health", "severity", e.maxSeverity)}» степени).`
        : `Здоровье станет «Идеально здоров» — ${who(e.target)}.`;
    case "return":
      return "Выбранный изгнанный игрок вернётся в игру.";
    case "reveal":
      return `«${charName(game, e.charKey ?? "*")}» ${e.target === "self" ? `у ${owner}` : "выбранного игрока"} откроется всем.`;
    case "give":
      return `${charName(game, e.charKey)}: добавится строка — ${who(e.target)}. Текст можно поправить.`;
    case "add":
      return `Добавится случайное «${charName(game, e.charKey)}» — ${who(e.target)}.`;
    case "remove":
      return `«${charName(game, e.charKey)}» станет «Пусто» — ${who(e.target)}.`;
    case "gender.flip":
      return `Пол сменится на противоположный — ${who(e.target)}.`;
    case "childfree":
      return `Станет чайлдфри — ${who(e.target)}.`;
    case "curePhobia":
      return `Фобия вылечится — ${who(e.target)}.`;
    case "ageGroup":
      return `Возраст станет «${e.group === "*" ? "на выбор" : groupLabel(game, e.group)}» — ${who(e.target)}.`;
    case "body":
      return `Телосложение станет «${e.title === "*" ? "на выбор" : e.title}» — ${who(e.target)}.`;
    case "cancelSpecial":
      return "Отменится последняя применённая спец. возможность другого игрока — если она была последним действием ведущего.";
    case "manual":
      return `Применяется вручную: ${e.note}. Карта будет отмечена как использованная.`;
    case "info":
      return `Это постоянное свойство, применять не нужно: ${e.note}.`;
  }
}

function describe(effect: SpecialEffect | null, option: number, game: GameView, owner: string): string {
  if (!effect) return "У этой карты нет автоматического действия. Выполните написанное вручную и отметьте карту как применённую.";
  if (effect.op === "choice") return describeSimple(effect.options[option].effect, game, owner);
  if (effect.op === "multi") return effect.steps.map((s) => describeSimple(s, game, owner)).join(" ");
  return describeSimple(effect, game, owner);
}

function notesOf(effect: SpecialEffect | null, option: number): string[] {
  if (!effect) return [];
  const list = effect.op === "choice" ? [effect.options[option].effect] : effect.op === "multi" ? effect.steps : [effect];
  return list.flatMap((e) => (e.op !== "manual" && e.op !== "info" && e.note ? [e.note] : []));
}

function isManual(effect: SpecialEffect | null) {
  return !effect || effect.op === "manual";
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

/** Window for applying a special card or a profession ability with one click. */
export function ApplySpecial({ game, card, owner, onClose }: { game: GameView; card: VisibleCardView; owner: GamePlayerView; onClose: () => void }) {
  const send = useRoom((s) => s.send);
  const def = game.characteristics.find((c) => c.key === card.charKey);
  const isSpecial = def?.specialCard === true;
  const effect = card.effect;
  const [option, setOption] = useState(0);
  const needs = effectNeeds(effect, option);

  const players = useMemo(() => {
    if (needs.player === "exiled") return game.players.filter((p) => p.status === "exiled");
    if (needs.player === "neighbor") {
      const ring = game.players.filter((p) => p.id === owner.id || p.status === "alive");
      const i = ring.findIndex((p) => p.id === owner.id);
      if (i < 0 || ring.length < 2) return [];
      const ids = new Set([ring[(i - 1 + ring.length) % ring.length].id, ring[(i + 1) % ring.length].id]);
      ids.delete(owner.id);
      return ring.filter((p) => ids.has(p.id));
    }
    return game.players.filter((p) => p.status === "alive" && (needs.player === "any" || p.id !== owner.id));
  }, [game.players, needs.player, owner.id]);

  const allChars = game.characteristics.filter((c) => !c.specialCard);
  const chars = needs.chars === null ? [] : needs.chars.length ? allChars.filter((c) => needs.chars!.includes(c.key)) : allChars;
  const ageGroups = (() => {
    const m = game.characteristics.find((c) => c.key === "gender")?.modifiers.find((x) => x.kind === "age");
    return m && m.kind === "age" ? m.groups : [];
  })();
  const bodies = game.host?.bodies ?? [];

  const [target, setTarget] = useState("");
  const [target2, setTarget2] = useState("");
  const [charKey, setCharKey] = useState("");
  const [text, setText] = useState("");
  const [value, setValue] = useState("");
  const [lineId, setLineId] = useState("");
  const [busy, setBusy] = useState(false);

  // Defaults follow the picked variant.
  useEffect(() => {
    setTarget(players[0]?.id ?? "");
    setCharKey(chars[0]?.key ?? "");
    setText(needs.text?.initial ?? "");
    setValue(needs.value === "ageGroup" ? (ageGroups[0]?.key ?? "") : needs.value === "body" ? (bodies[0] ?? "") : "");
    setLineId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option, needs.player]);

  const second = players.filter((p) => p.id !== target);
  useEffect(() => {
    if (needs.player2 && !second.some((p) => p.id === target2)) setTarget2(second[0]?.id ?? "");
  }, [needs.player2, second, target2]);

  const lineOwner = needs.player === "none" ? owner : game.players.find((p) => p.id === target);
  const lines = needs.healthLine ? (lineOwner?.cards.health ?? []).flatMap((c) => (c.hidden ? [] : [c])) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needsPlayer = needs.player !== "none";
  const noPlayers = needsPlayer && players.length === 0;
  const noSecond = needs.player2 && second.length === 0;
  const textValue = needs.value ? value : needs.text ? text.trim() : "";
  const missingText = (!!needs.text || !!needs.value) && !textValue;

  const apply = async () => {
    setBusy(true);
    const ok = await send({
      type: "host.special.apply",
      cardId: card.id,
      ...(effect?.op === "choice" ? { option } : {}),
      ...(needsPlayer ? { target } : {}),
      ...(needs.player2 ? { target2 } : {}),
      ...(needs.chars !== null ? { charKey } : {}),
      ...(textValue ? { text: textValue } : {}),
      ...(lineId ? { lineId } : {}),
    });
    setBusy(false);
    if (ok) {
      toast("ok", "Откатить можно в панели ведущего: «Отменить предыдущее действие».", isSpecial ? "Спец. возможность применена" : "Способность профессии применена");
      onClose();
    }
  };

  const ability = card.abilities[0]?.text;
  const notes = notesOf(effect, option);
  const playerLabel = needs.player === "exiled" ? "Изгнанный игрок" : needs.player === "neighbor" ? "Сосед" : needs.player2 ? "Первый игрок" : "Игрок";

  return (
    <div className="overlay-in fixed inset-0 z-[65] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div role="dialog" aria-modal onClick={(e) => e.stopPropagation()} className="pop-in max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-ok/40 bg-panel shadow-2xl shadow-black/70">
        <div className="bg-special px-6 py-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#7fc99c]">
            <Avatar name={owner.nickname} src={owner.avatarUrl} size="sm" />
            <span>
              {isSpecial ? "Спец. возможность" : "Проф. возможность"} · {owner.nickname}
            </span>
          </div>
          <h2 className="mt-1 text-lg font-extrabold leading-snug">{card.label}</h2>
          {ability && <p className="mt-1.5 text-sm text-white/80">{ability}</p>}
        </div>
        <div className="flex flex-col gap-3 px-6 py-5">
          {effect?.op === "choice" && !card.used && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">Вариант</span>
              <div className="grid gap-1.5">
                {effect.options.map((o, i) => (
                  <button
                    key={i}
                    onClick={() => setOption(i)}
                    className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold ${i === option ? "border-accent bg-accent/15 text-white" : "border-line bg-panel-2 text-white/75 hover:border-white/30"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-xl border border-line bg-panel-2/70 px-4 py-3 text-sm leading-relaxed">
            <span className="font-bold text-accent-2">Что произойдёт: </span>
            {describe(effect, option, game, owner.nickname)}
          </div>
          {notes.map((n, i) => (
            <p key={i} className="rounded-xl bg-accent/10 px-4 py-2.5 text-sm text-accent-2">
              Проверьте: {n}
            </p>
          ))}
          {card.used && (
            <p className="rounded-xl bg-danger/15 px-4 py-2.5 text-sm text-[#ffaaa3]">
              {isSpecial ? "Эта карта уже применена." : "Способность этой профессии уже использована."} Чтобы откатить, используйте «Отменить предыдущее действие» в панели ведущего.
            </p>
          )}
          {!card.used && noPlayers && (
            <p className="rounded-xl bg-danger/15 px-4 py-2.5 text-sm text-[#ffaaa3]">
              {needs.player === "exiled" ? "Нет изгнанных игроков." : needs.player === "neighbor" ? "Рядом нет игроков в лагере." : "Нет подходящих игроков."}
            </p>
          )}
          {!card.used && needsPlayer && players.length > 0 && (
            <Select label={playerLabel} value={target} onChange={setTarget} options={players.map((p) => [p.id, `${p.seat}. ${p.nickname}`])} />
          )}
          {!card.used && needs.player2 && second.length > 0 && (
            <Select label="Второй игрок" value={target2} onChange={setTarget2} options={second.map((p) => [p.id, `${p.seat}. ${p.nickname}`])} />
          )}
          {!card.used && needs.chars !== null && <Select label="Характеристика" value={charKey} onChange={setCharKey} options={chars.map((c) => [c.key, c.name])} />}
          {!card.used && needs.value === "ageGroup" && <Select label="Возраст" value={value} onChange={setValue} options={ageGroups.map((g) => [g.key, g.label])} />}
          {!card.used && needs.value === "body" && <Select label="Телосложение" value={value} onChange={setValue} options={bodies.map((b) => [b, b])} />}
          {!card.used && needs.text && needs.text.options?.length ? (
            <Select label={needs.text.label} value={text} onChange={setText} options={needs.text.options.map((o) => [o, o])} />
          ) : (
            !card.used &&
            needs.text && (
              <label className="block text-left">
                <span className="mb-1 block text-xs font-semibold text-muted">{needs.text.label}</span>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={2}
                  maxLength={700}
                  className="w-full resize-none rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent"
                />
              </label>
            )
          )}
          {!card.used && lines.length > 1 && (
            <Select label="Какую строку здоровья" value={lineId} onChange={setLineId} options={[["", "Подходящие автоматически"], ...lines.map((c): [string, string] => [c.id, c.label])]} />
          )}
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button onClick={onClose} className="rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm font-semibold hover:border-white/30">
              Закрыть
            </button>
            <button
              onClick={apply}
              disabled={busy || card.used || noPlayers || noSecond || missingText}
              className="rounded-xl bg-ok px-4 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isManual(effect) ? "Отметить применённой" : "Применить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
