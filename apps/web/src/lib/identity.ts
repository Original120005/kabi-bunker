const TOKEN_KEY = "bunker.token";
const NICK_KEY = "bunker.nickname";

/** Secret that identifies this browser in all rooms. The server keeps only its hash. */
export function getToken(): string {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}

export function getNickname(): string {
  return localStorage.getItem(NICK_KEY) ?? "";
}

export function setNickname(nickname: string) {
  localStorage.setItem(NICK_KEY, nickname.trim());
}
