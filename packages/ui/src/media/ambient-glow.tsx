import type * as React from "react";

import { cn } from "../lib/cn";

/**
 * The ambient glow.
 *
 * A blurred radial of the image's `dominant_color` at 8% opacity behind the
 * photo, extending about 60px. It is the reason the feed feels *lit* rather
 * than pasted onto black, and it costs one CSS gradient using a value the
 * media worker already computed.
 *
 * Purely decorative, so it is hidden from assistive technology and never
 * intercepts a pointer.
 */
function AmbientGlow({
  color,
  className,
  ...props
  // `color` is omitted from the div props on purpose: HTMLDivElement has a
  // legacy `color` attribute typed `string | undefined`, and intersecting
  // with it would quietly drop the `null` that a media row can hold.
}: Omit<React.ComponentProps<"div">, "color"> & {
  /** `media.dominant_color`, any CSS color. Omit and nothing renders. */
  color: string | null | undefined;
}): React.JSX.Element | null {
  if (!color) return null;

  return (
    <div
      aria-hidden="true"
      data-slot="ambient-glow"
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 opacity-[0.035] blur-[40px]",
        className,
      )}
      style={{
        background: `radial-gradient(closest-side, ${color}, transparent)`,
      }}
      {...props}
    />
  );
}

export { AmbientGlow };
