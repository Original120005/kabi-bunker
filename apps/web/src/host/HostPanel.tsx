import { useEffect, useState, type ReactNode } from "react";
import { RAID, type ClientAction, type GameView, type RoomView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";
import { toast } from "../store/toasts.ts";
import { ask } from "../ui/Confirm.tsx";
import { VoteSetup } from "./VoteSetup.tsx";

type Option = [value: string, label: string];

const RANDOM = "random";

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Option[] }) {
  const valid = options.some(([v]) => v === value);
  useEffect(() => {
    if (!valid && options.length) onChange(options[0]![0]);
  }, [valid, options, onChange]);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-0 rounded-lg border border-line bg-bg px-2.5 py-2 text-sm outline-none focus:border-accent"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function Input({ value, onChange, placeholder, area }: { value: string; onChange: (v: string) => void; placeholder: string; area?: boolean }) {
  const cls = "w-full rounded-lg border border-line bg-bg px-2.5 py-2 text-sm outline-none focus:border-accent";
  return area ? (
    <textarea rows={3} value={value} maxLength={700} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${cls} resize-y`} />
  ) : (
    <input value={value} maxLength={700} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cls} />
  );
}

function Act({ children, onClick, tone = "default", disabled }: { children: ReactNode; onClick: () => void; tone?: "default" | "ok" | "danger"; disabled?: boolean }) {
  const tones = {
    default: "border-line bg-panel-2 hover:border-accent/70 hover:text-accent-2",
    ok: "border-ok/60 bg-ok/15 text-[#7fc99c] hover:bg-ok/25",
    danger: "border-danger/60 bg-danger/15 text-[#ffaaa3] hover:bg-danger/25",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function Group({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border-b border-line/70">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold hover:text-accent-2">
        <span className="flex-1">{title}</span>
        <span className={`text-muted transition ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && <div className="flex flex-col gap-2 px-4 pb-4">{children}</div>}
    </div>
  );
}

/** Lists for the forms, derived from the game definitions. */
function useLists(view: RoomView) {
  const game = view.game!;
  const alive = game.players.filter((p) => p.status === "alive");
  const players: Option[] = alive.map((p) => [p.id, `${p.seat}. ${p.nickname}`]);
  const targets: Option[] = [["all", "Для всех"], ...players];
  const chars: Option[] = game.characteristics.map((c) => [c.key, c.name]);
  const scales = game.characteristics.flatMap((c) =>
    c.modifiers.flatMap((m) => (m.kind === "scale" ? [{ id: `${c.key}:${m.key}`, charKey: c.key, modKey: m.key, name: c.name, levels: m.levels }] : [])),
  );
  const ageGroups = game.characteristics.flatMap((c) => c.modifiers.flatMap((m) => (m.kind === "age" ? m.groups : [])));
  return { game, alive, players, targets, chars, scales, ageGroups };
}

function firstOf(options: Option[]): string {
  return options[0]?.[0] ?? "";
}

function Tools({ view }: { view: RoomView }) {
  const send = useRoom((s) => s.send);
  const { game, players, targets, chars, scales, ageGroups } = useLists(view);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen(open === id ? null : id);

  const act = async (action: ClientAction, confirmText?: string) => {
    if (confirmText && !(await ask(confirmText, { tone: "danger" }))) return;
    if (await send(action)) toast("ok", "Готово", undefined, 1800);
  };

  const health = scales.filter((s) => s.charKey === "health");
  const experience = scales.filter((s) => s.charKey !== "health");
  const charsNoSpecial: Option[] = game.characteristics.filter((c) => !c.specialCard).map((c) => [c.key, c.name]);
  const inventory: Option[] = game.characteristics.filter((c) => ["bigInventory", "backpack"].includes(c.key)).map((c) => [c.key, c.name]);
  const fields: Option[] = game.bunker.fields.map((f) => [f.key, f.name]);
  const recipients: Option[] = [["all", "Всем"], ...view.participants.map((p): Option => [p.id, p.nickname])];
  const newHosts: Option[] = view.participants.filter((p) => !p.isHost).map((p) => [p.id, p.nickname]);

  const [rr, setRr] = useState({ target: "all", charKey: "all" });
  const [exp, setExp] = useState({ target: firstOf(players), scale: experience[0]?.id ?? "", level: RANDOM });
  const [hl, setHl] = useState({ target: firstOf(players), level: RANDOM });
  const [gender, setGender] = useState("all");
  const [body, setBody] = useState({ target: firstOf(players), title: "random" });
  const [swap, setSwap] = useState({ a: firstOf(players), b: players[1]?.[0] ?? "", charKey: firstOf(charsNoSpecial) });
  const [steal, setSteal] = useState({ thief: firstOf(players), victim: players[1]?.[0] ?? "", charKey: firstOf(inventory) || firstOf(chars) });
  const [cure, setCure] = useState({ target: firstOf(players), group: ageGroups[0]?.key ?? "", body: game.host?.bodies[0] ?? "" });
  const [add, setAdd] = useState({ target: firstOf(players), charKey: firstOf(chars), text: "" });
  const [inv, setInv] = useState({ target: firstOf(players), charKey: firstOf(inventory) || firstOf(chars) });
  const [rot, setRot] = useState(firstOf(charsNoSpecial));
  const [bunker, setBunker] = useState({ field: firstOf(fields), text: "", item: "" });
  const [msg, setMsg] = useState({ to: "all", color: "gold" as "gold" | "green" | "red" | "white", title: "", text: "" });
  const [host, setHost] = useState(firstOf(newHosts));

  const expScale = experience.find((s) => s.id === exp.scale) ?? experience[0];
  const healthScale = health[0];
  const name = (id: string) => view.participants.find((p) => p.id === id)?.nickname ?? "игрок";

  return (
    <div>
      <Group title="Изменить характеристику" open={open === "reroll"} onToggle={() => toggle("reroll")}>
        <Select value={rr.target} onChange={(target) => setRr({ ...rr, target })} options={targets} />
        <Select value={rr.charKey} onChange={(charKey) => setRr({ ...rr, charKey })} options={[["all", "Все характеристики"], ...chars]} />
        <Act onClick={() => act({ type: "host.char.reroll", target: rr.target, charKey: rr.charKey })}>Изменить случайно</Act>
      </Group>

      {expScale && (
        <Group title="Изменить стаж" open={open === "exp"} onToggle={() => toggle("exp")}>
          <Select value={exp.target} onChange={(target) => setExp({ ...exp, target })} options={targets} />
          {experience.length > 1 && <Select value={expScale.id} onChange={(scale) => setExp({ ...exp, scale, level: RANDOM })} options={experience.map((s): Option => [s.id, s.name])} />}
          <Select value={exp.level} onChange={(level) => setExp({ ...exp, level })} options={[[RANDOM, "Рандомно"], ...expScale.levels.map((l): Option => [l.key, l.label])]} />
          <Act onClick={() => act({ type: "host.modifier.set", target: exp.target, charKey: expScale.charKey, modifierKey: expScale.modKey, level: exp.level })}>Применить</Act>
        </Group>
      )}

      {healthScale && (
        <Group title="Изменить степень болезни" open={open === "health"} onToggle={() => toggle("health")}>
          <Select value={hl.target} onChange={(target) => setHl({ ...hl, target })} options={targets} />
          <Select value={hl.level} onChange={(level) => setHl({ ...hl, level })} options={[[RANDOM, "Рандомно"], ...healthScale.levels.map((l): Option => [l.key, l.label])]} />
          <Act onClick={() => act({ type: "host.modifier.set", target: hl.target, charKey: healthScale.charKey, modifierKey: healthScale.modKey, level: hl.level })}>Применить</Act>
        </Group>
      )}

      {(game.host?.bodies.length ?? 0) > 0 && (
        <Group title="Изменить телосложение" open={open === "body"} onToggle={() => toggle("body")}>
          <Select value={body.target} onChange={(target) => setBody({ ...body, target })} options={targets} />
          <Select value={body.title} onChange={(title) => setBody({ ...body, title })} options={[["random", "Случайно"], ...game.host!.bodies.map((b): Option => [b, b])]} />
          <Act onClick={() => act({ type: "host.body", target: body.target, title: body.title })}>Изменить телосложение</Act>
          <p className="text-xs text-muted">Меняется только тип телосложения, рост остаётся прежним.</p>
        </Group>
      )}

      <Group title="Изменить пол на противоположный" open={open === "gender"} onToggle={() => toggle("gender")}>
        <Select value={gender} onChange={setGender} options={targets} />
        <Act onClick={() => act({ type: "host.gender.flip", target: gender })}>Изменить пол</Act>
      </Group>

      <Group title="Обменять характеристики" open={open === "swap"} onToggle={() => toggle("swap")}>
        <Select value={swap.charKey} onChange={(charKey) => setSwap({ ...swap, charKey })} options={chars} />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
          <Select value={swap.a} onChange={(a) => setSwap({ ...swap, a })} options={players} />
          <span className="text-muted">⇄</span>
          <Select value={swap.b} onChange={(b) => setSwap({ ...swap, b })} options={players} />
        </div>
        <Act onClick={() => act({ type: "host.char.swap", a: swap.a, b: swap.b, charKey: swap.charKey })}>Обменять между двумя</Act>
        <Act onClick={() => act({ type: "host.char.shuffle", charKey: swap.charKey }, "Перемешать эту характеристику между всеми игроками?")}>Перемешать между всеми</Act>
      </Group>

      <Group title="Украсть характеристику" open={open === "steal"} onToggle={() => toggle("steal")}>
        <Select value={steal.charKey} onChange={(charKey) => setSteal({ ...steal, charKey })} options={chars} />
        <label className="text-xs text-muted">Кто крадёт</label>
        <Select value={steal.thief} onChange={(thief) => setSteal({ ...steal, thief })} options={players} />
        <label className="text-xs text-muted">У кого</label>
        <Select value={steal.victim} onChange={(victim) => setSteal({ ...steal, victim })} options={players} />
        <Act onClick={() => act({ type: "host.char.steal", thief: steal.thief, victim: steal.victim, charKey: steal.charKey })}>Украсть</Act>
      </Group>

      <Group title="Вылечить / сделать" open={open === "cure"} onToggle={() => toggle("cure")}>
        <Select value={cure.target} onChange={(target) => setCure({ ...cure, target })} options={targets} />
        <div className="grid grid-cols-2 gap-1.5">
          <Act onClick={() => act({ type: "host.cure", target: cure.target, op: "healthy" })}>Идеально здоров</Act>
          <Act onClick={() => act({ type: "host.cure", target: cure.target, op: "curePhobia" })}>Вылечить фобию</Act>
          <Act onClick={() => act({ type: "host.cure", target: cure.target, op: "childfree" })}>Сделать чайлдфри</Act>
          <Act onClick={() => act({ type: "host.cure", target: cure.target, op: "cureChildfree" })}>Вылечить чайлдфри</Act>
        </div>
        {ageGroups.length > 0 && (
          <div className="grid grid-cols-[1fr_auto] gap-1.5">
            <Select value={cure.group} onChange={(group) => setCure({ ...cure, group })} options={ageGroups.map((g): Option => [g.key, g.label])} />
            <button className="rounded-lg border border-line bg-panel-2 px-3 text-sm font-semibold hover:border-accent/70" onClick={() => act({ type: "host.ageGroup", target: cure.target, group: cure.group })}>
              Возраст
            </button>
          </div>
        )}
        {(game.host?.bodies.length ?? 0) > 0 && (
          <div className="grid grid-cols-[1fr_auto] gap-1.5">
            <Select value={cure.body} onChange={(body) => setCure({ ...cure, body })} options={game.host!.bodies.map((b): Option => [b, b])} />
            <button className="rounded-lg border border-line bg-panel-2 px-3 text-sm font-semibold hover:border-accent/70" onClick={() => act({ type: "host.body", target: cure.target, title: cure.body })}>
              Тело
            </button>
          </div>
        )}
      </Group>

      <Group title="Добавить характеристику" open={open === "add"} onToggle={() => toggle("add")}>
        <Select value={add.target} onChange={(target) => setAdd({ ...add, target })} options={players} />
        <Select value={add.charKey} onChange={(charKey) => setAdd({ ...add, charKey })} options={chars} />
        <Input value={add.text} onChange={(text) => setAdd({ ...add, text })} placeholder="Свой текст (пусто — случайно)" />
        <Act onClick={() => act({ type: "host.char.add", target: add.target, charKey: add.charKey, ...(add.text.trim() ? { text: add.text.trim() } : {}) })}>Добавить</Act>
      </Group>

      <Group title="Удалить / перенести в бункер" open={open === "inv"} onToggle={() => toggle("inv")}>
        <Select value={inv.target} onChange={(target) => setInv({ ...inv, target })} options={players} />
        <Select value={inv.charKey} onChange={(charKey) => setInv({ ...inv, charKey })} options={chars} />
        <div className="grid grid-cols-2 gap-1.5">
          <Act tone="danger" onClick={() => act({ type: "host.char.remove", target: inv.target, charKey: inv.charKey })}>
            Удалить
          </Act>
          <Act onClick={() => act({ type: "host.char.toBunker", target: inv.target, charKey: inv.charKey })}>В бункер</Act>
        </div>
      </Group>

      <Group title="По / против часовой, аннулировать" open={open === "rotate"} onToggle={() => toggle("rotate")}>
        <Select value={rot} onChange={setRot} options={chars} />
        <div className="grid grid-cols-2 gap-1.5">
          <Act onClick={() => act({ type: "host.rotate", charKey: rot, dir: "cw" })}>↻ По часовой</Act>
          <Act onClick={() => act({ type: "host.rotate", charKey: rot, dir: "ccw" })}>↺ Против часовой</Act>
        </div>
        <Act tone="danger" onClick={() => act({ type: "host.nullify", charKey: rot }, "Аннулировать эту характеристику всем игрокам?")}>
          Аннулировать всем
        </Act>
      </Group>

      <Group title="Изменить бункер" open={open === "bunker"} onToggle={() => toggle("bunker")}>
        <Select value={bunker.field} onChange={(field) => setBunker({ ...bunker, field })} options={fields} />
        <Act onClick={() => act({ type: "host.bunker.reroll", field: bunker.field })}>Изменить случайно</Act>
        <Input value={bunker.text} onChange={(text) => setBunker({ ...bunker, text })} placeholder="Свой текст поля" />
        <Act disabled={!bunker.text.trim()} onClick={() => act({ type: "host.bunker.set", field: bunker.field, text: bunker.text.trim() })}>
          Вписать текст
        </Act>
        <div className="mt-1 border-t border-line/60 pt-2 text-xs text-muted">Предмет в бункер</div>
        <Input value={bunker.item} onChange={(item) => setBunker({ ...bunker, item })} placeholder="Название (пусто — случайно)" />
        <Act onClick={() => act({ type: "host.bunker.addItem", ...(bunker.item.trim() ? { text: bunker.item.trim() } : {}) })}>Добавить предмет</Act>
      </Group>

      <Group title="Бросить кубик" open={open === "dice"} onToggle={() => toggle("dice")}>
        <div className="grid grid-cols-2 gap-1.5">
          <Act onClick={() => send({ type: "host.dice", sides: 6 })}>🎲 d6</Act>
          <Act onClick={() => send({ type: "host.dice", sides: 20 })}>🎲 d20</Act>
        </div>
        <p className="text-xs text-muted">Результат увидят все участники.</p>
      </Group>

      <Group title="Отправить сообщение" open={open === "msg"} onToggle={() => toggle("msg")}>
        <Select value={msg.to} onChange={(to) => setMsg({ ...msg, to })} options={recipients} />
        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              ["gold", "bg-accent"],
              ["green", "bg-ok"],
              ["red", "bg-danger"],
              ["white", "bg-white"],
            ] as const
          ).map(([c, bg]) => (
            <button
              key={c}
              onClick={() => setMsg({ ...msg, color: c })}
              aria-label={c}
              className={`h-8 rounded-lg ${bg} ${msg.color === c ? "ring-2 ring-white ring-offset-2 ring-offset-panel" : "opacity-60"}`}
            />
          ))}
        </div>
        <Input value={msg.title} onChange={(title) => setMsg({ ...msg, title })} placeholder="Заголовок" />
        <Input area value={msg.text} onChange={(text) => setMsg({ ...msg, text })} placeholder="Текст сообщения" />
        <Act
          disabled={!msg.text.trim()}
          onClick={async () => {
            if (await send({ type: "host.message", to: msg.to, color: msg.color, title: msg.title.trim(), text: msg.text.trim() })) {
              toast("ok", "Сообщение отправлено", undefined, 1800);
              setMsg({ ...msg, title: "", text: "" });
            }
          }}
        >
          Отправить
        </Act>
      </Group>

      {newHosts.length > 0 && (
        <Group title="Сменить ведущего" open={open === "host"} onToggle={() => toggle("host")}>
          <Select value={host} onChange={setHost} options={newHosts} />
          <Act tone="danger" onClick={() => act({ type: "host.transfer", participantId: host }, `Передать роль ведущего игроку ${name(host)}? Вернуть её сможет только новый ведущий.`)}>
            Передать роль
          </Act>
        </Group>
      )}
    </div>
  );
}

function Top({ view, game }: { view: RoomView; game: GameView }) {
  const send = useRoom((s) => s.send);
  const act = async (action: ClientAction, confirmText?: string) => {
    if (confirmText && !(await ask(confirmText, { tone: "danger" }))) return;
    if (await send(action)) toast("ok", "Готово", undefined, 1800);
  };
  const undo = game.host?.undoLabel ?? null;
  const alive = game.players.filter((p) => p.status === "alive").length;

  const vote = view.vote;
  const [picking, setPicking] = useState(false);
  const timerRunning = view.timer !== null && view.timer.endsAt > view.serverTime;
  const raidStage = view.raid?.stage;
  const raidBusy = raidStage === "voting" || raidStage === "picking" || raidStage === "returning";
  const protectedId = raidStage === "picking" || raidStage === "away" || raidStage === "returning" ? view.raid!.playerId : null;

  return (
    <div className="flex flex-col gap-2 border-b border-line p-4">
      <div className="text-center text-xs font-semibold text-muted">Таймер для всех, секунд</div>
      <div className="grid grid-cols-3 gap-1.5">
        {([15, 30, 60] as const).map((s) => (
          <button key={s} onClick={() => send({ type: "host.timer", seconds: s })} className="rounded-lg border border-line bg-panel-2 py-2.5 text-base font-extrabold hover:border-accent/70 hover:text-accent-2">
            {s}
          </button>
        ))}
      </div>
      {timerRunning && (
        <button onClick={() => send({ type: "host.timer.stop" })} className="text-xs font-semibold text-[#ff8a80] hover:underline">
          Остановить таймер
        </button>
      )}
      <Act onClick={() => act({ type: "host.catastrophe.reroll" })}>Изменить катаклизм</Act>
      {!vote && (
        <Act tone="danger" disabled={raidBusy} onClick={() => setPicking(true)}>
          Начать голосование
        </Act>
      )}
      {picking && <VoteSetup game={game} protectedId={protectedId} onClose={() => setPicking(false)} />}
      {vote?.status === "open" && (
        <Act tone="danger" onClick={() => act({ type: "host.vote.finish" }, `Завершить голосование досрочно? Проголосовали ${vote.voted.length} из ${vote.voters.length}.`)}>
          <span className="block">Завершить голосование</span>
          <span className="block text-xs font-normal opacity-80">
            проголосовали {vote.voted.length} из {vote.voters.length}
          </span>
        </Act>
      )}
      {vote?.status === "closed" && (
        <div className="grid grid-cols-2 gap-1.5">
          <Act onClick={() => send({ type: "host.vote.clear" })}>Убрать результаты</Act>
          <Act tone="danger" onClick={() => send({ type: "host.vote.clear" }).then((ok) => ok && setPicking(true))}>
            Новое голосование
          </Act>
        </div>
      )}
      <Act disabled={raidBusy || (!!view.event?.spin && view.serverTime < view.event.spin.at + RAID.pickSpinMs)} onClick={() => send({ type: "host.event" })}>
        Запустить ивент
      </Act>
      <RaidControls view={view} />
      <div className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm">
        <span className="flex-1 font-semibold">Мест в бункере</span>
        <button className="h-7 w-7 rounded-md bg-line text-lg leading-none hover:bg-danger" aria-label="Меньше мест" onClick={() => act({ type: "host.seats", delta: -1 })}>
          −
        </button>
        <span className="w-8 text-center font-bold text-accent">{game.bunker.seats}</span>
        <button className="h-7 w-7 rounded-md bg-line text-lg leading-none hover:bg-ok" aria-label="Больше мест" onClick={() => act({ type: "host.seats", delta: 1 })}>
          +
        </button>
      </div>
      <div className="text-center text-xs text-muted">
        В игре {alive} из {game.players.length}
      </div>
      <Act disabled={!undo} onClick={() => act({ type: "host.undo" })}>
        <span className="block">Отменить предыдущее действие</span>
        {undo && <span className="block truncate text-xs font-normal text-muted">{undo}</span>}
      </Act>
      <Act onClick={() => act({ type: "host.revealAll" }, "Открыть всем все характеристики всех игроков?")}>Открыть все характеристики</Act>
      {game.settled ? (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-center text-xs text-accent-2">Итоги подведены, рейтинг записан. Чтобы сыграть ещё раз — «Начать заново».</p>
      ) : (
        <Act
          tone="ok"
          onClick={async () => {
            if (
              !(await ask("Подвести итоги партии?", {
                text: "Кто остался в лагере, попадает в бункер (+20). Затем все увидят симуляцию: выживет ли бункер. Если выживет — каждому внутри ещё +10. Первый изгнанный теряет 20, второй — 10. Итог окончательный, переиграть нельзя.",
                confirmLabel: "Подвести итоги",
                tone: "ok",
              }))
            )
              return;
            if (await send({ type: "host.finish" })) toast("ok", "Все видят симуляцию бункера. Рейтинг записан.", "Итоги партии");
          }}
        >
          Подвести итоги партии
        </Act>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Act tone="ok" onClick={() => act({ type: "host.restart" }, "Начать игру заново? Персонажи, катаклизм и бункер будут сгенерированы заново.")}>
          Начать заново
        </Act>
        <Act tone="danger" onClick={() => act({ type: "room.close" }, `Закрыть комнату ${view.code}? Все участники будут отключены.`)}>
          Закрыть комнату
        </Act>
      </div>
    </div>
  );
}

function RaidControls({ view }: { view: RoomView }) {
  const send = useRoom((s) => s.send);
  const raid = view.raid;
  const name = (id: string | null) => view.game?.players.find((p) => p.id === id)?.nickname ?? "игрок";
  const voteOpen = view.vote?.status === "open";

  if (!raid)
    return (
      <Act disabled={voteOpen} onClick={() => send({ type: "host.raid.start" })}>
        Запустить голосование на вылазку
      </Act>
    );
  if (raid.stage === "away")
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-accent/40 bg-accent/[0.06] p-2">
        <div className="text-center text-xs text-muted">
          На вылазке: <span className="font-bold text-accent-2">{name(raid.playerId)}</span>
        </div>
        <Act tone="ok" onClick={() => send({ type: "host.raid.return" })}>
          Игрок вернулся
        </Act>
        <button
          onClick={async () => {
            if (await ask(`Отменить вылазку игрока ${name(raid.playerId)}?`, { text: "Игрок вернётся без проверки и без добычи.", confirmLabel: "Отменить вылазку", tone: "danger" })) send({ type: "host.raid.cancel" });
          }}
          className="text-xs font-semibold text-[#ff8a80] hover:underline"
        >
          Отменить вылазку
        </button>
      </div>
    );
  if (raid.stage === "done" || raid.stage === "cancelled")
    return (
      <Act tone="ok" onClick={() => send({ type: "host.raid.clear" })}>
        Продолжить игру
      </Act>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-center text-xs text-muted">
        {raid.stage === "voting" ? "Идёт голосование на вылазку…" : raid.stage === "picking" ? "Выбирается игрок для вылазки…" : "Подводятся итоги вылазки…"}
      </div>
      {raid.stage !== "returning" && (
        <button onClick={() => send({ type: "host.raid.cancel" })} className="text-xs font-semibold text-[#ff8a80] hover:underline">
          Отменить вылазку
        </button>
      )}
    </div>
  );
}

const STORAGE = "bunker.hostPanel";

export function useHostPanelOpen() {
  const [open, setOpenState] = useState(() => localStorage.getItem(STORAGE) === "1");
  const setOpen = (v: boolean) => {
    localStorage.setItem(STORAGE, v ? "1" : "0");
    setOpenState(v);
  };
  return [open, setOpen] as const;
}

/** Manual host tools. Nothing here is triggered by card texts: the host applies what abilities say. */
export function HostPanel({ view, open, setOpen }: { view: RoomView; open: boolean; setOpen: (v: boolean) => void }) {
  const game = view.game!;
  const hiddenWhenOpen = open ? "pointer-events-none opacity-0" : "opacity-100";
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        tabIndex={open ? -1 : 0}
        className={`fixed right-0 top-24 z-30 hidden flex-col items-center gap-2 rounded-l-xl border border-r-0 border-accent/60 bg-panel px-2 py-3 text-sm font-bold text-accent shadow-xl shadow-black/50 transition-opacity duration-300 hover:bg-panel-2 md:flex ${hiddenWhenOpen}`}
      >
        <span aria-hidden>‹</span>
        <span className="rotate-180 [writing-mode:vertical-rl]">Панель ведущего</span>
      </button>
      <button
        onClick={() => setOpen(true)}
        tabIndex={open ? -1 : 0}
        className={`fixed bottom-4 right-4 z-30 rounded-full border border-accent/70 bg-panel px-4 py-3 text-sm font-bold text-accent shadow-xl shadow-black/60 transition-opacity duration-300 md:hidden ${hiddenWhenOpen}`}
      >
        Ведущий
      </button>
      <div
        className={`fixed inset-0 z-30 bg-black/60 transition-opacity duration-300 lg:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setOpen(false)}
      />
      <aside
        aria-hidden={!open}
        className={`scrollbar-thin fixed bottom-0 right-0 top-[61px] z-40 w-[min(340px,100vw)] overflow-y-auto border-l border-white/10 bg-panel/[0.93] shadow-2xl will-change-transform shadow-black/60 transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-panel px-4 py-3">
          <span className="flex-1 text-base font-extrabold">
            Панель <span className="text-accent">ведущего</span>
          </span>
          <button onClick={() => setOpen(false)} className="rounded-lg border border-line px-2.5 py-1 text-sm text-muted hover:text-white" aria-label="Свернуть панель">
            Свернуть ›
          </button>
        </div>
        <Top view={view} game={game} />
        <Tools view={view} />
        <p className="px-4 py-4 text-xs leading-relaxed text-muted">
          Эффекты карт не применяются сами: прочитайте, что открыл игрок, и выполните это здесь. Последние 10 действий можно отменить.
        </p>
      </aside>
    </>
  );
}
