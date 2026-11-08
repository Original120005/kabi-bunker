// Test players for checking the game alone: they join a room, confirm readiness, vote and answer the raid call randomly; all their cards stay closed.
//   node scripts/bots.mjs <КОД_КОМНАТЫ> [количество=5] [http://localhost:3000]
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

function botSecret() {
  if (process.env.BOT_SECRET) return process.env.BOT_SECRET;
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^BOT_SECRET=(.*)$/.exec(line.trim());
      if (match) return match[1].replace(/^["']|["']$/g, "");
    }
  }
  return "bunker-local-bots";
}

const [code, count = "5", base = "http://localhost:3000"] = process.argv.slice(2);
if (!code) {
  console.log("Использование: node scripts/bots.mjs <КОД_КОМНАТЫ> [количество=5] [адрес]");
  process.exit(1);
}

const NAMES = ["Аня", "Борис", "Вика", "Гоша", "Денис", "Ева", "Жора", "Зоя", "Игорь", "Катя", "Лёва", "Маша", "Ника", "Олег"];

const shuffled = [...NAMES].sort(() => Math.random() - 0.5);

for (const nickname of shuffled.slice(0, Number(count))) {
  const socket = io(base, { auth: { token: randomBytes(24).toString("hex"), code: code.toUpperCase(), nickname: `${nickname} (бот)`, botSecret: botSecret() } });
  let votedIn = -1;
  let raidIn = -1;
  socket.on("connect", () => console.log(`${nickname}: в комнате`));
  socket.on("kicked", (reason) => {
    console.log(`${nickname}: ${reason}`);
    socket.disconnect();
  });
  socket.on("state", (view) => {
    if (view.status === "readyCheck" && view.me?.role === "player" && !view.me.ready) {
      socket.emit("action", { type: "lobby.setReady", ready: true }, () => {});
    }
    const vote = view.vote;
    const me = view.me?.id;
    if (vote?.status === "open" && vote.voters.includes(me) && !vote.voted.includes(me) && votedIn !== vote.id) {
      votedIn = vote.id;
      const options = vote.candidates.filter((c) => c !== me);
      const target = options[Math.floor(Math.random() * options.length)];
      setTimeout(() => socket.emit("action", { type: "vote.cast", candidateId: target }, () => {}), 1000 + Math.random() * 3000);
    }
    const raid = view.raid;
    if (raid?.stage === "voting" && raid.eligible.includes(me) && raid.myAnswer === null && raidIn !== raid.id) {
      raidIn = raid.id;
      const yes = Math.random() < 0.5;
      setTimeout(() => socket.emit("action", { type: "raid.answer", yes }, () => {}), 1500 + Math.random() * 12000);
    }
  });
}

console.log("Боты подключаются. Остановить: Ctrl+C");
