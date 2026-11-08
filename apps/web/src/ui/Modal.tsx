import type { ReactNode } from "react";

export function Modal({ title, children, onClose }: { title: ReactNode; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="overlay-in fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-line bg-panel p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-center text-xl font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
