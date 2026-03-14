# Stage 1: Build frontend
FROM node:22-alpine AS web-build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm run build

# Stage 2: Build backend
FROM node:22-alpine AS server-build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app/server
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY server/ ./
RUN pnpm run build

# Stage 3: Production image
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/src/plugins/preinstalled ./dist/plugins/preinstalled
COPY --from=server-build /app/server/drizzle ./drizzle
COPY --from=web-build /app/web/dist ./public

ENV NODE_ENV=production
VOLUME /app/data
EXPOSE 3000

CMD ["node", "dist/index.js"]
