# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are photographers and visual creators who publish work,
follow other creators, and maintain close communities around images and video.
People who primarily browse, respond, and converse are a secondary audience.
The product must work as comfortably on a phone during casual use as it does
on a desktop during focused viewing.

## Product Purpose

Aperture is a creator-first visual network. It lets people publish photographs
and video, discover creators, follow public or private accounts, react and
comment, share stories, and move into direct messaging or calls without
leaving the same social context. Success means the work remains the focus and
the next meaningful action is obvious without social-network clutter.

## Positioning

Aperture treats visual work as the primary object and the social graph as its
context. Publishing, discovery, privacy, conversation, and realtime presence
share one coherent experience instead of splitting creation and community
across separate tools.

## Operating Context

People use Aperture in short mobile sessions to check activity, publish, and
reply, and in longer desktop sessions to browse feeds, inspect profiles, and
message. Media can be still or moving, accounts can be public or private, and
the interface must remain understandable across empty, loading, populated,
error, and high-volume states.

## Capabilities and Constraints

- Preserve the existing routes, backend contracts, authentication, privacy
  model, moderation controls, and working user flows during the redesign.
- Core flows include signup and login, feed, explore, search, profiles,
  follow requests, post composition, stories, reactions, comments, reposts,
  sharing, notifications, messaging, calls, settings, and account deletion.
- The application is a responsive Next.js web client backed by the existing
  Django API and realtime gateway; the redesign must not require backend
  contract changes merely for presentation.
- The UI must remain usable from 375px mobile widths through wide desktop
  layouts and must respect reduced-motion preferences.

## Brand Commitments

- Keep the product name **Aperture**.
- Keep visual media—not interface chrome—as the protagonist.
- The user explicitly requested a complete replacement visual world that
  feels futuristic and improves the whole UX, not a cosmetic reskin.
- Preserve product truth and functionality while replacing navigation,
  hierarchy, surfaces, typography, color, motion, and interaction patterns.

## Evidence on Hand

- The working product and real route behavior in `src/app` and `src/features`.
- Shared UI primitives and incumbent tokens in `packages/ui`.
- A deterministic local demo corpus with users, photographs, video, stories,
  conversations, and activity for realistic browser verification.
- No approved logo artwork, commercial claims, testimonials, or external
  brand imagery exists; future work must not fabricate them.

## Product Principles

1. Put the work first: media and its human context outrank platform chrome.
2. Make state legible: privacy, presence, requests, progress, and failures must
   be understandable at a glance.
3. Keep creation close: publishing and conversation should never feel buried
   behind navigation meant only for browsing.
4. Reward familiarity: common social actions keep recognizable semantics even
   when their visual expression changes.
5. Reduce noise before adding novelty: futuristic interaction must improve
   orientation or feedback, not decorate the task.

## Accessibility & Inclusion

Target WCAG 2.2 AA contrast and interaction behavior. Every control needs a
visible keyboard focus state and an accessible name; touch targets must remain
at least 44px; media keeps meaningful alternative text support; motion must
have a reduced-motion equivalent; color cannot be the only state signal.
