import type { LogEntryView } from "@bunker/shared";
import { Section } from "../ui/Section.tsx";

const time = (at: number) => new Date(at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function Logs({ log }: { log: LogEntryView[] }) {
  return (
    <Section id="logs" title={`Логи (${log.length})`}>
      <ul className="scrollbar-thin max-h-72 space-y-1 overflow-auto text-sm">
        {[...log].reverse().map((e, i) => (
          <li key={i} className="flex gap-3">
            <span className="shrink-0 font-mono text-xs leading-5 text-muted">{time(e.at)}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
