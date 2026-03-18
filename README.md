# Antigravity Codex (Кодекс Антигравитации)

**Сборка 6.1** — Code Studio: код печатается в отдельном окне в реальном времени, в чате остаются пояснения, есть preview/fullscreen/minimize/close и ZIP. Desktop-режим переведён с `file://` на локальный HTTP, чтобы исключить Puter protocol errors.

Это гибридный dashboard для Puter: frontend на vanilla JS + Tailwind, backend локально на `localhost` для проксирования AI и мониторинга инфраструктуры.

## AI Studio

- Профили: `Универсальный`, `Создание сайтов`, `Лендинги`, `Программы`, `Рефакторинг`.
- Формат ответа: `Готовый`, `Сначала код`, `Пошаговый`.
- Поле `Модель ИИ`: можно указать конкретную модель для Puter/backend.
- Дополнительный провайдер: `OpenRouter`.
- Быстрый селектор тем в левой панели.

## Run (2 processes)

### 1) Backend

```bash
cd /Users/sergejmegeran/Desktop/MeGoogle
cp .env.example .env
npm install
npm run start:backend
```

Backend API:
- `GET /api/health`
- `GET /api/infra`
- `POST /api/chat`

### 2) Frontend

In another terminal:

```bash
cd /Users/sergejmegeran/Desktop/MeGoogle
npm run start:frontend
```

Open:
- [http://localhost:8765](http://localhost:8765)

## Native macOS app

```bash
cd /Users/sergejmegeran/Desktop/MeGoogle
npm run build:mac-app
cp -R "dist/Antigravity Codex-darwin-arm64/Antigravity Codex.app" "/Applications/Antigravity Codex.app"
open -a "Antigravity Codex"
```

Иконка приложения: `assets/icon.icns`.

## Environment variables (`.env`)

- `PORT=8787`
- `OLLAMA_BASE_URL=http://localhost:11434`
- `OPENAI_API_KEY=...`
- `GEMINI_API_KEY=...`
- `ANTHROPIC_API_KEY=...`
- `OPENROUTER_API_KEY=...`

Notes:
- Keys in `.env` are preferred. UI key fields are still supported as request override.
- Puter-only mode still works for `puter.ai.chat`, but clone/zip/new-project require Puter FS.

## Files

| File | Role |
|------|------|
| `index.html` | Layout, Russian UI, Tailwind + Puter v2 script |
| `styles.css` | Glassmorphism 2.0 theme variables |
| `app.js` | Puter FS, KV, clone, zip, monitor, wiring |
| `ui.js` | Themes, modals, welcome screen |
| `ai_handler.js` | Frontend AI router (`puter` direct + local backend routing) |
| `server/index.js` | Express backend (`/api/health`, `/api/infra`, `/api/chat`) |
| `.env.example` | Backend env template |

## Host on Puter

Upload the folder as a Puter app/site so `puter`, `puter.fs`, and `puter.kv` are available. Opening `index.html` from `file://` will use **localStorage** fallback for settings only (no cloud FS).

## Ollama

Set `OLLAMA_ORIGINS="*"` before starting Ollama. Note: HTTPS apps calling `http://localhost:11434` may be limited by the browser (mixed content); use Puter AI or a tunnel if needed.

## Git clone

Uses **isomorphic-git** + **cors.isomorphic-git.org** proxy for browser-safe GitHub clones, then writes files under `AntigravityProjects/<repo>/` in Puter FS.

## Quick diagnostics

```bash
curl http://localhost:8787/api/health
curl http://localhost:8787/api/infra
npm test
```

## License

MIT — branding: **MEGA FUTURE AI**.
