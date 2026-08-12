# The UI.
#
#   docker build -f apps/web/Dockerfile -t aperture-web .
#
# From the repo root, because this app depends on three workspace packages —
# `@repo/ui`, `@repo/api-client` and `@repo/realtime-events`.
#
# **Next.js is not a backend.** Nothing here reaches Postgres; the container
# needs `API_ORIGIN` and nothing else, because the `/api/*` rewrite is the
# only integration point and it is what keeps the session cookie same-origin.

FROM node:24.19.0-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/ui/package.json packages/ui/
COPY packages/api-client/package.json packages/api-client/
COPY packages/realtime-events/package.json packages/realtime-events/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web...

FROM deps AS build
COPY packages/ packages/
COPY apps/web/ apps/web/

# **`API_ORIGIN` is a build argument and not an environment variable, and
# that is not a preference.** `rewrites()` is evaluated during the build and
# written into `.next/routes-manifest.json`; the standalone server reads the
# manifest, so setting `API_ORIGIN` at runtime does nothing at all. It looks
# like it works — the container starts, the pages render — and every `/api/*`
# request 500s with `ECONNREFUSED 127.0.0.1:8000`.
#
# The default keeps one image usable everywhere: name the Django service
# `api` on whatever network the container joins and nothing needs rebuilding.
# Override it only when that is impossible.
ARG API_ORIGIN=http://api:8000
ENV API_ORIGIN=$API_ORIGIN

# No `NEXT_PUBLIC_*` anywhere in this app, which is why that is the only
# build-time input: the socket URL reaches the browser inside the ticket
# response Django mints, rather than being inlined into the bundle.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

FROM base AS runtime
WORKDIR /repo
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Two copies rather than one, because `output: "standalone"` splits them: the
# traced server tree, then `static/`, which the standalone server expects to
# find beside it but does not trace. (There is no `public/` — nothing in this
# app is served as a static asset.)
COPY --from=build /repo/apps/web/.next/standalone/ ./
COPY --from=build /repo/apps/web/.next/static/ ./apps/web/.next/static/

USER node
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
