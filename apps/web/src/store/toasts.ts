import { create } from "zustand";

export type ToastKind = "info" | "ok" | "error" | "white";

interface Toast {
  id: number;
  kind: ToastKind;
  title?: string;
  text: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (kind: ToastKind, text: string, title?: string, ms?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (kind, text, title, ms = 4500) => {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text, title }] });
    setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (kind: ToastKind, text: string, title?: string, ms?: number) => useToasts.getState().push(kind, text, title, ms);
