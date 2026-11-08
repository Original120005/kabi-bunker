import { useState } from "react";
import { Section } from "../ui/Section.tsx";

export function Notes({ code }: { code: string }) {
  const key = `bunker.notes.${code}`;
  const [text, setText] = useState(() => localStorage.getItem(key) ?? "");
  return (
    <Section id="notes" title="Заметки">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          localStorage.setItem(key, e.target.value);
        }}
        rows={5}
        placeholder="Ваши заметки"
        className="w-full rounded-lg border border-line bg-bg p-3 text-sm outline-none focus:border-accent"
      />
      <p className="mt-1 text-xs text-muted">Заметки хранятся только в этом браузере и сохраняются после обновления страницы.</p>
    </Section>
  );
}
