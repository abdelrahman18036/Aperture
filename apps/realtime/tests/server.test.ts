import type { AddressInfo } from "node:net";

import Redis from "ioredis";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { PROTOCOL_VERSION, userChannel } from "@repo/realtime-events";

import { config } from "../src/config.js";
import { createGateway, type Gateway } from "../src/server.js";

/**
 * The gateway end to end: a real HTTP upgrade, a real WebSocket, a real Redis.
 *
 * Requires Redis, the same way the Python suite requires Postgres. A socket
 * test that fakes the socket and fakes Redis is testing the fake — and the
 * failures worth catching here (an upgrade that hangs, a channel nobody is
 * listening on, a close that leaks) only appear when the real pieces are
 * connected.
 *
 * Django is *not* running here. It does not need to be: the gateway verifies
 * tickets locally and learns about messages from Redis, so publishing to a
 * channel by hand is exactly what Django would do after commit.
 */

const key = new TextEncoder().encode(config.ticketSecret);

let gateway: Gateway;
let port: number;
let publisher: Redis;

async function mint(userId: string, expiresIn = "60s"): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

/** Open a socket and wait for the gateway to say it is ready. */
async function connect(ticket: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws?ticket=${ticket}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  await nextMessage(ws); // connection.ready
  return ws;
}

/** The next frame, or a rejection — never a hang. */
async function nextMessage(ws: WebSocket, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("timed out waiting for a frame"));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData): void => {
      clearTimeout(timer);
      resolve(JSON.parse(String(raw)));
    };
    ws.once("message", onMessage);
  });
}

async function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once("close", (code: number) => resolve(code));
  });
}

beforeAll(async () => {
  gateway = createGateway();
  await new Promise<void>((resolve) => {
    gateway.http.listen(0, "127.0.0.1", () => resolve());
  });
  port = (gateway.http.address() as AddressInfo).port;
  publisher = new Redis(config.redisUrl);
});

afterAll(async () => {
  publisher.disconnect();
  await gateway.close();
});

describe("the upgrade", () => {
  it("refuses a connection with no ticket", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
    await expect(
      new Promise((_, reject) => {
        ws.once("error", reject);
        ws.once("open", () => reject(new Error("should not have opened")));
      }),
    ).rejects.toThrow(/401/);
  });

  it("refuses a forged ticket", async () => {
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("999")
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode("not-the-shared-secret-but-long-enough"));

    const ws = new WebSocket(
      `ws://127.0.0.1:${String(port)}/ws?ticket=${forged}`,
    );
    await expect(
      new Promise((_, reject) => {
        ws.once("error", reject);
        ws.once("open", () => reject(new Error("should not have opened")));
      }),
    ).rejects.toThrow(/401/);
  });

  it("refuses an expired ticket", async () => {
    // Sixty seconds is the whole reason a ticket may travel in a URL.
    const stale = await mint("101", "-10s");
    const ws = new WebSocket(
      `ws://127.0.0.1:${String(port)}/ws?ticket=${stale}`,
    );
    await expect(
      new Promise((_, reject) => {
        ws.once("error", reject);
        ws.once("open", () => reject(new Error("should not have opened")));
      }),
    ).rejects.toThrow(/401/);
  });

  it("accepts a valid ticket and says who it thinks you are", async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${String(port)}/ws?ticket=${await mint("101")}`,
    );
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    expect(await nextMessage(ws)).toEqual({
      v: PROTOCOL_VERSION,
      type: "connection.ready",
      user_id: "101",
    });
    ws.close();
  });
});

describe("delivery", () => {
  it("delivers what Django publishes to the recipient's channel", async () => {
    const ws = await connect(await mint("101"));
    const envelope = {
      v: PROTOCOL_VERSION,
      type: "message.created",
      conversation_id: "80750720826998780",
      seq: 7,
      payload: { body: "hello" },
    };

    // Exactly what messaging/events.py does after the transaction commits.
    await publisher.publish(userChannel("101"), JSON.stringify(envelope));

    expect(await nextMessage(ws)).toEqual(envelope);
    ws.close();
  });

  it("does not deliver another user's messages", async () => {
    const ws = await connect(await mint("101"));

    await publisher.publish(userChannel("202"), JSON.stringify({ seq: 1 }));
    // Then something addressed to us, so the assertion is about ordering
    // rather than about a timeout that might just be slow.
    await publisher.publish(
      userChannel("101"),
      JSON.stringify({ seq: 2, mine: true }),
    );

    expect(await nextMessage(ws)).toMatchObject({ mine: true });
    ws.close();
  });

  it("cannot be talked into someone else's durable channel", async () => {
    // `subscribe` names conversations, never users — the durable channel comes
    // from the verified ticket and the client never gets to choose it.
    const ws = await connect(await mint("101"));
    ws.send(
      JSON.stringify({
        type: "subscribe",
        conversation_ids: ["user.202", "202", "*"],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    await publisher.publish(userChannel("202"), JSON.stringify({ secret: 1 }));
    await publisher.publish(userChannel("101"), JSON.stringify({ mine: true }));

    expect(await nextMessage(ws)).toMatchObject({ mine: true });
    ws.close();
  });
});

describe("ephemeral events", () => {
  it("carries typing between two sockets in the same conversation", async () => {
    const alice = await connect(await mint("101"));
    const bob = await connect(await mint("202"));

    for (const ws of [alice, bob]) {
      ws.send(
        JSON.stringify({ type: "subscribe", conversation_ids: ["4242"] }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    alice.send(
      JSON.stringify({
        type: "typing",
        conversation_id: "4242",
        is_typing: true,
      }),
    );

    expect(await nextMessage(bob)).toEqual({
      v: PROTOCOL_VERSION,
      type: "typing",
      conversation_id: "4242",
      user_id: "101",
      is_typing: true,
    });

    alice.close();
    bob.close();
  });

  it("answers a heartbeat and refreshes presence", async () => {
    const ws = await connect(await mint("303"));
    ws.send(JSON.stringify({ type: "heartbeat" }));

    expect(await nextMessage(ws)).toMatchObject({
      type: "presence",
      user_id: "303",
      online: true,
    });

    // The TTL, not a row: a presence record that outlives the process is worse
    // than none at all.
    const ttl = await publisher.ttl("presence:303");
    expect(ttl).toBeGreaterThan(0);
    ws.close();
  });

  it("clears presence when the last socket closes", async () => {
    const ws = await connect(await mint("404"));
    expect(await publisher.exists("presence:404")).toBe(1);

    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await publisher.exists("presence:404")).toBe(0);
  });

  it("keeps presence while another tab is still open", async () => {
    const laptop = await connect(await mint("505"));
    const phone = await connect(await mint("505"));

    laptop.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await publisher.exists("presence:505")).toBe(1);
    phone.close();
  });
});

describe("bad clients", () => {
  it("closes a socket that sends malformed json", async () => {
    const ws = await connect(await mint("101"));
    ws.send("this is not json");
    expect(await closed(ws)).toBe(4002);
  });

  it("closes a socket that sends something not in the schema", async () => {
    // Either a bug or a probe. Neither is worth holding a connection for.
    const ws = await connect(await mint("101"));
    ws.send(JSON.stringify({ type: "drop table", conversation_ids: [] }));
    expect(await closed(ws)).toBe(4002);
  });

  it("frees the channel when a bad client is closed", async () => {
    const before = gateway.hub.channelCount;
    const ws = await connect(await mint("606"));
    ws.send("nonsense");
    await closed(ws);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(gateway.hub.channelCount).toBe(before);
  });
});

describe("health", () => {
  it("reports live socket and channel counts", async () => {
    const ws = await connect(await mint("707"));

    const response = await fetch(`http://127.0.0.1:${String(port)}/health`);
    const body = (await response.json()) as {
      status: string;
      sockets: number;
      channels: number;
    };

    expect(body.status).toBe("ok");
    expect(body.sockets).toBeGreaterThan(0);
    expect(body.channels).toBeGreaterThan(0);
    ws.close();
  });
});

describe("call signalling", () => {
  it("carries an offer between two sockets on the same call", async () => {
    // The call id stands in for one Django minted and handed to both parties.
    const callId = "80831119628435456";
    const alice = await connect(await mint("101"));
    const bob = await connect(await mint("202"));

    for (const ws of [alice, bob]) {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          conversation_ids: [],
          call_ids: [callId],
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    alice.send(
      JSON.stringify({
        type: "call.signal",
        call_id: callId,
        signal: "offer",
        payload: { sdp: "v=0 fake offer", type: "offer" },
      }),
    );

    expect(await nextMessage(bob)).toEqual({
      v: PROTOCOL_VERSION,
      type: "call.signal",
      call_id: callId,
      signal: "offer",
      from: "101",
      payload: { sdp: "v=0 fake offer", type: "offer" },
    });

    alice.close();
    bob.close();
  });

  it("stamps `from` from the ticket, not from the message", async () => {
    // A client that could name its own `from` could impersonate the other
    // party mid-negotiation and substitute its own SDP.
    const callId = "80831119628435457";
    const alice = await connect(await mint("101"));
    const bob = await connect(await mint("202"));

    for (const ws of [alice, bob]) {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          conversation_ids: [],
          call_ids: [callId],
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    alice.send(
      JSON.stringify({
        type: "call.signal",
        call_id: callId,
        signal: "ice",
        from: "999",
        payload: { candidate: "candidate:1 1 udp" },
      }),
    );

    expect(await nextMessage(bob)).toMatchObject({ from: "101" });

    alice.close();
    bob.close();
  });

  it("does not carry a signal to a socket on a different call", async () => {
    const alice = await connect(await mint("101"));
    const bob = await connect(await mint("202"));

    alice.send(
      JSON.stringify({
        type: "subscribe",
        conversation_ids: [],
        call_ids: ["80831119628435458"],
      }),
    );
    bob.send(
      JSON.stringify({
        type: "subscribe",
        conversation_ids: [],
        call_ids: ["80831119628435459"],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    alice.send(
      JSON.stringify({
        type: "call.signal",
        call_id: "80831119628435458",
        signal: "offer",
        payload: { sdp: "not for bob" },
      }),
    );
    // Then something bob is entitled to, so this asserts ordering rather than
    // a timeout that might merely be slow.
    await publisher.publish(
      userChannel("202"),
      JSON.stringify({ mine: true }),
    );

    expect(await nextMessage(bob)).toMatchObject({ mine: true });

    alice.close();
    bob.close();
  });

  it("delivers the invite Django publishes to a callee's own channel", async () => {
    // Ringing is the one call event that does not come from the socket:
    // it needs authorization, so Django sends it. Exactly what
    // `calls/events.py` publishes.
    const bob = await connect(await mint("202"));

    const invite = {
      v: PROTOCOL_VERSION,
      type: "call.incoming",
      call_id: "80831119628435460",
      conversation_id: "80778627226009600",
      mode: "p2p",
      caller: { id: "101", username: "alice" },
    };
    await publisher.publish(userChannel("202"), JSON.stringify(invite));

    expect(await nextMessage(bob)).toEqual(invite);
    bob.close();
  });

  it("frees the call channel when the client hangs up", async () => {
    // Hanging up is a `subscribe` without that call in it — the same
    // replace-rather-than-add rule the conversation list uses.
    const callId = "80831119628435461";
    const alice = await connect(await mint("101"));

    alice.send(
      JSON.stringify({
        type: "subscribe",
        conversation_ids: [],
        call_ids: [callId],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const during = gateway.hub.channelCount;

    alice.send(
      JSON.stringify({ type: "subscribe", conversation_ids: [], call_ids: [] }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(gateway.hub.channelCount).toBe(during - 1);
    alice.close();
  });
});
