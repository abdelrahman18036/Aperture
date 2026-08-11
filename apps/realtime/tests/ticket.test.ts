import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { InvalidTicketError, verifyTicket } from "../src/ticket.js";

const SECRET = "test-secret-that-is-long-enough-for-hs256";
const key = new TextEncoder().encode(SECRET);

async function mintTicket(options: {
  subject?: string;
  expiresIn?: string;
  algorithm?: string;
  secret?: string;
}): Promise<string> {
  const builder = new SignJWT({}).setProtectedHeader({
    alg: options.algorithm ?? "HS256",
  });
  if (options.subject !== undefined) {
    builder.setSubject(options.subject);
  }
  return builder
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "60s")
    .sign(
      options.secret === undefined
        ? key
        : new TextEncoder().encode(options.secret),
    );
}

describe("verifyTicket", () => {
  it("accepts a ticket Django would have minted", async () => {
    const token = await mintTicket({ subject: "80728620347162624" });
    await expect(verifyTicket(token, SECRET)).resolves.toEqual({
      userId: "80728620347162624",
    });
  });

  it("rejects a ticket signed with a different secret", async () => {
    const token = await mintTicket({
      subject: "1",
      secret: "a-completely-different-secret-value",
    });
    await expect(verifyTicket(token, SECRET)).rejects.toBeInstanceOf(
      InvalidTicketError,
    );
  });

  it("rejects an expired ticket", async () => {
    // A leaked ticket must be worthless within the minute. jose enforces exp
    // itself, so this is checking that we did not disable that.
    const token = await mintTicket({ subject: "1", expiresIn: "-10s" });
    await expect(verifyTicket(token, SECRET)).rejects.toBeInstanceOf(
      InvalidTicketError,
    );
  });

  it("rejects a ticket with no subject", async () => {
    const token = await mintTicket({});
    await expect(verifyTicket(token, SECRET)).rejects.toBeInstanceOf(
      InvalidTicketError,
    );
  });

  it("rejects garbage", async () => {
    await expect(verifyTicket("not-a-jwt", SECRET)).rejects.toBeInstanceOf(
      InvalidTicketError,
    );
  });
});
