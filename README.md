# Spending Tracker

Monorepo for a cross-platform spending tracker:

- `apps/mobile-web`: Expo + React Native app for web and Android
- `apps/api`: Node + Express API with SQLite persistence
- `packages/shared`: Shared types, validation, and reporting helpers

## Quick start

```bash
pnpm install
pnpm --filter @spending-tracker/api db:init
pnpm dev
```

## Standalone backend

The API is a standalone Node service. You can run it without the Expo app:

```bash
pnpm install
pnpm --filter @spending-tracker/api build
pnpm start:api
```

For local API-only development:

```bash
pnpm dev:api
```

## Environment

Copy `apps/api/.env.example` to `apps/api/.env`.

For Google Sign-In in Expo, set the client IDs in `apps/mobile-web/app.config.ts`.

## AI analysis

The dashboard and Reports screen send a compact history and habit profile to the API. The local AI returns a cycle-end total, per-category totals, and possible spending amounts for each future forecast point. Results are cached for unchanged data; creating, editing, or deleting a transaction or category changes the data signature and requests a fresh forecast. Start the local AI server, load a chat-capable model, and enable its OpenAI-compatible server on port `1234`. The default model is `phi-3-mini-4k-instruct`; set `AI_MODEL` to the exact ID shown by the server when using another model.

For local API development, the defaults use `http://localhost:1234`. Docker uses `http://host.docker.internal:1234` so the API container can reach the local AI server on the host. Configure `AI_BASE_URL`, `AI_MODEL`, and `AI_TIMEOUT_MS` in `.env` as needed. If the local AI service is unavailable or returns invalid output, the app labels the result as a local fallback and continues to work.

## Docker

The backend can also run in Docker with SQLite persisted in a named volume:

```bash
docker compose up --build api
```

This starts the API on [http://localhost:4000](http://localhost:4000) and stores the database under `/app/data/spending-tracker.sqlite` inside the container, backed by the `spending-tracker-api-data` volume.

You can stop it with:

```bash
docker compose down
```

If the web app should talk to the Dockerized API locally, set:

```bash
EXPO_PUBLIC_API_URL=http://localhost:4000
```
