import Redis from "ioredis";

import {
  callChannel,
  ephemeralChannel,
  userChannel,
} from "@repo/realtime-events";

/**
 * The fanout. One Redis subscriber for the whole process, many sockets.
 *
 * A subscriber connection per socket would mean ten thousand Redis
 * connections per replica, which is exactly the thing this service exists to
 * avoid — the whole reason sockets are in Node is connection density, and
 * spending that density on the backend instead of the frontend would be
 * self-defeating.
 *
 * So: one subscriber, a channel-to-sockets map, and reference counting so a
 * channel is unsubscribed when the last interested socket leaves.
 *
 * **No Postgres.** This service authenticates a connection, subscribes it to
 * channels, and pushes bytes. It learns that a message exists because Django
 * published it after committing — `01-ARCHITECTURE.md` §8.
 */

export interface Subscriber {
  readonly id: number;
  readonly userId: string;
  send: (payload: string) => void;
}

export class Hub {
  /** Channel → the sockets that asked for it. */
  private readonly channels = new Map<string, Set<Subscriber>>();
  /** Socket → the channels it holds, so teardown is O(its own channels). */
  private readonly held = new Map<Subscriber, Set<string>>();
  /** User → their sockets, so two tabs are correctly one presence. */
  private readonly byUser = new Map<string, Set<Subscriber>>();

  /**
   * Two connections, not one. A Redis connection in subscriber mode cannot
   * issue any other command, so publishing ephemeral events needs its own.
   */
  constructor(
    private readonly redis: Redis,
    private readonly publisher: Redis,
  ) {
    this.redis.on("message", (channel, payload) => {
      this.deliver(channel, payload);
    });
  }

  get socketCount(): number {
    return this.held.size;
  }

  get channelCount(): number {
    return this.channels.size;
  }

  /**
   * Attach a socket and give it its durable channel.
   *
   * That channel is derived from the verified ticket and nothing else, which
   * is the whole security argument: a socket cannot ask for someone else's
   * messages because it never gets to name the channel they arrive on.
   */
  async add(subscriber: Subscriber): Promise<void> {
    this.held.set(subscriber, new Set());

    let siblings = this.byUser.get(subscriber.userId);
    if (!siblings) {
      siblings = new Set();
      this.byUser.set(subscriber.userId, siblings);
    }
    siblings.add(subscriber);

    await this.attach(subscriber, userChannel(subscriber.userId));
  }

  /**
   * Point a socket at some conversations' and calls' **ephemeral** channels.
   *
   * Replacing rather than adding: a client that navigates sends its current
   * list, so a stale subscription cannot outlive the screen that wanted it.
   * Hanging up is therefore just a `subscribe` without that call in it.
   *
   * The durable channel added by `add()` is preserved — losing it here would
   * silently stop delivering messages the moment someone opened a thread, and
   * stop the phone ringing the moment they joined a call.
   */
  async subscribeEphemeral(
    subscriber: Subscriber,
    conversationIds: readonly string[],
    callIds: readonly string[] = [],
  ): Promise<void> {
    const durable = userChannel(subscriber.userId);
    const wanted = new Set<string>([durable]);
    for (const id of conversationIds) wanted.add(ephemeralChannel(id));
    for (const id of callIds) wanted.add(callChannel(id));

    const current = this.held.get(subscriber) ?? new Set<string>();

    for (const channel of current) {
      if (!wanted.has(channel)) await this.detach(subscriber, channel);
    }
    for (const channel of wanted) {
      if (!current.has(channel)) await this.attach(subscriber, channel);
    }

    this.held.set(subscriber, wanted);
  }

  /**
   * Publish an ephemeral event.
   *
   * Through Redis rather than delivered locally, so a typing indicator
   * reaches people whose socket landed on a different replica. One round trip,
   * and it is the difference between the feature working and working only for
   * one server's worth of users.
   */
  async publishEphemeral(
    conversationId: string,
    payload: unknown,
  ): Promise<void> {
    await this.publisher.publish(
      ephemeralChannel(conversationId),
      JSON.stringify(payload),
    );
  }

  /**
   * Publish one step of a call negotiation.
   *
   * Through Redis for the same reason typing is: two people on a call may
   * well have landed on different replicas, and an offer delivered only to
   * the process that received it is a call that never connects.
   *
   * Deliberately unchecked. The channel is named by a call id Django minted
   * and handed only to authorized participants, so the check has already
   * happened somewhere with a database — see `calls/services.py`.
   */
  async publishCallSignal(callId: string, payload: unknown): Promise<void> {
    await this.publisher.publish(
      callChannel(callId),
      JSON.stringify(payload),
    );
  }

  /** Whether this user still has another socket here. Two tabs are one person. */
  hasOtherSocket(subscriber: Subscriber): boolean {
    const siblings = this.byUser.get(subscriber.userId);
    if (!siblings) return false;
    return [...siblings].some((other) => other.id !== subscriber.id);
  }

  async remove(subscriber: Subscriber): Promise<void> {
    const channels = this.held.get(subscriber);
    if (channels) {
      for (const channel of channels) await this.detach(subscriber, channel);
    }
    this.held.delete(subscriber);

    const siblings = this.byUser.get(subscriber.userId);
    if (siblings) {
      siblings.delete(subscriber);
      if (siblings.size === 0) this.byUser.delete(subscriber.userId);
    }
  }

  private async attach(subscriber: Subscriber, channel: string): Promise<void> {
    let subscribers = this.channels.get(channel);
    if (!subscribers) {
      subscribers = new Set();
      this.channels.set(channel, subscribers);
      // First socket to want this channel pays for the Redis subscribe.
      await this.redis.subscribe(channel);
    }
    subscribers.add(subscriber);

    const held = this.held.get(subscriber);
    if (held) held.add(channel);
  }

  private async detach(subscriber: Subscriber, channel: string): Promise<void> {
    const subscribers = this.channels.get(channel);
    if (!subscribers) return;
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      this.channels.delete(channel);
      // Last one out unsubscribes, so an idle replica holds no channels.
      await this.redis.unsubscribe(channel);
    }
  }

  private deliver(channel: string, payload: string): void {
    const subscribers = this.channels.get(channel);
    if (!subscribers) return;
    for (const subscriber of subscribers) subscriber.send(payload);
  }
}
