import { formatNumber, pluralRu, type GameView } from "@bunker/shared";

const FALLBACK = "/images/cat-default.jpg";

export function Catastrophe({ game }: { game: GameView }) {
  const { title, description, population, timerMinutes, image } = game.catastrophe;
  return (
    <section id="catastrophe" className="relative scroll-mt-20 overflow-hidden rounded-2xl border border-line shadow-lg shadow-black/40">
      <img src={image ?? FALLBACK} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => (e.currentTarget.src = FALLBACK)} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/65 to-black/90" />
      <div className="relative flex min-h-[340px] flex-col items-center justify-center px-5 py-12 text-center sm:min-h-[400px] sm:px-12">
        <div className="mb-3 rounded-full border border-accent/60 bg-black/40 px-4 py-1 text-xs font-bold uppercase tracking-[0.3em] text-accent">Катаклизм</div>
        <h1 className="mb-5 text-3xl font-extrabold drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] sm:text-5xl">{title}</h1>
        <p className="mx-auto max-w-3xl text-base leading-relaxed text-white/90 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] sm:text-lg">{description}</p>
        {population !== null && (
          <p className="mt-6 text-base drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] sm:text-lg">
            Остаток населения — <span className="font-extrabold text-accent-2">{formatNumber(population)}</span>{" "}
            {pluralRu(population, "человек", "человека", "человек")}
          </p>
        )}
        {timerMinutes !== null && <p className="mt-3 text-sm text-white/80">Таймер катаклизма: {timerMinutes} мин.</p>}
      </div>
    </section>
  );
}
