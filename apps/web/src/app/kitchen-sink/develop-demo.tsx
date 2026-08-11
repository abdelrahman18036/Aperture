"use client";

import { useState } from "react";

import { Button, DevelopImage } from "@repo/ui";

import type { MediaFixture } from "./fixtures";

/**
 * The develop-in, with a way to watch it again.
 *
 * The component latches after its first develop — that is the spec, "once per
 * image, on first paint into the viewport, never on re-render". Replaying it
 * therefore means remounting it, which is what bumping the key does. Without
 * this the effect is only visible on a hard reload, and the whole point of
 * the kitchen sink is being able to look at the thing.
 */
export function DevelopDemo({
  fixtures,
}: {
  fixtures: readonly MediaFixture[];
}) {
  const [run, setRun] = useState(0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setRun((n) => n + 1);
          }}
        >
          Replay the develop-in
        </Button>
        <span className="meta">run {String(run + 1)}</span>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        {fixtures.map((fixture) => (
          <figure key={`${fixture.src}:${String(run)}`} className="flex flex-col gap-2">
            <DevelopImage
              src={fixture.src}
              alt={fixture.alt}
              width={fixture.width}
              height={fixture.height}
              blurhash={fixture.blurhash}
              dominantColor={fixture.dominantColor}
              sizes="(max-width: 640px) 100vw, 33vw"
            />
            <figcaption className="meta">
              {fixture.width}×{fixture.height} · {fixture.dominantColor}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
