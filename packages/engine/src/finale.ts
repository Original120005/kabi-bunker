import {
  BUNKER_PROBLEMS,
  CATASTROPHE_NEEDS,
  CONTAGIOUS,
  EVENT_SOLVERS,
  FINALE_BASE,
  FINALE_MAX,
  FINALE_MIN,
  finaleRevealAt,
  ITEM_LABELS,
  ITEM_PATTERNS,
  SKILL_LABELS,
  SKILL_PATTERNS,
  type FinaleFactor,
  type FinaleItem,
  type FinaleResult,
  type FinaleSkill,
  type Solver,
} from "@bunker/shared";
import { BUNKER_EVENTS } from "./events.ts";
import type { Rng } from "./rng.ts";
import type { Card, GameState, RoomState } from "./types.ts";

const EMPTY = "Пусто";

interface Person {
  id: string;
  name: string;
  gender: string | null;
  age: number | null;
  childfree: boolean;
  body: string | null;
  health: Card[];
  healthy: boolean;
  profession: string | null;
  experience: string | null;
  extra: string[];
}

function cardsOf(game: GameState, playerId: string, key: string): Card[] {
  return (game.hands[playerId]?.[key] ?? []).map((id) => game.cards[id]).filter((c): c is Card => !!c);
}

const real = (c: Card) => !!c.contentId || c.title !== EMPTY;

function personOf(state: RoomState, game: GameState, id: string): Person {
  const g = cardsOf(game, id, "gender")[0];
  const health = cardsOf(game, id, "health");
  const prof = cardsOf(game, id, "profession").find(real);
  return {
    id,
    name: state.participants.find((p) => p.id === id)?.nickname ?? "Игрок",
    gender: g && real(g) ? g.title : null,
    age: typeof g?.modifiers.age === "number" ? g.modifiers.age : null,
    childfree: g?.modifiers.childfree === true,
    body: cardsOf(game, id, "body")[0]?.title ?? null,
    health,
    healthy: health.every((c) => c.title === "Идеально здоров"),
    profession: prof ? prof.title : null,
    experience: prof && typeof prof.modifiers.experience === "string" ? prof.modifiers.experience : null,
    extra: cardsOf(game, id, "extraInfo").map((c) => c.title),
  };
}

/** Skills of a profession by its title. */
export function professionSkills(title: string | null): FinaleSkill[] {
  if (!title) return [];
  const t = title.toLowerCase();
  return (Object.keys(SKILL_PATTERNS) as FinaleSkill[]).filter((k) => SKILL_PATTERNS[k].test(t));
}

/** Kinds of a free-text item. */
export function itemKinds(title: string): FinaleItem[] {
  const t = title.toLowerCase();
  return (Object.keys(ITEM_PATTERNS) as FinaleItem[]).filter((k) => ITEM_PATTERNS[k].test(t));
}

/** «на год и 9 месяцев», «2 года 3 месяца», «на полгода», «еды нет» → months. Null when nothing is recognised. */
export function parseMonths(text: string): number | null {
  const t = text.toLowerCase();
  if (/еды нет|нет еды/.test(t)) return 0;
  if (/полгода/.test(t)) return 6;
  let months = 0;
  let found = false;
  const years = t.match(/(\d+)\s*(год|года|лет)/);
  if (years) {
    months += Number(years[1]) * 12;
    found = true;
  } else if (/(^|[^а-яё])год([^а-яё]|$)/.test(t)) {
    months += 12;
    found = true;
  }
  const m = t.match(/(\d+)\s*месяц/);
  if (m) {
    months += Number(m[1]);
    found = true;
  }
  return found ? months : null;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};

/** A woman 16–50, not childfree, not frail and not severely obese, and not known to be infertile. */
function fertileWoman(p: Person) {
  return p.gender === "Женщина" && p.age !== null && p.age >= 16 && p.age <= 50 && !p.childfree && p.body !== "Хрупкое" && p.body !== "Ожирение-сильное" && !infertile(p);
}

function fertileMan(p: Person) {
  return p.gender === "Мужчина" && p.age !== null && p.age >= 16 && !p.childfree && !infertile(p);
}

function infertile(p: Person) {
  return [...p.extra, ...p.health.map((c) => c.title)].some((t) => /бесплод/i.test(t));
}

const SEVERITY_DELTA: Record<string, number> = { light: 0, medium: -1, heavy: -4, critical: -7 };

/**
 * Builds the bunker's fate from everyone inside. Pure: the same state and RNG give the same result.
 * `inside` are the players who enter the bunker.
 */
export function simulateBunker(state: RoomState, game: GameState, inside: string[], rng: Rng, now: number): FinaleResult {
  const people = inside.map((id) => personOf(state, game, id));
  const factors: FinaleFactor[] = [];
  const add = (label: string, detail: string, delta: number) => {
    if (delta !== 0 || detail) factors.push({ label, detail, delta: Math.round(delta) });
  };

  if (people.length === 0) {
    add("Никто не попал в бункер", "Бункер остался пустым", -100);
    return finish(rng, now, factors, null);
  }

  // Skills and things the group has.
  const skills = new Map<FinaleSkill, string[]>();
  for (const p of people) for (const s of professionSkills(p.profession)) skills.set(s, [...(skills.get(s) ?? []), `${p.profession} (${p.name})`]);
  const things: { title: string; kinds: FinaleItem[] }[] = [];
  for (const p of people) {
    for (const key of ["backpack", "bigInventory"]) for (const c of cardsOf(game, p.id, key).filter(real)) things.push({ title: c.title, kinds: itemKinds(c.title) });
  }
  const bunkerItems = game.bunkerFields.filter((f) => f.placement === "list").flatMap((f) => game.bunker.fields[f.key] ?? []);
  for (const v of bunkerItems) things.push({ title: v.title, kinds: itemKinds(v.title) });
  const hasItem = (k: FinaleItem) => things.find((t) => t.kinds.includes(k));
  const strong = people.find((p) => p.body === "Крепкое" || p.body === "Атлетическое");

  /** Who or what solves a problem, as words; null when nobody can. */
  const solve = (s: Solver): string | null => {
    for (const k of s.skills ?? []) {
      const who = skills.get(k);
      if (who) return who[0];
    }
    for (const k of s.items ?? []) {
      const t = hasItem(k);
      if (t) return `«${t.title}»`;
    }
    if (s.strongBody && strong) return `${strong.name} (${strong.body?.toLowerCase()} телосложение)`;
    return null;
  };

  // 1. Continuing the human race.
  const women = people.filter(fertileWoman);
  const men = people.filter(fertileMan);
  const pairs = Math.min(women.length, men.length);
  if (pairs > 0) {
    add("Продолжение рода", `${pairs} ${plural(pairs, "пара может", "пары могут", "пар могут")} завести детей`, 12 + Math.min(2, pairs - 1) * 3);
  } else {
    const why = women.length === 0 ? "нет женщины, способной родить (16–50 лет, не ч/ф, не хрупкая и без сильного ожирения)" : "нет мужчины, способного стать отцом";
    add("Продолжение рода", `Род не продолжится: ${why}`, -20);
  }

  // 2. Age.
  const ageDelta = people.reduce((sum, p) => {
    const a = p.age ?? 40;
    return sum + (a < 18 ? -2 : a <= 40 ? 2 : a <= 59 ? 0 : a <= 69 ? -3 : -5);
  }, 0);
  const young = people.filter((p) => (p.age ?? 40) >= 18 && (p.age ?? 40) <= 40).length;
  const old = people.filter((p) => (p.age ?? 0) >= 60).length;
  add("Возраст", `Молодых и сильных: ${young}, пожилых: ${old}`, Math.max(-12, Math.min(10, ageDelta)));

  // 3. Health.
  const healthy = people.filter((p) => p.healthy).length;
  let healthDelta = healthy * 2;
  const grave: string[] = [];
  const contagious: string[] = [];
  for (const p of people) {
    for (const c of p.health) {
      if (c.title === "Идеально здоров") continue;
      const sev = typeof c.modifiers.severity === "string" ? c.modifiers.severity : "medium";
      healthDelta += SEVERITY_DELTA[sev] ?? 0;
      if (sev === "heavy" || sev === "critical") grave.push(`${c.title} (${p.name})`);
      if (CONTAGIOUS.test(c.title)) contagious.push(`${c.title} (${p.name})`);
    }
  }
  add(
    "Здоровье",
    `Идеально здоровых: ${healthy} из ${people.length}${grave.length ? `; тяжело больны: ${grave.join(", ")}` : ""}`,
    Math.max(-12, Math.min(10, healthDelta)),
  );
  const medic = skills.get("med")?.[0];
  if (contagious.length) {
    add("Заразные болезни", medic ? `${contagious.join(", ")} — ${medic} не даст заразе разойтись` : `${contagious.join(", ")} — без медика зараза пойдёт по бункеру`, medic ? -2 : -8);
  }

  // 4. Skills.
  const skillFactor = (k: FinaleSkill, have: number, missing: number) => {
    const who = skills.get(k);
    add(`Навык: ${SKILL_LABELS[k]}`, who ? who.slice(0, 3).join(", ") : "Нет никого с такой профессией", who ? have : missing);
  };
  skillFactor("med", 8, -10);
  skillFactor("tech", 6, -6);
  skillFactor("food", 5, -4);
  skillFactor("defense", 4, -3);
  skillFactor("mind", 3, -2);
  const experts = people.filter((p) => p.experience === "expert" || p.experience === "professional").length;
  if (experts) add("Опыт", `Профессионалов и экспертов: ${experts}`, Math.min(6, experts * 2));

  // 5. Supplies.
  const kinds = (Object.keys(ITEM_LABELS) as FinaleItem[]).filter((k) => hasItem(k));
  add("Снаряжение", kinds.length ? `Есть: ${kinds.map((k) => ITEM_LABELS[k]).join(", ")}` : "Полезных вещей почти нет", Math.min(12, kinds.length * 1.5) - (kinds.length < 3 ? 4 : 0));

  // 6. Food against the stay.
  const field = (key: string) => (game.bunker.fields[key] ?? []).map((v) => v.title).join(", ");
  const foodText = field("food");
  const stayText = field("duration");
  const foodMonths = parseMonths(foodText);
  const stayMonths = parseMonths(stayText);
  const ownFood = !!skills.get("food") && (!!hasItem("seeds") || !!hasItem("animal") || !!hasItem("weapon"));
  const foodItems = things.filter((t) => t.kinds.includes("food")).length;
  if (foodMonths !== null && stayMonths !== null && stayMonths > 0) {
    // The stock is planned for the seats; fewer people make it last longer. Food in backpacks adds a little.
    const months = foodMonths * (game.bunker.seats / Math.max(1, people.length)) + foodItems * 0.5;
    const ratio = months / stayMonths;
    let delta = ratio >= 1 ? 10 : ratio >= 0.6 ? 2 : ratio >= 0.3 ? -5 : foodMonths === 0 ? -14 : -10;
    // People who can grow or hunt food make a short stock much less dangerous.
    if (delta < 0 && ownFood) delta = Math.round(delta / 2);
    add("Запасы еды", `Еда: ${foodText || "нет"}; сидеть ${stayText}${foodItems ? `, ещё ${foodItems} ${plural(foodItems, "запас", "запаса", "запасов")} у людей` : ""}`, delta);
  }
  if (ownFood) add("Своя еда", `${skills.get("food")![0]} вырастит или добудет еду`, 8);

  // 7. Space.
  const size = Number(field("size").match(/\d+/)?.[0] ?? NaN);
  if (Number.isFinite(size)) {
    const per = size / people.length;
    add("Место", `${size} м² на ${people.length} ${plural(people.length, "человека", "человек", "человек")} — ${per.toFixed(1)} м² на каждого`, per < 4 ? -6 : per < 7 ? -2 : per >= 12 ? 3 : 0);
  }

  // 8. Problems of the bunker itself.
  const history = field("history");
  const problems = BUNKER_PROBLEMS.filter((p) => p.pattern.test(history));
  if (problems.length === 0 && /проблем не обнаружено/i.test(history)) add("Состояние бункера", "Проблем не обнаружено", 5);
  for (const p of problems) {
    const by = solve(p.solver);
    add(`Поломка: ${p.label}`, by ? `Исправит ${by}` : "Исправить некому и нечем", by ? 0 : p.delta);
  }

  // 9. Catastrophe.
  const need = CATASTROPHE_NEEDS[game.catastrophe.title];
  if (need) {
    const by = solve(need.solver);
    add(`Катаклизм: ${need.label}`, by ? `Есть: ${by}` : "Этого в бункере нет", by ? 6 : -8);
  }

  // 10. Events of this party.
  const happened = (state.partyEvents ?? []).map((k) => BUNKER_EVENTS.find((e) => e.key === k)).filter((e) => !!e);
  const goods = happened.filter((e) => e.tone === "good");
  if (goods.length) add("Находки за игру", goods.map((e) => e.title).join(", "), Math.min(8, goods.length * 2));
  for (const e of happened.filter((x) => x.tone === "bad")) {
    const solver = EVENT_SOLVERS[e.key];
    if (!solver) continue;
    const by = solve(solver);
    add(`Ивент: ${e.title}`, by ? `Справится ${by}` : "Справиться некому", by ? 0 : -5);
  }

  // 11. One more event inside the bunker, rolled now.
  const unused = BUNKER_EVENTS.filter((e) => !(state.partyEvents ?? []).includes(e.key));
  const pool = unused.length ? unused : BUNKER_EVENTS;
  const bad = pool.filter((e) => e.tone === "bad" && EVENT_SOLVERS[e.key]);
  const good = pool.filter((e) => e.tone === "good");
  const picked = rng.chance(0.7) && bad.length ? rng.pick(bad) : good.length ? rng.pick(good) : rng.pick(pool);
  let finalEvent: FinaleResult["finalEvent"] = null;
  if (picked) {
    const solver = EVENT_SOLVERS[picked.key];
    const by = picked.tone === "bad" && solver ? solve(solver) : null;
    const solved = picked.tone === "bad" ? by !== null : null;
    const outcome = picked.tone === "bad" ? (by ? `Справился ${by}` : "Справиться было некому") : "Находка пригодится в бункере";
    const delta = picked.tone === "bad" ? (by ? 2 : -10) : 4;
    finalEvent = { key: picked.key, title: picked.title, text: picked.text.split("\n\n")[0], image: picked.image, tone: picked.tone, outcome, solved };
    factors.push({ label: `Уже в бункере: ${picked.title}`, detail: outcome, delta });
  }

  return finish(rng, now, factors, finalEvent);
}

function finish(rng: Rng, now: number, factors: FinaleFactor[], finalEvent: FinaleResult["finalEvent"]): FinaleResult {
  const chance = Math.max(FINALE_MIN, Math.min(FINALE_MAX, FINALE_BASE + factors.reduce((s, f) => s + f.delta, 0)));
  const survived = factors.some((f) => f.delta <= -100) ? false : rng.next() < chance / 100;
  // The final event is shown on its own after the list, so it is not counted among the list items.
  const listed = factors.filter((f) => !f.label.startsWith("Уже в бункере:")).length;
  return { at: now, revealAt: finaleRevealAt(now, listed), revealed: false, factors, finalEvent, chance, survived };
}

