import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";

/**
 * Three roles, three faces, all variable, all self-hosted.
 *
 * `next/font/google` downloads at build time and serves from our own origin —
 * no request to Google at runtime, and no layout shift. The three CSS
 * variables below are what `theme.css` binds Tailwind's font utilities to.
 *
 * This is the one module in `packages/ui` that imports Next, which is why
 * `next` is a dependency of this package. `03-AGENT-BRIEF.md` puts the fonts
 * here deliberately: they are part of the design system, not of the app.
 */

/**
 * Display — section heads, empty states, auth screens. **Nowhere below 24px.**
 *
 * The optical-size axis is the reason this face is here rather than a second
 * weight of Geist: at display sizes it tightens apertures and thins the
 * joins, which is what makes a header read as a different register instead of
 * a bigger paragraph.
 */
export const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-bricolage",
  display: "swap",
});

/** Body and UI — captions, comments, buttons, labels. Everything. */
export const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

/**
 * Utility — EXIF strips, timestamps, counts, usernames in metadata position,
 * sequence numbers. The `meta` role in `theme.css` is built on this.
 */
export const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

/** Every font variable, for the `<html>` element's className. */
export const fontVariables = [
  bricolage.variable,
  geistSans.variable,
  geistMono.variable,
].join(" ");
