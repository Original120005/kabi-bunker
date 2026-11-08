// End-to-end check against a running server: create a room, join players, run the ready check, start, reveal, reconnect.
//   node scripts/smoke.mjs [http://localhost:3000] [players=7]
import { randomBytes } from "node:crypto";
import { io } from "socket.io-client";

const BASE = process.argv[2] ?? "http://localhost:3000";
const N = Number(process.argv[3] ?? 7);

const token = () => randomBytes(24).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(cond, text) {
  if (!cond) throw new Error(`ПРОВАЛ: ${text}`);
  console.log(`  ok  ${text}`);
}

function client(code, tok, nickname) {
  const socket = io(BASE, { auth: { token: tok, code, nickname }, transports: ["websocket"], reconnection: false });
  const c = { socket, view: null, kicked: null, tok, nickname };
  socket.on("state", (v) => (c.view = v));
  socket.on("kicked", (r) => (c.kicked = r));
  c.act = (action) => new Promise((resolve) => socket.emit("action", action, resolve));
  return c;
}

async function until(fn, text, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await sleep(20);
  }
  throw new Error(`ПРОВАЛ: не дождались — ${text}`);
}

const hostToken = token();
const res = await fetch(`${BASE}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: hostToken, nickname: "Ведущий" }) });
const { code } = await res.json();
check(/^[A-Z2-9]{5}$/.test(code), `комната создана: ${code}`);

const clients = [client(code, hostToken, "Ведущий")];
for (let i = 1; i < N; i++) clients.push(client(code, token(), `Игрок ${i}`));
await until(() => clients.every((c) => c.view?.participants.length === N), `все ${N} в лобби`);
check(clients[0].view.me.isHost && !clients[1].view.me.isHost, "права ведущего у создателя");
check(clients.every((c) => c.view.participants.every((p) => p.online)), "все в сети");

const early = await clients[1].act({ type: "lobby.start" });
check(!early.ok && /ведущий/.test(early.error), `игрок не может начать: «${early.error}»`);

check((await clients[0].act({ type: "lobby.startReadyCheck" })).ok, "проверка готовности начата");
await until(() => clients.every((c) => c.view.status === "readyCheck"), "все видят проверку готовности");
check((await clients[0].act({ type: "lobby.setAutoStart", value: true })).ok, "автостарт включён");
for (const c of clients) await c.act({ type: "lobby.setReady", ready: true });
await until(() => clients.every((c) => c.view.status === "playing" && c.view.game), "игра началась у всех");

const g = clients[0].view.game;
check(g.players.length === N, `игроков в партии: ${N}`);
check(g.bunker.seats === Math.floor(N / 2), `мест в бункере: ${g.bunker.seats}`);
check(g.catastrophe.title && g.catastrophe.title !== "Катастрофа не задана", `катастрофа: ${g.catastrophe.title}`);

for (const c of clients) {
  for (const p of c.view.game.players) {
    for (const cards of Object.values(p.cards)) {
      for (const card of cards) {
        const leaked = p.id !== c.view.me.id && !card.hidden;
        if (leaked) throw new Error(`ПРОВАЛ: ${c.nickname} видит закрытую карту игрока ${p.nickname}`);
      }
    }
  }
}
check(true, "ни один клиент не видит чужие закрытые карты");

const p1 = clients[1];
const myProf = p1.view.game.players.find((p) => p.id === p1.view.me.id).cards.profession[0];
check(!myProf.hidden, `${p1.nickname} видит свою профессию: ${myProf.label}`);
check((await p1.act({ type: "card.setRevealed", cardId: myProf.id, revealed: true })).ok, "профессия открыта");
await until(() => clients[2].view.game.players.find((p) => p.id === p1.view.me.id).cards.profession[0].hidden === false, "другие видят открытую профессию");

const foreign = await clients[2].act({ type: "card.setRevealed", cardId: myProf.id, revealed: false });
check(!foreign.ok, `игрок не может скрыть чужую карту: «${foreign.error}»`);

p1.socket.disconnect();
await until(() => clients[0].view.participants.find((p) => p.id === p1.view.me.id)?.online === false, "отключившийся показан не в сети");
const back = client(code, p1.tok, "Другой ник");
await until(() => back.view?.game, "переподключение по токену");
check(back.view.me.id === p1.view.me.id && back.view.me.nickname === p1.nickname, "вернулся тот же игрок с тем же ником");
check(back.view.game.players.find((p) => p.id === back.view.me.id).cards.profession[0].revealed, "состояние карт сохранилось");

const late = client(code, token(), "Опоздавший");
await until(() => late.view, "опоздавший подключился");
check(late.view.me.role === "spectator", "опоздавший стал зрителем");
check(late.view.game.players.every((p) => Object.values(p.cards).flat().every((c) => c.hidden || c.revealed)), "зритель видит только открытые карты");

const status = await (await fetch(`${BASE}/api/rooms/${code}`)).json();
check(status.exists && status.status === "playing", "HTTP-статус комнаты: playing");
const spa = await fetch(`${BASE}/room/${code}`);
check(spa.ok && (await spa.text()).includes('<div id="root">'), "страница комнаты отдаётся клиентом");
const traversal = await fetch(`${BASE}/..%2f..%2fpackage.json`);
check(!(await traversal.text()).includes("workspaces"), "обход путей к файлам сервера не работает");

check((await clients[0].act({ type: "room.close" })).ok, "ведущий закрыл комнату");
await until(() => clients[2].kicked, "игроки получили уведомление о закрытии");

for (const c of [...clients, back, late]) c.socket.disconnect();
console.log("\nВсе проверки пройдены.");
process.exit(0);
