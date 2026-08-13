import type * as React from "react";

import { cn } from "../lib/cn";

type InstrumentPanelTone = "default" | "raised" | "key";

interface InstrumentPanelProps extends React.ComponentProps<"div"> {
  /** Surface plane. `key` is for compact neutral control banks, not content. */
  tone?: InstrumentPanelTone;
}

/** A soft card region shared by route surfaces and contextual bays. */
function InstrumentPanel({
  className,
  tone = "default",
  ...props
}: InstrumentPanelProps): React.JSX.Element {
  return (
    <div
      data-slot="instrument-panel"
      data-tone={tone}
      className={cn(
        "relative rounded-instrument border",
        tone === "default" && "border-seam bg-panel text-ink shadow-instrument",
        tone === "raised" && "border-seam bg-panel text-ink shadow-instrument",
        tone === "key" && "border-seam bg-key text-key-ink shadow-key",
        className,
      )}
      {...props}
    />
  );
}

export { InstrumentPanel };
export type { InstrumentPanelProps, InstrumentPanelTone };
