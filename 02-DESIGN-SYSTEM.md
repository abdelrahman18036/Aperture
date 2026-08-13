# Aperture Design System

The current product design is **The Focused Studio**, revised from the user-supplied reference on 2026-08-13 after the pale lilac palette and narrow, sparse workspaces were rejected. The previous darkroom, hardware-console, and Quiet Gallery directions are retired.

The normative, machine-readable and narrative design specification is [DESIGN.md](./DESIGN.md). Implemented tokens live in `packages/ui/src/theme.css`; shared primitives live in `packages/ui/src/primitives/`.

## Core direction

- Media leads inside crisp studio-white or near-black panels on a mineral canvas.
- Electric indigo (`#4857e8` in light mode) communicates selection, focus, and primary action.
- Geist is the interface family. Ordinary sentence case replaces industrial uppercase labels.
- Desktop uses a 256px navigation sidebar and a 72px top bar. Feed remains focused at about 800px; Explore, Search, post detail, and Messages expand to 1160px or the available workspace.
- Mobile collapses to a compact header and safe-area-aware bottom navigation without horizontal overflow at 375px.
- Cards and media use 16px radii, controls use 12px, and dialogs use 20px. Dialogs begin at 672px and task-heavy creation flows expand to 768–1152px.
- Shadows are soft and low contrast. Grain, keycaps, amber status strips, and orange commit controls do not belong to this world.

## Theme behavior

Light mode uses a mineral canvas, studio-white panels, graphite text, steel-blue seams, and indigo signals. Dark mode is a deliberate translation into near-black and layered blue-black surfaces with lifted indigo; it is not a simple inversion. System, light, and dark preferences resolve before first paint and persist locally.

## Interaction and accessibility

- Interactive targets are at least 44px.
- Keyboard focus is visible and uses the indigo focus token.
- Motion is limited to short state transitions and the existing media develop-in, with reduced-motion support.
- Loading, empty, error, retry, offline, and destructive states must remain explicit.
- Text and controls meet WCAG 2.2 AA contrast; subdued text still needs at least 4.5:1 at body and caption sizes.

Read `DESIGN.md` before adding or changing a product surface. If code and documentation disagree, the implemented tokens plus the latest user-approved reference win, and the documentation must be corrected in the same change.
