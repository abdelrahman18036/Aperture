# Vendored vendor docs

Snapshots of third-party documentation, fetched **2026-08-11**.

`03-AGENT-BRIEF.md` (Phase 0, "Known gap") calls for this: Drizzle and BetterAuth are the two
libraries where model training data is most likely stale, so we work from these files rather than
from memory. Everything here is a verbatim upstream snapshot — do not hand-edit. To refresh, re-run
the fetch commands below.

---

## better-auth/

**Version documented:** BetterAuth 1.6.26 (npm `latest`, matches `02`/`01` spec's "1.x").

25 pages, fetched from the site's own markdown endpoints:

```bash
base="https://www.better-auth.com/llms.txt/docs"
curl -sL "$base/<page>.md" -o "better-auth/<page with / → _>.md"
```

Index of all available pages: <https://www.better-auth.com/llms.txt>

### Two things already known to be stale in training data

1. **The Drizzle adapter is now its own package.** `@better-auth/drizzle-adapter` (1.6.26), not
   `better-auth/adapters/drizzle`. See `adapters_drizzle.md`.
2. **Usernames are a plugin.** `plugins_username.md` — relevant because `01-ARCHITECTURE.md`
   specifies `users.username` as a `citext unique` column. How the plugin's storage lines up with
   our own `users` table is an open Phase 1 question.

---

## drizzle/

**⚠️ Version mismatch — read this before using these files.**

| | Version |
|---|---|
| `01-ARCHITECTURE.md` says | `drizzle-orm` / `drizzle-kit` **0.4x** |
| npm `latest` (2026-08-11) | `drizzle-orm` **0.45.2**, `drizzle-kit` **0.31.10** |
| npm `rc` | both **1.0.0-rc.5** |
| **These docs document** | **1.0.0-rc (v1)** |

<https://orm.drizzle.team> has moved entirely to v1. Every page installs `drizzle-orm@rc`, the
relations API is `defineRelations` (relations **v2**), and the migrations folder layout changed
(no `journal.json`, per-migration folders). There is no longer a published v0 doc set — the old
non-namespaced URLs (`/docs/rqb`) now serve the v1 page, and the docs repo's `main` is v1-shaped.

**So:** if we pin stable 0.45.2 per the spec, the following pages here describe an API we are *not*
using and must not be copied from:

- `pg__relations.md`, `pg__relations-schema-declaration.md`, `pg__relations-v1-v2.md`, `pg__rqb.md`
  — v2 relations (`defineRelations`), not 0.45's `relations()`
- `pg__migrations.md`, `pg__kit-overview.md`, `pg__drizzle-kit-*.md` — v1 migration folder layout
- `pg__upgrade-v1.md`, `pg__v0-v1-changes.md` — the diff itself; useful as a *what changed* map

Still accurate for 0.45.x (schema-level, largely unchanged v0→v1):
`pg__sql-schema-declaration.md`, `pg__column-types.md`, `pg__indexes-constraints.md`,
`pg__select.md` / `insert` / `update` / `delete` / `joins` / `operators` / `sql` /
`transactions` / `perf-queries` / `views` / `schemas` / `sequences` / `generated-columns` /
`set-operations` / `dynamic-query-building` / `read-replicas` / `custom-types` / `gotchas`.

Under a 0.45.2 pin, the authority for anything relations- or migration-shaped is the package's own
`.d.ts` types and the `drizzle-orm` repo at tag `0.45.2` — not these files.

Fetched by slicing the site's full-text bundle on its `Source:` markers, keeping the `pg/*` namespace
plus the dialect-agnostic pages, then dropping non-Postgres drivers and the non-Zod validators:

```bash
curl -sL https://orm.drizzle.team/llms-full.txt -o drizzle-llms-full.txt
# split on lines matching ^Source: https://orm.drizzle.team/docs/<slug>
```

Index: <https://orm.drizzle.team/llms.txt>
