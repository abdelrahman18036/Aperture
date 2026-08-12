import type { Metadata } from "next";

import { PostDetail } from "@/features/post/post-detail";

export const metadata: Metadata = {
  title: "Post — Aperture",
};

/**
 * `/p/<id>` — one post and its comments.
 *
 * The id stays a string all the way down. It is a snowflake above 2^53, so
 * anything that turns it into a `Number` addresses a different row.
 */
export default async function PostPage({ params }: PageProps<"/p/[postId]">) {
  const { postId } = await params;
  return <PostDetail postId={postId} />;
}
