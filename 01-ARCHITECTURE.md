# Aperture — Architecture

A photo and video social platform. Web only. Local-first, scales without a rewrite.

**Design rule:** every local component speaks the same protocol as its production replacement. MinIO is S3's API, so Cloudflare R2 is an env var. Self-hosted LiveKit is LiveKit Cloud's API. Postgres is Postgres. You never rewrite to scale — you swap the endpoint.

> **Versions move.** Everything below was current in August 2026. Before you start, run `npm view <pkg> version` on the majors and pin what you actually get. Don't let an agent invent versions.

---

## 1. Stack

| Concern | Package / service | Version (Aug 2026) |
|---|---|---|
| Runtime | Node.js | 24 LTS |
| Framework | Next.js (App Router, Turbopack) | 16.3 |
| UI runtime | React + React Compiler | 19.x, compiler 1.x |
| Styling | Tailwind CSS | 4.x (CSS-first `@theme`) |
| Components | shadcn/ui on **Base UI** | CLI 3.x |
| Motion | Motion (ex Framer Motion) | 12.x |
| ORM | Drizzle ORM + drizzle-kit | 0.4x |
| Database | PostgreSQL | 18 |
| Cache / queues | Redis + BullMQ | Redis 8, BullMQ 5.x |
| Auth | BetterAuth | 1.x |
| Validation | Zod | 4.x |
| Realtime | `ws` or uWebSockets.js + Redis pub/sub | — |
| SFU | LiveKit server / client SDK | server 1.x, JS SDK 2.x |
| TURN | coturn | 4.6.x |
| Object storage | MinIO → Cloudflare R2 | S3 API |
| Images | `sharp` → Cloudflare Images | 0.34.x |
| Video | ffmpeg worker → Mux | — |
| Search | Postgres FTS → Typesense | 28.x |
| Monorepo | Turborepo + pnpm | Turbo 2.x, pnpm 10.x |
| Tests | Vitest + Playwright | 3.x / 1.5x |

Two notes on shadcn specifically. New projects now scaffold on **Base UI** rather than Radix — take that default, it's where the registry is heading. And the registry ships **chat primitives** (`MessageScroller`, `Message`, `Bubble`, `Attachment`) as of mid-2026, which covers a real chunk of Phase 4.

---

## 2. Repo layout

```
aperture/
├── apps/
│   ├── web/            Next.js 16 — UI, route handlers, server actions
│   ├── realtime/       WebSocket service (chat, presence, typing, signaling)
│   └── worker/         BullMQ consumers (media, fanout, notifications)
├── packages/
│   ├── db/             Drizzle schema + migrations + seed
│   ├── core/           domain logic — pure functions, no framework imports
│   ├── contracts/      Zod schemas + shared types
│   └── ui/             design system: tokens, primitives, motion
├── infra/
│   ├── docker-compose.yml
│   ├── coturn/turnserver.conf
│   └── livekit/livekit.yaml
└── turbo.json
```

**Why `realtime` is its own process:** it scales on concurrent connections and holds socket-to-user state. Next.js scales on request rate and is stateless. Merging them forces you to over-provision one to satisfy the other. Splitting costs nothing on day one.

**Why `worker` is its own process:** a video transcode must never occupy a request thread.

**Why `core` has no framework imports:** it's the only way the business logic stays testable in milliseconds and portable if Next.js changes its mind about something again.

---

## 3. Local environment

```yaml
# infra/docker-compose.yml
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: devpassword
      POSTGRES_DB: aperture
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s

  redis:
    image: redis:8-alpine
    command: redis-server --appendonly yes
    ports: ["6379:6379"]
    volumes: [redisdata:/data]

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]

  minio-init:
    image: minio/mc
    depends_on: [minio]
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin;
      mc mb --ignore-existing local/media;
      mc mb --ignore-existing local/dm-media;
      mc anonymous set download local/media;
      "

  livekit:
    image: livekit/livekit-server
    command: --config /etc/livekit.yaml --node-ip=127.0.0.1
    ports: ["7880:7880", "7881:7881", "50000-50100:50000-50100/udp"]
    volumes: [./livekit/livekit.yaml:/etc/livekit.yaml]

  coturn:
    image: coturn/coturn
    network_mode: host
    volumes: [./coturn/turnserver.conf:/etc/coturn/turnserver.conf]

  typesense:
    image: typesense/typesense:28.0
    environment:
      TYPESENSE_API_KEY: devkey
      TYPESENSE_DATA_DIR: /data
    ports: ["8108:8108"]
    volumes: [typesensedata:/data]

volumes: { pgdata:, redisdata:, miniodata:, typesensedata: }
```

`docker compose up && pnpm dev` — full backend, cold machine to running stack in about four minutes.

---

## 4. Schema

Drizzle. Decisions worth defending:

**Snowflake IDs, not UUIDv4.** 64-bit, time-sortable, generated in-app. `ORDER BY id` *is* `ORDER BY created_at`, cursor pagination is trivial, and index locality survives. If you must use UUID, use **v7** — never v4 as a primary key on a table heading for hundreds of millions of rows.

```
users
  id, username (citext unique), email, display_name, avatar_media_id,
  bio, is_private, created_at
  -- no counts here; see counters

follows
  follower_id, followee_id, status('accepted'|'pending'), created_at
  PK (follower_id, followee_id)
  INDEX (followee_id, follower_id)     -- "who follows me"
  -- both directions indexed, or one of the two queries is a seq scan

blocks
  blocker_id, blocked_id, created_at
  PK (blocker_id, blocked_id)
  INDEX (blocked_id)                   -- enforced in EVERY read path

media
  id, owner_id, kind('image'|'video'), bucket, object_key,
  width, height, duration_ms, blurhash, dominant_color,
  state('pending'|'ready'|'failed')
  -- row exists BEFORE upload completes; worker flips to ready
  -- dominant_color feeds the UI's ambient glow, see design spec

posts
  id, author_id, caption, location, visibility, created_at, deleted_at
  INDEX (author_id, id DESC)                    -- profile contact sheet
  INDEX (id DESC) WHERE deleted_at IS NULL

post_media    post_id, media_id, position       -- carousels

likes
  user_id, post_id, created_at
  PK (post_id, user_id)                -- post_id first: "who liked this"
  INDEX (user_id, created_at DESC)

comments
  id, post_id, author_id, parent_id, body, created_at, deleted_at
  INDEX (post_id, id)

counters
  entity_type, entity_id, metric, value
  PK (entity_type, entity_id, metric)
  -- worker-updated, Redis-cached. NEVER COUNT(*) on a hot path.

timeline                               -- push fanout, Phase 8 only
  user_id, post_id, author_id, score, created_at
  PK (user_id, post_id)
  INDEX (user_id, created_at DESC)
```

Messaging:

```
conversations
  id, kind('dm'|'group'), title, created_at, last_message_seq

conversation_members
  conversation_id, user_id, role, joined_at, last_read_seq, muted_until
  PK (conversation_id, user_id)
  INDEX (user_id)                      -- inbox

messages
  conversation_id, seq BIGINT,         -- server-assigned, monotonic per convo
  id, sender_id, body, media_id,
  client_id UUID,                      -- idempotency key from client
  reply_to_seq, created_at, deleted_at
  PK (conversation_id, seq)
  UNIQUE (conversation_id, client_id)
```

That `seq` column and that `UNIQUE` constraint are the two most important lines in the entire schema. `seq` gives correct ordering without trusting browser clocks, plus cursor sync (*"send me everything after 4821"*) for free. The unique constraint makes a flaky-network retry a no-op instead of a duplicate message. Both are miserable to retrofit onto live conversations.

Allocate `seq` with `UPDATE conversations SET last_message_seq = last_message_seq + 1 RETURNING last_message_seq` inside the same transaction as the insert. Row lock, correct order, no gaps.

---

## 5. Media pipeline

Bytes never pass through your server. Not at any scale — develop against the same path you'll ship.

```
1. POST /api/media/intent { kind, mime, size }
   → create media row (state=pending)
   → return presigned PUT url + media_id
2. Browser PUTs directly to MinIO / R2
3. POST /api/media/:id/complete → enqueue BullMQ job
4. Worker: ffprobe → validate → blurhash + dominant color
   images: sharp derivatives | video: ffmpeg locally, Mux in prod
   → state = ready
5. Client receives WS event, image develops in
```

Presigned URLs: 5-minute expiry, constrained on content-length and content-type. An unconstrained presigned URL is a free file host for anyone who finds it.

**Do not build a video transcoding pipeline.** One ffmpeg worker producing 720p H.264 is fine locally. In production, hand video to Mux. Adaptive bitrate ladders, HLS packaging, per-device codec selection — a genuine multi-quarter project, and not your product.

---

## 6. Feed

Everything else here is plumbing. This is architecture.

**Phase 1 — pull.** Query at read time:

```sql
SELECT p.* FROM posts p
JOIN follows f ON f.followee_id = p.author_id
WHERE f.follower_id = $1 AND f.status = 'accepted'
  AND p.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM blocks b
                  WHERE b.blocker_id = $1 AND b.blocked_id = p.author_id)
  AND p.id < $2
ORDER BY p.id DESC LIMIT 30;
```

Always fresh, trivially correct, no invalidation bugs. Good into the low millions of posts given both `follows` indexes. **Start here and don't apologize for it.**

**Phase 2 — cache.** Redis sorted set per user, 30-min TTL, invalidated on a followee's new post.

**Phase 3 — hybrid push.** Only when feed p99 crosses ~200ms. New post → job → write into every follower's `timeline`, *except* accounts over ~10k followers, which stay pull and merge in at read time.

The split is arithmetic, not taste: pure push means a 10M-follower account triggers 10M writes per post; pure pull means someone following 5,000 accounts triggers a brutal fan-in on every scroll. Instagram and Twitter both converged here. Don't build it speculatively — instrument, then act.

---

## 7. Realtime

Node + `ws`, Redis pub/sub for cross-replica fanout.

```
Browser ──WSS──> replica N
                    ├─ subscribes redis  user:{id}
                    └─ publishes         conv:{id}

Send: route handler validates → writes to PG (allocating seq)
      → publish conv:{id} → every replica holding a member socket delivers
      → offline members get a notification job
```

Scale by adding replicas. Comfortable into tens of thousands of concurrent sockets per replica; past that swap Redis pub/sub for Redis Streams or NATS — you'll know well before you get there.

Reconnect: client sends `{conversation_id, last_seq}`, server returns the delta. That's the entire offline-sync story, and it's correct because `seq` is monotonic.

---

## 8. Calls

- **1:1** — WebRTC peer-to-peer, TURN fallback.
- **Group (3+)** — LiveKit SFU. Docker locally, LiveKit Cloud in prod, identical client SDK. Never an MCU; server-side mixing burns a core per call and buys nothing.
- **Signaling** — rides the existing WebSocket service. Don't open a second connection.
- **TURN** — coturn with **TLS on 443**, non-negotiable. Egyptian ISPs and effectively every corporate firewall drop UDP. Without TCP/443 fallback your connection rate quietly sits near 70% and you'll blame the code.

Budget TURN bandwidth as a real line item. Every relayed call is full media through your server — the one WebRTC cost that scales linearly with usage.

---

## 9. Scaling path

| Stage | What changes |
|---|---|
| 0 → 10k | Nothing. One Next.js instance, one Postgres, pull feed. |
| 10k → 100k | Read replica. Redis feed cache. Worker fleet. Video to Mux. |
| 100k → 1M | Hybrid push. Partition `messages` by month. PgBouncer. Typesense. |
| 1M → 10M | Conversations onto their own DB. Citus or app-level shard by user_id. |
| 10M+ | You have a platform team; this document is obsolete. |

The most common failure in projects like this is building stage-3 infrastructure at stage 0 — Kafka, sharding, a service mesh for forty users. Each one multiplies the cost of every feature you ship between now and a scale you may never reach.

---

## 10. Non-negotiable from day one

**Moderation.** Public image upload attracts CSAM, spam, and copyright claims within days of traction. This is a legal and ethical obligation from your first public user, not a Phase 9 feature. Minimum: CSAM scanning on the bucket, an NCMEC reporting path, a report queue with an admin view, hard upload rate limits. Build the report button before you build stories.

**Blocking.** Enforced at the query layer in *every* read path — feed, search, comments, DMs, notifications. Retrofitting means auditing every query you've ever written. It's in the Phase 1 feed query above for exactly this reason.

**Deletion.** Real account deletion is a GDPR requirement. Soft-delete everywhere plus a scheduled hard-delete job, or you'll write a data-archaeology script under a deadline.

**Rate limits.** Redis token bucket, per-user and per-IP, on upload / follow / comment / message. Follow-spam is the first abuse you will see.
