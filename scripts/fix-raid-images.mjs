// Replaces missing and clearly wrong raid photos with known Wikimedia files.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACK = path.join(ROOT, "content/packs/base/items/raidItem.json");
const OUT = path.join(ROOT, "apps/web/public/images/raid");
const UA = "KabiBunker/1.0 (personal hobby game; image prefetch)";

/** Index in the pack (1-based) -> exact Commons file, tried in order. */
const FIXES = {
  1: ["Tin cans.jpg", "Canned food.jpg"],
  12: ["Candles.jpg"],
  13: ["Kitchen knives.jpg", "Knife.jpg"],
  16: ["Surgical face mask.jpg", "Medical face mask.jpg", "Face masks.jpg"],
  23: ["Canned food.jpg", "Tin cans.jpg"],
  35: ["Bat and ball.jpg", "Baseball and bat.jpg"],
  37: ["Slingshot (weapon).jpg", "Toy slingshot.jpg"],
  42: ["Vodka bottle.jpg", "Vodka.jpg"],
  43: ["Cigarettes.jpg"],
  51: ["Crossbow.jpg"],
  52: ["Ammunition box.jpg"],
  57: ["Solar panel.jpg"],
  60: ["Jerry can.jpg", "Fuel can.jpg"],
  62: ["Map.jpg", "Road map.jpg"],
  66: ["Acoustic guitar.jpg"],
  76: ["MRE.jpg"],
  82: ["Car battery.jpg"],
  84: ["Álcool Isopropílico.png"],
  85: ["Motorcycle.jpg"],
  91: ["Exoskeleton.jpg"],
  96: ["Reverse osmosis desalination plant.JPG"],
  102: ["Delivery drone.jpg"],
  106: ["Medieval gold figurine (FindID 506719).jpg"],
};

const titles = [...new Set(Object.values(FIXES).flat())].map((f) => `File:${f}`);
const url = new URL("https://commons.wikimedia.org/w/api.php");
url.searchParams.set("action", "query");
url.searchParams.set("format", "json");
url.searchParams.set("titles", titles.join("|"));
url.searchParams.set("prop", "imageinfo");
url.searchParams.set("iiprop", "url|mime|extmetadata");
url.searchParams.set("iiurlwidth", "320");
const res = await fetch(url, { headers: { "User-Agent": UA } });
if (!res.ok) throw new Error(String(res.status));
const pages = Object.values((await res.json()).query.pages);
const byName = new Map(pages.filter((p) => p.imageinfo?.[0]?.thumburl).map((p) => [p.title.replace(/^File:/, ""), p]));

const pack = JSON.parse(readFileSync(PACK, "utf8"));
for (const [index, names] of Object.entries(FIXES)) {
  const item = pack.items[Number(index) - 1];
  const page = names.map((n) => byName.get(n)).find(Boolean);
  if (!page) {
    console.log(`НЕТ  ${index} ${item.title}`);
    continue;
  }
  const info = page.imageinfo[0];
  const license = (info.extmetadata?.LicenseShortName?.value ?? "").replace(/<[^>]+>/g, "");
  const ext = info.mime === "image/png" ? "png" : "jpg";
  const name = `${String(index).padStart(3, "0")}.${ext}`;
  const fileRes = await fetch(info.thumburl, { headers: { "User-Agent": UA } });
  if (!fileRes.ok) {
    console.log(`СКАЧ  ${item.title} ${fileRes.status}`);
    continue;
  }
  writeFileSync(path.join(OUT, name), Buffer.from(await fileRes.arrayBuffer()));
  item.data.image = `/images/raid/${name}`;
  console.log(`${name}  ${item.title}  ←  ${page.title.replace(/^File:/, "")}  [${license}]`);
  await new Promise((r) => setTimeout(r, 400));
}
writeFileSync(PACK, JSON.stringify(pack, null, 2) + "\n");
const withImage = pack.items.filter((it) => it.data.image).length;
console.log(`С картинкой: ${withImage} из ${pack.items.length}`);
