import { CircleOff, TriangleAlert } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/cn";
import { Spinner } from "./spinner";

type SurfaceStateVariant = "loading" | "empty" | "error";

interface SurfaceStateProps extends Omit<React.ComponentProps<"div">, "title"> {
  variant: SurfaceStateVariant;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}

const DEFAULT_TITLES: Record<SurfaceStateVariant, string> = {
  loading: "Loading",
  empty: "Nothing here yet",
  error: "This surface could not load",
};

/** Honest loading, empty and recoverable error states for every route family. */
function SurfaceState({
  variant,
  title = DEFAULT_TITLES[variant],
  description,
  action,
  compact = false,
  className,
  ...props
}: SurfaceStateProps): React.JSX.Element {
  const isError = variant === "error";

  return (
    <div
      data-slot="surface-state"
      data-variant={variant}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-busy={variant === "loading" ? true : undefined}
      className={cn(
        "flex w-full flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-6" : "min-h-56 gap-3 px-6 py-12",
        className,
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className={cn(
          "grid size-11 place-items-center rounded-control border border-seam bg-panel-raised",
          isError ? "text-danger" : "text-ink-dim",
        )}
      >
        {variant === "loading" ? <Spinner role="presentation" /> : null}
        {variant === "empty" ? <CircleOff className="size-5" /> : null}
        {isError ? <TriangleAlert className="size-5" /> : null}
      </div>
      <p className="font-display text-title tracking-[-0.02em] text-ink">
        {title}
      </p>
      {description ? (
        <p className="max-w-[62ch] text-body text-ink-dim">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

export { SurfaceState };
export type { SurfaceStateProps, SurfaceStateVariant };
