import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { RAID, pluralRu, type RaidLoot, type RaidStep, type RaidView, type RoomView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";
import { Avatar } from "./PlayersTable.tsx";

const TIER_STYLE: Record<number, { ring: string; text: string; bg: string }> = {
  1: { ring: "border-white/25", text: "text-white/70", bg: "bg-[#17191e]" },
  2: { ring: "border-[#1c6b3c]", text: "text-[#8fbfa3]", bg: "bg-[#0c2416]" },
  3: { ring: "border-[#3d74b8]", text: "text-[#8bbcf5]", bg: "bg-[#101c2e]" },
  4: { ring: "border-[#8a55c4]", text: "text-[#c9a2f5]", bg: "bg-[#1a1028]" },
  5: { ring: "border-accent", text: "text-accent-2", bg: "bg-[#2a1c0c]" },
};
const tierStyle = (tier: number) => TIER_STYLE[tier] ?? TIER_STYLE[1];

/** Fast spin, then one smooth slow-down. A long flat tail looks like a low frame rate. */
const SPIN_EASING = "cubic-bezier(0.12, 0.8, 0.16, 1)";

function serverNow() {
  return Date.now() + useRoom.getState().clockOffset;
}

function useServerNow(ms = 200) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Flips once, when the spin is over. No ticking, so the reel is not re-rendered mid-animation. */
export function useSpinDone(startAt: number, duration: number) {
  const [done, setDone] = useState(() => serverNow() >= startAt + duration);
  useEffect(() => {
    const left = startAt + duration - serverNow();
    if (left <= 0) {
      setDone(true);
      return;
    }
    setDone(false);
    const t = setTimeout(() => setDone(true), left);
    return () => clearTimeout(t);
  }, [startAt, duration]);
  return done;
}

/**
 * Runs a server-scheduled animation: it starts at `startAt` on every client, and a client that
 * reconnects mid-spin jumps straight to the current frame.
 */
function useServerAnimation(ref: React.RefObject<HTMLElement | null>, startAt: number, duration: number, frames: () => Keyframe[] | null, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = ref.current;
    const kf = frames();
    if (!el || !kf) return;
    const elapsed = serverNow() - startAt;
    const anim = el.animate(kf, { duration, easing: SPIN_EASING, fill: "both", delay: Math.max(0, -elapsed) });
    if (elapsed > 0) anim.currentTime = Math.min(elapsed, duration);
    return () => anim.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt, duration, ...deps]);
}

/** Horizontal strip that stops with cell `RAID.reelWinIndex` under the centre marker. */
export function Reel({ cells, cellWidth, startAt, duration, offset, done }: { cells: ReactNode[]; cellWidth: number; startAt: number; duration: number; offset: number; done: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useServerAnimation(
    strip,
    startAt,
    duration,
    () => {
      const width = box.current?.clientWidth ?? 0;
      const target = width / 2 - (RAID.reelWinIndex + offset) * cellWidth;
      const start = width / 2 - 2.5 * cellWidth;
      return [{ transform: `translate3d(${start}px,0,0)` }, { transform: `translate3d(${target}px,0,0)` }];
    },
    [offset, cellWidth],
  );
  return (
    <div ref={box} className="relative overflow-hidden rounded-2xl border border-line bg-black/50 py-2">
      <div ref={strip} className="flex [backface-visibility:hidden] will-change-transform" style={{ width: cells.length * cellWidth }}>
        {cells.map((c, i) => (
          <div
            key={i}
            style={{ width: cellWidth }}
            className={`shrink-0 px-1 ${done && i !== RAID.reelWinIndex ? "opacity-25" : ""} ${done && i === RAID.reelWinIndex ? "reel-win" : ""}`}
          >
            {c}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent shadow-[0_0_12px_2px_rgba(240,180,60,0.7)]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[9px] border-t-[11px] border-x-transparent border-t-accent" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[9px] border-b-[11px] border-x-transparent border-b-accent" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-panel to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-panel to-transparent" />
    </div>
  );
}

/** Draws the chance disc once. Rotating a live conic-gradient repaints it every frame and looks uneven. */
function paintWheel(canvas: HTMLCanvasElement, chance: number) {
  const size = 512;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const c = size / 2;
  const radius = c - 8;
  const start = -Math.PI / 2;
  const ok = (Math.max(0, Math.min(100, chance)) / 100) * Math.PI * 2;
  const wedge = (from: number, to: number, color: string) => {
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, radius, from, to);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  if (ok > 0.001) wedge(start, start + ok, "#0f4a2c");
  if (ok < Math.PI * 2 - 0.001) wedge(start + ok, start + Math.PI * 2, "#8a2a22");
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 5;
  for (let i = 0; i < 20; i++) {
    const a = start + (i / 20) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * (radius - 34), c + Math.sin(a) * (radius - 34));
    ctx.lineTo(c + Math.cos(a) * (radius - 4), c + Math.sin(a) * (radius - 4));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#2a2216";
  ctx.lineWidth = 14;
  ctx.stroke();
}

/** Wheel with the success sector [0, chance) clockwise from the top; it stops with `roll` under the pointer. */
function Wheel({ chance, roll, startAt, duration, done, success, okText, failText }: { chance: number; roll: number; startAt: number; duration: number; done: boolean; success: boolean; okText: string; failText: string }) {
  const disc = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (canvas.current) paintWheel(canvas.current, chance);
  }, [chance]);
  useServerAnimation(disc, startAt, duration, () => [{ transform: "rotate(0deg)" }, { transform: `rotate(${360 * 6 - roll * 360}deg)` }], [roll]);
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-56 w-56 sm:h-64 sm:w-64">
        <div ref={disc} className="absolute inset-0 [backface-visibility:hidden] will-change-transform">
          <canvas ref={canvas} className="h-full w-full rounded-full shadow-[0_0_0_3px_rgba(240,180,60,0.45)]" />
        </div>
        <div className="absolute inset-[30%] flex flex-col items-center justify-center rounded-full border-2 border-accent/50 bg-panel shadow-inner">
          <span className="text-3xl font-black text-white sm:text-4xl">{chance}%</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">шанс</span>
        </div>
        <div className="absolute -top-2 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[20px] border-x-transparent border-t-accent drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]" />
      </div>
      <div className="mt-4 h-9">
        {done && <div className={`pop-in text-2xl font-extrabold ${success ? "text-[#74c495]" : "text-[#ff7b70]"}`}>{success ? okText : failText}</div>}
      </div>
    </div>
  );
}

function ItemPicture({ item, big }: { item: RaidLoot; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (item.image && !failed) {
    return <img src={item.image} alt="" draggable={false} onError={() => setFailed(true)} className={`object-contain ${big ? "h-16 w-16" : "h-14 w-14"}`} />;
  }
  return <span className={`leading-none ${big ? "text-5xl" : "text-3xl"}`}>{item.icon}</span>;
}

function ItemCell({ item }: { item: RaidLoot }) {
  const s = tierStyle(item.tier);
  return (
    <div className={`flex h-28 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-center ${s.ring} ${s.bg}`}>
      <ItemPicture item={item} />
      <span className="line-clamp-2 text-[11px] font-bold leading-tight text-white">{item.title}</span>
    </div>
  );
}

function ItemCard({ item, big }: { item: RaidLoot; big?: boolean }) {
  const s = tierStyle(item.tier);
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 text-left ${s.ring} ${s.bg}`}>
      <span className="shrink-0">
        <ItemPicture item={item} big={big} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`font-extrabold text-white ${big ? "text-lg" : "text-sm"}`}>{item.title}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] font-semibold">
          <span className={s.text}>{item.rarity}</span>
          <span className="text-muted">{item.category}</span>
          <span className="text-muted">ценность {item.value}</span>
        </div>
        {item.description && <p className={`mt-1 leading-snug text-white/75 ${big ? "text-sm" : "text-xs"}`}>{item.description}</p>}
      </div>
    </div>
  );
}

function Shell({ children, onHide }: { children: ReactNode; onHide?: () => void }) {
  return (
    <div className="overlay-in fixed inset-0 z-[58] flex items-center justify-center bg-black/85 p-3" onClick={onHide}>
      <div role="dialog" aria-modal onClick={(e) => e.stopPropagation()} className="pop-in no-scrollbar relative max-h-[96vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-accent/30 bg-panel shadow-2xl shadow-black/70">
        {onHide && (
          <button onClick={onHide} className="absolute right-3 top-3 z-10 rounded-lg bg-black/50 px-2.5 py-1 text-xs font-semibold text-white/80 hover:text-white">
            Свернуть
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

function Hero({ title, subtitle, small }: { title: string; subtitle?: ReactNode; small?: boolean }) {
  return (
    <div className={`relative overflow-hidden ${small ? "h-28" : "h-44 sm:h-52"}`}>
      <img src="/images/raid.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/40 to-black/20" />
      <div className="absolute inset-x-0 bottom-0 px-6 pb-3 text-center">
        <h2 className={`font-black uppercase tracking-wide text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)] ${small ? "text-2xl" : "text-3xl sm:text-4xl"}`}>{title}</h2>
        {subtitle && <div className="mt-1 text-sm font-semibold text-white/85 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">{subtitle}</div>}
      </div>
    </div>
  );
}

function Voting({ view, raid, name, avatarOf }: { view: RoomView; raid: RaidView; name: (id: string) => string; avatarOf: (id: string) => string | null }) {
  const send = useRoom((s) => s.send);
  const now = useServerNow(250);
  const bar = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const meId = view.me?.id ?? "";
  const canAnswer = raid.eligible.includes(meId) && raid.myAnswer === null && !raid.answered.includes(meId);
  const left = Math.max(0, Math.ceil((raid.votingEndsAt - now) / 1000));

  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const start = raid.votingEndsAt - RAID.voteMs;
    const anim = el.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: RAID.voteMs, fill: "both" });
    anim.currentTime = Math.min(RAID.voteMs, Math.max(0, serverNow() - start));
    return () => anim.cancel();
  }, [raid.votingEndsAt]);

  const answer = async (yes: boolean) => {
    setBusy(true);
    await send({ type: "raid.answer", yes });
    setBusy(false);
  };

  return (
    <>
      <Hero title="Вылазка" subtitle="Хотите отправиться на вылазку?" />
      <div className="px-5 pb-5 pt-2 sm:px-6">
        <div className="flex items-center justify-center gap-3">
          <span className={`text-4xl font-black tabular-nums ${left <= 5 ? "text-[#ff7b70]" : "text-accent-2"}`}>{left}</span>
          <span className="text-sm text-muted">{pluralRu(left, "секунда", "секунды", "секунд")}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
          <div ref={bar} className="h-full origin-left rounded-full bg-gradient-to-r from-accent to-accent-2 will-change-transform" />
        </div>
        <p className="mt-3 text-center text-xs text-muted">На вылазку пойдёт только один из согласившихся — его выберет рулетка. Пока игрок на вылазке, его нельзя изгнать.</p>

        {canAnswer ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button disabled={busy} onClick={() => answer(true)} className="rounded-xl bg-ok py-3.5 text-lg font-extrabold text-white hover:brightness-110 disabled:opacity-50">
              Да
            </button>
            <button disabled={busy} onClick={() => answer(false)} className="rounded-xl border border-line bg-panel-2 py-3.5 text-lg font-extrabold hover:border-white/30 disabled:opacity-50">
              Нет
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-line bg-panel-2/60 py-3 text-center text-sm font-semibold">
            {raid.myAnswer === true ? <span className="text-[#74c495]">Вы согласились пойти на вылазку</span> : raid.myAnswer === false ? <span className="text-muted">Вы отказались</span> : <span className="text-muted">Ждём ответов игроков</span>}
          </div>
        )}

        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-muted">
            <span>Согласились: {raid.volunteers.length}</span>
            <span>
              Ответили {raid.answered.length} из {raid.eligible.length}
            </span>
          </div>
          <div className="flex min-h-11 flex-wrap gap-1.5 rounded-xl border border-line/70 bg-black/30 p-2">
            {raid.volunteers.length === 0 && <span className="m-auto text-xs text-muted">Пока никто не вызвался</span>}
            {raid.volunteers.map((id) => (
              <span key={id} className="pop-in flex items-center gap-1.5 rounded-full border border-ok/50 bg-ok/15 py-0.5 pl-0.5 pr-2.5 text-sm font-bold">
                <Avatar name={name(id)} src={avatarOf(id)} size="sm" />
                {name(id)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Picking({ raid, name, avatarOf }: { raid: RaidView; name: (id: string) => string; avatarOf: (id: string) => string | null }) {
  const pick = raid.pick;
  const done = useSpinDone(pick?.at ?? Number.MAX_SAFE_INTEGER, RAID.pickSpinMs);
  return (
    <>
      <Hero title="Вылазка" subtitle={`Рулетка выбирает одного из ${raid.volunteers.length} добровольцев`} small />
      <div className="px-4 pb-6 pt-3 sm:px-6">
        {pick && (
          <Reel
            cellWidth={132}
            startAt={pick.at}
            duration={RAID.pickSpinMs}
            offset={pick.offset}
            done={done}
            cells={pick.reel.map((id, i) => (
              <div key={i} className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-panel-2 px-1">
                <Avatar name={name(id)} src={avatarOf(id)} />
                <span className="w-full truncate text-center text-sm font-bold">{name(id)}</span>
              </div>
            ))}
          />
        )}
        <div className="mt-5 flex h-10 items-center justify-center text-center">
          {done ? (
            <div className="pop-in flex items-center justify-center gap-2 text-xl font-extrabold sm:text-2xl">
              <Avatar name={name(pick!.reel[RAID.reelWinIndex])} src={avatarOf(pick!.reel[RAID.reelWinIndex])} />
              <span>
                <span className="text-accent-2">{name(pick!.reel[RAID.reelWinIndex])}</span> отправляется на вылазку!
              </span>
            </div>
          ) : (
            <div className="text-sm text-muted">Кто же пойдёт?..</div>
          )}
        </div>
      </div>
    </>
  );
}

function spinMs(step: RaidStep) {
  return step.kind === "survival" ? RAID.survivalSpinMs : step.kind === "chance" ? RAID.chanceSpinMs : RAID.itemSpinMs;
}

function Returning({ raid, name, avatarOf }: { raid: RaidView; name: (id: string) => string; avatarOf: (id: string) => string | null }) {
  const steps = raid.steps;
  const index = steps.length - 1;
  const step = steps[index];
  const done = useSpinDone(step?.at ?? Number.MAX_SAFE_INTEGER, step ? spinMs(step) : 1);
  const found = steps.flatMap((s) => (s.kind === "item" && (s !== step || done) ? [s.item] : []));
  const player = name(raid.playerId ?? "");
  const itemNo = steps.filter((s) => s.kind === "item").length;

  let title = "Вернулся ли игрок живым?";
  if (step?.kind === "chance") title = `Удастся ли найти предмет №${step.tier}?`;
  if (step?.kind === "item") title = `Предмет №${step.tier}`;

  return (
    <>
      <Hero title={player} subtitle="вернулся с вылазки" small />
      <div className="px-4 pb-5 pt-3 sm:px-6">
        {raid.playerId && (
          <div className="mb-3 flex justify-center">
            <Avatar name={player} src={avatarOf(raid.playerId)} size="lg" />
          </div>
        )}
        <div className="mb-3 flex justify-center gap-1.5">
          {RAID.lootChances.map((c, i) => {
            const got = i < found.length;
            const current = step && step.kind !== "survival" && step.tier === i + 1;
            return (
              <span
                key={i}
                className={`rounded-lg border px-2 py-0.5 text-[11px] font-bold ${got ? `${tierStyle(i + 1).ring} ${tierStyle(i + 1).text} bg-white/5` : current ? "border-accent/70 text-accent-2" : "border-line text-muted"}`}
              >
                №{i + 1} · {c}%
              </span>
            );
          })}
        </div>
        <h3 className="mb-3 text-center text-lg font-extrabold">{title}</h3>

        {!step && <div className="py-16 text-center text-sm text-muted">Подсчитываем шансы…</div>}

        {step?.kind === "survival" && (
          <div key={`s-${index}`}>
            <Wheel chance={step.chance} roll={step.roll} startAt={step.at} duration={RAID.survivalSpinMs} done={done} success={step.success} okText="Выжил!" failText="Погиб…" />
          </div>
        )}

        {step?.kind === "chance" && (
          <div key={`c-${index}`}>
            <Wheel chance={step.chance} roll={step.roll} startAt={step.at} duration={RAID.chanceSpinMs} done={done} success={step.success} okText="Что-то нашлось!" failText="Больше ничего не найдено" />
          </div>
        )}

        {step?.kind === "item" && (
          <div key={`i-${index}`}>
            <Reel cellWidth={112} startAt={step.at} duration={RAID.itemSpinMs} offset={step.offset} done={done} cells={step.reel.map((it, i) => <ItemCell key={i} item={it} />)} />
            <div className="mt-3 min-h-28">{done && <div className="pop-in"><ItemCard item={step.item} big /></div>}</div>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-line/70 bg-black/30 p-2">
          <div className="mb-1 text-xs font-semibold text-muted">
            Рюкзак: {found.length} {pluralRu(found.length, "предмет", "предмета", "предметов")}
            {itemNo > found.length && " (+ крутится)"}
          </div>
          <div className="flex min-h-10 flex-wrap gap-1.5">
            {found.map((it) => (
              <span key={it.id} title={it.description} className={`pop-in flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-bold ${tierStyle(it.tier).ring} ${tierStyle(it.tier).text}`}>
                {it.image ? <img src={it.image} alt="" className="h-5 w-5 object-contain" /> : <span className="text-base leading-none">{it.icon}</span>}
                {it.title}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Done({ view, raid, name, avatarOf, onClose }: { view: RoomView; raid: RaidView; name: (id: string) => string; avatarOf: (id: string) => string | null; onClose: () => void }) {
  const send = useRoom((s) => s.send);
  const isHost = view.me?.isHost === true;
  const player = name(raid.playerId ?? "");
  const total = raid.loot.reduce((s, l) => s + l.value, 0);
  return (
    <>
      <Hero
        title={raid.survived ? "Итоги вылазки" : "Вылазка окончена"}
        subtitle={
          raid.survived ? (
            <>
              <span className="text-accent-2">{player}</span> вернулся и принёс {raid.loot.length} {pluralRu(raid.loot.length, "предмет", "предмета", "предметов")}
            </>
          ) : (
            <>
              <span className="text-[#ff7b70]">{player}</span> погиб на вылазке
            </>
          )
        }
        small
      />
      <div className="px-4 pb-5 pt-3 sm:px-6">
        {raid.playerId && (
          <div className="mb-3 flex justify-center">
            <Avatar name={player} src={avatarOf(raid.playerId)} size="lg" />
          </div>
        )}
        {raid.survived ? (
          <>
            <div className="flex flex-col gap-2">
              {raid.loot.map((it) => (
                <ItemCard key={it.id} item={it} />
              ))}
            </div>
            <p className="mt-2 text-center text-xs text-muted">Общая ценность: {total}. Предметы добавлены в рюкзак игрока и видны всем.</p>
          </>
        ) : (
          <p className="py-6 text-center text-sm text-white/80">Игрок не вернулся живым. Его характеристики остаются в таблице, но в бункер он уже не попадёт.</p>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button onClick={onClose} className="min-w-40 rounded-xl border border-line bg-panel-2 px-5 py-2.5 text-sm font-semibold hover:border-white/30">
            Закрыть окно
          </button>
          {isHost && (
            <button onClick={() => send({ type: "host.raid.clear" })} className="min-w-40 rounded-xl bg-gradient-to-r from-accent to-accent-2 px-5 py-2.5 text-sm font-bold text-black hover:brightness-110">
              Продолжить игру
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** Every stage of «Вылазка» for every participant; all outcomes come from the server. */
export function RaidPopup({ view }: { view: RoomView }) {
  const raid = view.raid;
  const [hidden, setHidden] = useState<string | null>(null);
  if (!raid || !view.game || raid.stage === "away") return null;
  const name = (id: string) => view.game!.players.find((p) => p.id === id)?.nickname ?? "Игрок";
  const avatarOf = (id: string) => view.game!.players.find((p) => p.id === id)?.avatarUrl ?? null;
  const key = `${raid.id}:${raid.stage}`;
  const hide = () => setHidden(key);

  if (hidden === key) {
    if (raid.stage === "done" || raid.stage === "cancelled") return null;
    return (
      <button
        onClick={() => setHidden(null)}
        className="fixed bottom-4 left-1/2 z-[45] flex w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-accent/40 bg-panel/95 px-4 py-3 text-left shadow-2xl shadow-black/60"
      >
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
        </span>
        <span className="flex-1 text-sm font-bold">{raid.stage === "voting" ? "Голосование на вылазку" : raid.stage === "picking" ? "Выбор игрока для вылазки" : "Итоги вылазки"}</span>
        <span className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-black">Открыть</span>
      </button>
    );
  }

  switch (raid.stage) {
    case "voting":
      return (
        <Shell onHide={hide}>
          <Voting view={view} raid={raid} name={name} avatarOf={avatarOf} />
        </Shell>
      );
    case "cancelled":
      return (
        <Shell onHide={hide}>
          <Hero title="Вылазка отменена" subtitle="Никто не согласился отправиться на вылазку" small />
          <div className="px-6 pb-5 pt-3 text-center">
            <button onClick={hide} className="min-w-40 rounded-xl border border-line bg-panel-2 px-5 py-2.5 text-sm font-semibold hover:border-white/30">
              Закрыть
            </button>
          </div>
        </Shell>
      );
    case "picking":
      return (
        <Shell onHide={hide}>
          <Picking raid={raid} name={name} avatarOf={avatarOf} />
        </Shell>
      );
    case "returning":
      return (
        <Shell onHide={hide}>
          <Returning raid={raid} name={name} avatarOf={avatarOf} />
        </Shell>
      );
    case "done":
      return (
        <Shell onHide={hide}>
          <Done view={view} raid={raid} name={name} avatarOf={avatarOf} onClose={hide} />
        </Shell>
      );
  }
}
