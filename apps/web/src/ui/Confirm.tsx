import { useEffect } from "react";
import { create } from "zustand";

type Tone = "primary" | "danger" | "ok";

interface Request {
  title: string;
  text?: string;
  confirmLabel: string;
  tone: Tone;
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ request: Request | null }>(() => ({ request: null }));

/** Styled replacement for window.confirm. */
export function ask(title: string, opts: { text?: string; confirmLabel?: string; tone?: Tone } = {}): Promise<boolean> {
  useConfirm.getState().request?.resolve(false);
  return new Promise((resolve) => {
    useConfirm.setState({ request: { title, text: opts.text, confirmLabel: opts.confirmLabel ?? "Подтвердить", tone: opts.tone ?? "primary", resolve } });
  });
}

const tones: Record<Tone, string> = {
  primary: "bg-gradient-to-r from-accent to-accent-2 text-black",
  danger: "bg-danger text-white",
  ok: "bg-ok text-white",
};

export function ConfirmHost() {
  const request = useConfirm((s) => s.request);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    useConfirm.setState({ request: null });
  };

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!request) return null;
  return (
    <div className="overlay-in fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onClick={() => close(false)}>
      <div
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
        className="pop-in w-full max-w-sm overflow-hidden rounded-2xl border border-accent/30 bg-panel shadow-2xl shadow-black/70"
      >
        <div className="px-6 pb-5 pt-6 text-center">
          <img src="/logo.png" alt="" className="mx-auto mb-3 h-12 w-12 rounded-full ring-2 ring-accent/50" />
          <h2 className="text-lg font-extrabold leading-snug">{request.title}</h2>
          {request.text && <p className="mt-2 text-sm leading-relaxed text-white/70">{request.text}</p>}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button onClick={() => close(false)} className="rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm font-semibold hover:border-white/30">
              Отмена
            </button>
            <button autoFocus onClick={() => close(true)} className={`rounded-xl px-4 py-2.5 text-sm font-bold hover:brightness-110 ${tones[request.tone]}`}>
              {request.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
