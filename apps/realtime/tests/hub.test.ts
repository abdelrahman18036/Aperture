import { beforeEach, describe, expect, it, vi } from "vitest";

import { ephemeralChannel, userChannel } from "@repo/realtime-events";

import { Hub, type Subscriber } from "../src/hub.js";

/**
 * The fanout, tested without Redis.
 *
 * A fake subscriber connection rather than a real one, because none of what
 * matters here is about whether ioredis can reach a server: it is about
 * reference counting, which channel a socket ends up on, and whether anything
 * leaks when it disconnects. Those are the failures that would show up in
 * production as a slow memory climb rather than an error.
 */

interface FakeRedis {
  subscribed: Set<string>;
  subscribe: (channel: string) => Promise<void>;
  unsubscribe: (channel: string) => Promise<void>;
  publish: (channel: string, payload: string) => Promise<number>;
  published: { channel: string; payload: string }[];
  emit: (event: string, ...args: unknown[]) => void;
  on: (event: string, handler: (...args: never[]) => void) => void;
  /** Deliver a message as Redis would. */
  deliver: (channel: string, payload: string) => void;
}

function fakeRedis(): FakeRedis {
  const handlers = new Map<string, ((...args: never[]) => void)[]>();
  const redis: FakeRedis = {
    subscribed: new Set<string>(),
    published: [],
    subscribe: (channel: string) => {
      redis.subscribed.add(channel);
      return Promise.resolve();
    },
    unsubscribe: (channel: string) => {
      redis.subscribed.delete(channel);
      return Promise.resolve();
    },
    publish: (channel: string, payload: string) => {
      redis.published.push({ channel, payload });
      return Promise.resolve(1);
    },
    on: (event, handler) => {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
    emit: (event, ...args) => {
      for (const handler of handlers.get(event) ?? [])
        (handler as (...a: unknown[]) => void)(...args);
    },
    deliver: (channel, payload) => {
      redis.emit("message", channel, payload);
    },
  };
  return redis;
}

function makeHub(): {
  hub: Hub;
  subscriber: FakeRedis;
  publisher: FakeRedis;
} {
  const subscriber = fakeRedis();
  const publisher = fakeRedis();
  // The Hub only ever calls subscribe/unsubscribe/publish/on, so a structural
  // stand-in is enough — and a cast is cheaper than mocking all of ioredis.
  const hub = new Hub(
    subscriber as unknown as ConstructorParameters<typeof Hub>[0],
    publisher as unknown as ConstructorParameters<typeof Hub>[1],
  );
  return { hub, subscriber, publisher };
}

let nextId = 1;

function socket(userId: string): Subscriber & { received: string[] } {
  const received: string[] = [];
  return {
    id: nextId++,
    userId,
    received,
    send: (payload: string) => received.push(payload),
  };
}

beforeEach(() => {
  nextId = 1;
});

describe("durable subscription", () => {
  it("puts a socket on its own user channel and nowhere else", async () => {
    const { hub, subscriber } = makeHub();
    const alice = socket("101");

    await hub.add(alice);

    expect([...subscriber.subscribed]).toEqual([userChannel("101")]);
  });

  it("delivers a message published to that channel", async () => {
    const { hub, subscriber } = makeHub();
    const alice = socket("101");
    await hub.add(alice);

    subscriber.deliver(userChannel("101"), '{"type":"message.created"}');

    expect(alice.received).toEqual(['{"type":"message.created"}']);
  });

  it("does not deliver another user's message", async () => {
    const { hub, subscriber } = makeHub();
    const alice = socket("101");
    const bob = socket("202");
    await hub.add(alice);
    await hub.add(bob);

    subscriber.deliver(userChannel("202"), "for bob");

    expect(alice.received).toEqual([]);
    expect(bob.received).toEqual(["for bob"]);
  });

  it("reaches every tab the same person has open", async () => {
    const { hub, subscriber } = makeHub();
    const laptop = socket("101");
    const phone = socket("101");
    await hub.add(laptop);
    await hub.add(phone);

    subscriber.deliver(userChannel("101"), "hello");

    expect(laptop.received).toEqual(["hello"]);
    expect(phone.received).toEqual(["hello"]);
    // One Redis subscription, two sockets. That is the point of the hub.
    expect(subscriber.subscribed.size).toBe(1);
  });

  it("survives a subscribe call, which must not unsubscribe it", async () => {
    // The regression that would be worst in practice: opening a conversation
    // silently stops delivering that conversation's messages.
    const { hub, subscriber } = makeHub();
    const alice = socket("101");
    await hub.add(alice);

    await hub.subscribeEphemeral(alice, ["555", "666"]);

    expect(subscriber.subscribed.has(userChannel("101"))).toBe(true);

    subscriber.deliver(userChannel("101"), "still arriving");
    expect(alice.received).toEqual(["still arriving"]);
  });
});

describe("ephemeral subscription", () => {
  it("replaces rather than accumulates", async () => {
    const { hub, subscriber } = makeHub();
    const alice = socket("101");
    await hub.add(alice);

    await hub.subscribeEphemeral(alice, ["1", "2"]);
    await hub.subscribeEphemeral(alice, ["2", "3"]);

    expect([...subscriber.subscribed].sort()).toEqual(
      [
        userChannel("101"),
        ephemeralChannel("2"),
        ephemeralChannel("3"),
      ].sort(),
    );
    // Navigating away must actually stop the old subscription.
    expect(subscriber.subscribed.has(ephemeralChannel("1"))).toBe(false);
  });

  it("publishes through Redis so other replicas see it", async () => {
    // Delivering locally would make typing indicators work only for people
    // who happened to land on the same process.
    const { hub, publisher } = makeHub();
    const alice = socket("101");
    await hub.add(alice);

    await hub.publishEphemeral("777", { type: "typing" });

    expect(publisher.published).toEqual([
      { channel: ephemeralChannel("777"), payload: '{"type":"typing"}' },
    ]);
  });
});

describe("reference counting", () => {
  it("subscribes once for two interested sockets", async () => {
    const { hub, subscriber } = makeHub();
    const spy = vi.spyOn(subscriber, "subscribe");
    const alice = socket("101");
    const bob = socket("202");
    await hub.add(alice);
    await hub.add(bob);

    await hub.subscribeEphemeral(alice, ["shared"]);
    await hub.subscribeEphemeral(bob, ["shared"]);

    const shared = spy.mock.calls.filter(
      ([channel]) => channel === ephemeralChannel("shared"),
    );
    expect(shared).toHaveLength(1);
  });

  it("keeps the channel while anyone still wants it", async () => {
    const { hub, subscriber } = makeHub();
    const alice = socket("101");
    const bob = socket("202");
    await hub.add(alice);
    await hub.add(bob);
    await hub.subscribeEphemeral(alice, ["shared"]);
    await hub.subscribeEphemeral(bob, ["shared"]);

    await hub.remove(alice);

    expect(subscriber.subscribed.has(ephemeralChannel("shared"))).toBe(true);
    subscriber.deliver(ephemeralChannel("shared"), "typing");
    expect(bob.received).toEqual(["typing"]);
  });

  it("leaves nothing behind when the last socket goes", async () => {
    const { hub, subscriber } = makeHub();
    const alice = socket("101");
    await hub.add(alice);
    await hub.subscribeEphemeral(alice, ["a", "b", "c"]);

    await hub.remove(alice);

    expect(subscriber.subscribed.size).toBe(0);
    expect(hub.channelCount).toBe(0);
    expect(hub.socketCount).toBe(0);
  });

  it("does not deliver to a removed socket", async () => {
    const { hub, subscriber } = makeHub();
    const alice = socket("101");
    await hub.add(alice);
    await hub.remove(alice);

    subscriber.deliver(userChannel("101"), "too late");

    expect(alice.received).toEqual([]);
  });
});

describe("presence bookkeeping", () => {
  it("reports another socket while a second tab is open", async () => {
    // Closing one tab must not show someone as offline in the other.
    const { hub } = makeHub();
    const laptop = socket("101");
    const phone = socket("101");
    await hub.add(laptop);
    await hub.add(phone);

    expect(hub.hasOtherSocket(laptop)).toBe(true);

    await hub.remove(phone);
    expect(hub.hasOtherSocket(laptop)).toBe(false);
  });

  it("does not count a different person's socket", async () => {
    const { hub } = makeHub();
    const alice = socket("101");
    const bob = socket("202");
    await hub.add(alice);
    await hub.add(bob);

    expect(hub.hasOtherSocket(alice)).toBe(false);
  });
});
