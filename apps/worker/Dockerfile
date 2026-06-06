# syntax=docker/dockerfile:1
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jarvis/db generate
RUN pnpm --filter "@jarvis/worker..." build

ENV NODE_ENV=production
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
