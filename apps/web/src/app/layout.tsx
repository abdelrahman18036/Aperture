import type { Metadata } from "next";

import { Grain } from "@repo/ui";
import { fontVariables } from "@repo/ui/fonts";

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
    <html lang="en" className={fontVariables}>
      <body className="font-sans text-body text-ink antialiased">
        <Grain />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
