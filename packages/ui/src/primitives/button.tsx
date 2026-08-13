import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn";

/** Soft, generous workspace action. Violet is reserved for active commitment. */
const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center gap-1.5",
    "rounded-control border border-transparent whitespace-nowrap",
    "font-sans text-label select-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--duration-hover)]",
    "active:scale-[0.98] active:shadow-key-pressed motion-reduce:active:scale-100",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "[&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary: [
          "border-commit bg-commit text-commit-ink shadow-key",
          "hover:border-commit-hover hover:bg-commit-hover",
        ],
        secondary: [
          "border-seam bg-panel-raised text-key-ink shadow-key",
          "hover:border-seam-strong hover:bg-key-active",
        ],
        ghost: ["text-ink-dim", "hover:bg-key hover:text-ink"],
        destructive: [
          "border-danger bg-danger text-danger-ink shadow-key",
          "hover:brightness-110",
        ],
        link: [
          "text-ink underline decoration-seam-strong decoration-1 underline-offset-4",
          "hover:text-ink-dim",
        ],
      },
      size: {
        sm: "min-h-11 px-3",
        default: "min-h-11 px-4",
        lg: "min-h-12 px-5",
        icon: "size-11",
        "icon-sm": "size-11",
      },
    },
    defaultVariants: {
      variant: "secondary",
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
