# syntax=docker/dockerfile:1
#
# Pylon docs (a Pylon + usePages server app) for Coolify.
#
# IMPORTANT: the build context MUST be the REPOSITORY ROOT, because the docs app
# depends on the workspace packages (`@getcronit/pylon`, `pylon-pages`,
# `pylon-query`, ...) via `workspace:*` and builds them FROM SOURCE — it never
# pulls them from npm. That is what keeps a docs deploy fully decoupled from the
# npm canary channel: this image never publishes anything.
#
#   Local:   docker build -f docs/Dockerfile -t pylon-docs .
#   Coolify: Build Pack = Dockerfile
#            Base Directory      = /
#            Dockerfile Location = /docs/Dockerfile
#            Port                = 3000

FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ---- build: compile the workspace packages, then the docs app ----
FROM base AS build
# Copy the root manifest FIRST so corepack pins pnpm from its `packageManager`
# field (pnpm@10). Without it, `pnpm fetch` runs before any package.json exists
# and corepack grabs the latest pnpm, which is incompatible with Node 20.
# The lockfile + workspace file let `pnpm fetch` populate the store from the
# lockfile alone, so this layer stays cached until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
# Now bring the full monorepo — a workspace install/build needs every package.
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm build                                   # builds ./packages/* dist
RUN pnpm --filter @getcronit/pylon-docs build    # `pylon build` -> docs/.pylon/index.js

# ---- runner: serve the built app ----
FROM base AS runner
ENV NODE_ENV=production PORT=3000
# Carry over the built workspace (node_modules symlinks + docs/.pylon + public).
# TODO(optimize): once we confirm `pylon build` bundles react/react-dom, the
# runner can copy only docs/.pylon + docs/public and drop node_modules, or use
# `pnpm deploy --filter @getcronit/pylon-docs` for a pruned image.
COPY --from=build /app /app
WORKDIR /app/docs
EXPOSE 3000
CMD ["node", "--enable-source-maps", ".pylon/index.js"]
