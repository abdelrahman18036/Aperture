import type * as React from "react";

/**
 * The global grain overlay.
 *
 * A fixed, `pointer-events: none` SVG turbulence layer across the viewport at
 * **2.5% opacity**. It sits above the base and below content.
 *
 * This is the one indulgence in the design system: it gives the flat dark
 * surfaces a film-emulsion texture and ties the whole darkroom idea together.
 * Above 4% it becomes noise on the photographs and ruins them.
 *
 * **Ship it at 2.5% and leave it alone.**
 */
function Grain(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      data-slot="grain"
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.025]"
    >
      <svg className="size-full" xmlns="http://www.w3.org/2000/svg">
        <filter id="aperture-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.8"
            numOctaves="3"
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter="url(#aperture-grain)" />
      </svg>
    </div>
  );
}

export { Grain };
