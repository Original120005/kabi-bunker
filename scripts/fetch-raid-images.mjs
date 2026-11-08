// Downloads freely licensed photographs for raid items from Wikimedia Commons.
//   node scripts/fetch-raid-images.mjs
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACK = path.join(ROOT, "content/packs/base/items/raidItem.json");
const OUT = path.join(ROOT, "apps/web/public/images/raid");
const UA = "KabiBunker/1.0 (personal hobby game; image prefetch)";
const OK_LICENSE = /^(cc0|cc by( \d|\-sa)?|public domain)/i;
const BAD_TITLE = /illustration|diagram|icon|logo|flag|map of|drawing|painting|sketch|cartoon|emoji|coat of arms|poster|stamp|svg|schema|graph|portrait|person|people|soldier|man |woman |child/i;

/** English search for each item. The first decent photograph wins. */
const QUERY = {
  "Банка тушёнки": "opened tin can of meat",
  "Пачка галет": "hardtack biscuits",
  "Бутылка воды": "plastic water bottle",
  "Мешочек сахара": "bag of white sugar",
  "Пакет сухарей": "rye bread crackers",
  "Рулон бинта": "roll of medical bandage",
  "Пачка активированного угля": "activated charcoal tablets",
  "Флакон зелёнки": "small green glass medicine bottle",
  "Моток изоленты": "roll of electrical tape",
  "Коробок спичек": "matchbox matches",
  "Моток верёвки": "coil of rope",
  "Свечи": "white household candles",
  "Ржавый нож": "rusty kitchen knife",
  "Арматура": "steel rebar rods",
  "Рабочие перчатки": "leather work gloves",
  "Медицинские маски": "surgical face masks",
  "Батарейки": "AA batteries",
  "Старая газета": "old newspaper",
  "Пустая канистра": "plastic jerrycan",
  "Колода карт": "deck of playing cards",
  "Резиновая уточка": "rubber duck",
  "Носки шерстяные": "wool socks",
  "Ящик консервов": "crate of canned food",
  "Армейский сухпаёк": "military MRE ration pack",
  "Мешок риса": "burlap sack of rice",
  "Таблетки для очистки воды": "water purification tablets",
  "Аптечка первой помощи": "first aid kit box",
  "Обезболивающее": "blister pack of pills",
  "Перекись водорода": "hydrogen peroxide bottle",
  "Фонарик с динамо": "hand crank flashlight",
  "Мультитул": "multitool pliers",
  "Топор": "hatchet axe",
  "Набор инструментов": "open toolbox",
  "Лопата": "entrenching shovel",
  "Бейсбольная бита": "wooden baseball bat",
  "Охотничий нож": "hunting knife sheath",
  "Рогатка с шариками": "slingshot",
  "Респиратор": "half face respirator mask",
  "Каска строителя": "yellow hard hat",
  "Дождевик-пончо": "rain poncho",
  "Портативная рация": "handheld walkie talkie",
  "Бутылка водки": "clear glass vodka bottle",
  "Блок сигарет": "carton of cigarettes",
  "Спальный мешок": "sleeping bag",
  "Противогаз ГП-7": "soviet gas mask",
  "Бронежилет": "bulletproof vest",
  "Антибиотики": "antibiotic capsules",
  "Хирургический набор": "surgical instruments scalpel",
  "Йодид калия": "potassium iodide tablets bottle",
  "Охотничье ружьё": "double barrel shotgun",
  "Арбалет": "crossbow",
  "Коробка патронов": "box of rifle ammunition",
  "Фильтр для воды": "portable water filter",
  "Семена овощей": "packets of vegetable seeds",
  "Мёд в банке": "glass jar of honey",
  "Счётчик Гейгера": "geiger counter",
  "Солнечная зарядка": "foldable solar panel charger",
  "Бинокль": "binoculars",
  "Бензопила": "chainsaw",
  "Канистра бензина": "metal gasoline can",
  "Набор для рыбалки": "fishing rod and reel",
  "Карта местности с пометками": "paper topographic map",
  "Ящик патронов к травмату": "box of cartridges",
  "Тёплая куртка": "winter down jacket",
  "Клетка с курицей": "chicken in a cage",
  "Гитара": "acoustic guitar",
  "Автомат Калашникова": "AK-74 rifle",
  "Пистолет с глушителем": "pistol suppressor",
  "Костюм химзащиты": "hazmat suit",
  "Армейский шлем": "kevlar combat helmet",
  "Портативный генератор": "portable gasoline generator",
  "Военная радиостанция": "military radio transceiver",
  "Прибор ночного видения": "night vision goggles",
  "Полевая хирургическая аптечка": "combat medical bag",
  "Инсулин в термосумке": "insulin vials",
  "Ящик армейских пайков": "stack of MRE boxes",
  "Бочка чистой воды": "plastic water barrel",
  "Коза": "domestic goat",
  "Сварочный аппарат": "inverter welding machine",
  "Дрон-разведчик": "camera quadcopter drone",
  "Золотые слитки": "gold bars",
  "Аккумуляторная батарея": "lead acid battery",
  "Лодка с мотором": "inflatable boat outboard motor",
  "Ящик медицинского спирта": "bottles of ethanol",
  "Мотоцикл": "enduro motorcycle",
  "Охотничий карабин с оптикой": "hunting rifle with scope",
  "Капибара": "capybara",
  "Набор для выживания спецназа": "survival kit backpack",
  "Ключ от военного склада": "electronic key card",
  "Вакцина от катастрофы": "vaccine vial",
  "Экзоскелет": "powered exoskeleton",
  "Портативный реактор": "radioisotope thermoelectric generator",
  "Бронированный внедорожник": "armored military vehicle",
  "Спутниковый телефон": "satellite phone",
  "Гидропонная ферма": "hydroponic plants",
  "Установка опреснения воды": "water desalination equipment",
  "Ящик гранат": "hand grenades",
  "Снайперская винтовка": "sniper rifle with scope",
  "Передвижная операционная": "field hospital tent",
  "Кейс с бриллиантами": "cut diamonds",
  "Чертежи бункера-города": "architectural blueprints",
  "Беспилотник-грузовоз": "cargo helicopter drone",
  "Запас лекарств на год": "boxes of medicine",
  "Пара здоровых кроликов": "two rabbits",
  "Белый кролик с часами": "white rabbit pocket watch",
  "Золотая капибара": "gold animal statue",
};

const pack = JSON.parse(readFileSync(PACK, "utf8"));
const missing = pack.items.filter((it) => !QUERY[it.title]).map((it) => it.title);
if (missing.length) {
  console.error("Нет запроса для:", missing.join(", "));
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(query) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const page = await searchOnce(query);
    if (page !== "retry") return page;
    await sleep(4000 * (attempt + 1));
  }
  throw new Error(`поиск не удался: ${query}`);
}

async function searchOnce(query) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "8");
  url.searchParams.set("gsrsearch", query);
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|mime|extmetadata|size");
  url.searchParams.set("iiurlwidth", "320");
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 429) return "retry";
  if (!res.ok) throw new Error(`поиск ${res.status}: ${query}`);
  const data = await res.json();
  return Object.values(data.query?.pages ?? {}).filter((p) => p.imageinfo?.[0]?.thumburl);
}

function score(page) {
  const info = page.imageinfo[0];
  const license = info.extmetadata?.LicenseShortName?.value ?? "";
  let s = 0;
  if (!OK_LICENSE.test(license.replace(/<[^>]+>/g, ""))) return -100;
  if (!/^image\/(jpeg|png|webp)$/.test(info.mime)) return -100;
  if (BAD_TITLE.test(page.title)) return -100;
  if (info.mime === "image/png") s += 1;
  if ((info.width ?? 0) >= 400) s += 1;
  return s;
}

async function download(url, file) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429) {
      await sleep(4000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`скачивание ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return;
  }
  throw new Error(`скачивание не удалось: ${url}`);
}

const have = new Map(readdirSync(OUT, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => [d.name.slice(0, 3), d.name]));
const sources = [];
let n = 0;
for (const item of pack.items) {
  n++;
  const key = String(n).padStart(3, "0");
  if (have.has(key)) {
    item.data.image = `/images/raid/${have.get(key)}`;
    console.log(`${key}  ${item.title}  (уже скачано)`);
    continue;
  }
  await sleep(1200);
  const pages = (await search(QUERY[item.title])).sort((a, b) => score(b) - score(a));
  const best = pages.find((p) => score(p) > -50);
  if (!best) {
    console.log(`НЕТ  ${item.title}`);
    delete item.data.image;
    continue;
  }
  const info = best.imageinfo[0];
  const ext = info.mime === "image/png" ? "png" : info.mime === "image/webp" ? "webp" : "jpg";
  const name = `${key}.${ext}`;
  await download(info.thumburl, path.join(OUT, name));
  item.data.image = `/images/raid/${name}`;
  const license = (info.extmetadata?.LicenseShortName?.value ?? "").replace(/<[^>]+>/g, "");
  sources.push({ item: item.title, file: best.title, license, url: info.descriptionurl });
  console.log(`${String(n).padStart(3, "0")}  ${item.title}  ←  ${best.title.replace(/^File:/, "")}`);
}

writeFileSync(PACK, JSON.stringify(pack, null, 2) + "\n");
writeFileSync(path.join(OUT, "sources.json"), JSON.stringify(sources, null, 2) + "\n");
console.log(`Готово: ${sources.length} из ${pack.items.length}`);
