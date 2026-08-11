# Verified versions

Checked against PyPI, npm, Docker Hub and nodejs.org on **2026-08-11**. Everything here is the
registry's `latest` **stable** release — no prereleases — except where a note says otherwise.

Stack ruled 2026-08-11: **Django API + Node socket gateway + Next.js frontend.** See `01-ARCHITECTURE.md`.

---

## Python — the backend

**Runtime: CPython 3.13.12**, project-local via `uv`. Not the system 3.14.7.

⚠️ **This is deliberate and load-bearing.** Celery 5.6.3 declares support only through Python 3.13
— it installs on 3.14 (`requires_python >= 3.9`) but is untested there. Celery runs the media
pipeline and the counter updates; it is not the component to gamble on. Django 6.1, psycopg and
Pillow all support 3.14 fine, so revisit once Celery ships 3.14 classifiers.

`uv python install 3.13.12` — this does not touch the system Python.

| Package | Pin | Note |
|---|---|---|
| django | **6.1** | Requires Python ≥3.12. See LTS note below. |
| djangorestframework | **3.18.0** | |
| drf-spectacular | **0.30.0** | Generates the OpenAPI 3.1 schema — the type boundary. |
| psycopg | **3.3.4** | psycopg **3**, not psycopg2. |
| celery | **5.6.3** | Redis broker, not RabbitMQ. Pins the runtime to 3.13. |
| django-celery-beat | **2.9.0** | Scheduled hard-delete job, Phase 5. |
| django-unfold | **0.104.0** | Admin theme for the moderation console. Supports Django 5.2/6.0/6.1 ✓, Python ≥3.12 ✓. Only dep is `django>=5.2`. **See `docs/vendor/django-unfold.md`.** |
| uvicorn | **0.52.1** | ASGI server for the API process. |
| redis | **8.1.0** | Python client. |
| boto3 | **1.43.68** | Presigned URLs against MinIO/R2. |
| django-storages | **1.14.6** | |
| pillow | **12.3.0** | `pyvips` 3.1.1 is the upgrade if the worker bottlenecks. |
| blurhash-python | **1.2.2** | |
| python-magic | **0.4.27** | Real MIME detection. Needs libmagic on Windows — verify in Phase 3. |
| livekit-api | **1.2.0** | Server-side token minting, Phase 7. |
| django-cors-headers | **4.9.0** | Should be barely needed — Next.js rewrites make it same-origin. |
| dj-database-url | **3.1.2** | |
| pytest-django | **4.14.0** | |
| ruff | **0.16.2** | Lint + format. |
| mypy + django-stubs | **2.3.0** / **6.0.9** | Strict. The Python-side equivalent of rule 2. |

### Django 6.1 vs 5.2 LTS

Ruled: **6.1**. Current LTS is 5.2.17 (supported to ~April 2028); the next LTS is 6.2, expected
~April 2027. Starting on 6.1 makes the eventual move to 6.2 LTS a minor upgrade. Starting on
5.2 LTS would mean a two-major jump later. Plan to adopt **6.2 LTS when it ships**.

---

## TypeScript — the realtime gateway and the frontend

**Runtime: Node.js 24.19.0**, installed via `pnpm env use --global`. pnpm 10.17.0.

### `apps/realtime` — the socket gateway

| Package | Pin | Note |
|---|---|---|
| ws | **8.21.3** | The socket server. |
| ioredis | **6.0.0** | Redis pub/sub for cross-replica fanout. |
| jose | **6.2.8** | Verifies the HS256 ticket Django mints. Verify-only — this service never signs. |
| tsx | **4.23.12** | Dev runner. |

No ORM, no database driver, no Postgres client. If one appears in this package's `package.json`,
something has gone wrong — see `01-ARCHITECTURE.md` §8.

### `apps/web` — the frontend

| Package | Pin | Note |
|---|---|---|
| next | **16.3.0** | |
| react / react-dom | **19.2.8** | |
| babel-plugin-react-compiler | **1.0.0** | Compiler is 1.0 stable. |
| eslint-plugin-react-hooks | **7.1.1** | Carries the compiler lint rules. |
| tailwindcss + @tailwindcss/postcss | **4.3.3** | CSS-first `@theme`. |
| shadcn (CLI) | **4.16.2** | ⚠️ Verify it still scaffolds on **Base UI** — the design spec depends on it. |
| motion | **13.1.0** | ⚠️ Check v12→v13 breaking changes before Phase 2. |
| openapi-typescript | **7.13.0** | Generates `packages/api-client` from Django's schema. |
| openapi-fetch | **0.17.0** | Typed fetch client. Chosen over `orval` — smaller, no codegen runtime. |
| zod | **4.4.3** | **Frontend forms only.** Does not restate the API contract — see `01-ARCHITECTURE.md` §3. |
| livekit-client | **2.21.0** | |
| blurhash | **2.0.5** | Client-side decode. |
| typescript | **5.9.3** | ⚠️ Deliberately behind. `latest` is 7.0.2 (the native port); 6.0.0-beta and 7.0.1-rc also exist. Revisit after Phase 4. |
| turbo | **2.10.9** | Orchestrates both ecosystems. |
| vitest | **4.1.10** | |

**Playwright is not in the stack.** Flows are verified through Claude's Chrome access. Do not add
`@playwright/test`, `playwright-cli`, or `webapp-testing`.

**Dropped when the stack changed:** `drizzle-orm`, `drizzle-kit`, `better-auth`, `bullmq`, `sharp`,
`pg`, `livekit-server-sdk` — Django owns all of those concerns now. Also `channels`,
`channels-redis` and `daphne`, dropped when sockets moved to Node.

---

## Docker images

All tags confirmed to exist on Docker Hub 2026-08-11. Floating `latest` tags were replaced with
concrete ones — a compose file that pulls `latest` is not reproducible.

| Service | Pin | Note |
|---|---|---|
| postgres | `postgres:18-alpine` | Host port **5433**, not 5432. |
| redis | `redis:8-alpine` | Celery broker, feed cache, **and** the pub/sub bus between Django and the realtime gateway. |
| minio | `minio/minio:RELEASE.2025-09-07T16-13-09Z` | was `latest` |
| minio-init | `minio/mc` | bootstrap only, floating is fine |
| livekit | `livekit/livekit-server:v1.13.5` | was `latest` |
| coturn | `coturn/coturn:4.17.2` | was `latest`; spec assumed 4.6.x — current line is 4.17 |
| typesense | `typesense/typesense:28.0` | |

Not yet pulled — the daemon was stopped at check time.

---

## Toolchain state on this machine (verified 2026-08-11)

| Tool | State |
|---|---|
| Python | **3.14.7** at `C:\Python314` (system). Project pins **3.13.12** via uv — see above. |
| uv | **0.10.11**, at `~/.local/bin/uv.exe`. This is the Python package manager for the project. |
| pip / poetry / pipx | Not on PATH. Not needed — uv covers it. |
| Node | **24.19.0**, via `pnpm env use --global`. At `%LOCALAPPDATA%\pnpm\node.exe`. |
| pnpm | **10.17.0** (11.21.0 available, not required). Store: `D:\.pnpm-store\v10`. Verified working. |
| npm / npx | **Working** (repaired 2026-08-11, see below). `pnpm` is still the project's package manager. |
| Docker | Desktop **29.2.1** / Compose **v5.0.2** installed, **daemon stopped**. Start manually. |
| ffmpeg | **7.1.1** on PATH. Phase 3's worker has what it needs. |
| git | 2.50.1. Repo on `main`. |
| Disk | ~184 GB free on D:. |

### `npm` / `npx` — was broken, now fixed

**Root cause: two corrupt NTFS junctions**, not a disk or permission fault.

`%LOCALAPPDATA%\npm-cache` and `%LOCALAPPDATA%\pip` are junctions into `D:\cache`. Both had been
created in January 2026; the `D:\cache` targets were later deleted. Recreating the targets did not
help, because the *junctions themselves* had gone bad.

The signature was distinctive and worth recognising again:

| Operation through the junction | Result |
|---|---|
| Read / list | worked |
| Create a **file** | worked |
| Create a **directory** | **`EEXIST` for a name that did not exist** |
| `mkdir -p` (nested) | `ENOENT` |
| Same directory create written **direct to `D:\…`** | worked |

Directory creation failing with "already exists" for a random unused name, while file creation
through the same path succeeds, means the reparse point is defective — not the target, not the ACL,
not the filesystem. D: is healthy NTFS with plenty of space, and identical operations addressed
directly at `D:\cache\...` always worked.

**Fix — delete and recreate each junction.** No elevation needed; `mklink /J` does not require
admin, unlike `/D` symlinks. Plain `rmdir` on a junction removes only the link and leaves the
target's contents intact — do **not** use `rmdir /S` or PowerShell `Remove-Item -Recurse`, which
have historically followed junctions into the target.

```
rmdir "%LOCALAPPDATA%\npm-cache"
mklink /J "%LOCALAPPDATA%\npm-cache" "D:\cache\npm-cache"
```

Applied to both `npm-cache` and `pip` on 2026-08-11 (pip's target had to be recreated first, as
`D:\cache\pip` was missing entirely). Verified afterwards: `npm view`, `npm cache verify`, and
`npx` all work.

**If a junction ever misbehaves this way again, recreate it before believing anything else.**
`%LOCALAPPDATA%\Docker` and `docker-secrets-engine` are also junctions (into `D:\Docker`) and were
healthy at check time — but they're the same vintage, so they're the first suspects if Docker
starts failing strangely.

`pnpm` remains the project's package manager. It was never affected: its store is `D:\.pnpm-store\v10`,
reached directly with no junction in the path.

### Port conflict — ruled

Host **5432** is held by a native `postgresql-x64-17` Windows service, unrelated to this project.
**Ruled: bind the container to `5433:5432`** and leave the native service running. `DATABASE_URL`
uses port **5433**. Inside the compose network everything still talks to `postgres:5432`.
Record as a Deviation in the Phase 1 handoff.

Ports verified free: 6379, 9000, 9001, 7880, 8108, 3000, 8000, 3478, 443.

---

## Docs to fetch before Phase 1

`docs/vendor/` held Drizzle and BetterAuth pages for the previous stack. Those were removed when the
stack changed (they remain in git history at commit `e1beb29`).

Django and DRF are extremely well represented in training data and do **not** need vendoring.

- ✅ **django-unfold** — fetched, at `docs/vendor/django-unfold.md`.
- ⬜ **drf-spectacular** — the OpenAPI generation pipeline. Fetch before Phase 1.
- ⬜ **Django 6.x release notes** — composite primary keys and `Index(condition=...)`. Fetch before Phase 1.

Channels docs are no longer needed — sockets moved to Node.
