# Spending Tracker Instructions

## Scope

This repo currently targets:

- `web`

The current product shape is:

- Expo + React Native app in `apps/mobile-web`
- standalone Node API in `apps/api`
- shared schemas and types in `packages/shared`

## Current Product Rules

- Categories stay enabled, but budget features are being removed from the visible product flow.
- `Device-ID` is the local profile on a device.
- `Sync Code` is a linked remote profile on the same device.
- A device can keep a local `Device-ID` profile and linked `Sync Code` profiles separately.
- Forgetting a sync profile removes it from the current device only.
- Importing local data copies local records into the active sync account.
- “Own this device” replaces local device data with the active sync account data after confirmation.
- Reports should follow the same summary range used by Home.

## Frontend Notes

- Main app routes live under `apps/mobile-web/app`.
- Shared UI primitives live under `apps/mobile-web/src/components`.
- Session/profile state lives in `apps/mobile-web/src/state/session.ts`.
- Offline draft and sync queue state lives in `apps/mobile-web/src/state`.
- The app should behave like an installable PWA on web.
- Compact screens should keep floating actions from covering the last visible content.

## Backend Notes

- The API is standalone and can run without the Expo app.
- SQLite is the current persistence layer.
- Docker support exists for the API via `docker-compose.yml`.
- Sync/profile behavior should remain compatible with the client-side profile model.

## Common Commands

Install dependencies:

```bash
pnpm install
```

Run the API database setup:

```bash
pnpm --filter @spending-tracker/api db:init
```

Run the full dev stack:

```bash
pnpm dev
```

Run only the API:

```bash
pnpm dev:api
```

Run web typecheck:

```bash
corepack pnpm --filter @spending-tracker/mobile-web typecheck
```

Prepare persistent Docker data from the existing local SQLite database (stop the local API first):

```powershell
.\scripts\migrate-api-data.ps1
```

Run the private API through Docker and Tailscale:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

Tailscale is a separate private sidecar. Log it in manually after Compose starts:

```bash
docker exec -it spending-tracker-tailscale tailscale up
docker exec spending-tracker-tailscale tailscale serve --bg localhost:4000
```

To run the local Expo app against the Docker API (rather than the separate
local development API on port 4000), use:

```bash
pnpm dev:app:docker
```

It reads the Tailscale sidecar's current HTTPS hostname and starts Expo with
that address as `EXPO_PUBLIC_API_URL`. Stop any existing Expo server first,
because its API URL is fixed when the development bundle starts.

## Editing Guidelines

- Prefer updating shared schemas in `packages/shared` before wiring client/server changes.
- Keep web and compact-screen behavior responsive instead of hardcoding single viewport fixes.
- Use confirmation modals for destructive actions.
- Keep copy short and app-like rather than dashboard or browser-like.
