"use client";

import { SurfaceState } from "@repo/ui";

import { PostTile } from "@/features/explore/post-tile";
import type { Post } from "@/features/feed/use-feed";

/** A clean responsive gallery shared with discovery. */
export function ContactSheet({ posts }: { posts: Post[] }) {
  if (posts.length === 0) {
    return (
      <SurfaceState
        variant="empty"
        title="No posts yet"
        description="Published photos and videos will appear here."
      />
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
      {posts.map((post) => (
        <PostTile key={post.id} post={post} />
      ))}
    </ul>
  );
}
