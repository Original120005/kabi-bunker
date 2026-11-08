const KEY = "bunker.recentRooms";
const LIMIT = 5;

export function recentRooms(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((c) => typeof c === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRoom(code: string) {
  localStorage.setItem(KEY, JSON.stringify([code, ...recentRooms().filter((c) => c !== code)].slice(0, LIMIT)));
}

export function forgetRoom(code: string) {
  localStorage.setItem(KEY, JSON.stringify(recentRooms().filter((c) => c !== code)));
}
