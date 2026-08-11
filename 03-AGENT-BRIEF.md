# Agent Brief — Aperture

**Aperture** is a photo and video social platform. Web only — there is no mobile app in scope.

**Django backend, Next.js frontend.** Two deployables, one repo.

Three documents govern the work:

- `01-ARCHITECTURE.md` — stack, type boundary, schema, data flow, scaling path
- `02-DESIGN-SYSTEM.md` — color, type, layout, motion
- `docs/VERSIONS.md` — pinned versions for both ecosystems, and this machine's quirks

They are the source of truth. Where this brief and a spec disagree, **tell me** — don't silently pick one.

## How we work

**Phase by phase, with a review gate between each.** Complete one phase, run its verification, write a short handoff note, then **stop and wait for me**. Do not start the next phase. Do not get a head start on the next phase. The gate is the point.

Each phase ends with a note in this shape:

```
PHASE N COMPLETE

Built:        what exists now that didn't before
Decisions:    anything I chose that the spec left open, and why
Deviations:   anything I did differently from the spec, and why
Verification: commands you can run + what you should see
Risks:        what I'm least confident about
Next:         what Phase N+1 will touch
```

Then stop.

## Standing rules

1. **Pinned versions live in `docs/VERSIONS.md`.** Anything not listed gets verified against PyPI or npm before install. Never invent a version number.
2. **Both languages are strict.** TypeScript: strict, no `any`, no non-null assertions. Python: full type hints, `mypy` strict with `django-stubs`, `ruff` clean. If types get hard, that's information about the design — surface it, don't suppress it.
3. **`apps/api/core/` imports no Django.** Pure Python, unit-testable in milliseconds without a database.
4. **`packages/api-client` is generated, never hand-edited.** A serializer change means regenerating it in the same commit. CI fails on drift. This is the seam the Django choice costs us — it is not optional bookkeeping.
5. **Every read path that returns user content filters blocks.** Feed, search, comments, DMs, notifications, profile. One reusable queryset method, not forty ad-hoc filters. From Phase 3 onward this is non-negotiable and I will check it.
6. **No `.count()` or `COUNT(*)` on a request path.** Counters table plus Redis.
7. **Read the SQL the ORM generates.** `.explain()` the feed query and anything on a hot path. The N+1 the ORM hides is the most common way a Django app gets slow.
8. **No secrets in code.** `.env.local`, with `.env.example` committed and complete.
9. **Tests alongside the code, not after.** pytest-django for the backend, Vitest for frontend logic. User flows are walked in the browser (see below).
10. **When you're unsure, ask.** One good question beats a thousand lines built on a wrong assumption. Ask before the phase, not after.
11. **Skills are advisory.** Where a skill conflicts with `01-ARCHITECTURE.md` or `02-DESIGN-SYSTEM.md`, the specs win. Note the conflict in the handoff under Decisions and continue — do not stop to ask, and do not quietly follow the skill.

## Testing

**pytest-django** for the backend and **Vitest** for frontend logic. These run in CI and they are the regression net.

**Flows are verified in a real browser through your Chrome access**, not Playwright. Walk the flow, look at it, report what you saw. This is also how you check the *design* — whether the develop-in actually reads like a print coming up, whether the contact sheet gutters are right — which a headless assertion could never tell you.

Consequence to keep in mind: there is no automated regression test on user flows. A break in signup, upload, or send will not be caught by CI — only by someone walking it. Re-walk the critical flows at each phase gate rather than assuming earlier phases still work.

Do not install or use Playwright, `playwright-cli`, or `webapp-testing`.

## Design discipline

The design spec is deliberately opinionated and its choices are load-bearing:

- **Feed posts have no card.** Hairline rule between posts, image directly on the base. No border, no radius above 2px, no shadow. If you find yourself reaching for a card, re-read the reasoning.
- **One signature motion — the develop-in.** No scroll reveals in the feed, no stagger on grids, no parallax, no particle effects on the like button. The motion budget is spent; everything else is functional and under 200ms.
- **Warm is you, cool is live.** Safelight and daylight never appear in the same component.
- **Accents at small scale only.** Rings, icon fills, 1px underlines. No large filled accent blocks.

If a phase tempts you to add a visual flourish not in the spec, don't. Put it in the handoff under Decisions and I'll rule on it.

**Do not consult design-taste skills** — `taste-skill`, `impeccable`, `redesign-skill`, or similar. They supply aesthetic direction where none is missing; ours is locked in `02-DESIGN-SYSTEM.md` and a second opinion produces exactly the drift I'm preventing. If you think one would help, say so in the handoff.

**Django admin is a tool, not a design surface.** It runs the moderation console and nothing user-facing. Don't spend design effort on it, and don't let its conventions leak into the product UI.

Ignore anything for Prisma, Supabase, Firebase, or Azure — wrong stack.

---

## Phases

### Phase 1 — Foundation
uv workspace with the Django project and its apps; pnpm workspace with `apps/web`, `packages/ui`, `packages/api-client`; Turborepo over both. `docker-compose.yml` with all six services. Django models for every table in the spec including indexes and constraints, migrations generated and applied. Django auth with email/password and session cookies. Next.js rewrite of `/api/*` to Django so the session cookie is same-origin. **The full OpenAPI → TypeScript client pipeline, wired and running in CI.** Health check endpoint verifying Postgres, Redis, and MinIO. `.env.example`. A README with exact setup steps for both ecosystems.

**Verify:** `docker compose up`, then the API, worker, and web processes start on a clean clone. `/api/health` returns all-green. `manage.py showmigrations` is fully applied. Changing a serializer field and regenerating produces a diff in `packages/api-client` — demonstrate this, it is the phase's most important outcome.

### Phase 2 — Design system
Frontend only. `packages/ui`: the `@theme` block, the three fonts via `next/font`, the grain overlay, the `meta` type role. Install shadcn on Base UI and override Button, Input, Avatar, Dialog, Skeleton per the spec. Build the develop-in image component (blurhash canvas → real image) and the ambient glow. Ship a `/kitchen-sink` route showing every primitive in every state.

**Verify:** `/kitchen-sink` renders, keyboard focus visible everywhere, reduced-motion honored, contrast checked and reported.

### Phase 3 — Media
Presigned upload intent → direct browser PUT → complete → Celery task. Worker: ffprobe and `python-magic` validation, Pillow derivatives, blurhash, dominant color, state transition. Polling is fine here; realtime comes in Phase 6. Composer UI with drag-drop, crop, and alt text field.

**Verify:** upload a 12MB JPEG and a 30s MP4, both reach `state=ready`, derivatives exist in MinIO, blurhash renders before the full image. Confirm a file whose real type contradicts its declared MIME is rejected.

### Phase 4 — Core social
Post creation, profile contact sheet, pull feed with cursor pagination and block filtering, like, comment, follow with pending state for private accounts. Counters updated by Celery, cached in Redis.

**Verify:** seed 50 users and 500 posts; feed p95 under 100ms at that size; `.explain()` output for the feed query included in the handoff; blocking a user removes them from feed, search, and comments in the same request.

### Phase 5 — Safety
Report queue and admin view **built on Django admin** — this is where the stack choice pays. Rate limits (Redis token bucket in `core/`) on upload, follow, comment. Soft delete everywhere plus the scheduled hard-delete job via django-celery-beat. Block enforcement audit — walk every queryset and confirm.

**Verify:** rate limits return 429 at the threshold, reported content appears in the admin queue, deleted account's content disappears from all read paths.

### Phase 6 — Realtime chat
Channels consumers over ASGI, `channels-redis` group fanout. Server-allocated `seq` in the same transaction as insert. `client_id` idempotency via the unique constraint. Cursor-based reconnect sync. Read receipts, typing indicators, presence. Use shadcn's chat primitives where they fit.

**Verify:** send from two browsers, kill one's network mid-conversation, reconnect — no duplicates, no gaps, correct order. Send the same `client_id` twice, get one message. Confirm every ORM call inside a consumer is wrapped for async.

### Phase 7 — Calls
LiveKit rooms, tokens minted server-side with `livekit-api`. 1:1 P2P with TURN fallback, then group via SFU. Signaling over the existing Channels connection. coturn configured with TLS on 443.

**Verify:** force `iceTransportPolicy: 'relay'` and confirm the call still connects — that's the TCP/443 path, and it's the one that matters.

### Phase 8 — Scale (only on my word)
Redis feed cache, then hybrid push fanout with the celebrity threshold. Do not start without instrumentation data showing it's needed.
