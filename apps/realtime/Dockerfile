# The socket gateway.
#
#   docker build -f apps/realtime/Dockerfile -t aperture-realtime .
#
# Built from the repo root because it depends on `packages/realtime-events`,
# which is a workspace package — the Zod schemas it shares with the browser.
#
# **Nothing here talks to Postgres.** No ORM, no database driver: this process
# authenticates a socket, subscribes it to Redis and pushes bytes. A `pg` or a
# Prisma in the image means something went wrong upstream — `01-ARCHITECTURE.md`
# §4, and it is checked below rather than only asserted.

FROM node:24.19.0-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /repo

# Manifests only, so this layer survives every change that is not a
# dependency change.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/realtime/package.json apps/realtime/
COPY packages/realtime-events/package.json packages/realtime-events/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @repo/realtime...

FROM deps AS build
COPY packages/realtime-events/ packages/realtime-events/
COPY apps/realtime/ apps/realtime/

# The rule from §4, enforced rather than remembered. A database dependency
# reaching this image is the failure the architecture is arranged to prevent,
# and it is far cheaper to catch here than in a postmortem.
RUN if grep -Eq '"(pg|postgres|postgresql|prisma|@prisma/client|typeorm|knex|drizzle-orm)"' apps/realtime/package.json; then \
      echo "apps/realtime must never depend on a database driver — 01-ARCHITECTURE.md §4"; \
      exit 1; \
    fi

FROM base AS runtime
WORKDIR /repo
COPY --from=build /repo/ ./

USER node
EXPOSE 4000

# `tsx` rather than a compiled bundle. The gateway is a few hundred lines with
# no build step of its own, and adding one to save a millisecond of startup on
# a long-lived process is not a trade worth making.
CMD ["pnpm", "--filter", "@repo/realtime", "start"]
