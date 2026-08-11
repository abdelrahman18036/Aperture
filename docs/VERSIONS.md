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
| typescript | — | 7.0.2 | **5.9.3** | ⚠️ **deliberately behind `latest`.** TS 7 is the native port; 6.0.0-beta and 7.0.1-rc are also published. Ruled: stay on 5.9.3 through Phase 4, then revisit. Strict mode is only enforceable if the checker itself is boring. |
| turbo | 2.x | **2.10.9** | 2.10.9 | |
| vitest | 3.x | **4.1.10** | 4.1.10 | ⚠️ **major drift** from spec. |
| @playwright/test | 1.5x | **1.62.1** | 1.62.1 | |
| blurhash | — | **2.0.5** | 2.0.5 | |
| pg | — | **8.23.0** | 8.23.0 | |

## Docker images (from `01-ARCHITECTURE.md` §3)

`postgres:18-alpine`, `redis:8-alpine`, `minio/minio`, `minio/mc`,
`livekit/livekit-server`, `coturn/coturn`, `typesense/typesense:28.0`.
Not yet pulled — the daemon was not running at check time. Verify tags on first `compose up`.

## Drift — ruled 2026-08-11

Five majors moved past the spec: **shadcn 3→4, motion 12→13, BullMQ 5→6, Vitest 3→4, TypeScript →7.**
Per standing rule 1 these were reported rather than silently taken. Ruling:

- **shadcn 4.16.2, motion 13.1.0, bullmq 6.0.11, vitest 4.1.10 — take current.** Read each one's
  migration notes at the phase that first touches it and flag anything `01-ARCHITECTURE.md` or
  `02-DESIGN-SYSTEM.md` assumed about the older major.
- **TypeScript — hold at 5.9.3.** Revisit after Phase 4.

Specific things to check when the relevant phase arrives:

| Phase | Check |
|---|---|
| 2 | Does shadcn **4.x** still scaffold on **Base UI** by default? The design spec depends on it. |
| 2 | Motion **13** breaking changes vs the 12.x API the spec's motion section assumes. |
| 2 | Are the registry **chat primitives** (`MessageScroller`, `Message`, `Bubble`, `Attachment`) still shipping in v4? Phase 6 budgets for them. |
| 1/3 | BullMQ **6** worker + connection option changes; confirm the ioredis 6 peer requirement. |
| 1 | Vitest **4** config/API changes vs 3.x. |

## Doc/version mismatch to watch

`docs/vendor/drizzle/` includes `pg__upgrade-v1.md` and `pg__v0-v1-changes.md` — Drizzle **1.0**
material. The pin is **0.45.2**. When a vendor doc describes v1 API, it does not apply.

## Toolchain state on this machine (verified 2026-08-11)

| Tool | State |
|---|---|
| Node | **24.19.0**, installed via `pnpm env use --global`. Lives at `%LOCALAPPDATA%\pnpm\node.exe`. |
| pnpm | **10.17.0** (11.21.0 available, not required). Store: `D:\.pnpm-store\v10`. Install verified end-to-end. |
| npm / npx | **Broken.** See below. Use `pnpm` and `pnpm dlx` instead — `pnpm dlx` verified working. |
| Docker | Desktop **29.2.1** / Compose **v5.0.2** installed, **daemon stopped**. Start it before `compose up`. |
| ffmpeg | **7.1.1** on PATH. Phase 3's worker has what it needs locally. |
| git | 2.50.1. Repo initialized on `main`, specs committed. |
| Disk | ~184 GB free on D:. |

### `npm` / `npx` are broken on this machine

`%LOCALAPPDATA%\npm-cache` is a **junction** to `D:\cache\npm-cache`, whose target had been deleted.
Recreating the target was not sufficient — npm still cannot create `_cacache` through the junction
(`ENOENT` on mkdir, `EEXIST` on the temp file once the dir exists). It fails identically inside and
outside the sandbox, so it is a real machine-config fault, not a tooling artifact.

**Impact:** none on this project — pnpm has its own store and installs fine. Substitute
`pnpm dlx <pkg>` anywhere the brief or a doc says `npx <pkg>`.

**Permanent fix (user, one line):**

```
npm config set cache "D:\npm-cache"
```

Any real directory on a path with no junction works. Or delete the junction and let npm recreate
`%LOCALAPPDATA%\npm-cache` as a normal folder.

### Port conflict — ruled 2026-08-11

Host **5432** is held by a native `postgresql-x64-17` Windows service (PG 17, unrelated to this
project). `01-ARCHITECTURE.md` §3 binds `5432:5432` and would fail to start.

**Ruled: bind the container to `5433:5432`.** The native service is left running and untouched.
`DATABASE_URL` uses port **5433**. Everything inside the compose network still talks to `postgres:5432`
— only the host-side mapping changes. This is a deviation from the spec's compose block and must be
recorded in the Phase 1 handoff under Deviations.

Ports otherwise verified free: 6379, 9000, 9001, 7880, 8108, 3000, 3478, 443.
