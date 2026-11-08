# Бункер — расширяемый клон Bunker Online

Личный проект для игры с друзьями: многопользовательская браузерная игра «Бункер» с правилами оригинала
(bunker-online.com) и полностью расширяемой системой контента.

## Документация

- [Отчёт об исследовании](docs/research/01-research-report.md) — что удалось собрать и чего нет.
- [Правила игры (формализация)](docs/research/02-game-rules.md)
- [Характеристики персонажа](docs/research/03-characteristics.md)
- [Панель ведущего](docs/research/04-host-panel.md)
- [События, паки, тест выживаемости](docs/research/05-events-packs.md)
- [Структура интерфейса](docs/research/06-ui-structure.md)
- [Архитектура](docs/architecture/ARCHITECTURE.md)
- [План реализации](docs/PLAN.md)
- [Как запустить игру с друзьями](docs/HOW_TO_PLAY.md)

## Быстрый старт

```powershell
npm install
npm run play
```

## Статус

Этапы 1–3 завершены: комнаты, лобби, проверка готовности, раздача персонажей, катастрофа, бункер и игровой экран.
Раунды, таймеры, голосование и панель ведущего появятся на этапе 4.

Стек: TypeScript · React + Vite · Node.js + Fastify + Socket.IO · SQLite через Prisma.
Сервером служит ваш ПК: `npm run play` запускает игру и печатает ссылку для друзей (Cloudflare Tunnel).
