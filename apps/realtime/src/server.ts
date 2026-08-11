import { createServer, type IncomingMessage, type Server } from "node:http";

import Redis from "ioredis";
import { WebSocketServer, type WebSocket } from "ws";

import {
  PROTOCOL_VERSION,
  clientMessageSchema,
  type PresenceEvent,
  type TypingEvent,
} from "@repo/realtime-events";

import { config } from "./config.js";
import { Hub, type Subscriber } from "./hub.js";
import * as presence from "./presence.js";
import { InvalidTicketError, verifyTicket } from "./ticket.js";

/**
 * The socket gateway.
 *
 * Its whole job: authenticate a connection, subscribe it to Redis channels,
 * push bytes. No models, no migrations, no ORM, no business logic. Everything
 * durable belongs to Django — break that and you have two applications
 * fighting over one schema, which is far worse than the problem it solves.
 *
 * The two classes of event, and the rule that decides between them:
 *
 * - **Persisted** — messages, read receipts. Up over HTTP to Django, which
 *   allocates `seq` in a transaction and publishes to Redis after commit;
 *   down over this socket. This service never writes them.
 * - **Ephemeral** — typing, presence. Up over this socket, out over Redis to
 *   the other replicas, and never into Postgres. Nothing here is worth a
 *   database write per keystroke.
 *
 * If it must survive a restart it goes through Django. If it does not, it
 * stays here.
 */

/**
 * 4000+ is the application-defined close-code range.
 *
 * There is no code for "unauthorized" because a failed ticket never reaches
 * the WebSocket layer at all — the upgrade is answered with a plain HTTP 401
 * and the socket destroyed, which is both cheaper and harder to get wrong.
 */
const CLOSE_BAD_MESSAGE = 4002;

/** A socket that has not spoken in this long is assumed gone. */
const IDLE_TIMEOUT_MS = 90_000;

/** Refuse anything larger rather than buffering it. */
const MAX_MESSAGE_BYTES = 16 * 1024;

export interface Gateway {
  readonly http: Server;
  readonly wss: WebSocketServer;
  readonly hub: Hub;
  close: () => Promise<void>;
}

export function createGateway(): Gateway {
  const subscriberRedis = new Redis(config.redisUrl);
  const commandRedis = new Redis(config.redisUrl);
  const hub = new Hub(subscriberRedis, commandRedis);

  let nextId = 1;

  /**
   * Teardown still in flight.
   *
   * A socket's close handler unsubscribes and clears presence, and both are
   * asynchronous. Tracking them lets `close()` wait rather than pulling the
   * Redis connection out from under work it started.
   */
  const teardowns = new Set<Promise<void>>();

  const http = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ok",
          sockets: hub.socketCount,
          channels: hub.channelCount,
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });

  // `noServer` so the upgrade is handled explicitly: a socket that fails
  // ticket verification must never reach the WebSocket layer at all.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });

  http.on("upgrade", (request, socket, head) => {
    void (async () => {
      const ticket = readTicket(request);
      if (ticket === undefined) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      try {
        const claims = await verifyTicket(ticket, config.ticketSecret);
        wss.handleUpgrade(request, socket, head, (ws) => {
          void onConnection(ws, claims.userId);
        });
      } catch (error) {
        if (error instanceof InvalidTicketError) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        throw error;
      }
    })();
  });

  async function onConnection(ws: WebSocket, userId: string): Promise<void> {
    const subscriber: Subscriber = {
      id: nextId++,
      userId,
      send: (payload) => {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      },
    };
    // Subscribe to the user's own durable channel before anything else.
    // The channel name comes from the verified ticket, never from the client,
    // so there is no membership question for this service to answer.
    await hub.add(subscriber);

    await presence.touch(commandRedis, userId);

    subscriber.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "connection.ready",
        user_id: userId,
      }),
    );

    // Idle sockets are closed rather than left to accumulate. A phone that
    // went into a tunnel does not send a close frame, and without this the
    // process leaks a connection per such event.
    let idleTimer = setTimeout(() => {
      ws.close();
    }, IDLE_TIMEOUT_MS);

    const resetIdle = (): void => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        ws.close();
      }, IDLE_TIMEOUT_MS);
    };

    ws.on("message", (raw) => {
      resetIdle();
      void handleClientMessage(subscriber, ws, String(raw));
    });

    ws.on("pong", resetIdle);

    ws.on("close", () => {
      clearTimeout(idleTimer);
      const teardown = (async () => {
        // Ask before removing: `remove` is what forgets this socket, so
        // afterwards the hub can no longer tell whether it was the last one.
        const alone = !hub.hasOtherSocket(subscriber);
        await hub.remove(subscriber);
        // Only drop presence if this was the person's last socket. Two tabs
        // are one person, and closing one must not show them as offline.
        if (alone) await presence.clear(commandRedis, userId);
      })()
        // Nobody is waiting on this promise, so an unhandled rejection here
        // would take the whole process down — one socket closing during a
        // Redis blip should not disconnect the other ten thousand. Presence
        // expires on its own TTL anyway, which is why it can be left to.
        .catch((error: unknown) => {
          console.error("socket teardown failed", error);
        })
        .finally(() => {
          teardowns.delete(teardown);
        });
      teardowns.add(teardown);
    });
  }

  async function handleClientMessage(
    subscriber: Subscriber,
    ws: WebSocket,
    raw: string,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ws.close(CLOSE_BAD_MESSAGE, "malformed json");
      return;
    }

    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success) {
      // Anything not in the schema is either a bug or a probe. Neither is
      // worth keeping the socket open for.
      ws.close(CLOSE_BAD_MESSAGE, "unrecognised message");
      return;
    }

    const message = result.data;

    if (message.type === "subscribe") {
      // Ephemeral channels only. Messages arrive on the user's own channel,
      // which the client cannot name and cannot opt out of — so a forged
      // conversation id here buys typing indicators, never message content.
      await hub.subscribeEphemeral(subscriber, message.conversation_ids);
      return;
    }

    if (message.type === "typing") {
      const event: TypingEvent = {
        v: PROTOCOL_VERSION,
        type: "typing",
        conversation_id: message.conversation_id,
        user_id: subscriber.userId,
        is_typing: message.is_typing,
      };
      await hub.publishEphemeral(message.conversation_id, event);
      return;
    }

    if (message.type === "heartbeat") {
      // Refresh the TTL and say so, so the client can tell a live socket from
      // one that is open but no longer reaching Redis.
      await presence.touch(commandRedis, subscriber.userId);
      const event: PresenceEvent = {
        v: PROTOCOL_VERSION,
        type: "presence",
        user_id: subscriber.userId,
        online: true,
      };
      subscriber.send(JSON.stringify(event));
    }
  }

  async function close(): Promise<void> {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => {
      wss.close(() => {
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      http.close(() => {
        resolve();
      });
    });

    // Terminating the sockets above fired close handlers that unsubscribe
    // and clear presence. Let them finish before taking Redis away, or every
    // one of those commands rejects.
    await Promise.allSettled([...teardowns]);

    // `quit`, not `disconnect`: it drains what is already in flight.
    // `allSettled` because Redis may already be gone, and a shutdown that
    // throws is worse than one that does not.
    await Promise.allSettled([subscriberRedis.quit(), commandRedis.quit()]);
  }

  return { http, wss, hub, close };
}

/**
 * Pull the ticket out of the upgrade request's query string.
 *
 * A query parameter rather than a header because the browser's WebSocket
 * constructor cannot set headers. It is safe here only because the ticket
 * lives for sixty seconds — a long-lived credential in a URL ends up in
 * access logs and referrers.
 */
export function readTicket(request: IncomingMessage): string | undefined {
  if (request.url === undefined) return undefined;
  const url = new URL(request.url, "http://localhost");
  if (url.pathname !== "/ws") return undefined;
  return url.searchParams.get("ticket") ?? undefined;
}
