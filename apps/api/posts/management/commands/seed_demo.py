"""Seed a realistic corpus: 50 users, 500 posts, and a follow graph.

`03-AGENT-BRIEF.md`'s Phase 4 verification asks for exactly this size, so the
defaults match it. The point is not to have data on screen — it is to have
enough of it that the feed query's plan is the plan it will really use.

The media is genuinely processed: the same Pillow path the worker runs, the
same derivative widths, uploaded to the same bucket. Seeding rows that point
at objects which do not exist would give a feed that benchmarks correctly and
renders nothing, which is half a lie.
"""

from __future__ import annotations

import argparse
import io
import random
from typing import Any

from django.core.management.base import BaseCommand
from django.db import transaction
from PIL import Image, ImageDraw, ImageFilter

from core.media import DERIVATIVE_FORMAT, DERIVATIVE_WIDTHS, derivative_key, object_key
from counters.tasks import recompute_user
from media import storage
from media.models import Media
from media.tasks import blurhash_of, dominant_color_of, resize_to_webp
from posts.models import Post, PostMedia
from users.models import Follow, User

WORDS = [
    "safelight",
    "contact sheet",
    "grain",
    "stop bath",
    "enlarger",
    "fixer",
    "portra",
    "tri-x",
    "pushed one stop",
    "golden hour",
    "blue hour",
    "wet street",
    "streetlight",
    "long exposure",
    "handheld",
    "backlit",
]

PLACES = [
    "Cairo",
    "Alexandria",
    "Aswan",
    "Lisbon",
    "Porto",
    "Reykjavík",
    "Kyoto",
    "Osaka",
    "Marrakesh",
    "Tbilisi",
    "Sarajevo",
    "Valparaíso",
]

#: Distinct images, reused across posts. Deriving 500 of them would take
#: minutes and prove nothing the tenth does not.
IMAGE_COUNT = 12

SHAPES = [(1080, 1350), (1080, 1080), (1600, 900)]


def _synthesise(width: int, height: int, seed: int) -> Image.Image:
    """A soft field of colour. Not art — just real pixels with real structure."""
    rng = random.Random(seed)
    image = Image.new("RGB", (width, height), "black")
    draw = ImageDraw.Draw(image)

    top = (rng.randint(20, 90), rng.randint(20, 90), rng.randint(30, 110))
    bottom = (rng.randint(90, 200), rng.randint(70, 180), rng.randint(80, 190))
    for y in range(height):
        t = y / max(height - 1, 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(
                round(a + (b - a) * t) for a, b in zip(top, bottom, strict=True)
            ),
        )

    for _ in range(3):
        radius = rng.randint(min(width, height) // 6, min(width, height) // 3)
        cx = rng.randint(0, width)
        cy = rng.randint(0, height)
        draw.ellipse(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            fill=(rng.randint(60, 255), rng.randint(60, 255), rng.randint(60, 255)),
        )

    return image.filter(ImageFilter.GaussianBlur(radius=min(width, height) * 0.05))


class Command(BaseCommand):
    help = "Seed users, posts, follows and processed media for development."

    def add_arguments(self, parser: argparse.ArgumentParser) -> None:
        parser.add_argument("--users", type=int, default=50)
        parser.add_argument("--posts", type=int, default=500)
        parser.add_argument(
            "--follows-each",
            type=int,
            default=15,
            help="How many accounts each user follows.",
        )
        parser.add_argument(
            "--password",
            default="seeded-password-1234",
            help="Shared password for every seeded account.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        rng = random.Random(20260811)

        users = self._seed_users(options["users"], options["password"], rng)
        self._seed_follows(users, options["follows_each"], rng)
        media = self._seed_media(users, rng)
        posts = self._seed_posts(users, media, options["posts"], rng)
        self._recount(users, posts)

        self.stdout.write(
            self.style.SUCCESS(
                f"seeded {len(users)} users, {len(media)} media, {len(posts)} posts"
            )
        )
        self.stdout.write(f"sign in as {users[0].email} / {options['password']}")

    # -- users ------------------------------------------------------------

    def _seed_users(self, count: int, password: str, rng: random.Random) -> list[User]:
        usernames = [f"seed{index:03d}" for index in range(count)]
        existing = {
            user.username: user for user in User.objects.filter(username__in=usernames)
        }
        users: list[User] = []
        password_updates: list[User] = []
        for index in range(count):
            username = f"seed{index:03d}"
            user = existing.get(username)
            if user is None:
                user = User.objects.create_user(
                    email=f"{username}@aperture.local",
                    username=username,
                    password=password,
                    display_name=f"{rng.choice(WORDS).title()} {index:03d}",
                    bio=rng.choice(WORDS).capitalize() + ".",
                    # A minority are private, so the pending-follow path has
                    # something to exercise.
                    is_private=index % 9 == 0,
                )
            else:
                # The command promises a shared development password in its
                # output. Keep that promise on repeat runs as well as the
                # first one; otherwise a previously seeded database becomes
                # impossible to enter with the documented credentials.
                user.set_password(password)
                password_updates.append(user)
            users.append(user)

        if password_updates:
            User.objects.bulk_update(password_updates, ["password"])

        self.stdout.write(f"users: {len(users)}")
        return users

    # -- follows ----------------------------------------------------------

    def _seed_follows(self, users: list[User], each: int, rng: random.Random) -> None:
        edges: list[Follow] = []
        for follower in users:
            targets = rng.sample([u for u in users if u.pk != follower.pk], each)
            for followee in targets:
                edges.append(
                    Follow(
                        follower=follower,
                        followee=followee,
                        # Private accounts leave the request pending, which is
                        # what makes the feed's `status='accepted'` filter do
                        # real work rather than match everything.
                        status=(
                            Follow.Status.PENDING
                            if followee.is_private
                            else Follow.Status.ACCEPTED
                        ),
                    )
                )
        Follow.objects.bulk_create(edges, ignore_conflicts=True)
        self.stdout.write(f"follows: {len(edges)}")

    # -- media ------------------------------------------------------------

    def _seed_media(self, users: list[User], rng: random.Random) -> list[Media]:
        ready = list(
            Media.objects.filter(state=Media.State.READY, object_key__contains="/")[
                :IMAGE_COUNT
            ]
        )
        if len(ready) >= IMAGE_COUNT:
            self.stdout.write(f"reusing {len(ready)} processed media")
            return ready

        created: list[Media] = []
        for index in range(IMAGE_COUNT):
            width, height = SHAPES[index % len(SHAPES)]
            image = _synthesise(width, height, seed=index)

            owner = users[index % len(users)]
            media = Media(
                owner=owner,
                kind=Media.Kind.IMAGE,
                declared_mime="image/jpeg",
                declared_size_bytes=0,
                bucket="media",
                state=Media.State.PENDING,
            )
            media.object_key = object_key(media.pk, "image/jpeg")

            buffer = io.BytesIO()
            image.save(buffer, "JPEG", quality=88)
            original = buffer.getvalue()
            media.declared_size_bytes = len(original)

            storage.upload(
                bucket=media.bucket,
                key=media.object_key,
                data=original,
                content_type="image/jpeg",
            )
            for target in DERIVATIVE_WIDTHS:
                storage.upload(
                    bucket=media.bucket,
                    key=derivative_key(media.pk, target),
                    data=resize_to_webp(image, target),
                    content_type=f"image/{DERIVATIVE_FORMAT}",
                )

            media.width = width
            media.height = height
            media.blurhash = blurhash_of(image)
            media.dominant_color = dominant_color_of(image)
            media.alt_text = f"A soft field of colour, {width} by {height}."
            media.state = Media.State.READY
            media.save()
            created.append(media)
            self.stdout.write(f"  media {index + 1}/{IMAGE_COUNT}")

        return created

    # -- posts ------------------------------------------------------------

    def _seed_posts(
        self,
        users: list[User],
        media: list[Media],
        count: int,
        rng: random.Random,
    ) -> list[Post]:
        existing = Post.objects.filter(caption__startswith="[seed]").count()
        if existing >= count:
            self.stdout.write(f"reusing {existing} seeded posts")
            return list(Post.objects.filter(caption__startswith="[seed]")[:count])

        posts: list[Post] = []
        attachments: list[PostMedia] = []

        for _ in range(count - existing):
            author = rng.choice(users)
            post = Post(
                author=author,
                caption=f"[seed] {rng.choice(WORDS)}, {rng.choice(WORDS)}",
                location=rng.choice(PLACES),
                visibility=Post.Visibility.PUBLIC,
            )
            posts.append(post)
            # Mostly single images, sometimes a short carousel.
            for position in range(1 if rng.random() < 0.8 else rng.randint(2, 3)):
                attachments.append(
                    PostMedia(post=post, media=rng.choice(media), position=position)
                )

        with transaction.atomic():
            Post.objects.bulk_create(posts, batch_size=200)
            PostMedia.objects.bulk_create(
                attachments, batch_size=500, ignore_conflicts=True
            )

        self.stdout.write(f"posts: {len(posts)} ({len(attachments)} attachments)")
        return posts

    # -- counters ---------------------------------------------------------

    def _recount(self, users: list[User], posts: list[Post]) -> None:
        """Run the repair tasks inline.

        Seeding writes rows directly rather than through the services, so no
        counter increments were enqueued. These are the same tasks the product
        uses to heal a drifted count.
        """
        for user in users:
            recompute_user(user.pk)
        self.stdout.write(f"recounted {len(users)} users")

        # Posts have no likes or comments yet, so their counters are zero and
        # reading them costs one query each. Skipped deliberately: 500 no-op
        # repairs is a slow way to write zeroes that the cache already
        # defaults to.
        _ = posts
