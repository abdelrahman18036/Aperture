# Aperture — Design System

## The idea

Most social apps in dark mode look like a dark SaaS dashboard: neutral gray surfaces, one bright accent, rounded cards. Nothing about it says *photography*.

This one is lit like a **darkroom**. That's the whole concept and every decision below derives from it:

- A darkroom has exactly two light sources — a **warm safelight** and, when the print is done, **cool daylight** on the lightbox. So the interface has two accents, and the split carries meaning: **warm is you, cool is live**.
- Photographs carry **metadata**. So captions, timestamps, and counts are set in a mono utility face laid out like an EXIF strip — because photos genuinely do have metadata, not because mono looks technical.
- Photographers review work on a **contact sheet** — a grid with a frame-number gutter. So does the profile page.
- A print doesn't appear, it **develops**. That's the one signature motion in the product.

Everything else stays quiet. One bold idea, executed precisely.

---

## Color

OKLCH, because Tailwind v4 and shadcn both moved there and the interpolation is visibly better on dark backgrounds.

```css
@theme {
  /* Base — deep neutral with a faint cool cast, like paper in low light.
     Not pure black: pure black kills the sense of depth and makes
     photos look like they're floating in a void. */
  --color-base:      oklch(0.145 0.005 265);  /* #0B0B0E  page */
  --color-surface:   oklch(0.185 0.006 265);  /* #14141A  cards */
  --color-raised:    oklch(0.225 0.008 265);  /* #1D1D25  menus, modals */
  --color-line:      oklch(0.285 0.010 265);  /* #2A2A34  borders */

  /* Ink */
  --color-ink:       oklch(0.960 0.003 265);  /* primary text */
  --color-ink-dim:   oklch(0.700 0.012 265);  /* secondary */
  --color-ink-faint: oklch(0.545 0.014 265);  /* metadata, timestamps */

  /* Safelight — warm. YOUR actions: like, post, send, primary CTA. */
  --color-safelight:     oklch(0.760 0.155 55);   /* #F0A868 */
  --color-safelight-dim: oklch(0.470 0.090 55);   /* rings, hover glow */

  /* Daylight — cool, 5600K. LIVE state: online, typing, in-call, new. */
  --color-daylight:      oklch(0.845 0.095 215);  /* #7FD4E8 */
  --color-daylight-dim:  oklch(0.520 0.060 215);

  /* Status */
  --color-danger:  oklch(0.640 0.190 25);
  --color-success: oklch(0.760 0.130 155);
}
```

**The rule that keeps this from becoming generic:** safelight and daylight never appear in the same component. If a thing is something *you* do, it's warm. If a thing is something *happening now*, it's cool. A like button is warm. A typing indicator is cool. An unread badge is cool (it's new). A send button is warm.

Accents are used at **small scale and low frequency** — a 2px ring, an icon fill, a 1px underline. No accent-colored filled buttons larger than 40px tall. The photographs are the color in this interface; the chrome stays out of the way.

---

## Type

Three roles, three faces, all variable, all self-hosted via `next/font`.

| Role | Face | Use |
|---|---|---|
| Display | **Bricolage Grotesque** | Section heads, empty states, auth screens. Optical-size axis set low for large sizes. Nowhere below 24px. |
| Body / UI | **Geist Sans** | Everything. Captions, comments, buttons, labels. |
| Utility | **Geist Mono** | EXIF strips, timestamps, counts, usernames in metadata position, sequence numbers. |

Scale — 1.25 ratio, but the display face breaks out at the top so headers feel like a different register rather than a bigger paragraph:

```
display-xl  48/1.0   -0.03em   Bricolage 500
display-l   32/1.1   -0.02em   Bricolage 500
title       20/1.3   -0.01em   Geist 600
body        15/1.55   0        Geist 400
label       13/1.4    0.01em   Geist 500
meta        11/1.3    0.06em   Geist Mono 400 uppercase
```

The `meta` role is the workhorse and the thing people will recognize. Every timestamp, view count, and image dimension renders in it:

```
2.4K LIKES · 1080×1350 · 14 AUG
```

Wide tracking, faint ink, uppercase. It reads as film-edge printing, and it's *true* — those are the actual properties of the image.

---

## Layout

**Three columns on desktop, and the widths matter.** Nav rail 72px collapsed / 240px expanded. Feed column fixed at 640px, centered, never fluid — a photo feed that reflows on window resize feels unstable. Right rail 320px for suggestions and active conversations, dropped below 1280px.

**Feed post** — no card. No border, no radius, no shadow around the image. The photo sits directly on the base with a hairline `--color-line` rule separating posts. Cards imply a container; a photograph is not in a container, it's a print on a table. This is the single most consequential layout decision and it's what will make the feed not look like every other clone.

```
┌────────────────────────────────────────┐
│ ◉  marko                        ···    │   40px avatar, name in body
│    CAIRO · 24 MIN                      │   meta row
│                                        │
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                    ┃ │   image, 2px radius only
│ ┃         the photograph             ┃ │   ambient glow behind it
│ ┃                                    ┃ │   from dominant_color @ 8%
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                        │
│ ♥  ○  ↗                          ⌸     │   24px icons, 20px gap
│ 2.4K LIKES · 1080×1350 · f/1.8         │   meta strip
│ marko  caption text runs here in body  │
│ VIEW ALL 47 COMMENTS                   │   meta, ink-faint
├────────────────────────────────────────┤   hairline rule
```

The **ambient glow** is a blurred radial of the image's `dominant_color` at 8% opacity behind the photo, extending ~60px. It's the reason the feed feels lit rather than pasted onto black, and it costs one CSS gradient using a value the worker already computed.

**Profile — contact sheet.** 2px gutters (not the usual 4-8px — contact sheets are tight), and a frame-number gutter running down the left in `meta` type: `01 06 11…`, numbering the frame each row starts on. Numbering is legitimate here because a contact sheet genuinely is a numbered sequence; don't use numbered markers anywhere else in the product.

Columns are **3 / 4 / 5** by width, not a flat 3. Three was written when every screen was the 640px feed column; the profile is `data-wide` now, and on a 1152px page the same instruction produces 380px thumbnails — a contact sheet of six enormous frames is a gallery wall, which is the opposite of the metaphor. More, smaller frames as the page widens is the more faithful reading. The gutter is a real grid column, so the numbers follow the count instead of assuming it.

**Explore — mosaic, not a second contact sheet.** The feed answers "what did the people I chose post?"; explore answers "who else is here?", and the difference has to show in the layout or it is the same page twice — which it was, distinguishable only by the heading. Same 2px gutters and the same 3/4/5 columns, but every seventh tile prints at 2×2 from `md` up. That is information, not decoration: a wall of equal squares has no entry point and the eye slides off it. It stays off below `md`, where two of three columns is most of the row and the effect is a lopsided page rather than a rhythm. No frame numbers — a discovery grid is an arbitrary set of other people's posts, so numbering it would be decoration pretending to be information.

---

## Motion

**One signature effect: the develop-in.** Images enter the way a print comes up in the tray.

```
blurhash canvas (already loaded, instant)
  → 380ms: opacity 0→1 on the real image,
           filter: blur(12px) saturate(0.4) → blur(0) saturate(1)
  → cubic-bezier(0.16, 1, 0.3, 1)
```

It runs once per image, on first paint into the viewport, never on re-render. Under `prefers-reduced-motion` the blurhash cross-fades in 120ms with no blur or saturation change.

That is the motion budget. Everything else is functional and under 200ms:

- Like: icon scale 1 → 1.15 → 1, 180ms spring, plus a safelight ring that expands and fades. No particle bursts.
- Hover on interactive chrome: 120ms opacity/color only. No lift, no scale.
- Route change: 150ms opacity. No slide.
- Message arrival: 200ms fade + 8px rise.
- Typing indicator: three daylight dots, 1.4s loop.

**Do not** add scroll-triggered reveals to the feed. A feed is for consuming, not for being performed at. Animating posts as they scroll in makes the product feel slow and is the fastest way to make it read as AI-generated.

---

## Component notes

Build on shadcn's Base UI defaults, then override:

- **Button** — `radius: 6px`. Primary is safelight *text on transparent with a safelight-dim border*, not a filled warm block. Filled buttons only for destructive confirmation.
- **Input** — no background fill. 1px bottom border only, which goes safelight on focus. Full-box inputs make a dark UI feel like a form; a photo app should feel like a viewer.
- **Avatar** — 1px `--color-line` ring always. Daylight ring when the user is online. Never a gradient ring.
- **Dialog** — `--color-raised`, 12px radius, backdrop `blur(8px)` over base at 70%.
- **Skeletons** — solid `--color-surface`, no shimmer. Shimmer on a photo grid competes with the develop-in.

**Global grain.** A fixed, `pointer-events: none` SVG turbulence overlay across the viewport at **2.5% opacity**. It sits above the base and below content. This is the one indulgence — it gives the flat dark surfaces a film-emulsion texture and ties the whole darkroom idea together. Above 4% it becomes noise on the photographs and ruins them. Ship it at 2.5% and leave it alone.

---

## Quality floor

Not features — the definition of done:

- Responsive to 375px. Feed column becomes fluid below 640px; the rails collapse.
- Visible keyboard focus on everything: 2px safelight-dim ring, 2px offset.
- `prefers-reduced-motion` respected — the develop-in and every spring.
- Contrast: body text ≥ 4.5:1 against its surface, `meta` type ≥ 3:1 (verify `--color-ink-faint` on `--color-base` and lift it if it fails).
- Every image has an alt field in the composer; empty alt is allowed but the field is present.
- No layout shift on image load — the blurhash canvas holds the aspect ratio from the `width`/`height` already in the media row.
