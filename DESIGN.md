---
name: Aperture
description: A focused photo studio for visual discovery and conversation.
colors:
  light-chassis: "#f2f4f7"
  light-panel: "#ffffff"
  light-panel-raised: "#f8fafc"
  light-key: "#eef1f5"
  light-key-active: "#e7ebff"
  light-seam: "#dde2ea"
  light-seam-strong: "#c4cbd7"
  light-ink: "#111827"
  light-ink-dim: "#556070"
  light-ink-faint: "#6b7280"
  light-key-ink: "#252d3a"
  light-commit: "#4857e8"
  light-commit-hover: "#3543d2"
  light-live: "#2563eb"
  light-live-muted: "#dbeafe"
  light-danger: "#a62e2e"
  light-danger-ink: "#ffffff"
  light-success: "#176a4d"
  light-focus: "#4857e8"
  dark-chassis: "#0b0d12"
  dark-panel: "#12151c"
  dark-panel-raised: "#191e28"
  dark-key: "#202633"
  dark-key-active: "#26315a"
  dark-seam: "#293140"
  dark-seam-strong: "#3b475a"
  dark-ink: "#f7f8fa"
  dark-ink-dim: "#b2bac7"
  dark-ink-faint: "#818b9c"
  dark-key-ink: "#f7f8fa"
  dark-commit: "#7385ff"
  dark-commit-hover: "#8d9bff"
  dark-live: "#76a7ff"
  dark-live-muted: "#253e68"
  dark-danger: "#ff726a"
  dark-danger-ink: "#21100e"
  dark-success: "#55d49b"
  dark-focus: "#a5b0ff"
  commit-ink: "#ffffff"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 5vw, 4.75rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3vw, 3rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.01em"
  utility:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.025em"
rounded:
  tab: "10px"
  control: "12px"
  media: "16px"
  instrument: "16px"
  dialog: "20px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.light-commit}"
    textColor: "{colors.commit-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.light-panel-raised}"
    textColor: "{colors.light-key-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    height: "44px"
  input:
    backgroundColor: "{colors.light-panel-raised}"
    textColor: "{colors.light-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "44px"
  instrument-panel:
    backgroundColor: "{colors.light-panel}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.instrument}"
    padding: "20px"
  nav-active:
    backgroundColor: "{colors.light-key-active}"
    textColor: "{colors.light-commit}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    height: "48px"
---

# Design System: Aperture

## Overview

**Creative North Star: "Focused Photo Studio"**

Aperture is a modern photo studio adapted for social discovery and conversation. Mineral-white or near-black work surfaces, crisp studio panels, graphite ink, cool steel seams, and one electric-indigo signal keep the interface legible while photographs and video remain the strongest visual material.

The system is calm, precise, and useful rather than anonymous or theatrical. Creator identity and response context stay attached to the work: Explore is a detailed editorial grid, post detail holds media beside its conversation, and Messages preserves a searchable inbox beside the active thread. Dark mode is the default studio; light mode is a deliberate semantic translation with the same hierarchy, density, and silhouettes.

**Key Characteristics:**

- Media-first composition with author, story, and response context kept visible.
- Mineral-white or near-black canvas with crisp, tonally separated studio panels.
- Electric indigo reserved for orientation, focus, live state, and commitment.
- A 256px desktop navigation rail framing route-specific wide workspaces.
- Detailed Explore cards, split post/conversation detail, and searchable master/detail messaging.
- Restrained structural shadows, steel seams, and continuous 12–20px corners.
- Responsive continuity from wide desktop workspaces to safe-area mobile chrome.

## Colors

The palette is cool, high-clarity, and theme-aware; media supplies expressive color while indigo supplies interface orientation.

### Primary

- **Electric Indigo:** commits the primary task and marks active navigation, unread counts, and other decisive selections.
- **Lifted Indigo:** keeps the active signal luminous and readable on the near-black default theme.
- **Indigo Focus:** provides the universal two-pixel keyboard outline and focused field boundary.

### Secondary

- **Live Blue:** identifies current presence and live activity without borrowing the destructive palette.
- **Confirmation Green:** confirms online, saved, connected, or completed states when text or shape also carries the meaning.

### Tertiary

- **Safety Red:** communicates destructive actions and actionable failures, never routine emphasis.

### Neutral

- **Mineral Canvas:** the light chassis that separates white panels without tinting the work.
- **Studio White:** the primary light panel for cards, navigation, dialogs, and fields.
- **Near-black Studio:** the default dark chassis, neutral enough for color-critical media.
- **Night Panel:** the dark card and navigation plane; raised night panels carry controls and conversation history.
- **Graphite Ink:** primary light-theme text, supported by slate and faint graphite levels.
- **Moonlit Ink:** primary dark-theme text, softened from pure white for long sessions.
- **Steel Seams:** one-pixel cool boundaries in quiet and strong variants; they explain grouping without boxing every element.

**The Indigo Orientation Rule.** Indigo tells people where they are, what is live, or what will commit; it is not ambient decoration.

**The Theme Translation Rule.** Dark and light themes preserve semantic roles and contrast instead of mechanically inverting colors.

## Typography

**Display Font:** Geist (with ui-sans-serif and system fallbacks)  
**Body Font:** Geist (with ui-sans-serif and system fallbacks)  
**Utility Font:** Geist Mono (with ui-monospace fallback)

**Character:** Geist gives the studio a compact contemporary voice with excellent small-size legibility. Geist Mono is restricted to measured or machine-generated information so the interface never performs technicality for its own sake.

### Hierarchy

- **Display** (700, fluid 44–76px, 1 line-height): rare feature and entry headlines.
- **Headline** (700, fluid 32–48px, 1 line-height): route headings and major empty states.
- **Title** (650, 20px, 1.25 line-height): card, profile, dialog, and workspace titles.
- **Body** (400, 15px, 1.55 line-height): captions, messages, descriptions, and form help; keep sustained prose near 62 characters per line.
- **Label** (600, 13px, 1.35 line-height, 0.01em tracking): actions, navigation, tabs, and field labels.
- **Utility** (500, 11px, 1.3 line-height, 0.025em tracking): timestamps, counts, dimensions, and compact status data.

**The Human Voice Rule.** Use ordinary sentence case for interface copy; uppercase technical labels are not part of Focused Photo Studio.

**The Measured Mono Rule.** Mono type is earned by measured data, never used merely to make the interface feel technical.

## Layout

Authenticated desktop routes use a fixed 256px left navigation rail from 1024px upward and a sticky 72px top bar. The shell absorbs the remaining width inside a 1480px maximum frame with 28px desktop gutters. Default content occupies an 800px lane; Explore, Search, and post detail expand to 1160px, while messaging uses the full remaining shell width. A 336px contextual rail appears only from 1536px and disappears whenever the route declares a wide workspace.

The feed itself is fluid up to 896px including its page padding. Explore is a one-, two-, then three-column editorial grid with a consistent square media frame for every result. Post detail becomes a split 1.45fr/0.72fr stage at 1024px, with media beside a sticky conversation panel whose minimum width is 352px. Messaging becomes master/detail at 1280px with a fixed 376px searchable inbox and a fluid thread; below that breakpoint, the inbox and conversation are separate navigable views.

Below 1024px, the desktop rail and top bar yield to a safe-area-aware 68px mobile header and seven-destination bottom navigation with 56px targets. Page padding steps from 12px to 20px to 28px. The shell always collapses chrome before shrinking media, fields, or conversation controls below a useful width.

**The Route Owns Width Rule.** Feed, discovery, detail, search, and messaging receive the width their task needs; do not force every route through one generic column.

**The Viable Stage Rule.** Never preserve a rail by squeezing the primary work below a useful width; collapse chrome first.

## Elevation & Depth

Depth is structural and restrained. Tonal separation and a one-pixel steel seam do most of the work; low-opacity shadows detach controls, panels, and dialogs from the chassis. Dark shadows deepen while preserving the same four roles. Panels never use glass as their material, though sticky mobile chrome may use a quiet backdrop blur for continuity over scrolling content.

### Shadow Vocabulary

- **Key:** a compact 0 4px 14px shadow under primary and raised controls.
- **Key Pressed:** a tighter 0 2px 7px shadow paired with a 0.98 press scale.
- **Instrument:** a broad 0 16px 44px shadow under cards, workspaces, and contextual panels.
- **Dialog:** the only large float, a diffuse 0 32px 96px shadow over a softened backdrop.

**The Quiet Depth Rule.** If a shadow becomes a visual feature before the content does, it is too strong.

## Shapes

The reusable form language is continuous and precise: tab interiors are 10px, controls are 12px, media and instrument panels are 16px, and dialogs are 20px. Circular forms are reserved for avatars, icon-only actions, presence dots, count badges, and compact social actions. A few purpose-built canvases use 8px or 22–28px corners, but they are exceptions tied to crop, call, story, or authentication framing rather than new system primitives.

Media keeps its natural aspect ratio inside a 16px frame. Avoid nesting equally strong rounded rectangles; when a card contains media, the media frame and outer instrument panel should still read as one clear silhouette.

## Components

### Buttons

- **Shape:** soft rectangular controls with 12px corners, 44px minimum height, and 12–20px horizontal padding by size.
- **Primary:** electric-indigo fill, matching border, white ink, and the key shadow; reserved for the commitment action.
- **Secondary:** raised panel fill, steel seam, key ink, and key shadow for reversible or supporting actions.
- **Ghost / Link / Destructive:** transparent tonal hover; underlined text link; or safety-red fill respectively.
- **Hover / Focus:** 140ms semantic color change, 0.98 press scale, and the global 2px indigo outline with 2px offset.

### Chips

- **Style:** fully rounded compact status forms; unread badges use indigo fill and white ink, while privacy and neutral filters use key surfaces.
- **State:** presence pairs a colored dot with text; badges cap visible counts instead of widening navigation.

### Cards / Containers

- **Corner Style:** 16px instrument corners with a one-pixel steel seam.
- **Background:** studio white in light mode and night panel in dark mode.
- **Shadow Strategy:** the instrument shadow supports route panels, feed cards, and editorial tiles.
- **Internal Padding:** generally 16–24px, with tighter media insets where the photograph remains dominant.

### Inputs / Fields

- **Style:** raised panel fill, 12px corners, one-pixel seam, 16px horizontal padding, 44px minimum height, and a quiet inset-like key shadow.
- **Focus:** boundary and universal focus outline both move to indigo; the border never replaces the outline.
- **Error / Disabled:** error shifts the boundary to safety red; disabled fields remain visible at 40% opacity and cannot receive input.

### Navigation

Desktop navigation is a fixed 256px studio panel with 48px rows, familiar 20px outline icons, 15px labels, and indigo selection on a light signal wash. The 72px top bar carries search, quick destinations, and profile access. Mobile preserves destination order in a seven-column bottom bar with 56px targets and a compact header for search, creation, and appearance.

### Explore Tiles

Explore tiles are editorial cards rather than anonymous crops. Each retains creator identity, timestamp, caption, response counts, location when available, and an explicit video or multi-image badge. Every tile uses the same square media standard so the grid remains predictable while its information stays useful. Hover adds only a two-pixel lift, stronger seam, and instrument shadow, with no spatial motion under reduced-motion preferences.

### Messaging Workspace

The wide workspace pairs a 352px searchable inbox with a fluid conversation. Conversation rows are 76px minimum with avatar, presence, preview, time, and unread state. The thread fixes history between an 80px identity header and a touch-safe composer; mobile replaces the split with explicit inbox/thread navigation rather than compressing both columns.

### Surface States & Dialogs

Loading, empty, and error states share a centered icon, plain-language title, concise explanation, and optional recovery action; failures never masquerade as empty results. Dialogs use a 20px raised surface, steel seam, 20–28px padding, diffuse dialog shadow, and a six-pixel blurred semantic backdrop. Default width is 672px, with larger creation and selection flows allowed by their route.

## Do's and Don'ts

### Do:

- **Do** let real photographs and video carry the strongest color on the screen.
- **Do** keep creator identity, response context, and media type visible in discovery.
- **Do** use indigo for active navigation, focus, unread state, live orientation, or the primary task commitment.
- **Do** give each route the width and split structure its task needs.
- **Do** preserve 44px minimum controls, visible focus, accessible names, safe-area padding, and reduced-motion equivalents.
- **Do** distinguish loading, empty, failed, private, offline, and missing states with honest language and recovery.
- **Do** translate every semantic surface deliberately between near-black and mineral-white themes.

### Don't:

- **Don't** return Explore to anonymous thumbnail walls or remove context to create artificial minimalism.
- **Don't** collapse post detail or desktop messaging into narrow overlays when the route has room for a split workspace.
- **Don't** use indigo, live blue, green, or red as ambient decoration or as the only signal of state.
- **Don't** reintroduce pale lilac haze, orange or amber product accents, glassmorphism, luminous halos, thick borders, or dramatic elevation.
- **Don't** reintroduce industrial labels, status consoles, keycap styling, engraved chrome, or technical theater.
- **Don't** invent engagement metrics, creator claims, suggestions, or live status that the product does not know.
- **Don't** use mono or uppercase text as generic decoration.
