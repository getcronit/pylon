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
RUN pnpm build                                   # builds ./packages/* dist (incl. pylon-dev's `pylon` CLI)
# pnpm couldn't link docs' `pylon` bin during install: pylon-dev's dist is
# gitignored and only produced by `pnpm build` above, so the bin target didn't
# exist at install time (ENOENT skip). Invoke the freshly-built CLI directly —
# cwd = docs so `pylon build` picks up docs/pylon.config.ts and emits docs/.pylon.
RUN cd docs && node node_modules/@getcronit/pylon-dev/dist/index.js build
# Prune to a standalone deployment of JUST the docs app: its built files
# (.pylon, public, ...) plus a flat node_modules of only its PRODUCTION deps,
# with the workspace packages (@getcronit/pylon, pylon-pages, pylon-query, ...)
# copied in rather than symlinked. This is what keeps the runner image small —
# the whole monorepo + every dev dependency stays behind in the build stage.
# The env var satisfies pnpm 10's deploy gate for this one command (without
# switching the repo-wide install to injected mode); --legacy uses the
# copy-from-node_modules implementation, which matches our symlinked install.
RUN npm_config_inject_workspace_packages=true \
    pnpm --filter=@getcronit/pylon-docs deploy --legacy --prod /prod
# pnpm deploy selects files by npm-publish rules, which honor .gitignore — and
# docs/.gitignore excludes the built `.pylon` (docs has no `files` field, unlike
# the workspace deps whose `files:["dist"]` keeps their dist). Copy the built
# server entry into the pruned tree so the runner can start it.
RUN cp -r docs/.pylon /prod/.pylon

# ---- runner: serve the pruned deployment ----
FROM base AS runner
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /prod /app
EXPOSE 3000
# `pylon build` emits the Node server entry as .pylon/server.mjs — it boots the
# config, mounts the GraphQL handler + usePages catch-all, then binds node:http.
CMD ["node", "--enable-source-maps", ".pylon/server.mjs"]
