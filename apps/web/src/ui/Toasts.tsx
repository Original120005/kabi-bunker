import { useToasts, type ToastKind } from "../store/toasts.ts";

const colors: Record<ToastKind, string> = {
  info: "bg-gradient-to-r from-[#3a2a0e] to-[#22190a] text-accent-2",
  ok: "bg-special text-[#8fbfa3]",
  error: "bg-gradient-to-r from-[#3d1513] to-[#2a0f0e] text-[#ff9b93]",
  white: "bg-gradient-to-r from-[#2b2d33] to-[#1c1d21] text-white",
};

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-3">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`toast-in pointer-events-auto w-full max-w-md rounded-xl border border-white/10 px-5 py-3 text-left shadow-2xl shadow-black/60 ${colors[t.kind]}`}
        >
          {t.title && <div className="text-sm font-extrabold uppercase tracking-wide">{t.title}</div>}
          <div className={t.title ? "mt-0.5 text-sm text-white/90" : "text-sm"}>{t.text}</div>
        </button>
      ))}
    </div>
  );
}
