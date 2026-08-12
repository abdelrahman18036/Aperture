import type * as React from "react";

import { cn } from "../lib/cn";

/**
 * "Still working."
 *
 * A ring with a gap, rotating. Deliberately *not* a progress bar: we do not
 * know how long a page of posts will take, and a bar that fills to ninety
 * percent and then waits is a lie told with a nicer animation.
 *
 * Safelight, because waiting for a page is something you caused. The rule in
 * `02-DESIGN-SYSTEM.md` is that warm is you and cool is live, and a
 * pagination fetch is the former.
 *
 * `label` is announced; the ring itself is hidden from the accessibility
 * tree, since a spinning border is not information.
 */
function Spinner({
  className,
  label = "Loading",
  ...props
}: React.ComponentProps<"span"> & { label?: string }): React.JSX.Element {
  return (
    <span
      data-slot="spinner"
      role="status"
      className={cn("inline-flex items-center gap-2", className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-4 rounded-full border-2 border-safelight-dim",
          // One transparent edge is what makes the rotation visible at all.
          "border-t-safelight animate-revolve",
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export { Spinner };
