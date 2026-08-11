import type { Metadata } from "next";

import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Aperture",
  description: "A photo and video social platform.",
};

/**
 * The root layout holds nothing but the document shell. Chrome belongs to the
 * route groups: `(auth)` has no nav rail, `(app)` has the three-column shell
 * from `02-DESIGN-SYSTEM.md`. That is the work a `Layout` boolean prop would
 * otherwise be doing.
 *
 * `shadcn init` wired Geist Sans, which is the body face the design system
 * asks for. Phase 2 adds the other two roles — Bricolage Grotesque for
 * display and Geist Mono for the `meta` EXIF strip — along with the `@theme`
 * block and the grain overlay.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
