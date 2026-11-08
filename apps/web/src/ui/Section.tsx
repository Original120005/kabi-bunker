import type { ReactNode } from "react";

/**
 * Block of the game screen with a centered title.
 * `plain`: narrower block on the page's black background, outlined by a grey border.
 */
export function Section({
  id,
  title,
  children,
  right,
  plain,
  divider = true,
}: {
  id: string;
  title: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  plain?: boolean;
  divider?: boolean;
}) {
  if (plain) {
    return (
      <section id={id} className="mx-auto w-full max-w-6xl scroll-mt-20 rounded-2xl border border-line">
        <header className="relative flex items-center px-12 pb-1 pt-4">
          <h2 className="flex-1 text-center text-lg font-extrabold sm:text-xl">{title}</h2>
          {right && <div className="absolute right-3 flex items-center gap-2">{right}</div>}
        </header>
        <div className="px-3 py-4 sm:px-4">{children}</div>
      </section>
    );
  }
  return (
    <section id={id} className="scroll-mt-20 rounded-2xl border border-line bg-panel shadow-lg shadow-black/30">
      <header className="relative flex items-center rounded-t-2xl bg-gradient-to-b from-panel-2 to-panel px-12 py-4">
        <h2 className="flex-1 text-center text-lg font-extrabold sm:text-xl">{title}</h2>
        {right && <div className="absolute right-3 flex items-center gap-2">{right}</div>}
      </header>
      <div className={`${divider ? "border-t border-line" : ""} px-3 py-4 sm:px-5`}>{children}</div>
    </section>
  );
}
