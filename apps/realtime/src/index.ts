import Redis from "ioredis";

import { config } from "./config.js";
import { createGateway } from "./server.js";

/**
 * Entry point — `node apps/realtime`, or `pnpm dev` for the watch mode.
 *
 * Scales on concurrent sockets rather than request rate, which is the whole
 * reason this is a separate Node service instead of part of the Django
 * process: Python holds roughly 1-5k WebSocket connections, Node holds
 * 10-50k, and this service has no business logic to complicate the split.
 */

async function main(): Promise<void> {
  // Fail loudly at startup rather than on the first message. Redis is not
  // optional here: it is the only thing connecting this gateway to Django.
  const probe = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await probe.connect();
  await probe.ping();
  probe.disconnect();

  const gateway = createGateway();

  gateway.http.listen(config.port, () => {
    console.info(
      `realtime gateway listening on :${String(config.port)} (redis ok)`,
    );
  });

  const shutdown = (signal: string): void => {
    console.info(`${signal} received, closing sockets`);
    void gateway.close().then(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

main().catch((error: unknown) => {
  console.error("realtime gateway failed to start", error);
  process.exit(1);
});
