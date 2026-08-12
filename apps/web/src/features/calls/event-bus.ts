"use client";

import { useMemo } from "react";

import type { AnyServerEvent } from "@repo/realtime-events";

/**
 * A one-way fan-out for socket events the conversation does not handle.
 *
 * It exists to break a circular wiring problem honestly rather than with a
 * ref written during render. The cycle:
 *
 *   useConversation  needs  an event handler for calls
 *   the call hooks   need   `sendCallSignal`, which useConversation returns
 *
 * So the handler must be passed *in* before the thing that produces it
 * exists. The usual escape is a ref assigned during render, which the React
 * Compiler rejects — correctly, because a value read during render that
 * changes without a render is exactly what it exists to prevent.
 *
 * A bus with a stable identity solves it properly: `emit` never changes, so
 * it can be handed to `useConversation` immediately, and subscribers attach
 * from effects once they exist.
 */
export interface EventBus {
  emit: (event: AnyServerEvent) => void;
  subscribe: (listener: (event: AnyServerEvent) => void) => () => void;
}

export function useEventBus(): EventBus {
  return useMemo(() => {
    const listeners = new Set<(event: AnyServerEvent) => void>();
    return {
      emit: (event) => {
        for (const listener of listeners) listener(event);
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }, []);
}
