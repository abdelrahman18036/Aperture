"use client";

import { Avatar, AvatarFallback, AvatarImage, cn } from "@repo/ui";

/**
 * One account's avatar, rendered the same way everywhere.
 *
 * It exists because the pattern was written out by hand on six surfaces and
 * was wrong on all of them: `<AvatarImage src="" />` with an empty string,
 * guarded on `avatar_media_id`, which is an id and not a URL. So the image
 * never loaded and the initials always showed — an avatar could not appear
 * even after the API grew a way to set one.
 *
 * `packages/ui` owns `Avatar`; this owns *what an Aperture user's avatar is*,
 * which is why it lives in a feature and not in the design system. Rule 2.
 */

export interface AvatarUser {
  username: string;
  avatar_url?: string | null;
}

export function UserAvatar({
  user,
  className,
}: {
  user: AvatarUser;
  className?: string;
}) {
  return (
    <Avatar className={cn(className)}>
      {user.avatar_url ? (
        // Alt is empty on purpose. The username is always beside it in the
        // markup, so describing the picture again makes a screen reader say
        // the name twice.
        <AvatarImage src={user.avatar_url} alt="" />
      ) : null}
      <AvatarFallback>{user.username.slice(0, 2)}</AvatarFallback>
    </Avatar>
  );
}
