import type { RoomView } from "@bunker/shared";
import { HostPanel, useHostPanelOpen } from "../host/HostPanel.tsx";
import { Catastrophe } from "./Catastrophe.tsx";
import { Bunker } from "./Bunker.tsx";
import { MyInfo } from "./MyInfo.tsx";
import { PlayersTable } from "./PlayersTable.tsx";
import { SpecialTable } from "./SpecialTable.tsx";
import { Notes } from "./Notes.tsx";
import { Logs } from "./Logs.tsx";
import { TimerBar, TimerSplash } from "./TimerBar.tsx";
import { EventPopup } from "./EventPopup.tsx";
import { RaidPopup } from "./RaidPopup.tsx";
import { VotePopup } from "./VotePopup.tsx";

const NAV = [
  { id: "catastrophe", label: "Катаклизм" },
  { id: "bunker", label: "Бункер" },
  { id: "me", label: "Мой персонаж" },
  { id: "players", label: "Игроки" },
  { id: "special", label: "Спец. возможности" },
  { id: "notes", label: "Заметки" },
  { id: "logs", label: "Логи" },
];

export function GameScreen({ view }: { view: RoomView }) {
  const game = view.game!;
  const mine = game.players.find((p) => p.id === view.me?.id);
  const isHost = view.me?.isHost === true;
  const [panelOpen, setPanelOpen] = useHostPanelOpen();

  return (
    <div className={isHost ? "md:pr-11" : ""}>
      <nav className="fixed left-1.5 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-1.5 xl:flex">
        {NAV.filter((n) => (n.id !== "me" || mine) && (n.id !== "logs" || isHost)).map((n, i) => (
          <a
            key={n.id}
            href={`#${n.id}`}
            title={n.label}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel/90 text-sm font-bold text-muted hover:border-accent hover:text-accent"
          >
            {i + 1}
          </a>
        ))}
      </nav>
      <div className="px-2 py-4 sm:px-4 xl:pl-14 xl:pr-4">
        <div className="flex min-w-0 flex-col gap-4">
          <Catastrophe game={game} />
          <Bunker game={game} />
          {mine && <MyInfo game={game} me={mine} />}
          <TimerBar timer={view.timer} />
          <PlayersTable view={view} />
          <SpecialTable view={view} />
          <Notes code={view.code} />
          {isHost && <Logs log={view.log} />}
        </div>
      </div>
      {isHost && <HostPanel view={view} open={panelOpen} setOpen={setPanelOpen} />}
      <VotePopup view={view} />
      <EventPopup view={view} />
      <RaidPopup view={view} />
      <TimerSplash />
    </div>
  );
}
