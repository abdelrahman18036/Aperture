import type Redis from "ioredis";

/**
 * Presence — Redis keys with a TTL, refreshed by heartbeat.
 *
 * §8, verbatim: "Presence is Redis keys with a TTL, refreshed by heartbeat."
 * Nothing here is worth a database write, and a presence record that survives
 * a restart is worse than none — it says someone is online when the process
 * that knew about them is gone.
 *
 * The TTL is the whole design. A socket that dies without a close frame
 * simply stops refreshing, and the key expires. No cleanup job, no tombstone,
 * no "was that disconnect clean?" question to get wrong.
 */

/** Comfortably more than two heartbeat intervals, so one lost beat is fine. */
export const PRESENCE_TTL_SECONDS = 75;

function key(userId: string): string {
  return `presence:${userId}`;
}

/**
 * When somebody was last connected.
 *
 * A separate key with no TTL, because it has to *outlive* the presence one —
 * the whole point of "last seen 20 minutes ago" is that it is readable after
 * the presence key has expired. Written on every heartbeat rather than only
 * on disconnect: a socket that dies without a close frame never gets to write
 * anything, and the last heartbeat is within one interval of the truth.
 */
function lastSeenKey(userId: string): string {
  return `last-seen:${userId}`;
}

export async function touch(redis: Redis, userId: string): Promise<void> {
  await redis
    .multi()
    .set(key(userId), "1", "EX", PRESENCE_TTL_SECONDS)
    .set(lastSeenKey(userId), Date.now().toString())
    .exec();
}

export async function clear(redis: Redis, userId: string): Promise<void> {
  // The presence key goes; the timestamp stays, and stays accurate — this
  // *is* the moment they were last seen.
  await redis
    .multi()
    .del(key(userId))
    .set(lastSeenKey(userId), Date.now().toString())
    .exec();
}

export async function isOnline(redis: Redis, userId: string): Promise<boolean> {
  return (await redis.exists(key(userId))) === 1;
}
