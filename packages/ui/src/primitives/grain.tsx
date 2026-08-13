import type * as React from "react";

/** A quiet violet atmosphere on the global canvas, never over media. */
function Grain(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      data-slot="grain"
      className="aperture-chassis-texture pointer-events-none fixed inset-0 z-0"
    />
  );
}

export { Grain };
