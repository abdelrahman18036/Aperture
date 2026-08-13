"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type * as React from "react";

import { cn } from "../lib/cn";

/**
 * Avatar.
 *
 * **1px neutral ring always. Violet ring when the user is online. Never a
 * gradient ring.**
 *
 * The ring is the clearest expression of "warm is you, cool is live": the
 * ring going daylight means something is happening *now*, not that this
 * person is important. Nothing warm appears on this component.
 */

type AvatarSize = "sm" | "default" | "lg";

const sizeClasses: Record<AvatarSize, string> = {
  sm: "size-6 text-meta",
  default: "size-10 text-label",
  lg: "size-14 text-label",
};

function Avatar({
  className,
  size = "default",
  online = false,
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: AvatarSize;
  /** Cool means live. Nothing else on this component gets an accent. */
  online?: boolean;
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      data-online={online || undefined}
      className={cn(
        "group/avatar relative flex shrink-0 rounded-full select-none",
        "ring-1 ring-line",
        "transition-[box-shadow] duration-[var(--duration-hover)]",
        "data-[online]:ring-daylight",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn(
        "aspect-square size-full rounded-full object-cover",
        className,
      )}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full",
        "bg-surface font-mono uppercase text-ink-faint",
        className,
      )}
      {...props}
    />
  );
}

/** A row of overlapping avatars — group conversations, "liked by". */
function AvatarGroup({
  className,
  ...props
}: React.ComponentProps<"div">): React.JSX.Element {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-base",
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarGroup, AvatarImage };
