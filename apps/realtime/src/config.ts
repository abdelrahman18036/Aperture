/**
 * Configuration, read once at startup.
 *
 * Note what is absent and must stay absent: any database URL. This service
 * never touches Postgres. If a connection string for one turns up in this
 * file, something has gone wrong — see `01-ARCHITECTURE.md` §8.
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`${name} must be set`);
  }
  return value;
}

export const config = {
  port: Number(process.env.REALTIME_PORT ?? 4000),

  redisUrl: required("REDIS_URL", "redis://localhost:6379/0"),

  /**
   * Shared with Django, which signs 60-second HS256 tickets with it. This
   * service only ever verifies — it never signs — and it never calls back to
   * Django to check a socket.
   */
  ticketSecret: required(
    "REALTIME_TICKET_SECRET",
    "dev-only-insecure-ticket-secret-0123456789abcdef",
  ),
} as const;
