# Agent Brief — Aperture

> Paste this as your opening message to Claude Code, with `01-ARCHITECTURE.md` and `02-DESIGN-SYSTEM.md` in the repo root.

---

You are building **Aperture**, a photo and video social platform. Web only — there is no mobile app in scope.

Two specs sit in the repo root. Read both fully before writing anything.

- `01-ARCHITECTURE.md` — stack, schema, data flow, scaling path
- `02-DESIGN-SYSTEM.md` — color, type, layout, motion

They are the source of truth. Where this brief and a spec disagree, tell me — don't silently pick one.

## How we work

**Phase by phase, with a review gate between each.** You will complete one phase, run its verification, write a short handoff note, and then **stop and wait for me**. Do not start the next phase. Do not "get a head start on" the next phase. The gate is the point.

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

1. **Verify versions before installing.** Run `npm view <pkg> version` for every major dependency. The spec lists August 2026 versions; take what's actually current and tell me if it drifted by a major. Never invent a version number.
2. **TypeScript strict, no `any`, no non-null assertions.** If types get hard, that's information about the design — surface it, don't suppress it.
3. **`packages/core` imports no framework.** Pure functions, unit-testable in milliseconds.
4. **Every read path that returns user content filters blocks.** Feed, search, comments, DMs, notifications, profile. From Phase 3 onward this is non-negotiable and I will check it.
5. **No `COUNT(*)` on a request path.** Counters table plus Redis.
6. **No secrets in code.** `.env.local`, with `.env.example` committed and complete.
7. **Tests alongside the code, not after.** Vitest for `core` and `db`, Playwright for the two or three flows that would embarrass us if they broke.
8. **When you're unsure, ask.** One good question beats a thousand lines built on a wrong assumption. Ask before the phase, not after.
9. **Installed skills are advisory.** Where a skill's guidance conflicts with `01-ARCHITECTURE.md` or `02-DESIGN-SYSTEM.md`, the specs win. Note the conflict in your handoff under Decisions and continue — do not stop to ask, and do not quietly follow the skill.

## Design discipline

The design spec is deliberately opinionated and its choices are load-bearing. Specifically:

- **Feed posts have no card.** Hairline rule between posts, image directly on the base. Do not add a border, radius above 2px, or shadow. If you find yourself reaching for a card, re-read the reasoning.
- **One signature motion — the develop-in.** No scroll reveals in the feed, no stagger animations on grids, no parallax, no particle effects on the like button. Motion budget is spent; everything else is functional and under 200ms.
- **Warm is you, cool is live.** Safelight and daylight never appear in the same component.
- **Accents at small scale only.** Rings, icon fills, 1px underlines. No large filled accent blocks.

If a phase tempts you to add a visual flourish not in the spec, don't. Put it in the handoff note under Decisions and I'll rule on it.

---

## Phases

### Phase 0 — Environment and skills

Install the skills below via the `skills` CLI (`npx skills add <owner/repo>`; the skills.sh page for each one shows the exact command if you need to scope to a single skill rather than the whole repo).

**Framework and UI**

| Skill | Repo | Why |
|---|---|---|
| `shadcn` | `shadcn/ui` | Phase 2 installs shadcn on Base UI defaults. Keeps you on the current registry, not 2024 Radix patterns. |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | Next.js 16, React 19, React Compiler. |
| `vercel-composition-patterns` | `vercel-labs/agent-skills` | Server/client boundaries — where Next.js codebases rot. |
| `frontend-design` | `anthropics/skills` | Design *process*, not a look. Compatible with our locked spec. |
| `emil-design-eng` | `emilkowalski/skills` | Motion and micro-interactions. Owns the develop-in and the like spring. |

**Process**

| Skill | Repo | Why |
|---|---|---|
| `writing-plans` | `obra/superpowers` | Phase planning before execution. |
| `executing-plans` | `obra/superpowers` | Keeps you inside the plan you wrote. |
| `verification-before-completion` | `obra/superpowers` | **Run the verification, don't assert it.** This one is load-bearing for our gate model. |
| `domain-modeling` | `mattpocock/skills` | `packages/core` and the schema. |
| `diagnosing-bugs` | `mattpocock/skills` | — |
| `git-guardrails-claude-code` | `mattpocock/skills` | — |

**Testing**

| Skill | Repo | Why |
|---|---|---|
| `webapp-testing` | `anthropics/skills` | — |
| `playwright-cli` | `microsoft/playwright-cli` | — |
| `agent-browser` | `vercel-labs/agent-browser` | Real browser with React introspection. This is how you *see* whether the develop-in is right instead of guessing. |

**Do not install** any additional design-taste skill — not `taste-skill`, `ui-ux-pro-max`, `anti-ui-slop`, `high-end-visual-design`, or `impeccable`. Those skills supply aesthetic direction where none exists. Ours is locked in `02-DESIGN-SYSTEM.md`, and loading a second opinion produces exactly the drift I'm trying to prevent. If you think one of them would help, say so in the handoff; don't install it.

Also skip anything for Prisma, Supabase, Firebase, or Azure — wrong stack.

**Known gap:** there is no strong Drizzle or BetterAuth skill in the directory. Those are the two libraries where your training data is most likely stale. Before Phase 1, fetch the current Drizzle and BetterAuth docs and save the relevant pages into `docs/vendor/` in the repo, then work from those rather than memory.

**Verify:** list the installed skills and confirm each resolves. Report anything that failed to install or that you judged unnecessary, and why.

### Phase 1 — Foundation
Turborepo + pnpm workspace, the four apps and four packages from the spec's layout. `docker-compose.yml` with all six services. Drizzle schema for every table in the spec including indexes, migrations generated and applied. BetterAuth with email/password and session handling. Health check route that verifies Postgres, Redis, and MinIO connectivity. `.env.example`. A README with exact setup steps.

**Verify:** `docker compose up` then `pnpm dev` on a clean clone, `/api/health` returns all-green, `pnpm db:studio` shows every table.

### Phase 2 — Design system
`packages/ui`: the `@theme` block, the three fonts via `next/font`, the grain overlay, the `meta` type role. Install shadcn on Base UI and override Button, Input, Avatar, Dialog, Skeleton per the spec. Build the develop-in image component (blurhash canvas → real image) and the ambient glow. Ship a `/kitchen-sink` route showing every primitive in every state.

**Verify:** `/kitchen-sink` renders, keyboard focus visible everywhere, reduced-motion honored, contrast checked and reported.

### Phase 3 — Media
Presigned upload intent → direct browser PUT → complete → BullMQ job. Worker: ffprobe validation, sharp derivatives, blurhash, dominant color, state transition. WS-free polling is fine here; realtime comes in Phase 6. Composer UI with drag-drop, crop, and alt text field.

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
Redis feed cache, then hybrid push fanout with the celebrity threshold. Do not start this phase without instrumentation data showing it's needed.

---

Start with Phase 0. If anything in the specs is ambiguous, ask now.
