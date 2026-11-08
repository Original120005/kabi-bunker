// Captures the main screens against a running server: the host in a real browser, the other players as socket bots.
//   node scripts/screenshots.mjs [http://localhost:3000] [docs/screenshots/stage-3]
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { io } from "socket.io-client";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = path.resolve(process.argv[3] ?? "docs/screenshots/stage-3");
mkdirSync(OUT, { recursive: true });
const shot = (name) => path.join(OUT, `${name}.png`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const host = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" })).newPage();
host.on("dialog", (d) => d.accept());
host.on("pageerror", (e) => console.error("Ошибка на странице:", e.message));

await host.goto(BASE);
await host.screenshot({ path: shot("1-home") });
await host.fill('input[placeholder="Например, Дима"]', "Дима");
await host.click("text=Создать игру");
await host.waitForURL(/\/room\//);
const code = host.url().split("/room/")[1];

const bots = ["Аня", "Борис", "Вика", "Гоша", "Денис", "Ева"].map((nickname) => {
  const token = randomBytes(24).toString("hex");
  const s = io(BASE, { auth: { token, code, nickname }, transports: ["websocket"] });
  const bot = { s, token, nickname, view: null };
  s.on("state", (v) => {
    bot.view = v;
    if (v.status === "readyCheck" && !v.me.ready) s.emit("action", { type: "lobby.setReady", ready: true }, () => {});
    const vote = v.vote;
    if (vote?.status === "open" && vote.voters.includes(v.me.id) && !vote.voted.includes(v.me.id) && bot.votedIn !== vote.id) {
      bot.votedIn = vote.id;
      const target = vote.candidates.find((c) => c !== v.me.id && c !== bots[0].view?.me?.id) ?? vote.candidates.find((c) => c !== v.me.id);
      setTimeout(() => s.emit("action", { type: "vote.cast", candidateId: target }, () => {}), 200);
    }
    if (v.raid?.stage === "voting" && v.raid.myAnswer === null && bot.raidIn !== v.raid.id) {
      bot.raidIn = v.raid.id;
      setTimeout(() => s.emit("action", { type: "raid.answer", yes: !!bot.raidYes }, () => {}), 600 + Math.random() * 1500);
    }
  });
  return bot;
});
await sleep(800);
await host.screenshot({ path: shot("2-lobby-host") });

await host.click("button:has-text('Начать игру')");
await sleep(800);
await host.screenshot({ path: shot("3-ready-check") });
await host.click("button:has-text('Я готов')");
await sleep(400);
await host.screenshot({ path: shot("3-ready-check-all") });
await host.click("button:has-text('Я не готов')");
await sleep(300);
await host.click("button:has-text('Я готов')");
await sleep(300);
await host.click(".fixed button:has-text('Начать игру')");
await host.waitForSelector("#catastrophe");

for (const [i, bot] of bots.entries()) {
  const me = bot.view.game.players.find((p) => p.id === bot.view.me.id);
  for (const k of ["gender", "profession", "health", "body"].slice(0, 1 + (i % 4))) {
    bot.s.emit("action", { type: "card.setRevealed", cardId: me.cards[k][0].id, revealed: true }, () => {});
  }
  if (i % 2 === 0) bot.s.emit("action", { type: "card.setRevealed", cardId: me.cards.special[0].id, revealed: true }, () => {});
}
await sleep(500);
await host.click("#me button[title='Нажмите, чтобы открыть всем'] >> nth=0");
await sleep(600);
await host.screenshot({ path: shot("4-game") });
await host.locator("#players span.cursor-help >> nth=0").hover();
await sleep(200);
await host.locator("#players").screenshot({ path: shot("4-players-tooltip") });
await host.locator("#me span.cursor-help >> nth=0").hover();
await sleep(200);
await host.locator("#me").screenshot({ path: shot("4-me-tooltip") });
await host.click("button:has-text('Панель ведущего')");
await sleep(400);
await host.click("#players button:has-text('изгнать') >> nth=2");
await sleep(200);
await host.click("[role=dialog] button:has-text('Изгнать')");
await sleep(400);
await host.click("#special button:has-text('Нажмите, чтобы применить') >> nth=0");
await sleep(300);
await host.screenshot({ path: shot("4-apply-special") });
await host.click("[role=dialog] button:has-text('Применить'), [role=dialog] button:has-text('Отметить применённой')");
await sleep(600);
await host.screenshot({ path: shot("4-applied") });
const undoLabel = await host.locator("aside button:has-text('Отменить предыдущее действие')").innerText().catch(() => "");
console.log("Отмена в панели:", undoLabel.replace(/\s+/g, " "));
await host.click("button:has-text('Бросить кубик')");
await host.click("button:has-text('d20')");
await sleep(600);
await host.screenshot({ path: shot("4-host-dice") });
await host.click("button:has-text('Вылечить / сделать')");
await sleep(200);
await host.locator("aside").screenshot({ path: shot("4-host-panel") });
for (const id of ["catastrophe", "bunker", "me", "players", "special"]) await host.locator(`#${id}`).screenshot({ path: shot(`4-${id}`) });
await host.click("button:has-text('Свернуть ›')");
await sleep(300);
await host.locator("#players").screenshot({ path: shot("4-players-no-panel") });

await host.click("button:has-text('Панель ведущего')");
await sleep(400);
await host.click("aside button:has-text('30')");
await sleep(500);
await host.screenshot({ path: shot("6-timer-splash") });
await sleep(2000);
await host.screenshot({ path: shot("6-timer") });
await host.click("aside button:has-text('Остановить таймер')");
await sleep(300);
await host.click("aside button:has-text('15')");
await sleep(500);
console.log("Попап после остановки и перезапуска:", (await host.locator(".splash-fade").count()) > 0 ? "есть" : "НЕТ");
await sleep(2000);
await host.click("aside button:has-text('Начать голосование')");
await sleep(300);
await host.screenshot({ path: shot("6-vote-setup") });
await host.click("[role=dialog] button:has-text('Выбрать всех')");
await host.click("[role=dialog] button:has-text('Начать голосование (')");
await sleep(1200);
await host.screenshot({ path: shot("6-vote") });
if (await host.locator("button:has-text('Выберите игрока')").count()) {
  await host.locator("[class*='max-w-xl'] .grid button").first().click();
  await host.click("button:has-text('Голосовать против')");
  await sleep(500);
}
await sleep(1000);
await host.screenshot({ path: shot("6-vote-results") });
await host.click("button:has-text('Убрать результаты у всех')");
await sleep(300);

for (const bot of bots.slice(1, 4)) bot.raidYes = true;
await host.click("aside button:has-text('Запустить голосование на вылазку')");
await sleep(2500);
await host.screenshot({ path: shot("7-raid-vote") });
if (await host.locator("[role=dialog] button:has-text('Нет')").count()) await host.click("[role=dialog] button:has-text('Нет')");
await sleep(500);
await host.screenshot({ path: shot("7-raid-vote-answered") });
await host.waitForSelector("text=Рулетка выбирает", { timeout: 40000 });
await sleep(3500);
await host.screenshot({ path: shot("7-raid-pick-spin") });
await host.waitForSelector("text=отправляется на вылазку!", { timeout: 15000 });
await sleep(700);
await host.screenshot({ path: shot("7-raid-pick-done") });
await host.waitForSelector("[role=dialog]", { state: "detached", timeout: 15000 });
await sleep(400);
await host.locator("#players").screenshot({ path: shot("7-raid-away-table") });
await host.locator("aside").screenshot({ path: shot("7-raid-host-panel") });
await host.click("aside button:has-text('Игрок вернулся')");
await sleep(3500);
await host.screenshot({ path: shot("7-raid-survival-spin") });
await sleep(5000);
await host.screenshot({ path: shot("7-raid-survival-result") });
await sleep(4000);
await host.reload();
await host.waitForSelector("[role=dialog]");
await sleep(1500);
await host.screenshot({ path: shot("7-raid-after-reload") });
for (let i = 0; i < 40 && !(await host.locator("text=Продолжить игру").count()); i++) {
  await sleep(3000);
  if (i % 3 === 0) await host.screenshot({ path: shot(`7-raid-step-${String(i).padStart(2, "0")}`) });
}
await sleep(500);
await host.screenshot({ path: shot("7-raid-done") });
console.log("Итог вылазки:", (await host.locator("[role=dialog] h2").innerText()).replace(/\s+/g, " "), "|", (await host.locator("[role=dialog] h2 + div").innerText()).replace(/\s+/g, " "));
await host.click("[role=dialog] button:has-text('Продолжить игру')");
await sleep(500);
await host.locator("#players").screenshot({ path: shot("7-raid-after-table") });

const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
await mobileCtx.addInitScript(([t, n]) => {
  localStorage.setItem("bunker.token", t);
  localStorage.setItem("bunker.nickname", n);
}, [bots[1].token, bots[1].nickname]);
const mobile = await mobileCtx.newPage();
await mobile.goto(`${BASE}/room/${code}`);
await mobile.waitForSelector("#catastrophe");
await sleep(400);
await mobile.screenshot({ path: shot("5-mobile") });
await mobile.locator("#me").screenshot({ path: shot("5-mobile-me") });
await mobile.locator("#players").screenshot({ path: shot("5-mobile-players") });

const hostMobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU", storageState: await host.context().storageState() });
const hostMobile = await hostMobileCtx.newPage();
await hostMobile.goto(`${BASE}/room/${code}`);
await hostMobile.waitForSelector("#catastrophe");
await hostMobile.evaluate(() => localStorage.removeItem("bunker.hostPanel"));
await hostMobile.reload();
await hostMobile.waitForSelector("#catastrophe");
await hostMobile.click("button:has-text('Ведущий')");
await sleep(300);
await hostMobile.screenshot({ path: shot("5-mobile-host-panel") });

await host.evaluate(() => fetch("/api/health"));
for (const b of bots) b.s.disconnect();
await browser.close();
console.log(`Скриншоты сохранены в ${OUT} (комната ${code})`);
process.exit(0);
