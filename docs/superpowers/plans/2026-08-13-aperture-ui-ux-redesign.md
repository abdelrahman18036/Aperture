# Aperture UI/UX Redesign Implementation Plan

> **For agentic workers:** Execute task-by-task with independent ownership.
> Steps use checkbox syntax for tracking. Do not commit; the user did not ask
> for git history changes.

**Goal:** Replace Aperture's incumbent darkroom UI with the approved dual-theme
Creator Console world while improving navigation, feedback, responsive layout,
and every existing user flow without changing backend contracts.

**Architecture:** Establish semantic dual-theme tokens and reusable instrument
primitives first. Rebuild the authenticated shell around an adaptive media
stage and context bay, then migrate route families onto shared loading, empty,
error, status, field, and action patterns. Preserve data hooks and API calls;
the redesign changes presentation and client interaction structure only.

**Tech Stack:** Next.js 16.3, React 19.2, TypeScript 5.9, Tailwind CSS 4,
Base UI/shadcn primitives, Lucide, existing Django/OpenAPI client, Vitest.

## Global Constraints

- Approved dark comp: `apps/web/.impeccable/mocks/creator-console-a-media-stage.webp`.
- Required light counterpart: `creator-console-a-media-stage-light.webp`.
- Responsive range: 375px through wide desktop; no clipped 640–743px state.
- WCAG 2.2 AA, visible focus, 44px touch targets, reduced motion, safe areas.
- Preserve routes, backend contracts, privacy, moderation, and realtime flows.
- Safety orange is reserved for the primary commit action; amber means live/new.
- No new runtime dependency unless an existing implementation cannot satisfy a
  confirmed behavior.

---

### Task 1: Dual-theme foundation and shared UX primitives

**Files:**
- Modify: `packages/ui/src/theme.css`, `packages/ui/src/fonts.ts`, `packages/ui/src/index.ts`
- Modify: existing primitives under `packages/ui/src/primitives/`
- Create: `packages/ui/src/primitives/instrument-panel.tsx`
- Create: `packages/ui/src/primitives/surface-state.tsx`
- Create: `apps/web/src/features/theme/theme-control.tsx`
- Create: `apps/web/src/features/theme/theme-script.tsx`
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`

**Interfaces:**
- Produce `ThemeControl`, a three-state control for `system | light | dark`.
- Produce `InstrumentPanel` for engraved material regions.
- Produce `SurfaceState` with `loading | empty | error` variants and optional action.

- [ ] Define semantic light/dark chassis, key, ink, seam, orange commit, amber
      live, danger, success, focus, elevation, and safe-area tokens.
- [ ] Replace the incumbent display/font roles with an engineered but readable
      three-role type system; utility type remains limited to measured data.
- [ ] Implement pre-hydration theme resolution from local preference and
      `prefers-color-scheme`, then expose the accessible three-state control.
- [ ] Rework Button, Input, Dialog, TabBar, Skeleton, Spinner, and focus styles
      into the approved material and state grammar.
- [ ] Add reusable `InstrumentPanel` and `SurfaceState` primitives.
- [ ] Run `pnpm --filter @repo/ui lint && pnpm --filter @repo/ui check-types`.

### Task 2: Responsive application shell and navigation

**Files:**
- Modify: `apps/web/src/features/nav/app-shell.tsx`
- Modify: `apps/web/src/features/nav/nav-rail.tsx`
- Modify: `apps/web/src/app/(app)/layout.tsx`

**Interfaces:**
- Consume `ThemeControl` and the semantic tokens from Task 1.
- Produce stable `rail`, `stage`, and optional `context` regions for every route.

- [ ] Move the desktop rail breakpoint to a width where rail plus content fits;
      keep the main region fluid rather than clipping overflow.
- [ ] Replace the unused suggestions rail with a route-aware context bay and
      remove it where the route has no useful context.
- [ ] Keep parent destinations active for detail/thread routes.
- [ ] Give Requests a truthful mobile path and keep item positions stable while
      viewer data loads.
- [ ] Add safe-area padding to mobile navigation and call overlays.
- [ ] Put the orange Publish key and theme control in both shell variants.
- [ ] Verify keyboard order and accessible names at 375, 768, 1280, and 1600px.

### Task 3: Feed, post, explore, stories, and profile surfaces

**Files:**
- Modify: `apps/web/src/features/feed/feed.tsx`, `feed-post.tsx`, action controls
- Modify: `apps/web/src/features/stories/story-tray.tsx`, `story-viewer.tsx`
- Modify: `apps/web/src/features/explore/explore.tsx`, `post-tile.tsx`
- Modify: `apps/web/src/features/profile/profile.tsx`, `contact-sheet.tsx`, `user-avatar.tsx`
- Modify: `apps/web/src/features/post/post-detail.tsx`
- Modify: shared media components under `packages/ui/src/media/`

**Interfaces:**
- Consume the shell's media-stage/context-bay topology.
- Preserve `Post`, story, profile, and media data contracts unchanged.

- [ ] Recompose FeedPost so media dominates and context/actions read as one
      stable instrument bay on wide screens and an in-flow tray on mobile.
- [ ] Retain all like/comment/repost/share/report behavior and visible counts.
- [ ] Replace misleading failure-as-empty states with `SurfaceState` recovery.
- [ ] Restyle story, explore, profile, and detail views in the same material
      grammar without forcing all media into identical cards.
- [ ] Fix story modal focus trapping/restoration and visible overflow cues.
- [ ] Browser-check populated, empty, loading, error, private, and missing states.

### Task 4: Messaging and activity workspace

**Files:**
- Modify: messaging files under `apps/web/src/features/messaging/`
- Modify: `apps/web/src/app/(app)/messages/page.tsx`
- Modify: `apps/web/src/app/(app)/messages/[conversationId]/page.tsx`
- Modify: `apps/web/src/features/notifications/notifications.tsx`
- Modify: `apps/web/src/features/requests/requests.tsx`

**Interfaces:**
- Reuse `SurfaceState`, `InstrumentPanel`, and shell context regions.
- Preserve realtime event, message, read-receipt, attachment, and call contracts.

- [ ] Build a desktop master/detail messaging workspace while retaining direct
      conversation URLs and a single-pane mobile layout.
- [ ] Make connection, retry, typing, sent, failed, seen, and attachment states
      visually explicit and accessible.
- [ ] Convert notifications and requests into legible instrument channels with
      honest loading/error/empty states and preserved bulk actions.
- [ ] Verify direct/group threads, pending retry, unread badges, and requests.

### Task 5: Auth, discovery, settings, composer, and global overlays

**Files:**
- Modify auth forms under `apps/web/src/features/auth/`
- Modify: `apps/web/src/features/search/search.tsx`
- Modify: `apps/web/src/features/settings/settings.tsx`
- Modify composer files under `apps/web/src/features/composer/`
- Modify: report/share/call overlay components
- Modify: `apps/web/src/app/error.tsx`, `not-found.tsx`

**Interfaces:**
- Reuse shared field, status, dialog, and surface-state patterns.
- Preserve upload, crop, alt-text, visibility, moderation, session, and call APIs.

- [ ] Recompose auth as a clear creator-entry surface with explicit progress and
      recovery, without invented claims.
- [ ] Distinguish search initial, searching, zero-result, and failed states.
- [ ] Give settings persistent save/error feedback and safer destructive flows.
- [ ] Turn compose into a staged instrument workflow while preserving media
      processing, alt text, visibility, and discard confirmation.
- [ ] Align report, share, call, global error, and 404 surfaces with the system.
- [ ] Remove nested `<main>` markup and restore focus after every modal closes.

### Task 6: Verification, finish review, and durable documentation

**Files:**
- Update: `dogfood-output/report.md`
- Create at finish: `apps/web/DESIGN.md` and Impeccable sidecar
- Update: `02-DESIGN-SYSTEM.md`, `03-AGENT-BRIEF.md`

- [ ] Run one batched browser inspection at desktop and mobile across every
      route family, then fix all material findings in one batch.
- [ ] Confirm light/dark/system persistence, no flash, AA contrast, keyboard
      focus, safe areas, reduced motion, and no horizontal overflow.
- [ ] Run the design detector once over all changed UI targets.
- [ ] Run the independent finish reviewer and resolve its verdict batch.
- [ ] Run `pnpm lint`, `pnpm check-types`, `pnpm test`, `pnpm build`, API-client
      verification, and all three service health checks.
- [ ] Record the shipped system in `DESIGN.md`, update the former locked design
      spec, and report any unresolved reviewer findings honestly.
