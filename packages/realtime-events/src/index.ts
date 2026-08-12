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
 * Everything Django publishes after a commit.
 *
 * Named rather than left as `string` for two reasons. It makes the union
 * below a real discriminated union, so `event.type === "typing"` narrows
 * instead of leaving every field possibly-absent. And it puts the durable
 * event vocabulary in one place that both `messaging/events.py` and the
 * browser can be checked against.
 *
 * A type not in this list fails validation and the client drops the frame.
 * That is the correct behaviour for a client that does not understand an
 * event — but it does mean adding one in Django means adding it here too.
 */
export const durableEventTypeSchema = z.enum([
  "message.created",
  "message.read",
  "message.deleted",
]);

export type DurableEventType = z.infer<typeof durableEventTypeSchema>;

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
  type: durableEventTypeSchema,
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

/**
 * Client → gateway: which conversations and calls this socket wants.
 *
 * Two lists, because they are two different kinds of name. A conversation id
 * is long-lived and shared; a call id is minted per call by Django and given
 * only to people it has authorized — see `calls/services.py`. The gateway
 * treats both the same way, which is the point: it subscribes a socket to a
 * channel and knows nothing about what the channel means.
 */
export const subscribeSchema = z.object({
  type: z.literal("subscribe"),
  conversation_ids: z.array(z.string()).max(200),
  call_ids: z.array(z.string()).max(8).default([]),
});

/** Client → gateway: I am typing / I stopped. */
export const typingSchema = z.object({
  type: z.literal("typing"),
  conversation_id: z.string(),
  is_typing: z.boolean(),
});

/** Client → gateway: keep this socket alive and my presence fresh. */
export const heartbeatSchema = z.object({ type: z.literal("heartbeat") });

/**
 * Client → gateway: one step of a WebRTC negotiation.
 *
 * The payload is opaque here on purpose. An SDP offer is a multi-kilobyte
 * blob whose grammar belongs to the browser, and restating it in Zod would
 * mean a schema that breaks every time a codec is added. What *is* validated
 * is the envelope: which call, and which kind of step.
 *
 * None of this is persisted, and none of it passes through Django. It is
 * ephemeral by §8's rule — if it does not need to survive a restart, it stays
 * in Node.
 */
export const callSignalSchema = z.object({
  type: z.literal("call.signal"),
  call_id: z.string(),
  signal: z.enum(["offer", "answer", "ice", "hangup", "ringing"]),
  //: Recipient, for a mesh where more than one peer is on the channel. Absent
  //: means everyone else on the call.
  to: z.string().optional(),
  payload: z.unknown(),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  subscribeSchema,
  typingSchema,
  heartbeatSchema,
  callSignalSchema,
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

/**
 * Gateway → client: somebody's step of a negotiation.
 *
 * The gateway stamps `from` rather than taking it from the sender, so a
 * client cannot claim to be someone else on a call it has joined.
 */
export const callSignalEventSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("call.signal"),
  call_id: z.string(),
  signal: z.enum(["offer", "answer", "ice", "hangup", "ringing"]),
  from: z.string(),
  to: z.string().optional(),
  payload: z.unknown(),
});

/**
 * Django → client: your phone is ringing.
 *
 * The one call event that does *not* come from the socket's own traffic.
 * Ringing needs authorization, authorization needs a database, and the
 * gateway has neither — so Django publishes this to the callee's own durable
 * channel. The `call_id` it carries is the capability that lets everything
 * after it stay in Node.
 */
export const callInviteSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("call.incoming"),
  call_id: z.string(),
  conversation_id: z.string(),
  mode: z.enum(["p2p", "sfu"]),
  caller: z.object({ id: z.string(), username: z.string() }),
});

export type TypingEvent = z.infer<typeof typingEventSchema>;
export type PresenceEvent = z.infer<typeof presenceEventSchema>;
export type CallSignalEvent = z.infer<typeof callSignalEventSchema>;
export type CallInvite = z.infer<typeof callInviteSchema>;
export type CallSignalKind = CallSignalEvent["signal"];

/** Anything the gateway may send. */
export const anyServerEventSchema = z.union([
  connectionReadySchema,
  typingEventSchema,
  presenceEventSchema,
  callSignalEventSchema,
  callInviteSchema,
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

/**
 * The signalling channel for one call.
 *
 * Named by a snowflake Django minted for this call and handed only to the
 * people it authorized, which is what makes it safe for the gateway to fan
 * out offers and answers here without checking anything. It is per *call*
 * rather than per conversation deliberately: a conversation-derived name
 * would let anyone who was ever in a call listen to the next one.
 */
export function callChannel(callId: string): string {
  return `call.${callId}.signal`;
}
