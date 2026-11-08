async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Ошибка ${res.status}`);
  return body as T;
}

export const api = {
  createRoom: () => request<{ code: string }>("/api/rooms", { method: "POST", body: "{}" }),
  roomStatus: (code: string) => request<{ exists: boolean; status: string | null }>(`/api/rooms/${encodeURIComponent(code)}`),
};
