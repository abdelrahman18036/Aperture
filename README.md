# Aperture

A photo and video social platform. Web only.

**Django owns the data and the API. Node owns the sockets. Next.js owns the
UI.** Three deployables, one repo.

| Doc | Owns |
|---|---|
| [`01-ARCHITECTURE.md`](01-ARCHITECTURE.md) | stack, schema, data flow, scaling path |
| [`02-DESIGN-SYSTEM.md`](02-DESIGN-SYSTEM.md) | color, type, layout, motion |
| [`03-AGENT-BRIEF.md`](03-AGENT-BRIEF.md) | process, phases, standing rules |
| [`docs/VERSIONS.md`](docs/VERSIONS.md) | pinned versions and this machine's quirks |

---

## Setup from a clean clone

### 0. Prerequisites

- **Docker Desktop**, started manually — it does not auto-start on this
  machine.
- **[uv](https://docs.astral.sh/uv/)** for Python. `pip`, `poetry` and `pipx`
  are not on PATH and are not needed.
- **pnpm**, not npm. npm is unreliable here; see `docs/VERSIONS.md` for the
  corrupt-junction diagnosis. Use `pnpm dlx` wherever a guide says `npx`.

### 1. Backing services

```bash
cd infra && docker compose up -d
```

Brings up Postgres (host port **5433**), Redis, MinIO with its two buckets,
and Typesense. LiveKit and coturn sit behind a `calls` profile and stay down
until Phase 7 — `docker compose --profile calls up -d` when that lands.

Wait for `docker compose ps` to show postgres, redis and minio as `healthy`.

### 2. Install

```bash
pnpm install
```

```bash
cd apps/api && uv sync
```

`uv sync` creates `apps/api/.venv` on CPython 3.13.12, downloading that
interpreter if needed. It does not touch the system Python.

### 3. Environment

```bash
cp .env.example .env.local
```

Every variable has a development default in code, so this step is optional
locally. It is not optional anywhere else.

### 4. Migrate

```bash
cd apps/api && uv run manage.py migrate
```

```bash
cd apps/api && uv run manage.py collectstatic --noinput
```

`collectstatic` is not optional. Django serves static files itself only under
`runserver`; this project runs `uvicorn`, which serves none, and WhiteNoise
reads from `STATIC_ROOT`. Skip it and the admin renders as unstyled HTML.

```bash
cd apps/api && uv run manage.py createsuperuser
```

`createsuperuser` asks for an email first — email is the login credential
here, with username kept unique for profile URLs.

---

## The three processes

Each in its own terminal. There is no single command that starts all three,
deliberately: they scale on different things and deploy independently.

**API** — scales on request rate:

```bash
cd apps/api && uv run uvicorn config.asgi:application --reload --port 8000
```

**Worker** — scales on queue depth:

```bash
cd apps/api && uv run celery -A config worker --loglevel=info --pool=solo
```

`--pool=solo` is a Windows requirement; the default prefork pool does not work
there.

**Realtime gateway** — scales on concurrent sockets:

```bash
cd apps/realtime && pnpm dev
```

**Beat** — the scheduler, for the hard delete and the upload reaper:

```bash
cd apps/api && uv run celery -A config beat
```

**Frontend**:

```bash
cd apps/web && pnpm dev
```

Then open <http://localhost:3000>. The admin is at
<http://localhost:8000/admin>.

Seed a corpus to look at:

```bash
cd apps/api && uv run manage.py seed_demo
```

50 users, 500 posts and a follow graph, signing in as
`seed000@aperture.local` / `seeded-password-1234`. Then time the feed and read
the plan Postgres chose:

```bash
cd apps/api && uv run manage.py bench_feed
```

Turbo can drive the JavaScript side of that from the root — `pnpm dev` runs
every package's `dev` task — but the Django processes are usually clearer run
directly.

---

## Checking it works

```bash
curl http://localhost:3000/api/health
```

Served by Django on port 8000, reached through the Next.js `/api/*` rewrite.
That rewrite is the **only** integration point between the frontend and the
backend, and it is what keeps the browser on one origin so Django's session
cookie stays same-site. All three dependencies should report `ok`:

```json
{"status":"ok","checks":[
  {"name":"postgres","status":"ok","latency_ms":22.1,"detail":""},
  {"name":"redis","status":"ok","latency_ms":27.95,"detail":""},
  {"name":"object_storage","status":"ok","latency_ms":157.22,"detail":""}]}
```

```bash
curl http://localhost:4000/health
```

The gateway's own liveness check, including its current socket count.

---

## The type boundary

Django's serializers are the single source of truth for the frontend's types.
Nothing about the API contract is hand-written on the TypeScript side.

```bash
pnpm generate
```

Runs `serializers → drf-spectacular → packages/api-client/openapi.json →
openapi-typescript → packages/api-client/src/schema.d.ts`.

```bash
pnpm verify:api-client
```

Regenerates and fails if the committed client differs. **A serializer change
that is not reflected in a regenerated client is a broken build, not a runtime
surprise** — CI runs exactly this. `packages/api-client` is generated output
and is never hand-edited.

---

## Quality gates

```bash
pnpm lint
```

```bash
pnpm check-types
```

```bash
pnpm test
```

Each fans out across both ecosystems: `ruff` and `mypy --strict` with
`django-stubs` on the Python side, ESLint and `tsc --noEmit` on the
TypeScript side, `pytest` and Vitest for tests.

**There is no automated regression net on user flows.** Playwright is
deliberately not in this stack — flows are walked in a real browser instead.
A break in signup, upload or send will not be caught by CI, only by someone
walking it, so the critical flows get re-walked at every phase gate rather
than assumed still working.

---

## Safety

The moderation console is the Django admin at
<http://localhost:8000/admin/moderation/report/> — that is what choosing
Django bought, and there is deliberately no bespoke moderation UI.

Rate limits are token buckets in `core/ratelimit.py` with Redis state in
`moderation/ratelimit.py`. They fail **open**: a limiter that takes the site
down when Redis hiccups has done more damage than the abuse it prevented.

Two integrations are seams rather than implementations, both off by default
and both raising rather than silently passing if switched on unwired:

| Setting | What it needs |
|---|---|
| `CSAM_SCANNING_ENABLED` | a hash-matching provider (PhotoDNA, Cloudflare CSAM Scanning) |
| `NCMEC_REPORTING_ENABLED` | a registered ESP account and CyberTipline access |

A CSAM report that has not been forwarded stays visibly un-escalated and is
counted hourly by `moderation.report_escalation_backlog`. It is never marked
done by something that did not do it.

## Layout

```
apps/
  api/        Django — data, API, queue, auth, admin. Never holds sockets.
  realtime/   Node — socket gateway. Never touches Postgres.
  web/        Next.js — UI. Not a second backend.
packages/
  api-client/       GENERATED from OpenAPI. Never hand-edited.
  realtime-events/  Zod schemas shared by the gateway and the browser.
  ui/               Design system. Nothing here knows what a post is.
infra/        docker-compose.yml, coturn, livekit
```

Every Django app has the same eight files in the same order: reads in
`selectors.py`, writes in `services.py`, thin views, dumb models. See
`01-ARCHITECTURE.md` §2.
