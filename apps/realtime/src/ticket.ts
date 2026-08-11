import { jwtVerify } from "jose";

/**
 * Ticket verification.
 *
 * Django mints a short-lived HS256 JWT — `{sub: user_id, exp: now + 60s}` —
 * signed with the secret both services share. This gateway verifies the
 * signature locally and drops the ticket. Stateless, no database lookup on
 * connect, and a leaked ticket is worthless in a minute.
 *
 * Verify-only by design: this service holds no signing path at all.
 */

export class InvalidTicketError extends Error {}

export interface TicketClaims {
  readonly userId: string;
}

/**
 * Check a ticket and return who it belongs to.
 *
 * `jose` enforces `exp` itself, so an expired ticket throws rather than
 * quietly passing. The algorithm is pinned to HS256: leaving it open is how
 * `alg: none` and algorithm-confusion attacks get in.
 */
export async function verifyTicket(
  token: string,
  secret: string,
): Promise<TicketClaims> {
  const key = new TextEncoder().encode(secret);

  let subject: string | undefined;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    subject = payload.sub;
  } catch (cause) {
    throw new InvalidTicketError("ticket failed verification", { cause });
  }

  if (subject === undefined || subject === "") {
    throw new InvalidTicketError("ticket carries no subject");
  }

  return { userId: subject };
}
