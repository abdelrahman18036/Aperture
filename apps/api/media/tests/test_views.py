"""Tests for `media.views`."""

from __future__ import annotations

from typing import Any

import pytest
from rest_framework.test import APIClient

from media import services
from media.models import Media
from users.models import User

pytestmark = pytest.mark.django_db


def test_intent_requires_authentication(api: APIClient) -> None:
    response = api.post(
        "/api/media/intent",
        {"kind": "image", "mime": "image/jpeg", "size_bytes": 1000},
        format="json",
    )
    assert response.status_code == 403


def test_intent_returns_a_presigned_url_and_the_row(
    signed_in: APIClient, fake_storage: dict[str, Any]
) -> None:
    response = signed_in.post(
        "/api/media/intent",
        {"kind": "image", "mime": "image/jpeg", "size_bytes": 1000},
        format="json",
    )
    assert response.status_code == 201
    body = response.json()
    assert body["media"]["state"] == "pending"
    assert body["upload_url"].startswith("https://storage.test/")


def test_ids_cross_the_wire_as_strings(
    signed_in: APIClient, fake_storage: dict[str, Any]
) -> None:
    """Snowflakes exceed 2^53; a JSON number would lose precision in JS."""
    response = signed_in.post(
        "/api/media/intent",
        {"kind": "image", "mime": "image/jpeg", "size_bytes": 1000},
        format="json",
    )
    media_id = response.json()["media"]["id"]
    assert isinstance(media_id, str)
    assert int(media_id) > 2**53


def test_intent_rejects_a_disallowed_type_with_a_readable_message(
    signed_in: APIClient, fake_storage: dict[str, Any]
) -> None:
    response = signed_in.post(
        "/api/media/intent",
        {"kind": "image", "mime": "image/svg+xml", "size_bytes": 1000},
        format="json",
    )
    assert response.status_code == 400
    assert "not an accepted image type" in response.json()["detail"]


def test_someone_elses_media_is_a_404_not_a_403(
    api: APIClient, user: User, other_user: User, fake_storage: dict[str, Any]
) -> None:
    """403 would confirm the id exists, which is an enumeration oracle."""
    intent = services.create_intent(
        owner=other_user, kind="image", mime="image/jpeg", size_bytes=1000
    )
    api.force_authenticate(user=user)
    assert api.get(f"/api/media/{intent.media.pk}").status_code == 404


def test_complete_is_idempotent(
    signed_in: APIClient, user: User, fake_storage: dict[str, Any]
) -> None:
    intent = services.create_intent(
        owner=user, kind="image", mime="image/jpeg", size_bytes=1000
    )
    url = f"/api/media/{intent.media.pk}/complete"
    assert signed_in.post(url).status_code == 202
    assert signed_in.post(url).status_code == 202


def test_alt_text_may_be_empty(
    signed_in: APIClient, user: User, fake_storage: dict[str, Any]
) -> None:
    """Every image has an alt field; an empty one is allowed."""
    intent = services.create_intent(
        owner=user, kind="image", mime="image/jpeg", size_bytes=1000
    )
    response = signed_in.patch(
        f"/api/media/{intent.media.pk}", {"alt_text": ""}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["alt_text"] == ""


def test_delete_soft_deletes_and_hides_the_row(
    signed_in: APIClient, user: User, fake_storage: dict[str, Any]
) -> None:
    intent = services.create_intent(
        owner=user, kind="image", mime="image/jpeg", size_bytes=1000
    )
    assert signed_in.delete(f"/api/media/{intent.media.pk}").status_code == 204
    assert signed_in.get(f"/api/media/{intent.media.pk}").status_code == 404
    assert Media.objects.filter(pk=intent.media.pk).exists()
