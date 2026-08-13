import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "../lib/cn";

/** Airy workspace field with a visible boundary and touch-safe height. */
function Input({
  className,
  type,
  ...props
}: React.ComponentProps<"input">): React.JSX.Element {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "min-h-11 w-full min-w-0 rounded-control bg-panel-raised px-4 py-2.5",
        "border border-seam shadow-[0_2px_10px_rgb(68_72_110/0.04)]",
        "font-sans text-body text-ink placeholder:text-ink-faint",
        "transition-colors duration-[var(--duration-hover)]",
        "hover:border-seam-strong focus:border-focus focus-visible:border-focus",
        "disabled:pointer-events-none disabled:opacity-40",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
