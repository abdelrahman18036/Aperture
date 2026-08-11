# Aperture — Architecture

A photo and video social platform. Web only. Local-first, scales without a rewrite.

**Backend is Django. Frontend is Next.js.** Two deployables, one repo.

**Design rule:** every local component speaks the same protocol as its production replacement. MinIO is S3's API, so Cloudflare R2 is an env var. Self-hosted LiveKit is LiveKit Cloud's API. Postgres is Postgres. You never rewrite to scale — you swap the endpoint.

> **Versions live in [`docs/VERSIONS.md`](docs/VERSIONS.md)**, verified against PyPI and npm and pinned. Use those, not numbers from memory.

---

## 1. Stack

**Backend — Python / Django**

| Concern | Package |
|---|---|
| Runtime | CPython |
| Framework | Django |
| API | Django REST Framework |
| Schema / types | drf-spectacular (OpenAPI 3.1) |
| Database | PostgreSQL via psycopg 3 |
| ORM | Django ORM |
| Auth | Django auth (session cookies, same-site) |
| Queues | Celery + Redis broker |
| Realtime | Django Channels + channels-redis |
| ASGI server | uvicorn |
| Images | Pillow → Cloudflare Images |
| Video | ffmpeg subprocess → Mux |
| Object storage | boto3 → MinIO → Cloudflare R2 |
| SFU tokens | livekit-api |
| Admin | Django admin — this is the Phase 5 moderation console |
| Tests | pytest-django |
| Lint / types | ruff + mypy + django-stubs |
| Packages | uv |

**Frontend — TypeScript / Next.js**

| Concern | Package |
|---|---|
| Framework | Next.js (App Router, Turbopack) |
| UI runtime | React + React Compiler |
| Styling | Tailwind CSS (CSS-first `@theme`) |
| Components | shadcn/ui on **Base UI** |
| Motion | Motion (ex Framer Motion) |
| API client | openapi-typescript + openapi-fetch, generated |
| Validation | Zod (forms and client-side only) |
| Realtime | native WebSocket to Channels |
| Calls | livekit-client |
| Tests | Vitest, plus flows walked in Chrome |
| Packages | pnpm |

Two notes on shadcn. New projects scaffold on **Base UI** rather than Radix — take that default, it's where the registry is heading. And the registry ships **chat primitives** (`MessageScroller`, `Message`, `Bubble`, `Attachment`), which covers a real chunk of Phase 6.

**Why Django here:** the admin gives us the Phase 5 moderation console essentially for free, and Django's ORM, auth, and migrations are the most mature in any ecosystem. **What it costs:** the type boundary in §3, which you must automate on day one or it will rot.

---

## 2. Repo layout

```
aperture/
├── apps/
│   ├── api/                    Django project — the entire backend
│   │   ├── config/             settings, urls, asgi.py, celery.py
│   │   ├── core/               domain logic — pure Python, NO django imports
│   │   ├── users/              accounts, follows, blocks
│   │   ├── media/              upload intent, derivatives, Celery tasks
│   │   ├── posts/              posts, likes, comments, feed
│   │   ├── messaging/          conversations, messages, Channels consumers
│   │   ├── calls/              LiveKit token minting, signaling relay
│   │   ├── moderation/         reports, admin actions, rate limits
│   │   └── pyproject.toml
│   └── web/                    Next.js frontend
├── packages/
│   ├── api-client/             GENERATED from OpenAPI — never hand-edited
│   └── ui/                     design system: tokens, primitives, motion
├── infra/
│   ├── docker-compose.yml
│   ├── coturn/turnserver.conf
│   └── livekit/livekit.yaml
├── pnpm-workspace.yaml
└── turbo.json
```

**Three processes, one Django codebase.** This is the idiomatic Django shape and it is simpler than it looks:

| Process | Command | Scales on |
|---|---|---|
| API | `uvicorn config.asgi:application` | request rate |
| Realtime | `uvicorn config.asgi:application` (Channels routes) | concurrent sockets |
| Worker | `celery -A config worker` | queue depth |

They share models and settings but deploy and scale independently. Run the realtime process separately from the API even on day one — it holds socket state and the API is stateless, so merging them forces you to over-provision one to satisfy the other. Splitting costs nothing now.

**Why `core/` imports no Django:** it's the only way the business logic stays testable in milliseconds without a database, and portable if Django changes its mind about something. Feed ranking, snowflake generation, the celebrity threshold, permission arithmetic — all pure functions there. If a module in `core/` needs `django.`, it belongs in an app instead.

---

## 3. The type boundary — read this before Phase 1

Django and the browser are different languages. The contract between them is generated, never hand-written:

```
Django models + DRF serializers
   → drf-spectacular  → openapi.json          (make schema)
   → openapi-typescript → packages/api-client (pnpm generate)
   → Next.js imports typed routes, params, responses
```

**Three rules, all enforced in CI:**

1. `packages/api-client` is **generated output**. Never hand-edit it. It's committed so the frontend builds without a running backend, and CI regenerates and fails on any diff.
2. **A serializer change that isn't reflected in a regenerated client is a broken build**, not a runtime surprise. This is the whole point.
3. Zod lives on the **frontend only** — form validation and user input. It does not restate the API contract; the generated types do that. Two hand-maintained descriptions of the same shape is the failure mode this section exists to prevent.

This is the one thing the TypeScript-everywhere alternative gave for free. Automate it in Phase 1 and it stays cheap forever. Defer it and every phase after pays interest.

**Auth flows through the same origin.** Next.js rewrites `/api/*` to Django, so the browser sees one origin and Django's session cookie is same-site. No JWT in `localStorage`, no CORS credential dance. Configure the rewrite in Phase 1 and CSRF works the way Django expects.

---

## 4. Local environment

```yaml
# infra/docker-compose.yml
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: devpassword
      POSTGRES_DB: aperture
    ports: ["5433:5432"]        # host 5432 is taken by a native PG service — see docs/VERSIONS.md
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
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z
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
    image: livekit/livekit-server:v1.13.5
    command: --config /etc/livekit.yaml --node-ip=127.0.0.1
    ports: ["7880:7880", "7881:7881", "50000-50100:50000-50100/udp"]
    volumes: [./livekit/livekit.yaml:/etc/livekit.yaml]

  coturn:
    image: coturn/coturn:4.17.2
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

`docker compose up`, then `uv run manage.py runserver` and `pnpm dev` — full stack from a cold machine in about four minutes. Start Docker Desktop first; it does not auto-start on this machine.

---

## 5. Schema

Django models and migrations. The table design below is the decision; the ORM is just how it's spelled.

**Snowflake IDs, not UUIDv4.** 64-bit, time-sortable, generated in `core/`. `ORDER BY id` *is* `ORDER BY created_at`, cursor pagination is trivial, and index locality survives. Use a `BigIntegerField(primary_key=True)` with a default from `core.ids.snowflake` — **not** `BigAutoField`, because the point is that the application owns the value. If you must use UUID, use **v7** — never v4 as a primary key on a table heading for hundreds of millions of rows.

```
users                                  -- extends AbstractUser
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
  INDEX (id DESC) WHERE deleted_at IS NULL      -- Django: condition= on Index

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
  -- Celery-updated, Redis-cached. NEVER .count() on a hot path.

timeline                               -- push fanout, Phase 8 only
  user_id, post_id, author_id, score, created_at
  PK (user_id, post_id)
  INDEX (user_id, created_at DESC)
```

Composite primary keys need `constraints = [UniqueConstraint(...)]` plus a surrogate, or Django 6's composite primary key support — pick one in Phase 1 and be consistent. Partial indexes go through `Index(condition=Q(deleted_at__isnull=True))`.

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

Allocate `seq` inside the same transaction as the insert, with a row lock:

```python
with transaction.atomic():
    conv = Conversation.objects.select_for_update().get(pk=conversation_id)
    conv.last_message_seq += 1
    conv.save(update_fields=["last_message_seq"])
    Message.objects.create(conversation=conv, seq=conv.last_message_seq, ...)
```

Correct order, no gaps. Catch `IntegrityError` on the `client_id` unique constraint and return the existing message — that is the whole idempotency story.

---

## 6. Media pipeline

Bytes never pass through your server. Not at any scale — develop against the same path you'll ship.

```
1. POST /api/media/intent { kind, mime, size }
   → create media row (state=pending)
   → boto3 generate_presigned_url('put_object') + media_id
2. Browser PUTs directly to MinIO / R2
3. POST /api/media/:id/complete → Celery task
4. Worker: ffprobe → validate → blurhash + dominant color
   images: Pillow derivatives | video: ffmpeg locally, Mux in prod
   → state = ready
5. Client polls (Phase 3) or receives a WS event (Phase 6); image develops in
```

Presigned URLs: 5-minute expiry, constrained on content-length and content-type. An unconstrained presigned URL is a free file host for anyone who finds it.

Validate the *file*, not the client's claim: `ffprobe` for video, Pillow's `Image.verify()` plus `python-magic` for images. A declared `image/jpeg` that is really something else is the first upload attack you'll see.

**Do not build a video transcoding pipeline.** One ffmpeg subprocess producing 720p H.264 is fine locally. In production, hand video to Mux. Adaptive bitrate ladders, HLS packaging, per-device codec selection — a genuine multi-quarter project, and not your product.

**Pillow is the starting choice; `pyvips` is the upgrade.** pyvips is several times faster on large images but needs a system library. Start on Pillow and swap only if the worker becomes the bottleneck — the derivative code is the same shape either way.

---

## 7. Feed

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

Express it with the ORM, but **read the generated SQL** — `.explain()` on this query at least once in Phase 4. The ORM makes it easy to write something that looks identical and produces a very different plan. Use `select_related`/`prefetch_related` deliberately; the N+1 that the ORM hides from you is the single most common way a Django feed gets slow.

**Phase 2 — cache.** Redis sorted set per user, 30-min TTL, invalidated on a followee's new post.

**Phase 3 — hybrid push.** Only when feed p99 crosses ~200ms. New post → Celery task → write into every follower's `timeline`, *except* accounts over ~10k followers, which stay pull and merge in at read time.

The split is arithmetic, not taste: pure push means a 10M-follower account triggers 10M writes per post; pure pull means someone following 5,000 accounts triggers a brutal fan-in on every scroll. Instagram and Twitter both converged here. Don't build it speculatively — instrument, then act.

---

## 8. Realtime

Django Channels over ASGI, `channels-redis` for cross-replica fanout.

```
Browser ──WSS──> uvicorn replica N (Channels)
                    ├─ group_add    user.{id}
                    └─ group_send   conv.{id}

Send: DRF view or consumer validates → writes to PG (allocating seq)
      → group_send conv.{id} → every replica holding a member socket delivers
      → offline members get a Celery notification task
```

Scale by adding replicas. Comfortable into the low thousands of concurrent sockets per replica — **Python holds fewer sockets per process than Node, so plan on more replicas at the same user count.** That is a known and accepted cost of this stack. Past `channels-redis`, move to a dedicated broker; you'll know well before you get there.

Reconnect: client sends `{conversation_id, last_seq}`, the consumer returns the delta. That's the entire offline-sync story, and it's correct because `seq` is monotonic.

Consumers are async; the ORM is not. Every database call inside a consumer goes through `database_sync_to_async` or an `async`-native ORM method. Forgetting this is the defining Channels bug and it appears as intermittent hangs under load, not as an error.

---

## 9. Calls

- **1:1** — WebRTC peer-to-peer, TURN fallback.
- **Group (3+)** — LiveKit SFU. Docker locally, LiveKit Cloud in prod, identical client SDK. Never an MCU; server-side mixing burns a core per call and buys nothing.
- **Signaling** — rides the existing Channels connection. Don't open a second connection.
- **Tokens** — minted server-side with `livekit-api`. Never in the browser.
- **TURN** — coturn with **TLS on 443**, non-negotiable. Egyptian ISPs and effectively every corporate firewall drop UDP. Without TCP/443 fallback your connection rate quietly sits near 70% and you'll blame the code.

Budget TURN bandwidth as a real line item. Every relayed call is full media through your server — the one WebRTC cost that scales linearly with usage.

---

## 10. Scaling path

| Stage | What changes |
|---|---|
| 0 → 10k | Nothing. One API process, one worker, one Postgres, pull feed. |
| 10k → 100k | Read replica. Redis feed cache. More Celery workers. Video to Mux. |
| 100k → 1M | Hybrid push. Partition `messages` by month. PgBouncer. Typesense. More ASGI replicas for sockets. |
| 1M → 10M | Conversations onto their own DB. Citus or app-level shard by user_id. |
| 10M+ | You have a platform team; this document is obsolete. |

The most common failure in projects like this is building stage-3 infrastructure at stage 0 — Kafka, sharding, a service mesh for forty users. Each one multiplies the cost of every feature you ship between now and a scale you may never reach.

---

## 11. Non-negotiable from day one

**Moderation.** Public image upload attracts CSAM, spam, and copyright claims within days of traction. This is a legal and ethical obligation from your first public user, not a Phase 9 feature. Minimum: CSAM scanning on the bucket, an NCMEC reporting path, a report queue with an admin view, hard upload rate limits. Build the report button before you build stories. Django admin gives you the queue view cheaply — there is no excuse to defer this one.

**Blocking.** Enforced at the query layer in *every* read path — feed, search, comments, DMs, notifications. Retrofitting means auditing every query you've ever written. It's in the Phase 1 feed query above for exactly this reason. Put it in a single reusable queryset method (`visible_to(user)`) so there is one place to audit rather than forty.

**Deletion.** Real account deletion is a GDPR requirement. Soft-delete everywhere plus a scheduled hard-delete task, or you'll write a data-archaeology script under a deadline.

**Rate limits.** Redis token bucket, per-user and per-IP, on upload / follow / comment / message. DRF's built-in throttling is a starting point but is per-view and coarse — the token bucket belongs in `core/` where it can be tested. Follow-spam is the first abuse you will see.
