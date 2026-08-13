import type * as React from "react";

import { cn } from "../lib/cn";

/**
 * Skeleton.
 *
 * **`02-DESIGN-SYSTEM.md` asks for solid `--color-surface` with no shimmer,
 * and this shimmers — a deviation the owner asked for.** The spec's reasoning
 * is that a shimmer competes with the develop-in; the counter-argument, which
 * won, is that a placeholder that never moves is indistinguishable from a
 * surface that failed to load, and this codebase has already shipped that
 * exact failure twice.
 *
 * `still` is kept for the places where the spec's reasoning still holds — a
 * dense grid of them, where nine sweeps at once is worse than none.
 */
function Skeleton({
  className,
  still = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Opt out of the sheen where many render side by side. */
  still?: boolean;
}): React.JSX.Element {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "rounded-image bg-panel-raised",
        !still && "animate-sheen",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
