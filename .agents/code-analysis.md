# Code analysis handoff

Last reviewed: 2026-08-06

## Architecture

- `apps/mobile-web` is the Expo/React Native web app. Screens should use `src/backend/device-backend.ts`; the HTTP adapter is `src/backend/remote-storage.ts` and should not be called directly by screens.
- `apps/api` is standalone Express + SQLite remote storage. `src/routes.ts` owns HTTP/auth boundaries; `src/repositories.ts` owns persistence and domain mutations; `src/realtime.ts` provides `/ws` invalidation messages.
- `packages/shared` owns Zod schemas and reporting/forecast/debt-health calculations. Update shared schemas before changing both client and server payloads.
- Device profiles are authenticated by `Device-ID` plus a separate stored device secret. Linked Sync Code profiles use a durable pairing credential and rotating refresh sessions. Offline mutations are persisted in `offlineQueueStore` and replayed by `useSyncQueue`.
- Transaction creation checks `navigator.onLine === false` before calling the remote adapter, then writes to the local cache and sync queue immediately so the Quick add modal can close without waiting on a failed fetch.

## QA protocol

For code changes, use staged verification: focused regression test, full workspace tests, strict typecheck, production build where applicable, then `git diff --check` and working-tree status review.

## Verified behavior

- `pnpm test` passes all current shared, API, and mobile-web tests.
- `pnpm typecheck` passes all workspace packages.
- `pnpm build` passes shared/API production bundling and the Expo web export.

## Open findings to preserve

1. **Google/device-linking security:** `findOrCreateUser()` in `apps/api/src/auth.ts` selects a device record by the caller-supplied `deviceId` and converts it to a Google account without validating the device secret. The `/auth/google` route passes the client-supplied ID directly. A known Device-ID can therefore attach an untrusted Google identity to that device's data. The `/auth/device` path correctly checks the secret, but that check is not reused by Google linking.
2. **Import is not idempotent for debts:** `importDeviceData()` uses source transaction IDs as duplicate keys, but creates debts without a source/client idempotency key. Repeating an import duplicates every source debt. The import also is not wrapped in one transaction, so a later failure can leave partial copied data.
3. **Offline queue retry caveat:** `useSyncQueue()` iterates a snapshot of queued mutations. When a create receives its server ID, `replaceCategoryId`/`replaceDebtId`/`replaceTransactionId` updates the store but not already captured mutation objects later in the same loop. Dependent mutations may fail once with a temporary ID and succeed on the next five-second retry.
4. **Configured protections are currently dead configuration:** rate limits for device registration, transfer attempts, diagnostics, and WebSocket caps/heartbeat/buffer/lifetime are defined in `apps/api/src/config.ts` but are not referenced by the API/realtime implementation. Pairing consumption and diagnostic writes therefore have no active rate limiting or connection bounds.
5. **Cleanup edge cases:** `pruneStaleData()` treats accounts with only budgets as empty, and `subtractCalendarMonths()` can overflow at month-end (for example March 31 minus one month becomes March 3 in JavaScript). Review before changing retention behavior.
