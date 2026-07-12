FROM node:22-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm --filter @spending-tracker/shared build
RUN pnpm --filter @spending-tracker/api build
RUN pnpm --filter @spending-tracker/api deploy --prod --legacy /prod/api

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV API_BASE_URL=http://localhost:4000
ENV DB_PATH=/app/data/spending-tracker.sqlite

COPY --from=build --chown=node:node /prod/api ./

RUN mkdir -p /app/data && chown -R node:node /app

EXPOSE 4000

USER node

CMD ["node", "dist/index.js"]
