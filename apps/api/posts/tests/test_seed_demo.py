from __future__ import annotations

import random

import pytest

from posts.management.commands.seed_demo import Command
from users.models import User

pytestmark = pytest.mark.django_db


def test_reused_seed_account_gets_the_requested_password() -> None:
    account = User.objects.create_user(
        email="seed000@aperture.local",
        username="seed000",
        password="an-old-password",
    )

    users = Command()._seed_users(1, "seeded-password-1234", random.SystemRandom())

    account.refresh_from_db()
    assert users == [account]
    assert account.check_password("seeded-password-1234")
