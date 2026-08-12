"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AnyServerEvent } from "@repo/realtime-events";

import {
  useRealtime,
  type ConnectionState,
} from "@/features/messaging/use-realtime";

/**
 * One socket for the whole application.
 *
 * `01-ARCHITECTURE.md` §9 says a call must not open a second connection, and
 * the moment calls had to ring anywhere rather than only inside an open
 * thread, that stopped being a style rule and started being a constraint: an
 * app-level call listener plus a conversation-level socket is two sockets.
 *
 * So the socket is hoisted here and everything else subscribes. What that
 * buys, beyond obeying §9:
 *
 * - **One reconnect path.** Every screen resyncs off the same
 *   `connection.ready`, so there is no second backoff schedule to get wrong.
 * - **One presence identity.** Two sockets from one tab is one person the
 *   gateway counts twice.
 * - **Subscriptions outlive navigation.** Moving between the inbox and a
 *   thread no longer tears a connection down and builds another.
 *
 * Listeners are held in plain `Set`s created once. They are deliberately not
 * React state: an event arriving must reach its handler now, not after a
 * render, and a subscriber list that re-rendered the app on every mount would
 * be its own problem.
 */

export interface RealtimeApi {
  state: ConnectionState;
  sendTyping: (conversationId: string, isTyping: boolean) => void;
  sendCallSignal: (
    callId: string,
    signal: "offer" | "answer" | "ice" | "hangup",
    payload: unknown,
  ) => void;
  setCallIds: (callIds: readonly string[]) => void;
  setConversationIds: (conversationIds: readonly string[]) => void;
  setFocusedConversationId: (conversationId: string | null) => void;
  /** Every validated frame. Returns an unsubscribe function. */
  subscribe: (listener: (event: AnyServerEvent) => void) => () => void;
  /** Fires on every new connection, including the first. The resync hook. */
  onReady: (listener: () => void) => () => void;
  /** Who this socket belongs to, once known. */
  viewerId: string | null;
}

const RealtimeContext = createContext<RealtimeApi | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [viewerId, setViewerId] = useState<string | null>(null);

  const listeners = useMemo(
    () => ({
      events: new Set<(event: AnyServerEvent) => void>(),
      ready: new Set<() => void>(),
    }),
    [],
  );

  const emit = useCallback(
    (event: AnyServerEvent) => {
      // `connection.ready` names the socket's owner, which is the cheapest
      // place to learn it — no extra request, and it is authoritative because
      // the gateway took it from the verified ticket.
      if (event.type === "connection.ready") setViewerId(event.user_id);
      for (const listener of listeners.events) listener(event);
    },
    [listeners],
  );

  /**
   * Whether the socket is ready *now*, as opposed to the instant it became
   * ready. Kept because hoisting this provider into the shell changed who
   * outlives whom: the socket used to be created by the screen that needed
   * it, so "ready" always arrived after that screen had subscribed. Now the
   * socket connects once and screens mount and unmount underneath it, and a
   * thread opened a minute later would wait forever for an event that had
   * already happened — visible as a conversation stuck on "Loading" with a
   * green LIVE dot above it, which is a particularly unhelpful pair of
   * things to see together.
   */
  const readyNow = useRef(false);

  const ready = useCallback(() => {
    readyNow.current = true;
    for (const listener of listeners.ready) listener();
  }, [listeners]);

  const realtime = useRealtime({ onEvent: emit, onReady: ready });

  // A dropped connection is not ready, and the next `ready` is a genuinely
  // new one that every listener should hear.
  useEffect(() => {
    if (realtime.state !== "open") readyNow.current = false;
  }, [realtime.state]);

  const subscribe = useCallback(
    (listener: (event: AnyServerEvent) => void) => {
      listeners.events.add(listener);
      return () => listeners.events.delete(listener);
    },
    [listeners],
  );

  const onReady = useCallback(
    (listener: () => void) => {
      listeners.ready.add(listener);
      // Late subscribers are told at once rather than waiting for a
      // reconnection that may never come. Resyncing from `?after=` is cheap
      // and idempotent, so an extra call costs one indexed query.
      if (readyNow.current) listener();
      return () => listeners.ready.delete(listener);
    },
    [listeners],
  );

  const value = useMemo<RealtimeApi>(
    () => ({ ...realtime, subscribe, onReady, viewerId }),
    [realtime, subscribe, onReady, viewerId],
  );

  return (
    <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
  );
}

/**
 * The socket, from anywhere inside the authenticated shell.
 *
 * Throws rather than returning null when used outside it. A component that
 * silently gets no socket is a feature that silently stops working, which is
 * exactly the failure mode this whole area is built to avoid.
 */
export function useRealtimeApi(): RealtimeApi {
  const api = useContext(RealtimeContext);
  if (api === null) {
    throw new Error("useRealtimeApi must be used inside a RealtimeProvider");
  }
  return api;
}

/** Subscribe to socket events for as long as the component is mounted. */
export function useRealtimeEvents(
  listener: (event: AnyServerEvent) => void,
): void {
  const { subscribe } = useRealtimeApi();
  useEffect(() => subscribe(listener), [subscribe, listener]);
}

/** Run something on every new connection, including the first. */
export function useRealtimeReady(listener: () => void): void {
  const { onReady } = useRealtimeApi();
  useEffect(() => onReady(listener), [onReady, listener]);
}
