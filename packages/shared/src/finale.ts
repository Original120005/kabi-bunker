/**
 * «Итоги партии»: the server simulates whether the bunker survives. Numbers stay on the server;
 * clients get each factor as good / bad with a strength of 1–3 and, after the reveal, the verdict.
 * All tables below are authored rules and can be tuned here.
 */

/** Skills of the people inside, derived from profession titles. */
export type FinaleSkill = "med" | "tech" | "food" | "defense" | "mind" | "science";

export const SKILL_LABELS: Record<FinaleSkill, string> = {
  med: "медицина",
  tech: "техника и ремонт",
  food: "добыча и готовка еды",
  defense: "защита",
  mind: "моральный дух",
  science: "наука",
};

/** Roots matched against the profession title (lower case). One profession may have several skills. */
export const SKILL_PATTERNS: Record<FinaleSkill, RegExp> = {
  med: /врач|доктор|хирург|медсест|медбрат|фельдшер|санитар|терапевт|педиатр|реаниматолог|парамедик|акушер|гинеколог|кардиолог|невролог|онколог|уролог|стоматолог|окулист|дерматолог|иммунолог|вирусолог|эпидемиолог|фармацевт|провизор|травматолог|ортопед|пульмонолог|гастроэнтеролог|эндокринолог|гематолог|нарколог|психиатр|знахарь|ветеринар|микробиолог|венеролог|паразитолог|сомнолог|проктолог|подолог|оториноларинголог|реабилитолог|неонатолог|гериатр|генетик|биохимик|гирудотерапевт|андролог|массажист/,
  tech: /инженер|механик|электрик|энергетик|слесарь|сварщик|сантехник|техник|строитель|прораб|плотник|архитектор|кузнец|бурильщик|станочник|программист|хакер|кибернетик|разработчик|установщик|машинист|шахт[её]р|физик|изобретатель|часовщик|радио|ремонт|монтаж|разнорабоч|дворник|вахт[её]р|заправщик/,
  food: /повар|фермер|агроном|садовод|ботаник|охотник|рыбак|мясник|булочник|пекарь|кондитер|доярка|скотник|животновод|пчеловод|комбайнер|тракторист|сыровар|пивовар|биолог|эколог|озеленитель|товаровед|сушист|диетолог|технолог|энтомолог|винодел|энолог|бариста|дегустатор|грибник/,
  defense: /военн|солдат|полицей|охранник|телохранитель|сторож|майор|лейтенант|каратист|инкассатор|охотник|вышибала|пожарный|спасатель|киллер|агент|цру|следователь|криминалист|десантник|пограничник|боксёр|боксер|самбист|судебный пристав|космонавт|летчик|лётчик/,
  mind: /психолог|психотерапевт|психиатр|священник|батюшка|монах|педагог|учитель|воспитатель|няня|клоун|комик|музыкант|певец|актер|актёр|артист|философ|социолог|ведущий|аниматор|писатель|композитор|танцор|тамада|режиссер|режиссёр|диктор|гипнотизер/,
  science: /химик|физик|биолог|ученый|учёный|геолог|метеоролог|климатолог|астроном|астрофизик|математик|микробиолог|вирусолог|генетик|эколог|географ|археолог|энтомолог|орнитолог|биофизик|биохимик|сотрудник nasa/,
};

/** Kinds of useful things found in backpacks, big inventory and the bunker itself. */
export type FinaleItem = "meds" | "weapon" | "tools" | "energy" | "food" | "water" | "warm" | "protection" | "comms" | "chem" | "animal" | "seeds" | "tape";

export const ITEM_LABELS: Record<FinaleItem, string> = {
  meds: "лекарства",
  weapon: "оружие",
  tools: "инструменты",
  energy: "источник энергии",
  food: "запасы еды",
  water: "вода и фильтры",
  warm: "тёплые вещи",
  protection: "защитное снаряжение",
  comms: "связь",
  chem: "химия и яды",
  animal: "животные",
  seeds: "семена и рассада",
  tape: "изолента и уплотнители",
};

export const ITEM_PATTERNS: Record<FinaleItem, RegExp> = {
  meds: /аптечк|лекарств|антибиот|вакцин|бинт|сыворот|дефибрил|медикамент|таблет|шприц|ампул|травы|изолятор|хирург/,
  weapon: /пистолет|винтовк|ружь|ружьё|автомат|арбалет|(?<![а-яё])лук(?![а-яё])|нож|патрон|топор|бита|дубин|оружи|бронежилет/,
  tools: /инструмент|молоток|дрель|лопат|кирк|ключ|отв[её]ртк|пила|ножовк|рубанок|верстак|сварочн|трос|канат|(?<![а-яё])лом(?![а-яё])|лебёдк|лебедк|тахеометр/,
  energy: /генератор|аккумулятор|электростанц|батаре|солнечн|фонар|канистр|бензин|топлив/,
  food: /консерв|продукт|еда|еды|м[её]д|мяс|сыр|зерн|круп|суши|доширак|булоч|корм|сухпа|шоколад|хлеб|сахар|соль|напит|пиво|вин[оа]|сигар/,
  water: /фильтр|вод[аыу]|бутыл/,
  warm: /одежд|термо|куртк|спальн|одеял|ш[уе]б|тёпл|тепл/,
  protection: /противогаз|респиратор|маск|защитн|дозиметр|скафандр|каск|перчат|костюм/,
  comms: /радио|рация|радиотелефон|антенн|связ/,
  chem: /хлор|(?<![а-яё])яд|сода|реактив|дезинфек|отрав|химическ|мышеловк|средство от/,
  animal: /(?<![а-яё])кот(?![а-яё])|кошк|(?<![а-яё])п[её]с(?![а-яё])|собак|овчарк|корова|скотин|лошад|кур[ыа]|коз[аы]/,
  seeds: /семен|рассад|саженц|грунт|почв|теплиц|лампа для/,
  tape: /изолент|уплотнит|скотч|резин|герметик/,
};

/** What solves a problem: any of these skills, items, or (for heavy work) a strong body. */
export interface Solver {
  skills?: FinaleSkill[];
  items?: FinaleItem[];
  strongBody?: boolean;
}

/** Bad events: what deals with each of them. Keys match `BUNKER_EVENTS`. */
export const EVENT_SOLVERS: Record<string, Solver> = {
  generator: { skills: ["tech"], items: ["energy"] },
  rats: { skills: ["tech"], items: ["animal", "chem"] },
  pipe: { skills: ["tech"] },
  mold: { skills: ["med", "science"], items: ["protection", "chem"] },
  gas: { skills: ["tech"], items: ["protection"] },
  lock: { skills: ["tech"], items: ["tools"] },
  wolves: { skills: ["defense"], items: ["weapon"] },
  water: { skills: ["science", "med"], items: ["water"] },
  collapse: { skills: ["tech"], items: ["protection"], strongBody: true },
  radiation: { skills: ["tech"], items: ["protection"] },
  weevils: { items: ["chem", "food"] },
  cold: { skills: ["tech"], items: ["warm", "energy"] },
  fire: { skills: ["food", "tech"] },
  sewage: { skills: ["tech"], items: ["protection"] },
  looters: { skills: ["defense"], items: ["weapon"] },
  chemical: { skills: ["science"], items: ["protection"] },
  spoiled: { skills: ["food", "med"] },
  shower: { skills: ["med", "science"], items: ["chem", "protection"] },
  winch: { skills: ["tech"], items: ["tools"], strongBody: true },
  wasps: { skills: ["science", "food"], items: ["protection"] },
  silence: { skills: ["tech"] },
  frost: { skills: ["tech"], items: ["warm", "tape"] },
  short: { skills: ["tech"], items: ["tape"] },
  freezer: { skills: ["food", "tech"] },
  acid: { skills: ["science"], items: ["protection", "chem"] },
  bedbugs: { skills: ["med"], items: ["chem"] },
  pump: { skills: ["tech"] },
  valve: { skills: ["tech"], items: ["tools"] },
  hood: { skills: ["tech", "food"] },
  beam: { skills: ["tech"], items: ["tools"] },
  hiss: { skills: ["tech"], items: ["protection"] },
  cough: { skills: ["med"], items: ["meds", "protection"] },
  "ice-pipes": { skills: ["tech"], items: ["warm", "tape"] },
  ants: { items: ["chem"] },
  "cable-flood": { skills: ["tech"] },
  toilet: { skills: ["tech"], items: ["chem"] },
  oil: { skills: ["tech"] },
  scald: { skills: ["tech"] },
  "filter-dust": { skills: ["tech"], items: ["protection"] },
  seal: { skills: ["tech"], items: ["tape"] },
  "roof-leak": { skills: ["tech"], items: ["water"] },
};

/** Problems written in «Как и где был построен». */
export const BUNKER_PROBLEMS: { pattern: RegExp; label: string; solver: Solver; delta: number }[] = [
  { pattern: /нет электричества/i, label: "в бункере нет электричества", solver: { skills: ["tech"], items: ["energy"] }, delta: -10 },
  { pattern: /фильтр/i, label: "сломаны воздушные фильтры", solver: { skills: ["tech"], items: ["protection"] }, delta: -10 },
  { pattern: /плесен/i, label: "в стенах плесень", solver: { skills: ["med", "science"], items: ["chem", "protection"] }, delta: -6 },
  { pattern: /ул[ье]й/i, label: "пчелиный улей на входе", solver: { skills: ["food", "science"], items: ["protection"] }, delta: -4 },
  { pattern: /запах/i, label: "затхлый запах", solver: { skills: ["tech"], items: ["chem"] }, delta: -2 },
];

/** What each catastrophe demands from the survivors, by catastrophe title. */
export const CATASTROPHE_NEEDS: Record<string, { label: string; solver: Solver }> = {
  "Извержение супервулкана": { label: "защита от пепла и холода", solver: { items: ["protection", "warm"], skills: ["med"] } },
  "Пандемия неизвестного вируса": { label: "медик против вируса", solver: { skills: ["med"], items: ["meds"] } },
  "Ядерная война": { label: "защита от радиации", solver: { items: ["protection"], skills: ["science"] } },
  "Падение астероида": { label: "ремонт после ударной волны", solver: { skills: ["tech"], items: ["tools"] } },
  "Всемирный потоп": { label: "чистая вода и своя еда", solver: { skills: ["food"], items: ["water"] } },
  "Восстание машин": { label: "люди, которые понимают технику", solver: { skills: ["tech", "defense"] } },
  "Грибок-паразит": { label: "медицина и химия против грибка", solver: { skills: ["med", "science"], items: ["chem"] } },
  "Супервспышка на Солнце": { label: "своя энергия и связь", solver: { items: ["energy", "comms"], skills: ["tech"] } },
  "Новый ледниковый период": { label: "тепло и топливо", solver: { items: ["warm", "energy"] } },
  "Нашествие гигантских насекомых": { label: "оружие и яды", solver: { skills: ["defense"], items: ["weapon", "chem"] } },
  Тишина: { label: "крепкие нервы и моральный дух", solver: { skills: ["mind"] } },
};

/** Diseases that spread inside a closed bunker. */
export const CONTAGIOUS = /covid|туберкул|вич|гепатит|пневмон|герпес|бронхит|грипп/i;

/** Every bunker starts here; factors add up; the result is kept within these bounds. */
export const FINALE_BASE = 58;
export const FINALE_MIN = 5;
export const FINALE_MAX = 95;

/** Pace of the reveal on every screen. */
export const FINALE_TIMING = {
  startDelayMs: 800,
  factorMs: 1_500,
  eventMs: 4_500,
  levelMs: 3_000,
  verdictPauseMs: 1_500,
};

export function finaleRevealAt(at: number, factors: number): number {
  return at + FINALE_TIMING.startDelayMs + factors * FINALE_TIMING.factorMs + FINALE_TIMING.eventMs + FINALE_TIMING.levelMs + FINALE_TIMING.verdictPauseMs;
}

/** Words instead of a percentage. */
export function chanceLevel(chance: number): string {
  if (chance >= 80) return "очень высокий";
  if (chance >= 60) return "высокий";
  if (chance >= 40) return "средний";
  if (chance >= 20) return "низкий";
  return "очень низкий";
}

/** Strength shown to players: 1–3 marks instead of the number. */
export function factorStrength(delta: number): 1 | 2 | 3 {
  const a = Math.abs(delta);
  return a >= 10 ? 3 : a >= 5 ? 2 : 1;
}

export interface FinaleFactor {
  label: string;
  detail: string;
  delta: number;
}

export interface FinaleFactorView {
  label: string;
  detail: string;
  tone: "good" | "bad" | "neutral";
  strength: 1 | 2 | 3;
}

export interface FinaleEventView {
  title: string;
  text: string;
  image: string;
  tone: "good" | "bad" | "mixed";
  /** For problems: whether the people inside could deal with it, and how. */
  outcome: string;
  solved: boolean | null;
}

export interface FinaleRowView {
  playerId: string;
  nickname: string;
  avatarUrl: string | null;
  /** Why the rating changed: «в бункере», «первым изгнан»… */
  reason: string;
  delta: number;
  /** Has an account; bots get no rating. */
  rated: boolean;
}

export interface FinaleView {
  id: string;
  at: number;
  revealAt: number;
  factors: FinaleFactorView[];
  finalEvent: FinaleEventView | null;
  level: string;
  /** Null until `revealAt`, so nobody learns the verdict ahead of the show. */
  survived: boolean | null;
  rows: FinaleRowView[] | null;
}
