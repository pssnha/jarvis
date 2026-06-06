# syntax=docker/dockerfile:1
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app

# Install workspace dependencies.
COPY . .
RUN pnpm install --frozen-lockfile

# Generate the Prisma client, then build the API and the packages it depends on.
RUN pnpm --filter @jarvis/db generate
RUN pnpm --filter "@jarvis/api..." build

ENV NODE_ENV=production
WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
