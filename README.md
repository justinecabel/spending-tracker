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
