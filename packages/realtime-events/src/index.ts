import { z } from "zod";

/**
 * Socket event schemas, shared by `apps/realtime` and the browser.
 *
 * Both ends are TypeScript, so one Zod schema serves both — there is no third
 * hand-maintained description of anything. Note what is deliberately *not*
 * here: message payloads. Those are the output of the same DRF serializer the
 * REST endpoint returns, so their types already live in
 * `packages/api-client`. Restating one of them in this file would be the
 * exact failure mode `01-ARCHITECTURE.md` §3 exists to prevent.
 *
 * The split that organises this file is §8's: **if an event must survive a
 * restart it goes through Django; if it does not, it stays in Node.** Typing
 * and presence are the second kind and never reach Postgres.
 */

/** Wire protocol version. Bump only for a breaking envelope change. */
export const PROTOCOL_VERSION = 1;

/**
 * The envelope around every durable server-to-client event.
 *
 * These five fields are the only hand-typed part of the contract. `payload`
 * is `unknown` here on purpose: its real type comes from the generated API
 * client, and narrowing it belongs at the call site that knows which `type`
 * it asked for.
 */
export const serverEventSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.string(),
  conversation_id: z.string(),
  seq: z.number().int(),
  payload: z.unknown(),
});

export type ServerEvent = z.infer<typeof serverEventSchema>;

/**
 * What the gateway sends the moment a ticket checks out.
 *
 * Turns "did my socket actually authenticate?" from a guess into an
 * observation, which is what the reconnect logic keys off.
 */
export const connectionReadySchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("connection.ready"),
  user_id: z.string(),
});

export type ConnectionReady = z.infer<typeof connectionReadySchema>;

// ---------------------------------------------------------------------------
// Ephemeral events — browser ↔ Node, never Postgres
//
// "Nothing here is worth a database write or an HTTP request per keystroke."
// §8. A typing indicator that outlives a restart is a bug, not a feature.
// ---------------------------------------------------------------------------

/** Client → gateway: which conversations this socket wants to hear about. */
export const subscribeSchema = z.object({
  type: z.literal("subscribe"),
  conversation_ids: z.array(z.string()).max(200),
});

/** Client → gateway: I am typing / I stopped. */
export const typingSchema = z.object({
  type: z.literal("typing"),
  conversation_id: z.string(),
  is_typing: z.boolean(),
});

/** Client → gateway: keep this socket alive and my presence fresh. */
export const heartbeatSchema = z.object({ type: z.literal("heartbeat") });

export const clientMessageSchema = z.discriminatedUnion("type", [
  subscribeSchema,
  typingSchema,
  heartbeatSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Gateway → client: somebody else is typing. */
export const typingEventSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("typing"),
  conversation_id: z.string(),
  user_id: z.string(),
  is_typing: z.boolean(),
});

/** Gateway → client: somebody's presence changed. */
export const presenceEventSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("presence"),
  user_id: z.string(),
  online: z.boolean(),
});

export type TypingEvent = z.infer<typeof typingEventSchema>;
export type PresenceEvent = z.infer<typeof presenceEventSchema>;

/** Anything the gateway may send. */
export const anyServerEventSchema = z.union([
  connectionReadySchema,
  typingEventSchema,
  presenceEventSchema,
  serverEventSchema,
]);

export type AnyServerEvent = z.infer<typeof anyServerEventSchema>;

/**
 * Redis channel names — the one thing Django and the gateway must agree on.
 *
 * **Durable events are addressed per recipient, not per conversation.** Django
 * knows the members at publish time, so it publishes once per member to that
 * member's own channel. The gateway then subscribes a socket to exactly one
 * durable channel: the one named by the verified ticket.
 *
 * That is what lets the gateway hold no business logic and still be safe. A
 * per-conversation durable channel would mean the gateway had to answer "is
 * this user in that conversation?" — a database question, in a service that
 * `01-ARCHITECTURE.md` §8 forbids from touching Postgres. Fanning out to
 * `n` members instead costs `n` publishes, and `n` is two for a DM and at
 * most thirty-two for a group.
 *
 * Ephemeral events stay per-conversation, because typing has no recipient
 * list until you have one and the gateway cannot build one. The residual: a
 * client that already knows a conversation's id can subscribe to its typing
 * events without being a member. Ids are unguessable 63-bit snowflakes and
 * the leak is "someone is typing", never message content.
 */
export function userChannel(userId: string): string {
  return `user.${userId}`;
}

export function ephemeralChannel(conversationId: string): string {
  return `conv.${conversationId}.ephemeral`;
}
