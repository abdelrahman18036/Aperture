"""URL routes for the posts app."""

from django.urls import URLPattern, URLResolver, path

from posts.views import (
    CommentDetailView,
    CommentListView,
    ExploreView,
    FeedView,
    LikeView,
    PostCreateView,
    PostDetailView,
    UserPostsView,
)

app_name = "posts"

# `<snowflake:>`, never `<int:>`. See config/converters.py — an integer path
# parameter becomes a JavaScript number and silently rounds.
urlpatterns: list[URLPattern | URLResolver] = [
    path("create", PostCreateView.as_view(), name="create"),
    path("feed", FeedView.as_view(), name="feed"),
    path("explore", ExploreView.as_view(), name="explore"),
    path("by/<str:username>", UserPostsView.as_view(), name="by-user"),
    path(
        "comments/<snowflake:comment_id>",
        CommentDetailView.as_view(),
        name="comment",
    ),
    path("<snowflake:post_id>", PostDetailView.as_view(), name="detail"),
    path("<snowflake:post_id>/like", LikeView.as_view(), name="like"),
    path("<snowflake:post_id>/comments", CommentListView.as_view(), name="comments"),
]
