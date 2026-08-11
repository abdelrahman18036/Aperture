# Verified versions

Checked against the npm registry and nodejs.org on **2026-08-11**. These supersede the
August-2026 numbers in `01-ARCHITECTURE.md` §1. Re-verify before Phase 1 install if
significant time has passed.

## Pins

| Package | Spec says | Registry `latest` | Pin | Note |
|---|---|---|---|---|
| Node.js | 24 LTS | 26.7.0 (current) | **24.19.0** | Stay on LTS. Node 26 is current-line. |
| pnpm | 10.x | 11.21.0 | **10.17.0** (installed) | pnpm 11 is out; 10.17.0 works. Upgrade is optional, not required. |
| next | 16.3 | **16.3.0** | 16.3.0 | Matches spec exactly. |
| react / react-dom | 19.x | **19.2.8** | 19.2.8 | |
| babel-plugin-react-compiler | 1.x | **1.0.0** | 1.0.0 | Compiler is 1.0 stable. |
| eslint-plugin-react-hooks | — | 7.1.1 | 7.1.1 | Carries the compiler lint rules. |
| tailwindcss + @tailwindcss/postcss | 4.x | **4.3.3** | 4.3.3 | CSS-first `@theme`. |
| shadcn (CLI) | 3.x | **4.16.2** | 4.16.2 | ⚠️ **major drift.** Verify the Base UI scaffold default still holds on v4. |
| motion | 12.x | **13.1.0** | 13.1.0 | ⚠️ **major drift.** Check v12→v13 breaking changes before Phase 2. |
| drizzle-orm | 0.4x | **0.45.2** | 0.45.2 | 1.0.0-rc.5 exists but `latest` is still 0.45.2 — stay stable. |
| drizzle-kit | 0.4x | **0.31.10** | 0.31.10 | Kit versions independently of orm; this is correct. |
| better-auth | 1.x | **1.6.26** | 1.6.26 | |
| zod | 4.x | **4.4.3** | 4.4.3 | |
| bullmq | 5.x | **6.0.11** | 6.0.11 | ⚠️ **major drift.** v5→v6 changed worker/connection options. |
| ioredis | — | **6.0.0** | 6.0.0 | Major bump; check BullMQ 6 peer requirement first. |
| ws | — | **8.21.3** | 8.21.3 | |
| livekit-server-sdk | — | **2.17.0** | 2.17.0 | |
| livekit-client | JS SDK 2.x | **2.21.0** | 2.21.0 | |
| sharp | 0.34.x | **0.35.3** | 0.35.3 | Minor drift. |
| typescript | — | **7.0.2** | ⚠️ decide | TS 7 (native port) is `latest`. Big jump. Consider pinning `5.9.x`/`6.x` for Phase 1 and moving deliberately — the whole repo is strict-mode TS. |
| turbo | 2.x | **2.10.9** | 2.10.9 | |
| vitest | 3.x | **4.1.10** | 4.1.10 | ⚠️ **major drift** from spec. |
| @playwright/test | 1.5x | **1.62.1** | 1.62.1 | |
| blurhash | — | **2.0.5** | 2.0.5 | |
| pg | — | **8.23.0** | 8.23.0 | |

## Docker images (from `01-ARCHITECTURE.md` §3)

`postgres:18-alpine`, `redis:8-alpine`, `minio/minio`, `minio/mc`,
`livekit/livekit-server`, `coturn/coturn`, `typesense/typesense:28.0`.
Not yet pulled — the daemon was not running at check time. Verify tags on first `compose up`.

## Drift needing a ruling before Phase 1

Five majors moved past the spec: **shadcn 3→4, motion 12→13, BullMQ 5→6, Vitest 3→4, TypeScript →7.**
Per standing rule 1 these are reported, not silently taken. Default recommendation: take current
`latest` for all of them **except TypeScript**, where 7.0.2 is new enough that a strict-mode
monorepo is likely to hit rough edges in Drizzle/Next type inference before the ecosystem catches up.

## Doc/version mismatch to watch

`docs/vendor/drizzle/` includes `pg__upgrade-v1.md` and `pg__v0-v1-changes.md` — Drizzle **1.0**
material. The pin is **0.45.2**. When a vendor doc describes v1 API, it does not apply.

## Port conflict

Host **5432** is held by a native `postgresql-x64-17` Windows service. The compose file in
`01-ARCHITECTURE.md` §3 binds `5432:5432` and will fail to start. Resolve before Phase 1 — either
stop the native service, or bind the container to `5433:5432` and set `DATABASE_URL` accordingly
(a deviation to record in the Phase 1 handoff).
