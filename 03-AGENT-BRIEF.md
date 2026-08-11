# Agent Brief — Aperture

**Aperture** is a photo and video social platform. Web only — there is no mobile app in scope.

Three documents govern the work:

- `01-ARCHITECTURE.md` — stack, schema, data flow, scaling path
- `02-DESIGN-SYSTEM.md` — color, type, layout, motion
- `docs/VERSIONS.md` — the pinned versions and this machine's quirks

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

1. **Pinned versions live in `docs/VERSIONS.md`.** Anything not listed there gets verified against the registry before install. Never invent a version number.
2. **TypeScript strict, no `any`, no non-null assertions.** If types get hard, that's information about the design — surface it, don't suppress it.
3. **`packages/core` imports no framework.** Pure functions, unit-testable in milliseconds.
4. **Every read path that returns user content filters blocks.** Feed, search, comments, DMs, notifications, profile. From Phase 3 onward this is non-negotiable and I will check it.
5. **No `COUNT(*)` on a request path.** Counters table plus Redis.
6. **No secrets in code.** `.env.local`, with `.env.example` committed and complete.
7. **Tests alongside the code, not after.** Vitest for `core` and `db`. User flows are verified in the browser (see below).
8. **When you're unsure, ask.** One good question beats a thousand lines built on a wrong assumption. Ask before the phase, not after.
9. **Skills are advisory.** Where a skill conflicts with `01-ARCHITECTURE.md` or `02-DESIGN-SYSTEM.md`, the specs win. Note the conflict in the handoff under Decisions and continue — do not stop to ask, and do not quietly follow the skill.

## Testing

**Vitest** for `packages/core` and `packages/db` — the pure logic and the queries. These run in CI and they are the regression net.

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

Also ignore anything for Django, Prisma, Supabase, Firebase, or Azure — wrong stack.

---

## Phases

### Phase 1 — Foundation
Turborepo + pnpm workspace, the apps and packages from the spec's layout. `docker-compose.yml` with all six services. Drizzle schema for every table in the spec including indexes, migrations generated and applied. BetterAuth with email/password and session handling. Health check route that verifies Postgres, Redis, and MinIO connectivity. `.env.example`. A README with exact setup steps.

**Verify:** `docker compose up` then `pnpm dev` on a clean clone, `/api/health` returns all-green, `pnpm db:studio` shows every table.

### Phase 2 — Design system
`packages/ui`: the `@theme` block, the three fonts via `next/font`, the grain overlay, the `meta` type role. Install shadcn on Base UI and override Button, Input, Avatar, Dialog, Skeleton per the spec. Build the develop-in image component (blurhash canvas → real image) and the ambient glow. Ship a `/kitchen-sink` route showing every primitive in every state.

**Verify:** `/kitchen-sink` renders, keyboard focus visible everywhere, reduced-motion honored, contrast checked and reported.

### Phase 3 — Media
Presigned upload intent → direct browser PUT → complete → BullMQ job. Worker: ffprobe validation, sharp derivatives, blurhash, dominant color, state transition. Polling is fine here; realtime comes in Phase 6. Composer UI with drag-drop, crop, and alt text field.

**Verify:** upload a 12MB JPEG and a 30s MP4, both reach `state=ready`, derivatives exist in MinIO, blurhash renders before the full image.

### Phase 4 — Core social
Post creation, profile contact sheet, pull feed with cursor pagination and block filtering, like, comment, follow with pending state for private accounts. Counters updated by worker, cached in Redis.

**Verify:** seed 50 users and 500 posts; feed p95 under 100ms at that size; blocking a user removes them from feed, search, and comments in the same request.

### Phase 5 — Safety
Report queue and admin view. Rate limits (Redis token bucket) on upload, follow, comment. Soft delete everywhere plus the scheduled hard-delete job. Block enforcement audit — walk every query and confirm.

**Verify:** rate limits return 429 at the threshold, reported content appears in the admin queue, deleted account's content disappears from all read paths.

### Phase 6 — Realtime chat
`apps/realtime` WebSocket service, Redis pub/sub fanout. Server-allocated `seq` in the same transaction as insert. `client_id` idempotency. Cursor-based reconnect sync. Read receipts, typing indicators, presence. Use shadcn's chat primitives where they fit.

**Verify:** send from two browsers, kill one's network mid-conversation, reconnect — no duplicates, no gaps, correct order. Send the same `client_id` twice, get one message.

### Phase 7 — Calls
LiveKit rooms, token minting. 1:1 P2P with TURN fallback, then group via SFU. Signaling over the existing WS connection. coturn configured with TLS on 443.

**Verify:** force `iceTransportPolicy: 'relay'` and confirm the call still connects — that's the TCP/443 path, and it's the one that matters.

### Phase 8 — Scale (only on my word)
Redis feed cache, then hybrid push fanout with the celebrity threshold. Do not start without instrumentation data showing it's needed.
