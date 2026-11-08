// One command to host a game from this PC: build, migrate, seed, back up the DB, start the server and a Cloudflare quick tunnel.
//   npm run play             — link for friends over the internet
//   npm run play:lan         — only for the same Wi-Fi network
//   node scripts/play.mjs --no-build — skip rebuilding the client
import { execSync, spawn } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { Resolver } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 3000);
const args = new Set(process.argv.slice(2));
// From PowerShell `npm run play -- --lan` reaches npm as a config flag, hence the env fallback.
const LAN = args.has("--lan") || process.env.npm_config_lan === "true";
const BACKUPS_KEPT = 10;

const children = [];
let stopping = false;

function step(text) {
  console.log(`\n\x1b[33m▶ ${text}\x1b[0m`);
}

function run(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

function backupDb() {
  const db = path.join(ROOT, "data", "bunker.db");
  if (!existsSync(db)) return;
  const dir = path.join(ROOT, "data", "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  for (const suffix of ["", "-wal"]) {
    if (existsSync(db + suffix)) copyFileSync(db + suffix, path.join(dir, `bunker-${stamp}.db${suffix}`));
  }
  const old = readdirSync(dir).filter((f) => /^bunker-\d{8}-\d{6}\.db$/.test(f)).sort().slice(0, -BACKUPS_KEPT);
  for (const f of old) {
    rmSync(path.join(dir, f), { force: true });
    rmSync(path.join(dir, `${f}-wal`), { force: true });
  }
  console.log(`Копия базы: data/backups/bunker-${stamp}.db`);
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Сервер не запустился за 30 секунд");
}

function cloudflaredAsset() {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  if (process.platform === "win32") return { file: "cloudflared.exe", url: `cloudflared-windows-${arch}.exe` };
  if (process.platform === "linux") return { file: "cloudflared", url: `cloudflared-linux-${arch}` };
  return null;
}

async function ensureCloudflared() {
  const asset = cloudflaredAsset();
  if (!asset) throw new Error("Автоустановка cloudflared поддерживается только на Windows и Linux. Установите cloudflared вручную.");
  const dir = path.join(ROOT, "tools", "bin");
  const bin = path.join(dir, asset.file);
  if (existsSync(bin)) return bin;
  step("Скачиваю cloudflared (один раз, ~60 МБ)");
  mkdirSync(dir, { recursive: true });
  const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset.url}`);
  if (!res.ok || !res.body) throw new Error(`Не удалось скачать cloudflared: HTTP ${res.status}`);
  const tmp = `${bin}.download`;
  await pipeline(res.body, createWriteStream(tmp, { mode: 0o755 }));
  renameSync(tmp, bin);
  return bin;
}

/**
 * A fresh quick-tunnel name needs a few seconds to appear in DNS. Opening it earlier makes the local resolver
 * cache «not found» for minutes, so the link is printed only after Cloudflare's resolver knows it.
 */
async function waitForDns(url) {
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "1.0.0.1"]);
  const host = new URL(url).hostname;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await resolver.resolve4(host)).length) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => `http://${a.address}:${PORT}`);
}

function banner(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = "═".repeat(width);
  console.log(`\n\x1b[32m╔${bar}╗`);
  for (const l of lines) console.log(`║  ${l.padEnd(width - 2)}║`);
  console.log(`╚${bar}╝\x1b[0m\n`);
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

function startTunnel(bin) {
  return new Promise((resolve, reject) => {
    const tunnel = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { cwd: ROOT });
    children.push(tunnel);
    let found = false;
    const onData = (chunk) => {
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString());
      if (match && !found) {
        found = true;
        resolve(match[0]);
      }
    };
    tunnel.stdout.on("data", onData);
    tunnel.stderr.on("data", onData);
    tunnel.on("exit", (code) => {
      if (!found) reject(new Error(`cloudflared завершился с кодом ${code}. Проверьте интернет или запустите с --lan.`));
      else if (!stopping) {
        console.error("\x1b[31mТуннель отключился. Перезапустите npm run play и разошлите новую ссылку.\x1b[0m");
      }
    });
    setTimeout(() => !found && reject(new Error("Туннель не выдал ссылку за 60 секунд")), 60_000);
  });
}

try {
  if (!args.has("--no-build")) {
    step("Сборка клиента");
    run("npm run build");
  }
  step("Обновление базы данных");
  mkdirSync(path.join(ROOT, "data"), { recursive: true });
  backupDb();
  run("npm run db:migrate");
  run("npm run seed");

  step("Запуск сервера");
  const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const server = spawn(process.execPath, [tsx, "src/index.ts"], {
    cwd: path.join(ROOT, "apps", "server"),
    stdio: "inherit",
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "production" },
  });
  children.push(server);
  server.on("exit", (code) => {
    if (!stopping) {
      console.error(`\x1b[31mСервер остановился (код ${code}).\x1b[0m`);
      stopAll(code ?? 1);
    }
  });
  await waitForServer();

  if (LAN) {
    banner(["Игра запущена в локальной сети.", "Друзья в той же Wi-Fi сети открывают:", ...lanAddresses(), "", "Остановить: Ctrl+C"]);
  } else {
    step("Запуск туннеля Cloudflare");
    const url = await startTunnel(await ensureCloudflared());
    console.log("Туннель поднят, жду, пока ссылка станет доступна…");
    await waitForDns(url);
    banner([
      "Игра запущена! Ссылка для друзей:",
      url,
      "",
      `Вы можете играть с этого ПК: http://localhost:${PORT}`,
      "Ссылка меняется при каждом запуске.",
      "",
      "Discord → OAuth2 → Redirects, добавьте:",
      `${url}/api/auth/discord/callback`,
      `http://localhost:${PORT}/api/auth/discord/callback`,
      "Остановить: Ctrl+C",
    ]);
  }
} catch (e) {
  console.error(`\n\x1b[31m${e.message}\x1b[0m`);
  stopAll(1);
}
