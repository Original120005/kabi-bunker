import { useEffect, useState } from "react";
import type { CardView, CharacteristicView, GamePlayerView, PlayerStatus, RoomView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";
import { Section } from "../ui/Section.tsx";
import { ask } from "../ui/Confirm.tsx";
import { CardTitle, LevelsHint } from "./Hint.tsx";

const STATUS: Record<PlayerStatus, { text: string; cls: string } | null> = {
  alive: null,
  exiled: { text: "изгнан", cls: "bg-danger/20 text-[#ff8a80]" },
  inBunker: { text: "в бункере", cls: "bg-ok/20 text-[#74c495]" },
  dead: { text: "погиб", cls: "bg-white/10 text-white/60" },
};

/** The raided player is protected from exile and votes until the outcome is shown. */
export function onRaid(view: RoomView, id: string): boolean {
  const r = view.raid;
  return !!r && r.playerId === id && (r.stage === "picking" || r.stage === "away" || r.stage === "returning");
}

export function Avatar({ name, src, online, size = "md" }: { name: string; src?: string | null; online?: boolean; size?: "sm" | "md" | "lg" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const dims = size === "lg" ? "h-14 w-14 text-xl" : size === "sm" ? "h-8 w-8 text-sm" : "h-10 w-10 text-base";
  const dot = size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3";
  return (
    <span className={`relative inline-flex shrink-0 ${dims}`}>
      {src && !failed ? (
        <img src={src} alt="" draggable={false} onError={() => setFailed(true)} className="h-full w-full rounded-full object-cover ring-1 ring-accent/40" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[#5a3d1c] to-[#2a1d0f] font-extrabold text-accent-2 ring-1 ring-accent/40">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      {online !== undefined && (
        <span className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-panel ${dot} ${online ? "bg-ok" : "bg-muted"}`} title={online ? "В сети" : "Не в сети"} />
      )}
    </span>
  );
}

export function outOfGame(status: PlayerStatus): boolean {
  return status === "exiled" || status === "dead";
}

/** Only opened cards are shown; for the host an empty cell offers to open the card on hover. */
function Cell({ cards, isHost, def, owner, align }: { cards: CardView[]; isHost: boolean; def: CharacteristicView; owner: string; align: "center" | "right" }) {
  const send = useRoom((s) => s.send);
  const open = cards.filter((c): c is Extract<CardView, { hidden: false }> => !c.hidden && c.revealed);
  const closed = cards.filter((c) => c.hidden || !c.revealed);
  const reveal = async () => {
    if (await ask(`Открыть «${def.name}» игрока ${owner} всем?`, { text: "Карта откроется от имени ведущего.", confirmLabel: "Открыть", tone: "ok" })) {
      for (const c of closed) send({ type: "card.setRevealed", cardId: c.id, revealed: true });
    }
  };
  return (
    <div className="flex flex-col items-center justify-center gap-1 text-center">
      {open.map((c) => (
        <CardTitle key={c.id} card={c} align={align} className="font-semibold leading-snug text-white" />
      ))}
      {isHost && closed.length > 0 && (
        <button onClick={reveal} className="w-fit rounded-md px-1.5 py-0.5 text-xs font-semibold text-transparent transition group-hover/cell:text-white/35 hover:!bg-ok/15 hover:!text-[#74c495]">
          открыть
        </button>
      )}
    </div>
  );
}

function NameBlock({ p, online, isHost, isMe, center, raid }: { p: GamePlayerView; online: boolean; isHost: boolean; isMe: boolean; center?: boolean; raid: boolean }) {
  const send = useRoom((s) => s.send);
  const status = raid ? { text: "на вылазке", cls: "bg-accent/20 text-accent-2" } : STATUS[p.status];
  const exile = async () => {
    if (await ask(`Изгнать игрока ${p.nickname}?`, { text: "Вернуть его можно ссылкой «вернуть» или отменой действия.", confirmLabel: "Изгнать", tone: "danger" })) {
      send({ type: "host.exile", playerId: p.id });
    }
  };
  return (
    <div className={`flex gap-2 ${center ? "items-center" : "items-start"}`}>
      <Avatar name={p.nickname} src={p.avatarUrl} online={online} size="sm" />
      <div className="min-w-0">
        <div className={`break-words font-bold leading-tight ${isMe ? "text-accent-2" : "text-white"}`}>{p.nickname}</div>
        {status && <span className={`mt-0.5 inline-block whitespace-nowrap rounded px-1.5 py-px text-[10px] font-bold uppercase ${status.cls}`}>{status.text}</span>}
        {isHost && p.status === "alive" && !raid && (
          <button onClick={exile} className="mt-0.5 block text-xs font-semibold text-[#ff7b70] underline-offset-2 hover:underline">
            изгнать
          </button>
        )}
        {isHost && p.status === "exiled" && (
          <button onClick={() => send({ type: "host.return", playerId: p.id })} className="mt-0.5 block text-xs font-semibold text-[#74c495] underline-offset-2 hover:underline">
            вернуть
          </button>
        )}
      </div>
    </div>
  );
}

function Desktop({ view, columns, online, isHost }: { view: RoomView; columns: CharacteristicView[]; online: Set<string>; isHost: boolean }) {
  const game = view.game!;
  return (
    <div className="-mx-1 hidden rounded-xl border border-line sm:-mx-3 md:block">
      <table lang="ru" className="w-full table-fixed border-collapse text-[13px] 2xl:text-[15px]">
        <colgroup>
          <col className="w-9" />
          <col className="w-[132px] 2xl:w-[160px]" />
          {columns.map((c) => (
            <col key={c.key} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-panel-2 text-center text-[12px] text-muted 2xl:text-[13px]">
            <th className="rounded-tl-xl border-b border-r border-line px-1 py-3 font-bold">№</th>
            <th className="border-b border-r border-line px-2.5 py-3 text-left font-bold">Имя</th>
            {columns.map((c) => (
              <th key={c.key} className="border-b border-r border-line px-2 py-3 align-middle font-bold leading-tight last:rounded-tr-xl last:border-r-0">
                <span className="inline-flex items-center justify-center gap-1">
                  <span className="min-w-0 hyphens-auto break-words">{c.name}</span>
                  <LevelsHint def={c} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {game.players.map((p, i) => (
            <tr
              key={p.id}
              className={`align-middle transition-colors hover:bg-white/[0.035] ${outOfGame(p.status) ? "player-out" : ""} ${p.id === view.me?.id ? "bg-accent/[0.07]" : i % 2 ? "bg-white/[0.02]" : ""}`}
            >
              <td className="h-[68px] border-b border-r border-line/70 px-1 py-2 text-center font-bold text-muted 2xl:h-[74px]">{p.seat}</td>
              <td className="border-b border-r border-line/70 px-2 py-2">
                <NameBlock p={p} online={online.has(p.id)} isHost={isHost} isMe={p.id === view.me?.id} raid={onRaid(view, p.id)} center />
              </td>
              {columns.map((c, ci) => (
                <td key={c.key} className="group/cell hyphens-auto break-words border-b border-r border-line/70 px-2.5 py-2 text-center leading-snug last:border-r-0">
                  <Cell cards={p.cards[c.key] ?? []} isHost={isHost} def={c} owner={p.nickname} align={ci === columns.length - 1 ? "right" : "center"} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Mobile({ view, columns, online, isHost }: { view: RoomView; columns: CharacteristicView[]; online: Set<string>; isHost: boolean }) {
  const game = view.game!;
  return (
    <div className="flex flex-col gap-2 md:hidden">
      {game.players.map((p) => {
        const opened = columns.flatMap((c) => {
          const cards = (p.cards[c.key] ?? []).flatMap((card) => (!card.hidden && card.revealed ? [card] : []));
          return cards.length ? [{ def: c, cards }] : [];
        });
        return (
          <div
            key={p.id}
            className={`rounded-xl border px-3 py-2.5 ${p.id === view.me?.id ? "border-accent/50 bg-accent/[0.06]" : "border-line bg-panel-2/60"} ${outOfGame(p.status) ? "player-out" : ""}`}
          >
            <div className="flex items-start gap-2">
              <span className="pt-1.5 text-xs font-bold text-muted">{p.seat}</span>
              <div className="flex-1">
                <NameBlock p={p} online={online.has(p.id)} isHost={isHost} isMe={p.id === view.me?.id} raid={onRaid(view, p.id)} />
              </div>
              <span className="pt-1 text-xs text-muted">
                {opened.length}/{columns.length}
              </span>
            </div>
            {opened.length > 0 && (
              <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 border-t border-line/60 pt-2 text-[13px]">
                {opened.map(({ def, cards }) => (
                  <div key={def.key} className="contents">
                    <dt className="text-muted">{def.name}</dt>
                    <dd className="flex flex-col font-semibold [overflow-wrap:anywhere]">
                      {cards.map((c) => (
                        <CardTitle key={c.id} card={c} align="right" />
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PlayersTable({ view }: { view: RoomView }) {
  const game = view.game!;
  const columns = game.characteristics.filter((c) => !c.specialCard);
  const alive = game.players.filter((p) => p.status === "alive" || p.status === "inBunker").length;
  const online = new Set(view.participants.filter((p) => p.online).map((p) => p.id));
  const isHost = view.me?.isHost === true;

  return (
    <Section
      id="players"
      divider={false}
      title={
        <>
          Желающие попасть в бункер:{" "}
          <span className="text-accent">
            {alive}/{game.players.length}
          </span>
        </>
      }
    >
      <Desktop view={view} columns={columns} online={online} isHost={isHost} />
      <Mobile view={view} columns={columns} online={online} isHost={isHost} />
      <p className="mt-3 text-center text-xs text-muted">
        Характеристики появляются в таблице, когда игрок открывает их всем.{isHost && " Чтобы открыть чужую карту, наведите на пустую ячейку и нажмите «открыть»."}
      </p>
    </Section>
  );
}
