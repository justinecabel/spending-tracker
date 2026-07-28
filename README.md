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

## Debt payment health

The app does not calculate a FICO, VantageScore, or other consumer credit score. Those models are proprietary and require credit-bureau fields the app does not collect, including utilization and limits, account age and mix, inquiries, and derogatory records. Official background:

- [CFPB: What is a credit score?](https://www.consumerfinance.gov/ask-cfpb/what-is-a-credit-score-en-315/)
- [myFICO: What's in your FICO Scores?](https://www.myfico.com/credit-education/whats-in-your-credit-score)
- [VantageScore consumer guide](https://www.vantagescore.com/consumers/blog/the-complete-guide-to-your-vantagescore)

Debt Watcher instead shows a transparent **0–100 debt payment health** indicator:

1. A paid item is measured against its due date. An unpaid item starts counting after its due date passes. Future unpaid items do not affect the result.
2. Each evaluated item receives 100 points when on time, 70 when 1–29 days late, 40 when 30–59 days late, 15 when 60–89 days late, and 0 when 90+ days late.
3. Items due within the last 90 days have weight 1.0, items 91–365 days old have weight 0.75, and older items have weight 0.5.
4. The displayed result is the weighted average, rounded to a whole number. Amount is deliberately excluded because an amount without a credit limit is not credit utilization.
5. Bands are 90–100 Excellent, 75–89 Good, 60–74 Fair, and 0–59 Needs attention. Confidence is separate: High requires at least 12 evaluated items spanning 365 days, Medium requires at least 6 spanning 90 days, and all other histories are Low.

Until at least one item can be evaluated, the app displays **Insufficient history** rather than inventing a neutral score.
