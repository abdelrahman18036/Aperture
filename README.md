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
and Typesense. Wait for `docker compose ps` to show postgres, redis and minio
as `healthy`.

Calls need two more, behind a profile so the everyday case stays small.
coturn needs a certificate first, and it must be one the **browser** trusts —
`mkcert` handles both halves:

```bash
mkcert -install
```

```bash
mkcert -cert-file infra/coturn/certs/fullchain.pem -key-file infra/coturn/certs/privkey.pem localhost 127.0.0.1 ::1
```

```bash
cd infra && docker compose --profile calls up -d
```

LiveKit runs the SFU for group calls; coturn relays 1:1 media when a network
refuses a direct connection, with **TLS on 443** because that is the transport
that survives a firewall dropping UDP.

`mkcert -install` writes a root CA into your trust store — worth understanding
before running, and the only step here that touches the machine rather than
the project. Skip it and everything works except `turns:`, which the browser
will refuse. Run the two mkcert commands **in the same shell** and restart the
browser afterwards; `infra/coturn/turnserver.conf` explains why both matter.
The certificates themselves are git-ignored.

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

Sweep the fan-in, which is the variable that decides whether a pull feed
holds — `01-ARCHITECTURE.md` §7 warns that "someone following 5,000 accounts
triggers a brutal fan-in on every scroll":

```bash
cd apps/api && uv run manage.py bench_feed --follows 5000
```

Measured on the development machine at 6,004 users / 120,000 posts / 200,000
follow edges:

| followees | p50 | p95 | p99 |
|---|---|---|---|
| 200 | 6.23 ms | 9.01 ms | 10.10 ms |
| 1,000 | 6.32 ms | 9.45 ms | 10.41 ms |
| 3,000 | 6.31 ms | 8.05 ms | 10.47 ms |
| 5,000 | 6.10 ms | 8.50 ms | 10.21 ms |

Flat across a 25× change in fan-in. §7 puts the trigger for hybrid push
fanout at p99 above ~200 ms, so **it is not built** — and that is a
measurement rather than a preference.

The Redis feed cache from §7 phase 2 *is* built, and is off. Compare the two
before turning it on:

```bash
cd apps/api && uv run manage.py bench_feed --cached
```

At this corpus it is about 2× slower (p50 30.72 ms against 16.13 ms), because
caching post ids rather than rows means Postgres is queried either way — the
Redis round trips add to the total instead of replacing it. That is the
tradeoff that keeps a cache hit correct when a post is deleted or a block
appears. Set `FEED_CACHE_ENABLED=1` when the sweep says the query has grown
past it.

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

```bash
pnpm --filter realtime loadtest
```

How many sockets one gateway process holds before latency degrades. It ramps
in waves, measuring the full client → gateway → Redis → gateway → client round
trip, and stops at the first wave to exceed the budget.

Measured on the development machine (Windows 11, gateway and harness sharing
one box): **14,000 concurrent sockets, p95 23.4 ms, 266 MB RSS, zero
failures**, with latency flat from 250 sockets upward. That is a floor rather
than a ceiling — the run ends because the harness exhausts this machine's
16,384-port ephemeral range, not because the gateway slows down. To push
further, widen the range and re-run:

```bash
netsh int ipv4 set dynamicport tcp start=10000 num=55000
```

### Calls

The media path is verified with **synthetic tracks** rather than a webcam — a
canvas `captureStream` and an oscillator produce real `MediaStreamTrack`s with
no hardware, which is what makes this runnable on a machine with no camera or
in a browser that will not grant one. Paste into the console on any page:

```bash
cat docs/verify-call-media.js
```

Measured on the development machine, two `RTCPeerConnection`s and the ICE
servers from a live `POST /api/calls/start`:

| ICE servers offered | policy | selected pair | video | audio |
|---|---|---|---|---|
| all | default | `host` / udp | 590 frames, 239 KB | 79 KB |
| all | `relay` | `relay` / udp | 356 frames, 45 KB | 48 KB |
| **`turns:` only** | **`relay`** | **`relay` / tls** | **416 frames, 52 KB** | **56 KB** |

The last row is the one §9 cares about. With only the `turns:` server offered
and relay-only policy, nothing can connect unless coturn allocates **over TLS
on 443** and forwards every packet — so frames arriving proves the TCP/443
path end to end, with a credential Django minted. That is the transport that
survives a network dropping UDP, and it is the reason the connection rate does
not quietly sit near 70%.

Reaching that row needs a certificate the browser trusts. See
`infra/coturn/turnserver.conf` — and note both traps recorded there: issue the
certificate from the same shell that ran `mkcert -install`, and restart the
browser afterwards, because a running one has already cached the root store.

---

## Running what actually deploys

The three processes above are the development arrangement: backing services in
Docker, application code on the host with hot reload. Each service also has a
Dockerfile, and a second compose file brings all of them up together:

```bash
cd infra && docker compose -f docker-compose.yml -f docker-compose.app.yml up --build
```

Six application containers — `api`, `migrate`, `worker`, `beat`, `realtime`,
`web` — against the same Postgres, Redis and MinIO. The API and the worker
share one image and differ only in their command, because they share models
and settings; a second Dockerfile for the worker would be a copy waiting to
drift. Stop the host dev servers first: they hold 3000, 4000 and 8000.

It runs with `DJANGO_DEBUG=1` and the development secrets, and that is not
laziness. **With DEBUG off, the settings module refuses to boot if any signing
key still holds its development default**, if `DJANGO_ALLOWED_HOSTS` is still
localhost, or if `EMAIL_BACKEND` is still the console — see the "Production
posture" section at the end of `apps/api/config/settings.py`. A leaked
`SECRET_KEY` is not a degraded mode: anyone holding it can mint a session, a
realtime ticket or a TURN credential, so the failure is loud and at startup
rather than a warning nobody reads.

```bash
cd apps/api && DJANGO_DEBUG=0 uv run manage.py check --deploy
```

Two things worth knowing before deploying this anywhere:

- **`API_ORIGIN` is a build argument for the web image, not an environment
  variable.** Next evaluates `rewrites()` during the build and writes the
  result into `routes-manifest.json`, so setting it at runtime does nothing —
  visibly nothing: the container starts, pages render, and every `/api/*`
  request 500s with `ECONNREFUSED 127.0.0.1:8000`. It defaults to
  `http://api:8000`, so naming the Django service `api` needs no rebuild.
- **MinIO has two addresses and both are needed.** `S3_ENDPOINT_URL` is how
  Django reaches it across the network; `S3_PUBLIC_BASE_URL` is what goes into
  the URLs handed to a browser. Set only the first and the health check reads
  `degraded`, because inside a container `localhost:9000` is the container.

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

Counters are **at-most-once plus reconciliation**, which is worth knowing
before reading a count as a bug. `counters.adjust` is enqueued with
`transaction.on_commit` and never retried: `increment` is not idempotent, so a
retry policy would trade a missed increment for a double-counted one, and a
like that shows twice is worse than one that shows a minute late. A count that
looks wrong while no worker is running is not wrong — the message is waiting in
Redis and applies as soon as one starts.

Genuine drift is repaired by `counters.reconcile`, which walks a slice every
ten minutes and wraps. To repair something now rather than within ten minutes:

```bash
cd apps/api && uv run manage.py recount --user seed000
```

```bash
cd apps/api && uv run manage.py recount --all
```

It prints only what was actually wrong, and `--all` is the one place in this
codebase where `COUNT(*)` at scale is allowed — rule 9 is about what renders a
page, not about what an operator runs to fix one.

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
