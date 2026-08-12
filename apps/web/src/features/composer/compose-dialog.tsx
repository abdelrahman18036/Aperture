"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui";

import { Composer } from "./composer";

/**
 * Composing, over the page rather than instead of it.
 *
 * A full navigation to `/compose` threw away where somebody was: their feed
 * position, the profile they were looking at, the thread they were in. That
 * is the wrong trade for an action people take *from* somewhere — posting is
 * something you do while looking at something else, and the something else
 * should still be there afterwards.
 *
 * **`/compose` still works.** It is a real route, deep-linkable and
 * shareable, and it is what a fresh tab gets. This is the same component in
 * a dialog for the case where there is a page underneath worth keeping.
 *
 * Closing on success is the caller's job — `Composer` pushes to a route when
 * it finishes, and the dialog follows the navigation.
 */
function ComposeDialog({
  open,
  toStory,
  onOpenChange,
  onPosted,
}: {
  open: boolean;
  /** Story mode: the tray's plus button rather than the rail's camera. */
  toStory: boolean;
  onOpenChange: (open: boolean) => void;
  onPosted: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent // Wider than the feed column. A crop stage and a preview are the two
        // things in this product that genuinely want room, and neither is a
        // photograph whose size is the point.
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto no-scrollbar">
        <DialogHeader>
          <DialogTitle>{toStory ? "New story" : "New post"}</DialogTitle>
          <DialogDescription>
            {toStory
              ? "gone in 24 hours · bytes go straight to storage"
              : "bytes go straight to storage · never through our server"}
          </DialogDescription>
        </DialogHeader>

        <Composer
          toStory={toStory}
          onDone={() => {
            onPosted();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Opening the composer, from anywhere inside the shell.
 *
 * A context rather than a prop, because the two callers are on opposite
 * sides of a server-component boundary: the nav rail is rendered by the
 * shell, and the story tray by the feed page. Threading a function through
 * a server component is not possible, and duplicating the dialog would give
 * two of them.
 */
interface ComposeApi {
  start: (mode: ComposeMode) => void;
  /**
   * Bumped every time something is published.
   *
   * The tray depends on it, which is what makes a story you just posted
   * appear without a reload — closing the dialog is not by itself news that
   * anything changed, and the tray had no other way to hear about it.
   */
  posted: number;
}

const ComposeContext = createContext<ComposeApi | null>(null);

export type ComposeMode = "post" | "story";

export function ComposeProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [toStory, setToStory] = useState(false);
  const [posted, setPosted] = useState(0);

  const start = useCallback((mode: ComposeMode) => {
    setToStory(mode === "story");
    setOpen(true);
  }, []);

  const value = useMemo<ComposeApi>(() => ({ start, posted }), [start, posted]);

  return (
    <ComposeContext.Provider value={value}>
      {children}
      <ComposeDialog
        open={open}
        toStory={toStory}
        onOpenChange={setOpen}
        onPosted={() => {
          setPosted((count) => count + 1);
        }}
      />
    </ComposeContext.Provider>
  );
}

/** Throws outside the shell, rather than silently doing nothing on click. */
export function useCompose(): ComposeApi {
  const api = useContext(ComposeContext);
  if (api === null) {
    throw new Error("useCompose must be used inside a ComposeProvider");
  }
  return api;
}
