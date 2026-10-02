# syntax=docker/dockerfile:1.7
# One Dockerfile, several targets:
#   docker build -f infra/docker/Dockerfile --target api .
#   … --target worker | admin-api | migrate | nginx
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
WORKDIR /repo

# ---------- dependencies (cached on the lockfile) ----------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/admin-api/package.json apps/admin-api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/site/package.json apps/site/
COPY packages/shared/package.json packages/shared/
COPY packages/domain/package.json packages/domain/
COPY packages/application/package.json packages/application/
COPY packages/infrastructure/package.json packages/infrastructure/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---------- build everything ----------
FROM deps AS build
# Browser apps read these at build time (Vite). Passed from infra/.env.production by Compose.
ARG VITE_APP_URL=https://app.hellogram.in
ARG VITE_PHONE_AUTH=otp
ARG VITE_FIREBASE_API_KEY=
ARG VITE_FIREBASE_AUTH_DOMAIN=
ARG VITE_FIREBASE_PROJECT_ID=
ARG VITE_FIREBASE_APP_ID=
ARG VITE_TURNSTILE_SITE_KEY=
ENV VITE_APP_URL=$VITE_APP_URL VITE_PHONE_AUTH=$VITE_PHONE_AUTH VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
COPY . .
RUN pnpm --filter @hellogram/db generate \
 && pnpm --filter @hellogram/api build \
 && pnpm --filter @hellogram/worker build \
 && pnpm --filter @hellogram/admin-api build \
 && pnpm --filter @hellogram/web build \
 && pnpm --filter @hellogram/admin build \
 && pnpm --filter @hellogram/site build
RUN pnpm --filter @hellogram/api deploy --prod /out/api \
 && pnpm --filter @hellogram/worker deploy --prod /out/worker \
 && pnpm --filter @hellogram/admin-api deploy --prod /out/admin-api \
 && cp -r apps/api/dist /out/api/dist \
 && cp -r apps/worker/dist /out/worker/dist \
 && cp -r apps/admin-api/dist /out/admin-api/dist

# ---------- runtime images ----------
FROM node:${NODE_VERSION} AS node-runtime
ENV NODE_ENV=production
WORKDIR /app
USER node

FROM node-runtime AS api
COPY --from=build --chown=node:node /out/api ./
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health/live || exit 1
CMD ["node", "--enable-source-maps", "dist/server.js"]

FROM node-runtime AS worker
COPY --from=build --chown=node:node /out/worker ./
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM node-runtime AS admin-api
COPY --from=build --chown=node:node /out/admin-api ./
EXPOSE 4100
CMD ["node", "--enable-source-maps", "dist/server.js"]

# One-off: apply database migrations (docker compose run --rm migrate).
FROM deps AS migrate
COPY packages/db packages/db
WORKDIR /repo/packages/db
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# Landing page, web app and admin panel behind nginx (HTTPS, security headers, reverse proxy).
# Domains come from SITE_DOMAIN / APP_DOMAIN / ADMIN_DOMAIN at start-up (templates → conf.d).
FROM nginx:1.27-alpine AS nginx
RUN rm /etc/nginx/conf.d/default.conf
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/snippets /etc/nginx/snippets
COPY infra/nginx/templates /etc/nginx/templates
COPY --from=build /repo/apps/site/dist /srv/site
COPY --from=build /repo/apps/web/dist /srv/web
COPY --from=build /repo/apps/admin/dist /srv/admin
