# Django 6.1 — vendored release notes

Fetched 2026-08-11 from <https://docs.djangoproject.com/en/6.1/releases/6.1/>.
Pinned version for this project: **6.1** (`docs/VERSIONS.md`), with a planned move to 6.2 LTS.

Only what bears on Aperture is kept. Work from this file, not from memory.

---

## Runtime and database support

| | Django 6.1 supports | Ours |
|---|---|---|
| Python | 3.12, 3.13, 3.14 | **3.13.12** ✓ |
| PostgreSQL | **15+** (14 dropped) | **18-alpine** ✓ |
| SQLite | 3.37.0+ | n/a |

The Postgres floor moving to 15 is worth noting: `postgres:18-alpine` clears it comfortably, but a
future attempt to run against an older local Postgres — including the native `postgresql-x64-17`
service squatting on host port 5432 — would still be fine at 17. Nothing to do.

## Answers to the two questions this doc was fetched for

**Composite primary keys — nothing new in 6.1.** The release notes add no composite-PK support and
change none of the existing behaviour. The feature remains as introduced in 5.2, with the standing
limitation that a model with a `CompositePrimaryKey` cannot be the target of a `ForeignKey`.
→ **Ruled for Aperture: surrogate snowflake PK + `UniqueConstraint` on the logical key**, applied
consistently to `follows`, `blocks`, `likes`, `counters`, `conversation_members` and `messages`.
Fully supported by DRF, the admin and django-unfold with no special-casing.

**Partial indexes — unchanged in 6.1.** No changes to `Index` or to constraints. So
`01-ARCHITECTURE.md` §5's `INDEX (id DESC) WHERE deleted_at IS NULL` is spelled the ordinary way:

```python
models.Index(
    F("id").desc(),
    condition=Q(deleted_at__isnull=True),
    name="posts_live_id_desc_idx",
)
```

## New in 6.1 that we may want

- **Fetch modes** — control over on-demand field fetching, a direct lever against the N+1 that
  rule 10 is about:
  ```python
  books = Book.objects.fetch_mode(models.FETCH_PEERS)
  ```
  `FETCH_ONE` (default), `FETCH_PEERS`, `FETCH_RAISE`. `FETCH_RAISE` in tests turns an accidental
  lazy load into a failure instead of a silent extra query.
- **Database-level delete options** on `ForeignKey.on_delete`: `DB_CASCADE`, `DB_SET_NULL`,
  `DB_SET_DEFAULT`. Cheaper than the Python-level equivalents, but they do **not** fire
  `pre_delete` / `post_delete`. Given soft delete is the rule here (§11), these are mostly
  irrelevant — but they are the right choice for the scheduled hard-delete job in Phase 5.
- **`UUID7()`** database function. Not needed: IDs are snowflakes generated in `core/`.
- `QuerySet.totally_ordered` property.
- `action()` decorator gains `location` and `description_plural` — relevant to the Phase 5
  moderation console, alongside django-unfold's `actions_row` / `actions_list`.

## Backwards-incompatible changes that could bite us

- **`first()` / `last()`** no longer fall back to ordering by primary key when the queryset's
  ordering has been cleared with a bare `order_by()`. Feed and message selectors must be explicit
  about ordering — which they are anyway, since `ORDER BY id` is the cursor.
- **SQL alias quoting** — aliases from `annotate()` and join aliases are now systematically quoted.
  Only affects raw SQL that references them with mismatched case. We have none yet; keep it in mind
  when `.explain()`-ing the feed query in Phase 4.
- **`_is_pk_set()`** returns `False` for `DatabaseDefault` values on unsaved instances. Harmless
  here — the application supplies snowflake PKs, so they are always set before save.
- **Strict Base64 validation** in `BinaryField`, `MultiPartParser` and `DatabaseCache` — these now
  raise instead of silently ignoring malformed input. Good for us; upload handling should surface
  bad input loudly.
- **Auth under ASGI:** `RemoteUserMiddleware` no longer prefixes `HTTP_` for custom `request.META`
  lookups (use `HTTP_AUTHUSER`, not `AUTHUSER`). We use session cookies, not `REMOTE_USER`, so this
  does not apply.
- **Admin:** the `wide` CSS class is gone, `object-tools` moved out of the `content` block, and
  `ChangeList.has_related_field_in_list_display()` is replaced by `get_select_related_fields()`.
  Only matters if we override admin templates — and per the brief, we don't.

## Deprecations to avoid writing in the first place

- **`EMAIL_*` settings → `MAILERS`.** Write the new form from day one:
  ```python
  MAILERS = {
      "default": {
          "BACKEND": "django.core.mail.backends.smtp.EmailBackend",
          "OPTIONS": {"host": "smtp.example.com", "use_tls": True},
      },
  }
  ```
  Also deprecated: `mail.get_connection()`, the `connection` and `fail_silently` arguments to
  `send_mail()` and friends, `EmailMessage.connection`, and direct instantiation of
  `smtp.EmailBackend`.
- **`select_related()` with no arguments** is deprecated — always name the fields. Same for
  `ModelAdmin.list_select_related = True`. Rule 10 wanted this anyway.
- **`values_list(flat=True)` without a field name** is deprecated.
- **`django.db.transaction.savepoint()`** → `savepoint_create()`.
- `BLANK_CHOICE_DASH` → the `USE_BLANK_CHOICE_DASH` setting (itself transitional).
- `salted_hmac()` / `base64_hmac()` default algorithm changes `"sha1"` → `"sha256"` in Django 7.0.
  Not our ticket signing — that is HS256 via `jose` on the Node side and PyJWT-equivalent on the
  Django side, per §8.
