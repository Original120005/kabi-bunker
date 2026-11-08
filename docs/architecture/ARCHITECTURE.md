# Архитектура проекта «Бункер» (клон Bunker Online)

Статус: **согласовано, версия 4**. Сервером служит ПК ведущего (Windows), друзья подключаются через Cloudflare Tunnel.
Node.js и WebSocket-соединения остаются. Если когда-нибудь понадобится VPS, тот же код переносится без изменений.

## 1. Ключевые принципы

1. **Сервер — единственный источник истины.** Случайности, раздача, подсчёт голосов и таймеры считаются только на сервере. Клиент отправляет намерения и рисует присланное. Поэтому два игрока не могут увидеть разный результат голосования.
2. **Движок — чистые функции.** `applyAction(state, action, ctx) → { state, events }` не знает про сеть и БД. Это даёт тесты, детерминированный реплей, отмену действий и восстановление партии.
3. **Контент — данные, механики — модули.** Профессии, болезни, карты, катастрофы и бункеры лежат в БД и JSON-паках. Способности собираются из **эффектов-примитивов**; каждый примитив — отдельный модуль со схемой параметров. Редактор контента получает каталог эффектов с сервера и строит формы автоматически.
4. **Правила — тоже данные.** Таблица открытия, места, таймеры, 70%, пропуск, план исключений и все неоднозначные места хранятся в `RuleSet`.
5. **Проекция под зрителя.** Каждый игрок получает свою копию состояния, где закрытых чужих карт физически нет.
6. **Ведущий — оператор.** Как в оригинале, любую способность можно выполнить вручную инструментами панели. Если у способности есть структурированные эффекты, достаточно нажать «Применить».

## 2. Стек

| Слой | Технология | Почему |
| --- | --- | --- |
| Язык | TypeScript везде | Общие типы клиента, сервера и контента |
| Монорепозиторий | npm workspaces | Node 22 и npm уже установлены |
| Backend | Node.js 22 + Fastify + Socket.IO | Мгновенная рассылка, комнаты, авто-переподключение, подтверждения действий |
| БД | SQLite (WAL) через Prisma | Один сервер, одна партия друзей — SQLite надёжен и не требует администрирования. Переход на PostgreSQL — смена провайдера в `schema.prisma` |
| Валидация | Zod | Одна схема для API, контента, параметров эффектов, импорта паков |
| Frontend | React 18 + Vite + TypeScript, Tailwind CSS, Zustand | Тёмная тема оригинала, адаптивность, простое хранилище |
| Тесты | Vitest (движок, сервер), Playwright (несколько браузеров) | Голосование и синхронизация на N клиентах |
| Запуск для игры | Один Node-процесс на ПК раздаёт собранный клиент и WebSocket; Cloudflare Tunnel (npm-пакет `cloudflared`) даёт публичную HTTPS-ссылку | Без роутера, белого IP, домена и аренды сервера; одна команда `npm run play` |

## 3. Структура репозитория

```
bunker-online/
├─ package.json                  workspaces, скрипты dev / build / test / seed
├─ docs/
├─ content/packs/                паки в JSON (git), импортируются в БД
│  └─ base/  pack.json, professions.json, health.json, …
├─ packages/
│  ├─ shared/                    типы, Zod-схемы контента и сообщений, типы проекций
│  └─ engine/                    чистая игровая логика
│     ├─ state/                  GameState, фазы, редьюсер
│     ├─ rules/                  RuleSet, таблицы, план исключений
│     ├─ voting/                 алгоритм голосования
│     ├─ generation/             раздача персонажей, катастрофы, бункера
│     ├─ effects/                реестр эффектов (файл на эффект)
│     ├─ conditions/             условия и селекторы по тегам
│     ├─ actions/                действия игроков и ведущего
│     └─ projection/             фильтрация состояния под зрителя
├─ apps/
│  ├─ server/
│  │  ├─ prisma/schema.prisma
│  │  └─ src/  rooms/ sockets/ timers/ content/ http/ db/
│  └─ web/
│     └─ src/  api/ pages/ game/ host/ admin/ ui/
├─ scripts/play.mjs              сборка + запуск сервера + туннель, печатает ссылку для друзей
├─ data/                         файл БД SQLite и резервные копии (не в git)
└─ tests/e2e/                    Playwright-сценарии на 6–15 игроков
```

Движок — отдельный пакет. Клиент импортирует только `shared` (типы), логика в браузер не попадает.

## 4. Модель контента (система расширения)

### 4.1 Сущности

```
Pack            id, slug, name, description, kind (base|addon|custom), enabled, priority,
                source (original|author|user), ruleSetId?
CharacteristicType  key, name, order, revealable, isSpecialCard, countPerPlayer (1 или 2),
                modifiers[], onSteal (regenerate|empty), rotatable, enabled
ModifierDef     key (experience|severity|age|height|quantity|…), kind (scale|range),
                levels[] {key, label, minYears?, maxYears?} | range {min, max, unit}
ContentItem     id, packId, type, title, description, weight, enabled, tags[], constraints[],
                modifierRules?, abilities[], data{}, source
```

- **Характеристики — данные.** Новая характеристика добавляется записью `CharacteristicType`. Таблицы, карточки, панель ведущего и раскрытие строятся по списку типов автоматически.
- **Шкалы стажа и степени — данные.** Можно задать свою шкалу для пака или конкретной болезни.
- **Бункер собирается из полей**: размер, время, еда, предметы, локация, история с проблемами, комнаты. Каждое поле — свой тип контента. Так устроен и оригинал: ведущий меняет поля бункера по отдельности.
- **Теги** связывают контент и механики: `health:respiratory`, `phobia:animals`, `trait:negative`, `problem:electricity`, `item:weapon`.
- `weight` — относительная вероятность выпадения (0 — не выпадает). `enabled` — вкл/выкл. Набор паков выбирается на партию, паки комбинируются с приоритетами.

### 4.2 Способности и эффекты

```ts
AbilityDef {
  id, name, text,                      // text — формулировка для игроков
  kind: "active" | "passive" | "narrative",
  uses: number | "unlimited",
  timing: ("anytime" | "ownTurn" | "beforeVote" | "afterVote" | "justification" | "farewell" | "onBunkerEntry")[],
  forbiddenIn: Phase[],                // спец. карты нельзя во время голосования; карты голосования — на прощальной речи
  target: "self" | "other" | "any" | "all" | "neighbors" | "exiled" | "twoOthers" | "none",
  conditions?: Condition[],            // «степень не критическая», «болезнь с тегом skin», «есть изгнанный»
  effects?: { effect: string, params: object }[],   // пусто → исполняет ведущий вручную
  cancelable: boolean
}
```

Каждый эффект — модуль в `packages/engine/effects`: `name`, Zod-схема параметров (из неё генерируется форма в
редакторе), `check(state, ctx)` и `apply(state, ctx)`. Набор покрывает все функции панели ведущего и все 318
профессиональных способностей оригинала.

| Группа | Эффекты |
| --- | --- |
| Характеристики | `char.reroll`, `char.set`, `char.add`, `char.remove`, `char.steal`, `char.swap`, `char.copy`, `char.rotate`, `char.nullifyAll`, `char.reveal`, `char.chooseNextReveal` |
| Модификаторы | `modifier.shift`, `modifier.set`, `health.cure`, `gender.flip`, `age.setGroup`, `body.set`, `body.shift`, `childfree.set`, `childfree.clear`, `phobia.cure` |
| Бункер и мир | `bunker.field.reroll`, `bunker.field.set`, `bunker.item.add`, `bunker.item.remove`, `bunker.problem.add`, `bunker.problem.solve`, `bunker.seats.shift`, `bunker.food.scale`, `catastrophe.reroll`, `catastrophe.timer.shift`, `catastrophe.timer.clear`, `world.object.add`, `world.object.flip` |
| Голосование | `vote.add`, `vote.redirect`, `vote.removeAgainst`, `vote.protect`, `vote.cancelRound`, `vote.tieBreak`, `vote.useOthersVote` |
| Время и речь | `timer.shift`, `speech.extend`, `speech.take`, `speech.grant` |
| Игроки | `player.exile`, `player.return`, `relation.add`, `relation.remove`, `slot.free` |
| Карты | `card.cancelLast`, `card.cancelTargetingSelf`, `ability.useAs`, `ability.copy` |
| Пассивы и прочее | `passive.immunity`, `narrative` |

**Проверка совместимости** при сохранении элемента и при включении пака:
- эффект существует;
- параметры проходят схему;
- характеристики, модификаторы и уровни, на которые ссылается эффект, существуют и не переопределены паком несовместимо;
- теги из условий встречаются хотя бы у одного элемента, иначе предупреждение «способность никогда не сработает»;
- элементов хватает на 15 игроков, иначе предупреждение о доборе из базового пака.

Ошибки блокируют сохранение, предупреждения нет.

### 4.3 Правила (`RuleSet`)

```json
{
  "players": { "min": 6, "max": 15 },
  "maxRounds": 7,
  "seats": "floor(n/2)",
  "revealTable": [
    { "players": [6, 6],   "perRound": [3, 3, 2] },
    { "players": [7, 8],   "perRound": [3, 2, 2, 1, 1, 1, 1] },
    { "players": [9, 10],  "perRound": [3, 2, 1, 1, 1, 1, 1] },
    { "players": [11, 12], "perRound": [2, 2, 1, 1, 1, 1, 1] },
    { "players": [13, 15], "perRound": [2, 1, 1, 1, 1, 1, 1] }
  ],
  "firstRoundMandatory": ["profession"],
  "turnOrder": "alternate",
  "timers": { "speech": 60, "discussion": 60, "accusation": 30, "vote": 15, "justification": 30, "farewell": 15 },
  "voting": {
    "exileThreshold": 0.7, "abstainVotesAgainstSelf": true, "allowSelfVote": false,
    "skipAllowedInRounds": [1], "doubleVoteAfterSkip": true,
    "tieInRoundOne": "noExile", "doubleVoteAfterRoundOneTie": true,
    "tieLaterRounds": "exileAllTied", "justificationOncePerRound": true,
    "accusationOrder": "roundOrder"
  },
  "exilePlan": "auto",
  "specialCardsPerPlayer": 2,
  "events": { "easy": 2, "hard": 1 },
  "hostSeesHidden": false
}
```

Изменить голосование — это правка `RuleSet.voting` или замена модуля стратегии в `engine/voting`.

## 5. Игровое состояние и фазы

```
GameState: version, phase, round, turn{order[], index}, players[] (seat, nickname, status alive|exiled|inBunker),
           cards{cardId → charKey, contentId, modifiers, revealed, ownerId}, catastrophe, bunker, world,
           voting{cycle, candidates, justified[], votes}, timer{kind, endsAt, pausedRemainingMs},
           exilePlan[], pendingVoteCycles, usedAbilities, events[], log[], rngState
```

Фазы: `lobby → readyCheck → speeches → discussion → skipDecision? → accusations → voting →
(justification → revote)* → farewell → (следующий раунд | finale) → results`.
Ведущий может переключить фазу, сменить говорящего или перезапустить голосование.

## 6. Синхронизация в реальном времени

- Одна комната — одна Socket.IO-комната. Действие отправляется как `emit("action", { type, payload, expectedVersion }, ack)`.
- Действия комнаты выполняются **строго по очереди**: на каждую комнату своя очередь в памяти процесса. Сервер применяет движок, увеличивает `version`, сохраняет состояние и рассылает каждому участнику **его** проекцию.
- Если версия клиента устарела, действие не применяется вслепую: клиент получает свежее состояние.
- Таймеры живут на сервере: при истечении сервер сам переводит фазу, например закрывает голосование через 15 секунд. Клиенты рисуют обратный отсчёт по `endsAt` с поправкой на разницу часов.
- После перезапуска сервера комнаты и таймеры восстанавливаются из БД. Уже истёкшие дедлайны обрабатываются сразу при загрузке.

## 7. Личность, права, переподключение

- Без регистрации. При входе в комнату браузер получает случайный секретный токен и хранит его в `localStorage`. На сервере хранится только хэш. Токен передаётся при подключении сокета.
- Роли: **Ведущий** (создатель, права можно передать), **Игрок**, **Зритель** (исключённый или наблюдатель), **Редактор контента** (пароль из `.env`).
- Каждое действие проверяется на сервере: роль, фаза, владелец карты, лимиты и тайминг способности.
- Переподключение: Socket.IO переподключается сам, после обновления страницы клиент заходит с тем же токеном и получает текущее состояние. Отключённые игроки показываются «не в сети», но остаются в игре.

## 8. Защита закрытых характеристик

- Закрытая чужая карта в проекции: `{ charKey: "health", hidden: true }` — без названия, описания, ID контента и тегов.
- ID карт случайные и непрозрачные.
- Состояние генератора случайных чисел клиенту не отправляется.
- Логи без закрытых значений, например «Ведущий изменил здоровье игроку 3».
- Ведущий-игрок видит закрытое не больше обычного игрока. Ведущий без роли игрока видит закрытое только при включённой `hostSeesHidden`.
- Полный список контента доступен только редактору, чтобы нельзя было угадывать закрытые карты.
- Тест проверяет, что ни одна проекция не содержит закрытых значений других игроков.

## 9. База данных (Prisma)

```
Pack               (id, slug, name, description, kind, enabled, priority, source, ruleSetId, createdAt, updatedAt)
CharacteristicType (key PK, name, order, revealable, isSpecialCard, countPerPlayer, modifiers Json, onSteal, rotatable, enabled)
ContentItem        (id, packId, type, title, description, weight, enabled, tags Json, constraints Json,
                    modifierRules Json, abilities Json, data Json, source, createdAt, updatedAt)
RuleSet            (id, name, config Json)
Room               (id, code UNIQUE, status, settings Json, state Json, version, hostParticipantId,
                    createdAt, updatedAt, closedAt)
Participant        (id, roomId, tokenHash, nickname, seat, role, banned, lastSeenAt)
ActionLog          (id, roomId, seq, actorId, type, payload Json, createdAt)
Snapshot           (roomId, version, state Json)   -- последние 50 для «Отменить предыдущее действие»
```

Паки импортируются из `content/packs/*` командой `npm run seed` или кнопкой «Импорт» в редакторе. Экспорт выгружает
их обратно в JSON: паки можно хранить в git и передавать друзьям.

## 10. Раздача персонажей

1. Собрать пул по каждому типу из включённых паков: сначала паки с большим `priority`, недостающее добрать из базовых, как в оригинале.
2. Отфильтровать по `constraints` персонажа: пол, возраст, уже выданные карты.
3. Выбрать без повторов внутри партии с учётом `weight`.
4. Сгенерировать модификаторы: возраст (16–85) и группа, рост (150–210), стаж с ограничением «стаж ≤ возраст − 16», степень болезни, количество, ч/ф.
5. Выдать по 2 разные спец. карты.
6. Выбрать катастрофу и каждое поле бункера, посчитать места.

## 11. Развёртывание

Сервер — ПК ведущего. Режимы запуска:

| Команда | Для чего |
| --- | --- |
| `npm run dev` | Разработка: горячая перезагрузка, только этот ПК и локальная сеть |
| `npm run play` | Игра с друзьями: собрать клиент, запустить сервер на `localhost:3000`, поднять туннель и вывести ссылку вида `https://<случайные-слова>.trycloudflare.com` |
| `npm run play:lan` | Без интернета: друзья в одной Wi-Fi-сети заходят по адресу `http://<IP-ПК>:3000` |

Почему туннель, а не проброс портов на роутере:
- не нужен белый IP (у многих провайдеров его нет) и настройка роутера;
- HTTPS и WebSocket работают сразу, а ПК не открыт в интернет целиком: туннель ведёт только на порт игры;
- бесплатный быстрый туннель не требует аккаунта. Минус — ссылка меняется при каждом запуске, поэтому `npm run play` печатает её, и её нужно скинуть друзьям;
- если захочется постоянный адрес, нужен свой домен на бесплатном аккаунте Cloudflare. Это настройка туннеля, код не меняется.

Прочее:
- База — файл `data/bunker.db`. Перед каждым запуском `play` делается его копия в `data/backups/` (хранятся последние 10).
- Если ПК перезагрузится посреди партии, после повторного `npm run play` комнаты восстановятся. Ссылку туннеля при этом нужно разослать заново.
- Редактор контента защищён паролем из `.env`, поэтому друзья по ссылке не могут менять базу.
- При первом запуске Windows может спросить разрешение для Node.js в брандмауэре. Для туннеля оно не требуется, для режима `--lan` нужно разрешить частные сети.
- Нагрузка на ПК минимальная: одна партия — это 15 соединений и килобайты трафика.

## 12. Что будет легко менять

| Задача | Что меняется |
| --- | --- |
| Профессия «Военный инженер» со способностью | Одна запись в редакторе или в JSON-паке |
| Болезнь со своей шкалой степеней | Запись `health` + `modifierRules` |
| Новая характеристика | Запись `CharacteristicType` + элементы контента |
| Новая механика способности | Один модуль в `engine/effects`; он сам появится в конструкторе редактора |
| Изменить голосование | `RuleSet.voting` или модуль стратегии в `engine/voting` |
| Вид карточки | Один React-компонент в `apps/web/src/game` |
| Переход на PostgreSQL | Провайдер в `schema.prisma` |
| Переезд на VPS | Тот же код; добавляются Dockerfile и reverse-proxy с HTTPS |
