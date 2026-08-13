import type { Metadata } from "next";

import { Grain } from "@repo/ui";
import { fontVariables } from "@repo/ui/fonts";

import { ThemeScript } from "@/features/theme/theme-script";

import "./globals.css";

export const metadata: Metadata = {
  title: "Aperture",
  description: "A photo and video social platform.",
};

/**
 * The root layout holds the document shell, the three type faces, and the
 * grain. Chrome belongs to the route groups: `(auth)` has no nav rail,
 * `(app)` has the three-column shell from `02-DESIGN-SYSTEM.md`. That is the
 * work a `Layout` boolean prop would otherwise be doing.
 *
 * The grain sits above the base and below content, so the page's own children
 * are lifted onto their own stacking context above it.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={fontVariables}
      data-theme="dark"
      data-theme-preference="system"
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="font-sans text-body text-ink antialiased">
        <template
          data-aperture-design-contract
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: Aperture is a focused photo studio for discovery and conversation, refusing both anonymous thumbnail walls and pale surfaces that collapse into one layer.
OWN-WORLD: Mineral-white or near-black canvas, crisp studio panels, graphite ink, cool steel seams, and one electric-indigo signal; 12–20px corners and decisive tonal depth replace the former lilac haze.
STORY: Creators can judge work with its author and context visible, inspect a post beside its conversation, and move through a searchable messaging workspace without losing orientation.
FIRST VIEWPORT: A compact 256px navigation rail frames route-specific workspaces: a detailed editorial Explore grid, a wide split post view, or a 352px inbox beside a fluid thread.
FORM: Focused Photo Studio refinement, prompted by the user on 2026-08-13 after rejecting the previous palette, narrow overlays, sparse Explore cards, and weak Messages/Search layouts.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`,
          }}
        />
        <Grain />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
