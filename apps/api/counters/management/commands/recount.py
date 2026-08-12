"""Recount denormalised counters from source.

The manual half of the reconciliation in `counters.tasks` — that runs on a
schedule and walks a slice at a time; this repairs something now, because the
moment you want a counter fixed is rarely ten minutes from now.

    manage.py recount --user seed000        # one account
    manage.py recount --post 809662978...   # one post
    manage.py recount --all                 # everything, with progress

`--all` is a `COUNT(*)` per entity per metric and is the one place in this
codebase where that is allowed at scale. It is a command a person runs
deliberately, not something on a request path — rule 9 is about what renders a
page, not about what an operator does to fix one.

Prints only what was actually wrong, because a repair that says nothing is
indistinguishable from one that did not run, and a repair that lists six
thousand unchanged rows is worse.
"""

from __future__ import annotations

import argparse
from typing import Any

from django.core.management.base import BaseCommand, CommandError

from counters.models import Counter
from counters.tasks import recompute_post, recompute_user
from posts.models import Post
from users.models import User

#: Which metrics each entity type owns, so a drift report can name them.
METRICS: dict[str, tuple[str, ...]] = {
    Counter.EntityType.USER: (
        Counter.Metric.FOLLOWERS,
        Counter.Metric.FOLLOWING,
        Counter.Metric.POSTS,
    ),
    Counter.EntityType.POST: (Counter.Metric.LIKES, Counter.Metric.COMMENTS),
}


class Command(BaseCommand):
    help = "Recount counters from source and report what had drifted."

    def add_arguments(self, parser: argparse.ArgumentParser) -> None:
        parser.add_argument("--user", help="Username to recount.")
        parser.add_argument("--post", type=int, help="Post id to recount.")
        parser.add_argument(
            "--all",
            action="store_true",
            help="Recount every user and every post. Slow and deliberate.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        username: str | None = options["user"]
        post_id: int | None = options["post"]
        everything: bool = options["all"]

        if not any((username, post_id, everything)):
            raise CommandError("Pass --user, --post or --all.")

        drifted = 0

        if username:
            user = User.objects.filter(username=username).first()
            if user is None:
                raise CommandError(f"No account called {username!r}.")
            drifted += self._recount_user(user.pk)

        if post_id:
            if not Post.objects.filter(pk=post_id).exists():
                raise CommandError(f"No post with id {post_id}.")
            drifted += self._recount_post(post_id)

        if everything:
            drifted += self._recount_everything()

        if drifted == 0:
            self.stdout.write(self.style.SUCCESS("Nothing had drifted."))
        else:
            self.stdout.write(self.style.WARNING(f"Corrected {drifted} counter(s)."))

    # -- one entity ---------------------------------------------------------

    def _before(self, entity_type: str, entity_id: int) -> dict[str, int]:
        """What the counters table says right now, metric by metric."""
        rows = Counter.objects.filter(
            entity_type=entity_type, entity_id=entity_id
        ).values_list("metric", "value")
        stored = dict(rows)
        return {metric: stored.get(metric, 0) for metric in METRICS[entity_type]}

    def _report(self, label: str, before: dict[str, int], after: dict[str, int]) -> int:
        changed = 0
        for metric, truth in after.items():
            if before.get(metric, 0) != truth:
                # ASCII only, and not a style preference: this machine's
                # console is cp1252, and a stray arrow makes the command die
                # with a UnicodeEncodeError instead of repairing anything.
                self.stdout.write(
                    f"  {label} {metric}: {before.get(metric, 0)} -> {truth}"
                )
                changed += 1
        return changed

    def _recount_user(self, user_id: int) -> int:
        before = self._before(Counter.EntityType.USER, user_id)
        after = recompute_user(user_id)
        return self._report(f"user {user_id}", before, after)

    def _recount_post(self, post_id: int) -> int:
        before = self._before(Counter.EntityType.POST, post_id)
        after = recompute_post(post_id)
        return self._report(f"post {post_id}", before, after)

    # -- everything ---------------------------------------------------------

    def _recount_everything(self) -> int:
        drifted = 0

        # `iterator()` on both, because `--all` on a real corpus is more rows
        # than a list should hold and the whole point is that this is the slow
        # deliberate path.
        user_ids = User.objects.order_by("pk").values_list("pk", flat=True)
        total_users = user_ids.count()
        self.stdout.write(f"Recounting {total_users} users...")
        for index, user_id in enumerate(user_ids.iterator(chunk_size=500), start=1):
            drifted += self._recount_user(user_id)
            if index % 500 == 0:
                self.stdout.write(f"  ...{index}/{total_users}")

        post_ids = Post.objects.order_by("pk").values_list("pk", flat=True)
        total_posts = post_ids.count()
        self.stdout.write(f"Recounting {total_posts} posts...")
        for index, pid in enumerate(post_ids.iterator(chunk_size=500), start=1):
            drifted += self._recount_post(pid)
            if index % 500 == 0:
                self.stdout.write(f"  ...{index}/{total_posts}")

        return drifted
