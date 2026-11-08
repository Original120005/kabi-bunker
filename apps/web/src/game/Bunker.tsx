import type { GameView } from "@bunker/shared";
import { Section } from "../ui/Section.tsx";

const ICON_PATHS: Record<string, string> = {
  size: "M3 3h18v18H3zM3 9h18M9 3v18",
  time: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2",
  food: "M5 8h14l-1.5 12h-11zM8 8V5a4 4 0 0 1 8 0v3",
};

function Icon({ name }: { name?: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d={ICON_PATHS[name ?? ""] ?? "M4 4h16v16H4z"} />
    </svg>
  );
}

export function Bunker({ game }: { game: GameView }) {
  const fields = game.bunker.fields;
  const text = fields.filter((f) => f.placement === "text" && f.values.length);
  const lists = fields.filter((f) => f.placement === "list");
  const tiles = fields.filter((f) => f.placement === "tile");

  return (
    <Section id="bunker" title="Бункер" plain>
      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:gap-10">
        <div className="space-y-3">
          {text.map((f) => (
            <p key={f.key} className="font-normal text-white/85">
              <span className="font-bold text-white">{f.name}: </span>
              {f.values.join(". ")}
            </p>
          ))}
          {lists.map((f) => (
            <div key={f.key}>
              <div className="mb-1 font-semibold">{f.name}:</div>
              {f.values.length ? (
                <ul className="list-inside list-disc text-white/85">
                  {f.values.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">ничего</p>
              )}
            </div>
          ))}
          <p className="text-lg">
            Количество мест: <span className="font-bold text-accent">{game.bunker.seats}</span>
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 md:w-72 md:grid-cols-1">
          {tiles.map((f) => (
            <div key={f.key} className="flex flex-col items-center justify-center rounded-xl border border-line p-3 text-center md:flex-row md:justify-start md:gap-3 md:text-left">
              <Icon name={f.icon} />
              <div>
                <div className="text-xs text-muted">{f.name}</div>
                <div className="font-semibold">{f.values.join(", ") || "—"}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
