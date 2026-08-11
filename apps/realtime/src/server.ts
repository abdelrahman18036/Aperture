import { createServer, type IncomingMessage, type Server } from "node:http";

import Redis from "ioredis";
import { WebSocketServer, type WebSocket } from "ws";

import { PROTOCOL_VERSION } from "@repo/realtime-events";

import { config } from "./config.js";
import { InvalidTicketError, verifyTicket } from "./ticket.js";

/**
 * The socket gateway.
 *
 * Its whole job: authenticate a connection, subscribe it to Redis channels,
 * push bytes. No models, no migrations, no ORM, no business logic. Everything
 * durable belongs to Django — break that and you have two applications
 * fighting over one schema, which is far worse than the problem it solves.
 *
 * Phase 1 gets it to the point of starting, reaching Redis, and accepting an
 * authenticated socket. Phase 6 adds the pub/sub fanout, the ephemeral event
 * classes and reconnect sync.
 */

/** Close codes. 4000+ is the application-defined range. */
const CLOSE_UNAUTHORIZED = 4001;

export interface Gateway {
  readonly http: Server;
  readonly wss: WebSocketServer;
  close: () => Promise<void>;
}

export function createGateway(): Gateway {
  const http = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", sockets: wss.clients.size }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  // `noServer` so the upgrade is handled explicitly below: a socket that
  // fails ticket verification must never reach the WebSocket layer.
  const wss = new WebSocketServer({ noServer: true });

  const redis = new Redis(config.redisUrl, { lazyConnect: true });

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
          onConnection(ws, claims.userId);
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

  function onConnection(ws: WebSocket, userId: string): void {
    ws.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "connection.ready",
        user_id: userId,
      }),
    );

    // Phase 6 subscribes this socket to its conversation channels here and
    // fans Redis messages out to it. Until then the connection is proof the
    // authentication path works, and nothing more.
    ws.on("message", () => {
      ws.close(CLOSE_UNAUTHORIZED, "client messages arrive in Phase 6");
    });
  }

  async function close(): Promise<void> {
    for (const client of wss.clients) {
      client.terminate();
    }
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
    redis.disconnect();
  }

  return { http, wss, close };
}

/**
 * Pull the ticket out of the upgrade request's query string.
 *
 * A query parameter rather than a header because the browser's WebSocket
 * constructor cannot set headers. It is safe here only because the ticket
 * lives for sixty seconds — a long-lived credential in a URL would end up in
 * access logs and referrers.
 */
export function readTicket(request: IncomingMessage): string | undefined {
  if (request.url === undefined) return undefined;
  const url = new URL(request.url, "http://localhost");
  if (url.pathname !== "/ws") return undefined;
  return url.searchParams.get("ticket") ?? undefined;
}
