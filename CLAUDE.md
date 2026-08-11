# Aperture — working agreement

A photo and video social platform. **Web only.** No mobile app is in scope.

## Sources of truth

| File | Owns |
|---|---|
| `01-ARCHITECTURE.md` | stack, schema, data flow, scaling path |
| `02-DESIGN-SYSTEM.md` | color, type, layout, motion |
| `03-AGENT-BRIEF.md` | process, phases, standing rules |
| `docs/VERSIONS.md` | the pinned, registry-verified versions — use these, not the Aug-2026 numbers in the architecture doc |
| `docs/vendor/` | Drizzle + BetterAuth docs, fetched. Work from these, not from memory. |

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

1. **Verify versions before installing.** `docs/VERSIONS.md` holds verified pins. Re-check anything not listed there. Never invent a version number.
2. **TypeScript strict. No `any`. No non-null assertions.** If types get hard that is information about the design — surface it, don't suppress it.
3. **`packages/core` imports no framework.** Pure functions, unit-testable in milliseconds.
4. **Every read path returning user content filters blocks.** Feed, search, comments, DMs, notifications, profile. Non-negotiable from Phase 3 on, and it will be checked.
5. **No `COUNT(*)` on a request path.** `counters` table plus Redis.
6. **No secrets in code.** `.env.local` local-only; `.env.example` committed and complete.
7. **Tests alongside the code, not after.** Vitest for `core` and `db`; Playwright for the two or three flows that would embarrass us if they broke.
8. **When unsure, ask** — before the phase, not after.
9. **Skills are advisory.** Where a skill conflicts with `01-ARCHITECTURE.md` or `02-DESIGN-SYSTEM.md`, **the specs win.** Note the conflict under Decisions and continue — do not stop to ask, do not quietly follow the skill.

### Skills: do not consult

`taste-skill`, `impeccable`, `redesign-skill`, `frontend-design`'s aesthetic direction, or any other
design-taste skill. They supply aesthetic direction where none is missing — ours is locked in
`02-DESIGN-SYSTEM.md`, and a second opinion produces exactly the drift the brief is preventing.
These are installed globally on this machine and cannot be uninstalled per-project; **the rule is
to not load them.** If one seems like it would help, say so in the handoff instead.

Also ignore anything for Prisma, Supabase, Firebase, Azure, or GSAP — wrong stack.

## Design discipline — load-bearing, not preference

- **Feed posts have no card.** Hairline rule between posts, image directly on the base. No border, no radius above 2px, no shadow. Reaching for a card means re-reading the reasoning.
- **One signature motion — the develop-in.** No scroll reveals in the feed. No stagger on grids. No parallax. No particle burst on like. The motion budget is spent; everything else is functional and under 200ms.
- **Warm is you, cool is live.** Safelight and daylight never appear in the same component.
- **Accents at small scale only.** Rings, icon fills, 1px underlines. No large filled accent blocks, nothing accent-filled above 40px tall.
- **Grain at 2.5%.** Not 4%. Ship it and leave it alone.

A flourish not in the spec goes in the handoff under Decisions, not in the code.

## Non-negotiable from day one

- **Moderation** — CSAM scanning, NCMEC path, report queue, upload rate limits. The report button ships before stories.
- **Blocking** — enforced at the query layer in every read path.
- **Deletion** — soft delete everywhere plus a scheduled hard delete.
- **Rate limits** — Redis token bucket, per-user and per-IP, on upload / follow / comment / message.

## Environment notes for this machine

- Windows 11. Shell is PowerShell; a Git Bash tool is also available. Watch path separators in scripts.
- A native **PostgreSQL 17** service (`postgresql-x64-17`) holds port **5432**. See `docs/VERSIONS.md` for how the compose file resolves this.
- Docker Desktop is installed but must be started manually before `docker compose up`.
