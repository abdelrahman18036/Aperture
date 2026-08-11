"""Accounts, follows and blocks.

Data only: no business logic, no queries beyond properties. Reads live in
`selectors.py`, writes in `services.py`.

Every primary key here is a snowflake from `core.ids` — time-sortable, so
`ORDER BY id` is `ORDER BY created_at` and cursor pagination is a `WHERE id <
?`. Where `01-ARCHITECTURE.md` §5 specifies a composite primary key, this
project uses a surrogate snowflake plus a `UniqueConstraint` on the logical
key instead: Django 6.1's `CompositePrimaryKey` still cannot be the target of
a `ForeignKey`, and the surrogate costs eight bytes to keep DRF, the admin and
Unfold working with no special-casing.
"""

from __future__ import annotations

from typing import ClassVar

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.utils import timezone

from core.ids import snowflake

#: Name of the case-insensitive ICU collation created in the first migration.
#: `01-ARCHITECTURE.md` §5 asks for a citext username; the `citext` extension
#: and Django's `CITextField` are both retired, and a non-deterministic
#: collation is the supported way to get the same behaviour.
CASE_INSENSITIVE_COLLATION = "case_insensitive"


class UserManager(BaseUserManager["User"]):
    """Email is the login credential, so the default manager will not do."""

    use_in_migrations = True

    def create_user(
        self,
        email: str,
        username: str,
        password: str | None = None,
        **extra_fields: object,
    ) -> User:
        if not email:
            raise ValueError("users must have an email address")
        if not username:
            raise ValueError("users must have a username")
        user = self.model(
            email=self.normalize_email(email), username=username, **extra_fields
        )
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(
        self,
        email: str,
        username: str,
        password: str | None = None,
        **extra_fields: object,
    ) -> User:
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("superuser must have is_staff=True")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("superuser must have is_superuser=True")
        return self.create_user(email, username, password, **extra_fields)


class User(AbstractUser):
    """A person.

    No counts on this row. Follower and post counts live in the `counters`
    table, Celery-updated and Redis-cached — see `01-ARCHITECTURE.md` §11.
    """

    # AbstractUser's given/family name split does not fit a social product,
    # and leaving it would mean two competing notions of a display name.
    first_name = None  # type: ignore[assignment]
    last_name = None  # type: ignore[assignment]

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)

    username = models.CharField(
        max_length=30,
        unique=True,
        db_collation=CASE_INSENSITIVE_COLLATION,
        help_text="Case-insensitively unique. Shown in metadata position.",
    )
    email = models.EmailField(unique=True)

    display_name = models.CharField(max_length=60, blank=True)
    avatar_media = models.ForeignKey(
        "media.Media",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    bio = models.TextField(max_length=300, blank=True)
    is_private = models.BooleanField(
        default=False,
        help_text="Private accounts turn follows into requests pending approval.",
    )

    created_at = models.DateTimeField(default=timezone.now, editable=False)
    deleted_at = models.DateTimeField(null=True, blank=True, editable=False)

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    # AbstractUser types this as a ClassVar[UserManager[User]]; ours derives
    # from BaseUserManager instead, because email — not username — is the
    # credential, so the inherited create_user signature is wrong for us.
    objects: ClassVar[UserManager] = UserManager()  # type: ignore[assignment]

    class Meta(AbstractUser.Meta):
        db_table = "users"
        indexes = [
            models.Index(fields=["created_at"], name="users_created_at_idx"),
        ]

    def __str__(self) -> str:
        return self.username

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class Follow(models.Model):
    """A directed follow edge, possibly awaiting approval.

    Both directions are indexed. Without the reverse index, "who follows me"
    is a sequential scan — and that query runs on every profile view.
    """

    class Status(models.TextChoices):
        ACCEPTED = "accepted", "Accepted"
        PENDING = "pending", "Pending"

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    follower = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="following"
    )
    followee = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="followers"
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.ACCEPTED
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        db_table = "follows"
        constraints = [
            models.UniqueConstraint(
                fields=["follower", "followee"], name="follows_unique_edge"
            ),
            models.CheckConstraint(
                condition=~models.Q(follower=models.F("followee")),
                name="follows_no_self_follow",
            ),
        ]
        indexes = [
            # "who follows me" — the reverse of the unique constraint's index.
            models.Index(
                fields=["followee", "follower"], name="follows_followee_flwr_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.follower_id} -> {self.followee_id} ({self.status})"


class Block(models.Model):
    """A block. Enforced at the query layer in *every* read path.

    Retrofitting this means auditing every query ever written, which is why
    the helper in `users/selectors.py` exists from Phase 1 rather than from
    whenever it first becomes urgent.
    """

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    blocker = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="blocks_made"
    )
    blocked = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="blocks_received"
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        db_table = "blocks"
        constraints = [
            models.UniqueConstraint(
                fields=["blocker", "blocked"], name="blocks_unique_edge"
            ),
            models.CheckConstraint(
                condition=~models.Q(blocker=models.F("blocked")),
                name="blocks_no_self_block",
            ),
        ]
        indexes = [
            # The reverse lookup, "who has blocked me". Needed because
            # filtering runs in both directions on every read path.
            models.Index(fields=["blocked"], name="blocks_blocked_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.blocker_id} blocks {self.blocked_id}"
