"use client";

import { useCallback, useState } from "react";

import type { Schemas } from "@repo/api-client";
import { Button, InstrumentPanel, cn } from "@repo/ui";

import { api } from "@/lib/api";

type Background = Schemas["BackgroundEnum"];

/**
 * A story that is just words on a colour.
 *
 * The point is the missing step: posting one requires nothing to be uploaded,
 * processed or waited for. Somebody with something to say and no photograph
 * of it should not have to find a photograph of it.
 *
 * **The backgrounds are not the accent colours**, and that is a rule rather
 * than a palette choice — `02-DESIGN-SYSTEM.md` caps the accent at "rings,
 * icon fills, 1px underlines" and rules out anything accent-filled above
 * 40px tall, which a full-bleed safelight rectangle is the loudest possible
 * version of. These are content colours in the sense a photograph is:
 * desaturated, and dark enough for `--color-ink` to sit on.
 *
 * The list and the CSS both come from the server, so adding one is a server
 * change alone.
 */

const BACKGROUNDS: { id: Background; label: string; css: string }[] = [
  {
    id: "slate",
    label: "Slate",
    css: "linear-gradient(160deg, #1B1E28, #0B0B0E)",
  },
  {
    id: "moss",
    label: "Moss",
    css: "linear-gradient(160deg, #16241C, #0B0F0C)",
  },
  {
    id: "plum",
    label: "Plum",
    css: "linear-gradient(160deg, #241823, #100B10)",
  },
  {
    id: "clay",
    label: "Clay",
    css: "linear-gradient(160deg, #2A1E17, #120C09)",
  },
  { id: "ink", label: "Ink", css: "linear-gradient(160deg, #14141A, #000000)" },
];

const MAX_LENGTH = 700;

export function TextStory({ onPosted }: { onPosted: () => void }) {
  const [text, setText] = useState("");
  const [background, setBackground] = useState<Background>("slate");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const css =
    BACKGROUNDS.find((option) => option.id === background)?.css ??
    "linear-gradient(160deg, #1B1E28, #0B0B0E)";

  const post = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const response = await api.POST("/api/stories/create", {
        // `caption` is a required key in the generated type — the serializer
        // gives it a default, which drf-spectacular renders as
        // present-with-a-value rather than omittable. Sending "" is honest and
        // keeps the contract single-sourced.
        body: { text, background, caption: "" },
      });

      if (response.data === undefined) {
        const detail = (response.error as { detail?: string } | undefined)
          ?.detail;
        setError(detail ?? "That did not post. Try again.");
        return;
      }
      onPosted();
    } catch {
      setError(
        "The story could not be published. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [text, background, onPosted]);

  return (
    <InstrumentPanel className="grid gap-5 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      {/* The editor *is* the preview. A separate preview pane would be the
          same words twice and half the room for either. */}
      <label className="flex flex-col gap-2">
        <span className="sr-only">Your story</span>
        <div
          style={{ background: css }}
          className="flex aspect-[4/5] max-h-[62dvh] items-center justify-center overflow-hidden rounded-[8px] border border-seam p-8 shadow-[0_8px_22px_rgba(0,0,0,0.18)]"
        >
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            maxLength={MAX_LENGTH}
            placeholder="Say something"
            className={cn(
              "w-full resize-none bg-transparent text-center text-ink",
              "placeholder:text-ink-faint focus-visible:outline-none",
              // Shrinks as it fills, the way every text status does — which
              // is what makes a 700-character limit livable rather than a
              // wall of 12px type.
              text.length > 280
                ? "text-body"
                : text.length > 90
                  ? "text-title"
                  : "font-display text-display-l",
            )}
            rows={6}
          />
        </div>
      </label>

      <div className="flex flex-col gap-5 rounded-[8px] border border-seam bg-panel-raised p-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="meta">background</legend>
          <div className="grid grid-cols-5 gap-2">
            {BACKGROUNDS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setBackground(option.id);
                }}
                aria-label={option.label}
                aria-pressed={background === option.id}
                style={{ background: option.css }}
                className={cn(
                  "size-11 rounded-[8px] border border-seam transition-all duration-[var(--duration-hover)]",
                  background === option.id
                    ? "ring-2 ring-accent ring-offset-2 ring-offset-panel-raised"
                    : "ring-1 ring-line",
                )}
              />
            ))}
          </div>
        </fieldset>

        <p className="meta">
          {text.length} / {MAX_LENGTH} · gone in 24 hours
        </p>

        {error !== null ? (
          <p className="text-body text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <div>
          <Button
            disabled={busy || text.trim() === ""}
            onClick={() => {
              void post();
            }}
          >
            {busy ? "Posting…" : "Add to story"}
          </Button>
        </div>
      </div>
    </InstrumentPanel>
  );
}
