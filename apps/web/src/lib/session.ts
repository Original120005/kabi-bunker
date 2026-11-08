import { useEffect, useState } from "react";

export interface SessionUser {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  rating: number;
  games: number;
  bunkerEntries: number;
  survivalPercent: number;
}

export interface SessionState {
  ready: boolean;
  configured: boolean;
  user: SessionUser | null;
  refresh: () => void;
}

export function useSession(): SessionState {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<SessionState, "refresh">>({ ready: false, configured: false, user: null });
  useEffect(() => {
    let stop = false;
    fetch("/api/auth/status", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        if (!stop) setState({ ready: true, configured: !!d.configured, user: d.user ?? null });
      })
      .catch(() => {
        if (!stop) setState({ ready: true, configured: false, user: null });
      });
    return () => {
      stop = true;
    };
  }, [tick]);
  return { ...state, refresh: () => setTick((n) => n + 1) };
}
