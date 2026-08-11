import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn";

/**
 * Button.
 *
 * The override that matters: **primary is safelight text on transparent with
 * a safelight-dim border, not a filled warm block.** Filled buttons exist
 * only for destructive confirmation. Accents live at small scale and low
 * frequency in this interface — the photographs are the color, and the chrome
 * stays out of the way.
 *
 * Nothing here is taller than 40px, which is the ceiling the design system
 * puts on anything accent-filled.
 *
 * Hover is 120ms, color only. No lift, no scale.
 */
const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center gap-1.5",
    "rounded-control border border-transparent whitespace-nowrap",
    "font-sans text-label select-none",
    "transition-colors duration-[var(--duration-hover)]",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "[&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        /** Yours: like, post, send. Warm, and never a filled block. */
        primary: [
          "border-safelight-dim text-safelight",
          "hover:border-safelight hover:bg-safelight/5",
        ],
        /** The quieter action next to a primary one. */
        secondary: [
          "border-line text-ink-dim",
          "hover:border-ink-faint hover:text-ink",
        ],
        /** Chrome. Icon buttons, overflow menus, the row of feed actions. */
        ghost: ["text-ink-dim", "hover:bg-surface hover:text-ink"],
        /**
         * The one filled variant, and only for confirming something
         * destructive. If a filled button is tempting anywhere else, it is
         * the wrong button. Dark ink on the red rather than light — light ink
         * on danger measures about 3.4:1, which is under the bar for text.
         */
        destructive: [
          "border-transparent bg-danger text-ink-inverse",
          "hover:bg-danger/85",
        ],
        /** 1px underline, per the accent rules. */
        link: [
          "text-safelight underline decoration-1 underline-offset-4",
          "hover:text-ink",
        ],
      },
      size: {
        sm: "h-8 px-2.5",
        default: "h-9 px-3.5",
        /** 40px — the ceiling. Nothing accent-filled goes above it. */
        lg: "h-10 px-4",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
