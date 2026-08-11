import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "../lib/cn";

/**
 * Input.
 *
 * **No background fill. A 1px bottom border only, which goes safelight on
 * focus.** Full-box inputs make a dark UI feel like a form; a photo app
 * should feel like a viewer.
 *
 * The focus ring from `theme.css` still applies on keyboard focus — the
 * border change is the affordance, not the accessibility mechanism.
 */
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
        "h-9 w-full min-w-0 bg-transparent px-0 py-1",
        "font-sans text-body text-ink",
        "border-0 border-b border-line",
        "transition-colors duration-[--duration-hover]",
        "placeholder:text-ink-faint",
        "hover:border-ink-faint",
        // No `outline-none` here. The border going safelight is the
        // affordance; the focus ring from theme.css is the accessibility
        // mechanism, and suppressing it took three inputs off the keyboard.
        "focus:border-safelight focus-visible:border-safelight",
        "disabled:pointer-events-none disabled:opacity-40",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
