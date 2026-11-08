import { useEffect, useState } from "react";
import type { RoomView } from "@bunker/shared";
import { useRoom } from "../store/room.ts";

const SHOW_EXPIRED_MS = 4000;

function useServerNow(active: boolean) {
  const offset = useRoom((s) => s.clockOffset);
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now() + offset), 200);
    setNow(Date.now() + offset);
    return () => clearInterval(t);
  }, [active, offset]);
  return now;
}

const SPLASH_MS = 2000;

function secondsWord(n: number) {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return "секунду";
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return "секунды";
  return "секунд";
}

/** Full-screen notice that the host started a timer; hides itself after two seconds or on tap. */
export function TimerSplash() {
  const splash = useRoom((s) => s.timerSplash);
  const hide = useRoom((s) => s.hideTimerSplash);
  useEffect(() => {
    if (!splash) return;
    const t = setTimeout(hide, SPLASH_MS);
    return () => clearTimeout(t);
  }, [splash, hide]);
  if (!splash) return null;

  return (
    <div
      key={splash.id}
      onClick={hide}
      className="splash-fade fixed inset-0 z-[70] flex cursor-pointer items-center justify-center bg-black/80 p-6"
    >
      <div className="splash-pop flex flex-col items-center text-center">
        <img
          src="/images/timer-rabbit.png"
          alt=""
          className="h-64 w-auto drop-shadow-[0_0_40px_rgba(240,160,48,0.25)] sm:h-80"
          style={{ maskImage: "linear-gradient(to bottom, #000 72%, transparent 98%)", WebkitMaskImage: "linear-gradient(to bottom, #000 72%, transparent 98%)" }}
        />
        <div className="-mt-6 text-sm font-bold uppercase tracking-[0.2em] text-muted">Таймер запущен</div>
        <div className="mt-1 text-4xl font-extrabold text-accent-2 drop-shadow-[0_0_24px_rgba(240,160,48,0.45)] sm:text-5xl">
          {splash.seconds} {secondsWord(splash.seconds)}
        </div>
      </div>
    </div>
  );
}

/** Countdown above the players table; stays a few seconds after the end with «Время вышло». */
export function TimerBar({ timer }: { timer: RoomView["timer"] }) {
  const now = useServerNow(timer !== null);
  if (!timer) return null;
  const left = timer.endsAt - now;
  if (left < -SHOW_EXPIRED_MS) return null;
  const seconds = Math.max(0, Math.ceil(left / 1000));
  const share = Math.max(0, Math.min(1, left / (timer.seconds * 1000)));
  const over = left <= 0;
  const urgent = !over && seconds <= 5;

  return (
    <div className="sticky top-[68px] z-20 mx-auto w-full max-w-md">
      <div
        className={`flex items-center gap-3 rounded-2xl border px-4 py-2.5 shadow-xl shadow-black/50 transition-colors ${
          over ? "border-danger/60 bg-[#3d1513]/90" : urgent ? "border-danger/50 bg-panel/90" : "border-accent/40 bg-panel/90"
        }`}
      >
        <span className={`text-sm font-bold ${over ? "text-[#ff9b93]" : "text-muted"}`}>{over ? "Время вышло" : "Таймер"}</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
          <div className={`h-full rounded-full transition-[width] duration-200 ease-linear ${urgent || over ? "bg-danger" : "bg-gradient-to-r from-accent to-accent-2"}`} style={{ width: `${share * 100}%` }} />
        </div>
        <span className={`w-14 text-right font-mono text-xl font-extrabold tabular-nums ${urgent || over ? "text-[#ff7b70]" : "text-accent-2"}`}>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
