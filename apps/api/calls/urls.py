"""URL routes for the calls app.

Two endpoints and no resource collection: a call has no row, so there is
nothing to GET and nothing to address by id.

Both are named rather than sitting at the bare `/api/calls`. A POST to a path
Django then `APPEND_SLASH`-redirects arrives as a 301, and a browser
following that redirect drops the body — an empty request that fails
validation for reasons nothing in the code explains.
"""

from django.urls import URLPattern, URLResolver, path

from calls.views import JoinCallView, StartCallView

app_name = "calls"

urlpatterns: list[URLPattern | URLResolver] = [
    path("start", StartCallView.as_view(), name="start"),
    path("join", JoinCallView.as_view(), name="join"),
]
