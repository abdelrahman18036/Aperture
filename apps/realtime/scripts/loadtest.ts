/**
 * How many sockets does one gateway process hold before latency degrades?
 *
 * `03-AGENT-BRIEF.md` asks for this by name, and the reason it asks is worth
 * restating: the socket ceiling is the number the whole three-service split
 * is justified by. Guessing at it means the justification is a guess too.
 *
 * What is measured is the **round trip that matters**: a client sends a
 * typing event, the gateway publishes it to Redis, Redis fans it back out,
 * and the client receives it. That path includes everything a real message
 * traverses except the Postgres write, so it is the latency a person actually
 * feels when someone is typing at them.
 *
 * Run it against a gateway you started yourself:
 *
 *     pnpm --filter realtime loadtest
 *     pnpm --filter realtime loadtest -- --max 20000 --budget 150
 *
 * It ramps in waves and stops at the first wave whose p95 exceeds the budget,
 * reporting the last wave that held. Tickets are signed locally with the
 * shared secret rather than fetched from Django — the gateway cannot tell the
 * difference, and it keeps Django out of the measurement.
 */

import { SignJWT } from "jose";
import WebSocket from "ws";

import { config } from "../src/config.js";

interface Options {
  waves: number[];
  budgetMs: number;
  samplesPerWave: number;
  sourceAddresses: string[];
}

/**
 * Source addresses to spread client sockets across.
 *
 * Not a detail. Every outbound connection burns an ephemeral port on the
 * source address, and Windows hands out roughly 16k of them per address —
 * so a single-address harness hits `EADDRINUSE` around ten thousand sockets
 * and reports a limit that belongs to *itself*. The whole loopback /8 is
 * local, so cycling through eight addresses multiplies the pool and the
 * measurement stays about the server.
 */
const DEFAULT_SOURCES = Array.from(
  { length: 8 },
  (_, index) => `127.0.0.${String(index + 1)}`,
);

function parseOptions(argv: string[]): Options {
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const max = Number(read("--max") ?? 8000);
  const budgetMs = Number(read("--budget") ?? 200);
  const samplesPerWave = Number(read("--samples") ?? 200);

  const waves: number[] = [];
  for (let size = 250; size <= max; size *= 2) waves.push(size);
  if (waves.at(-1) !== max) waves.push(max);

  const sources = read("--sources");
  const sourceAddresses =
    sources === undefined ? DEFAULT_SOURCES : sources.split(",");

  return { waves, budgetMs, samplesPerWave, sourceAddresses };
}

const key = new TextEncoder().encode(config.ticketSecret);

async function mint(userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("120s")
    .sign(key);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? Number.NaN;
}

interface Client {
  ws: WebSocket;
  conversationId: string;
  /** Resolves the pending round trip, if one is outstanding. */
  pending: ((latencyMs: number) => void) | null;
  sentAt: number;
}

const host = `ws://127.0.0.1:${String(config.port)}/ws`;
const clients: Client[] = [];

async function openClient(
  index: number,
  sourceAddresses: string[],
): Promise<Client | null> {
  const ticket = await mint(900_000 + index);
  // Each socket gets its own conversation, so an echo can only come from the
  // round trip it belongs to. Sharing one would measure fanout instead.
  const conversationId = String(500_000 + index);

  return new Promise<Client | null>((resolve) => {
    const ws = new WebSocket(`${host}?ticket=${ticket}`, {
      localAddress: sourceAddresses[index % sourceAddresses.length],
    });
    const client: Client = { ws, conversationId, pending: null, sentAt: 0 };

    const giveUp = setTimeout(() => {
      ws.terminate();
      resolve(null);
    }, 15_000);

    ws.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string };
      if (frame.type === "connection.ready") {
        ws.send(
          JSON.stringify({
            type: "subscribe",
            conversation_ids: [conversationId],
          }),
        );
        clearTimeout(giveUp);
        resolve(client);
        return;
      }
      if (frame.type === "typing" && client.pending !== null) {
        const settle = client.pending;
        client.pending = null;
        settle(performance.now() - client.sentAt);
      }
    });

    ws.on("error", () => {
      clearTimeout(giveUp);
      resolve(null);
    });
  });
}

async function roundTrip(client: Client): Promise<number> {
  return new Promise<number>((resolve) => {
    const timeout = setTimeout(() => {
      client.pending = null;
      resolve(Number.POSITIVE_INFINITY);
    }, 10_000);

    client.pending = (latency) => {
      clearTimeout(timeout);
      resolve(latency);
    };
    client.sentAt = performance.now();
    client.ws.send(
      JSON.stringify({
        type: "typing",
        conversation_id: client.conversationId,
        is_typing: true,
      }),
    );
  });
}

async function health(): Promise<{ sockets: number; channels: number }> {
  const response = await fetch(`http://127.0.0.1:${String(config.port)}/health`);
  return (await response.json()) as { sockets: number; channels: number };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  console.info(`gateway   ${host}`);
  console.info(`sources   ${options.sourceAddresses.join(", ")}`);
  console.info(`budget    p95 <= ${String(options.budgetMs)}ms`);
  console.info(`waves     ${options.waves.join(", ")}`);
  console.info("");
  console.info("sockets   opened   failed   p50      p95      p99      max");

  let lastGood = 0;

  for (const target of options.waves) {
    let failed = 0;
    // Open in batches: a few thousand simultaneous handshakes says more about
    // the client's event loop than the server's.
    while (clients.length < target) {
      const batch = Math.min(250, target - clients.length);
      const opened = await Promise.all(
        Array.from({ length: batch }, (_, offset) =>
          openClient(clients.length + offset, options.sourceAddresses),
        ),
      );
      for (const client of opened) {
        if (client === null) failed += 1;
        else clients.push(client);
      }
      if (failed > 0 && opened.every((c) => c === null)) break;
    }

    // Let the process settle before measuring; a wave of handshakes leaves
    // work queued that would otherwise be blamed on latency.
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const sample = Array.from(
      { length: Math.min(options.samplesPerWave, clients.length) },
      (_, i) => clients[Math.floor((i * clients.length) / options.samplesPerWave)],
    ).filter((c): c is Client => c !== undefined);

    const latencies = (await Promise.all(sample.map(roundTrip)))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const worst = latencies.at(-1) ?? Number.NaN;

    const fixed = (value: number): string => value.toFixed(1).padEnd(8);
    console.info(
      `${String(clients.length).padEnd(9)} ${String(clients.length).padEnd(8)} ${String(failed).padEnd(8)} ${fixed(p50)} ${fixed(p95)} ${fixed(p99)} ${fixed(worst)}`,
    );

    if (failed > 0) {
      console.info(`\nstopped: ${String(failed)} connections failed to open`);
      break;
    }
    if (p95 > options.budgetMs) {
      console.info(`\nstopped: p95 ${p95.toFixed(1)}ms exceeded the budget`);
      break;
    }
    lastGood = clients.length;
  }

  // Best effort. With every ephemeral port spoken for, this fetch is the
  // first thing to fail — and losing the summary to it would throw away the
  // measurement the run exists to produce.
  console.info("");
  try {
    const final = await health();
    console.info(
      `gateway reports ${String(final.sockets)} sockets, ${String(final.channels)} channels`,
    );
  } catch {
    console.info("gateway health unavailable (harness out of local ports)");
  }
  console.info(`held ${String(lastGood)} concurrent sockets within budget`);

  for (const client of clients) client.ws.terminate();
  process.exit(0);
}

void main();
