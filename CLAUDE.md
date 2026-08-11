# Aperture — working agreement

A photo and video social platform. **Web only.** No mobile app is in scope.

**Django owns the data and the API. Node owns the sockets. Next.js owns the UI.**
Three deployables, one repo. Ruled 2026-08-11.

## Sources of truth

| File | Owns |
|---|---|
| `01-ARCHITECTURE.md` | stack, schema, data flow, scaling path |
| `02-DESIGN-SYSTEM.md` | color, type, layout, motion |
| `03-AGENT-BRIEF.md` | process, phases, standing rules |
| `docs/VERSIONS.md` | the pinned, registry-verified versions for both ecosystems, plus this machine's quirks |
| `docs/vendor/` | fetched library docs — currently django-unfold. Work from these, not from memory. |

Where the brief and a spec disagree, **say so** — do not silently pick one.

## Process — phase gates

One phase at a time. Complete it, run its verification, write the handoff note, then **stop and wait**.
Do not start the next phase. Do not get a head start on the next phase. The gate is the point.

Handoff note shape:

```
PHASE N COMPLETE

Built:        what exists now that didn't before
Decisions:    anything I chose that the spec left open, and why
Deviations:   anything I did differently from the spec, and why
Verification: commands you can run + what you should see
Risks:        what I'm least confident about
Next:         what Phase N+1 will touch
```

## Standing rules

1. **Scaffold with official CLIs, never by hand.** `create-turbo`, `django-admin startproject`, `manage.py startapp`, `create-next-app`, `shadcn init`. Dependencies go in via `uv add` / `pnpm add` — never by hand-editing `pyproject.toml` or `package.json`. Delete generated demo routes and placeholder assets in the same commit that creates them.
2. **Structure is uniform, not improvised.** Every Django app has the same eight files; reads in `selectors.py`, writes in `services.py`, thin views, dumb models. Frontend features in `apps/web/features/`; `packages/ui` holds nothing that knows what a post is. `01-ARCHITECTURE.md` §2 is the spec.
3. **Verify versions before installing.** `docs/VERSIONS.md` holds verified pins for both ecosystems. Re-check anything not listed there. Never invent a version number.
4. **Both languages are strict.** TypeScript: strict, no `any`, no non-null assertions. Python: full type hints, `mypy` strict with `django-stubs`, `ruff` clean. If types get hard that is information about the design — surface it, don't suppress it.
5. **`apps/api/core/` imports no Django.** Pure Python, unit-testable in milliseconds without a database. If a module there needs `django.`, it belongs in an app instead.
6. **`apps/realtime` never touches Postgres.** No ORM, no database driver, no business logic — it authenticates a socket, subscribes it to Redis, pushes bytes. A database dependency appearing in its `package.json` means something went wrong.
7. **`packages/api-client` is generated, never hand-edited.** A serializer change means regenerating in the same commit; CI fails on drift. This seam is what the Django choice costs — treat it as load-bearing, not bookkeeping.
8. **Every read path returning user content filters blocks.** It lives in the base selector, not in forty views. Non-negotiable from Phase 3 on, and it will be checked.
9. **No `.count()` / `COUNT(*)` on a request path.** `counters` table plus Redis.
10. **Read the SQL the ORM generates.** `.explain()` the feed query and anything hot. The N+1 the ORM hides is the most common way a Django app gets slow.
11. **Publish after commit, never inside the transaction.** A rollback that already delivered a socket event has announced a message that doesn't exist.
12. **No secrets in code.** `.env.local` local-only; `.env.example` committed and complete. `REALTIME_TICKET_SECRET` is shared by Django and the gateway and lives only in the environment.
13. **Tests alongside the code, not after.** pytest-django for the backend, Vitest for the gateway and frontend logic. User flows are walked in a real browser via Chrome access — **no Playwright**. There is therefore no automated regression net on flows: re-walk the critical ones at every phase gate instead of assuming earlier phases still work.
14. **Commits are small and phase-scoped.** One concern per commit, present-tense subject, no `git add -A` sweeps of generated noise. A phase is a readable series of commits, not one dump.
15. **When unsure, ask** — before the phase, not after.
16. **Skills are advisory.** Where a skill conflicts with `01-ARCHITECTURE.md` or `02-DESIGN-SYSTEM.md`, **the specs win.** Note the conflict under Decisions and continue — do not stop to ask, do not quietly follow the skill.

### Skills: do not consult

Several skills are installed globally on this machine and cannot be uninstalled per-project.
**The rule is to not load them.** If one seems like it would genuinely help, say so in the handoff
instead of using it.

| Skill | Why not |
|---|---|
| `taste-skill`, `impeccable`, `redesign-skill`, `frontend-design`'s aesthetic direction | Supply aesthetic direction where none is missing. Ours is locked in `02-DESIGN-SYSTEM.md`; a second opinion is exactly the drift the brief prevents. |
| `playwright-cli`, `webapp-testing` | We verify flows through Chrome access, not Playwright. |
| `gsap-*` | Motion is the animation library. GSAP is not in the stack. |
| Anything for Prisma, Supabase, Firebase, Azure | Wrong stack. |

**`django-expert` is allowed** — it matches the stack. Rule 11 still applies: where it disagrees
with the specs, the specs win.

### Who owns what

| Service | Owns | Never does |
|---|---|---|
| `apps/api` (Django) | data, API, queue, auth, admin, ticket minting, LiveKit tokens | hold sockets |
| `apps/realtime` (Node) | socket connections, Redis fanout, ephemeral events | touch Postgres, hold business logic |
| `apps/web` (Next.js) | UI | act as a second backend |

Next.js is not a backend. Don't add route handlers that talk to Postgres, don't add server actions
that duplicate a DRF endpoint. The `/api/*` rewrite to Django exists so the session cookie stays
same-origin — that rewrite is the only integration point.

**Event routing:** if it must survive a restart, it goes over HTTP to Django, which publishes to
Redis after commit and lets the gateway deliver it. If it doesn't — typing, presence, call
signaling — it stays in Node and never reaches Postgres.

**Types cross the seam generated only:** DRF serializers → drf-spectacular → openapi-typescript →
`packages/api-client`. Socket payloads reuse the same serializers, so they're already typed.
Ephemeral events are Node↔browser, both TypeScript, with shared Zod schemas in
`packages/realtime-events`. Never hand-write a TypeScript interface that restates a Django
serializer. See `01-ARCHITECTURE.md` §3.

## Design discipline — load-bearing, not preference

- **Feed posts have no card.** Hairline rule between posts, image directly on the base. No border, no radius above 2px, no shadow. Reaching for a card means re-reading the reasoning.
- **One signature motion — the develop-in.** No scroll reveals in the feed. No stagger on grids. No parallax. No particle burst on like. The motion budget is spent; everything else is functional and under 200ms.
- **Warm is you, cool is live.** Safelight and daylight never appear in the same component.
- **Accents at small scale only.** Rings, icon fills, 1px underlines. No large filled accent blocks, nothing accent-filled above 40px tall.
- **Grain at 2.5%.** Not 4%. Ship it and leave it alone.

A flourish not in the spec goes in the handoff under Decisions, not in the code.

**Django admin is a tool, not a design surface.** It runs the moderation console and nothing
user-facing. Don't spend design effort on it, and don't let its conventions leak into the product UI.

## Non-negotiable from day one

- **Moderation** — CSAM scanning, NCMEC path, report queue, upload rate limits. The report button ships before stories.
- **Blocking** — enforced at the query layer in every read path.
- **Deletion** — soft delete everywhere plus a scheduled hard delete.
- **Rate limits** — Redis token bucket, per-user and per-IP, on upload / follow / comment / message.

## Environment notes for this machine

Full detail in `docs/VERSIONS.md`. The four that will bite:

- **Python is 3.13.12 via `uv`, not the system 3.14.7.** Celery has no 3.14 support. `uv` is the
  Python package manager — pip, poetry and pipx are not on PATH and are not needed.
- **`pnpm` is the JS package manager** — not npm. (npm works again as of 2026-08-11; two corrupt
  cache junctions were repaired. See `docs/VERSIONS.md` if directory creation under
  `%LOCALAPPDATA%` ever starts returning `EEXIST` for names that don't exist.)
- **Postgres is on host port 5433, not 5432.** A native `postgresql-x64-17` service holds 5432.
  Compose binds `5433:5432`; `DATABASE_URL` uses 5433. Inside the compose network it's still
  `postgres:5432`. Record this as a Deviation in the Phase 1 handoff.
- **Docker Desktop must be started manually** before `docker compose up`. It does not auto-start.
- Windows 11. PowerShell is primary; a Git Bash tool is also available. Node 24.19.0 is managed by
  pnpm and lives at `%LOCALAPPDATA%\pnpm\node.exe`.
