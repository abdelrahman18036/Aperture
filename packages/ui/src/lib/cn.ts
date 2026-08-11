import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `twMerge`, taught our theme.
 *
 * This is not optional bookkeeping. tailwind-merge resolves conflicts by
 * grouping classes, and out of the box it knows Tailwind's default scales —
 * not ours. Given `text-label` (a size) and `text-safelight` (a color) it
 * cannot tell them apart, decides they conflict, and silently drops the first.
 *
 * Measured before this fix: every button in the system rendered at 15px
 * inherited body size instead of the 13px `label` role, because each variant's
 * `text-<color>` class was eating the base `text-label`.
 *
 * So every custom scale in `theme.css` is declared here. Adding a token there
 * means adding it here.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "base",
        "surface",
        "raised",
        "line",
        "ink",
        "ink-dim",
        "ink-faint",
        "ink-inverse",
        "safelight",
        "safelight-dim",
        "daylight",
        "daylight-dim",
        "danger",
        "success",
      ],
      text: ["display-xl", "display-l", "title", "body", "label", "meta"],
      radius: ["image", "control", "dialog"],
      font: ["display", "sans", "mono"],
      container: ["nav-rail", "nav-rail-open", "feed", "right-rail"],
    },
  },
});

/** Merge Tailwind classes, letting later ones win genuine conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
