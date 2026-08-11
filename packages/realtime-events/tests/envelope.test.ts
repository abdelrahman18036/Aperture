import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  connectionReadySchema,
  serverEventSchema,
} from "../src/index.js";

describe("serverEventSchema", () => {
  it("accepts the envelope 01-ARCHITECTURE.md §3 specifies", () => {
    const event = {
      v: 1,
      type: "message.created",
      conversation_id: "80728620347162624",
      seq: 4821,
      payload: { body: "anything — its real type comes from api-client" },
    };
    expect(serverEventSchema.parse(event)).toEqual(event);
  });

  it("rejects an envelope from a different protocol version", () => {
    expect(() =>
      serverEventSchema.parse({
        v: 2,
        type: "message.created",
        conversation_id: "1",
        seq: 1,
        payload: null,
      }),
    ).toThrow();
  });

  it("rejects a non-integer seq", () => {
    // seq is a server-allocated counter. A float here would mean something
    // upstream is deriving it from a clock, which is the thing seq exists to
    // avoid.
    expect(() =>
      serverEventSchema.parse({
        v: PROTOCOL_VERSION,
        type: "message.created",
        conversation_id: "1",
        seq: 1.5,
        payload: null,
      }),
    ).toThrow();
  });

  it("requires a conversation id", () => {
    expect(() =>
      serverEventSchema.parse({
        v: PROTOCOL_VERSION,
        type: "message.created",
        seq: 1,
        payload: null,
      }),
    ).toThrow();
  });
});

describe("connectionReadySchema", () => {
  it("accepts what the gateway sends on a verified socket", () => {
    expect(
      connectionReadySchema.parse({
        v: PROTOCOL_VERSION,
        type: "connection.ready",
        user_id: "80728620347162624",
      }),
    ).toEqual({
      v: 1,
      type: "connection.ready",
      user_id: "80728620347162624",
    });
  });
});
