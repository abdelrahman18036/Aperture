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
 * Phase 6 fills in the ephemeral events — typing, presence, read receipts —
 * and Phase 7 adds call signalling as another ephemeral class on this same
 * socket.
 */

/** Wire protocol version. Bump only for a breaking envelope change. */
export const PROTOCOL_VERSION = 1;

/**
 * The envelope around every server-to-client event.
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
 * What the gateway sends a client the moment its ticket checks out.
 *
 * Not strictly required by the protocol, but it turns "did my socket
 * actually authenticate?" from a guess into an observation, which matters
 * during Phase 6's reconnect work.
 */
export const connectionReadySchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal("connection.ready"),
  user_id: z.string(),
});

export type ConnectionReady = z.infer<typeof connectionReadySchema>;
