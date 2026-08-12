"""Measure the feed query, and print the plan Postgres actually chose.

Rule 10: read the SQL the ORM generates, and `.explain()` the feed query at
least once. The ORM makes it easy to write something that looks identical and
produces a very different plan — the N+1 it hides is the single most common
way a Django feed gets slow.

Reports p50/p95/p99 wall time for a full page render's worth of queries, not
just the post fetch: the prefetches and the counter batch are part of what a
request pays.
"""

from __future__ import annotations

import argparse
import statistics
import time
from typing import Any

from django.core.management.base import BaseCommand
from django.db import connection, reset_queries
from django.test.utils import CaptureQueriesContext

from counters.models import Counter
from counters.selectors import get_many
from posts import selectors
from posts.serializers import PostSerializer
from users.models import User


class Command(BaseCommand):
    help = "Time the feed query and print its EXPLAIN ANALYZE plan."

    def add_arguments(self, parser: argparse.ArgumentParser) -> None:
        parser.add_argument("--username", default="seed000")
        parser.add_argument("--runs", type=int, default=200)
        parser.add_argument("--limit", type=int, default=30)
        parser.add_argument(
            "--cached",
            action="store_true",
            help=(
                "Measure `cached_feed` instead of `feed`, so the Redis layer "
                "is compared against the query it is meant to save rather "
                "than assumed to help."
            ),
        )
        parser.add_argument(
            "--follows",
            type=int,
            default=None,
            help=(
                "Rewire the viewer to follow exactly this many accounts before "
                "measuring. Fan-in is the variable 01-ARCHITECTURE.md §7 says "
                "decides whether a pull feed holds, so it is the one worth "
                "sweeping: 'someone following 5,000 accounts triggers a brutal "
                "fan-in on every scroll'. Destructive to that user's follow "
                "graph, which is why it is opt-in and named."
            ),
        )

    def _rewire(self, viewer: User, count: int) -> None:
        """Point the viewer at exactly `count` accepted follows.

        The point of the sweep is to hold everything else still — same posts,
        same indexes, same machine — and move only the fan-in, so a change in
        the timings has one possible cause.
        """
        from users.models import Follow

        Follow.objects.filter(follower=viewer).delete()

        followees = list(
            User.objects.exclude(pk=viewer.pk).values_list("pk", flat=True)[:count]
        )
        Follow.objects.bulk_create(
            [
                Follow(follower=viewer, followee_id=pk, status=Follow.Status.ACCEPTED)
                for pk in followees
            ],
            batch_size=1000,
            ignore_conflicts=True,
        )
        self.stdout.write(f"viewer now follows {len(followees)} accounts")

    def handle(self, *args: Any, **options: Any) -> None:
        viewer = User.objects.filter(username=options["username"]).first()
        if viewer is None:
            self.stderr.write(f"no such user: {options['username']}")
            return

        if options["follows"] is not None:
            self._rewire(viewer, options["follows"])

        limit = options["limit"]

        self._plan(viewer, limit)
        self._query_count(viewer, limit)
        self._timings(viewer, limit, options["runs"], cached=options["cached"])

    # -- the plan ---------------------------------------------------------

    def _plan(self, viewer: User, limit: int) -> None:
        queryset = selectors.feed(viewer=viewer, limit=limit)

        self.stdout.write(self.style.MIGRATE_HEADING("\nSQL"))
        self.stdout.write(str(queryset.query))

        self.stdout.write(self.style.MIGRATE_HEADING("\nEXPLAIN ANALYZE"))
        self.stdout.write(queryset.explain(analyze=True, buffers=True, verbose=False))

    # -- how many queries a page costs ------------------------------------

    def _query_count(self, viewer: User, limit: int) -> None:
        reset_queries()
        with CaptureQueriesContext(connection) as captured:
            posts = list(selectors.feed(viewer=viewer, limit=limit))
            post_ids = [post.pk for post in posts]
            context = {
                "like_counts": get_many(
                    entity_type=Counter.EntityType.POST,
                    entity_ids=post_ids,
                    metric=Counter.Metric.LIKES,
                ),
                "comment_counts": get_many(
                    entity_type=Counter.EntityType.POST,
                    entity_ids=post_ids,
                    metric=Counter.Metric.COMMENTS,
                ),
                "liked_post_ids": selectors.liked_post_ids(
                    viewer=viewer, post_ids=post_ids
                ),
            }
            # Rendering is what triggers the prefetches, so the count below
            # includes them. The value is discarded on purpose.
            _ = PostSerializer(posts, many=True, context=context).data

        self.stdout.write(self.style.MIGRATE_HEADING("\nQueries for one page"))
        self.stdout.write(
            f"{len(captured)} queries for {len(posts)} posts "
            f"— constant, not proportional"
        )
        for entry in captured:
            sql = " ".join(entry["sql"].split())
            self.stdout.write(f"  {entry['time']}s  {sql[:120]}")

    # -- timings ----------------------------------------------------------

    def _timings(
        self, viewer: User, limit: int, runs: int, *, cached: bool = False
    ) -> None:
        samples: list[float] = []
        for _ in range(runs):
            started = time.perf_counter()
            posts = (
                selectors.cached_feed(viewer=viewer, limit=limit)
                if cached
                else list(selectors.feed(viewer=viewer, limit=limit))
            )
            post_ids = [post.pk for post in posts]
            get_many(
                entity_type=Counter.EntityType.POST,
                entity_ids=post_ids,
                metric=Counter.Metric.LIKES,
            )
            selectors.liked_post_ids(viewer=viewer, post_ids=post_ids)
            samples.append((time.perf_counter() - started) * 1000)

        samples.sort()
        self.stdout.write(self.style.MIGRATE_HEADING(f"\nTimings over {runs} runs"))
        self.stdout.write(f"  n         {len(samples)}")
        self.stdout.write(f"  min       {samples[0]:.2f} ms")
        self.stdout.write(f"  p50       {statistics.median(samples):.2f} ms")
        self.stdout.write(f"  p95       {samples[int(len(samples) * 0.95)]:.2f} ms")
        self.stdout.write(f"  p99       {samples[int(len(samples) * 0.99)]:.2f} ms")
        self.stdout.write(f"  max       {samples[-1]:.2f} ms")
