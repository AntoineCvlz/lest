# syntax=docker/dockerfile:1.7
# Étapes : base → deps → dev (Compose) → build → prod (serveur Next.js « standalone »).

FROM node:24.22.1-trixie-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    pnpm_config_store_dir=/home/node/.pnpm-store
# Le corepack livré avec Node ne sait pas lancer pnpm 12 : version récente épinglée.
RUN npm install --global corepack@0.36.0 \
 && corepack enable pnpm \
 && mkdir /app && chown node:node /app
WORKDIR /app
# Tout le reste (install, dev, build) tourne en utilisateur non-root.
USER 1000:1000

FROM base AS deps
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/home/node/.pnpm-store,uid=1000,gid=1000 \
    corepack install && pnpm install --frozen-lockfile

# --- Dev : code synchronisé par `develop.watch`, node_modules restent ceux de l'image -----
FROM deps AS dev
COPY --chown=node:node . .
EXPOSE 3000
CMD ["pnpm", "exec", "next", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

# --- Build -------------------------------------------------------------------------------
FROM deps AS build
COPY --chown=node:node . .
RUN pnpm build

# --- Prod : uniquement la sortie standalone, sans pnpm ni dépendances de dev --------------
FROM node:24.22.1-trixie-slim AS prod
# Le serveur standalone n'a besoin que de node : gestionnaires de paquets retirés
# (surface d'attaque réduite ; Trivy y signalait des CVE HIGH dans le npm embarqué).
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER 1000:1000
EXPOSE 3000
CMD ["node", "server.js"]
