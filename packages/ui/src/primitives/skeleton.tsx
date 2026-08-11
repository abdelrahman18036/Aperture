import type * as React from "react";

import { cn } from "../lib/cn";

/**
 * Skeleton.
 *
 * **Solid `--color-surface`, no shimmer.** A shimmer on a photo grid competes
 * with the develop-in, and the develop-in is the motion budget. A loading
 * placeholder that performs is a loading placeholder you notice.
 */
function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">): React.JSX.Element {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-image bg-surface", className)}
      {...props}
    />
  );
}

export { Skeleton };
