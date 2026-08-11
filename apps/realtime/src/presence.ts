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

export async function touch(redis: Redis, userId: string): Promise<void> {
  await redis.set(key(userId), "1", "EX", PRESENCE_TTL_SECONDS);
}

export async function clear(redis: Redis, userId: string): Promise<void> {
  await redis.del(key(userId));
}

export async function isOnline(redis: Redis, userId: string): Promise<boolean> {
  return (await redis.exists(key(userId))) === 1;
}
