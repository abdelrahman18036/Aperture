import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps signed-out visitors out of the authenticated shell.
 *
 * `proxy.ts`, not `middleware.ts`. This Next deprecated the middleware
 * convention and renamed it, and `AGENTS.md` in this app says to heed exactly
 * that kind of notice — the dev server prints it on every start otherwise.
 *
 * **This is not the security boundary and must not be mistaken for one.**
 * Django is: every endpoint behind `IsAuthenticated` refuses an
 * unauthenticated request, and that is what actually protects the data. All
 * this does is check whether a session cookie is *present* — it cannot tell
 * whether the session is valid, because only Django can, and asking would put
 * a round trip in front of every navigation.
 *
 * What it buys is the thing that was broken: without it, a signed-out visitor
 * got the full three-column shell — nav rail, story tray, "add to your story"
 * — with a red "Could not load the feed" where the feed should be. Every
 * authenticated route rendered its chrome and then failed. That reads as a
 * broken product rather than as a sign-in wall.
 *
 * A stale cookie still lands on the shell and gets a 403 from the API; the
 * shell handles that by sending them to sign in. Cookie presence is the cheap
 * check, and the API's answer is the real one.
 */

/** The cookie Django sets. Named in `config/settings.py`. */
const SESSION_COOKIE = "aperture_session";

/** Reachable signed out. Everything else under the shell is not. */
const PUBLIC_PATHS = ["/login", "/signup", "/reset"];

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!signedIn && !isPublic) {
    const login = new URL("/login", request.url);
    // Where they were going, so signing in returns them there rather than
    // to a feed they did not ask for. Path only — a full URL here would let
    // anyone craft a link that signs somebody in and bounces them off-site.
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  // Already signed in and asking for the sign-in page. Sending them to the
  // feed is what every product does, and it is what a bookmarked `/login`
  // should do.
  if (signedIn && isPublic && pathname !== "/reset") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except the things that must never redirect.
   *
   * `api` above all: the `/api/*` rewrite is how the browser reaches Django,
   * and bouncing an unauthenticated API call to an HTML page would turn every
   * 403 into a parse error at the call site. `_next` is the app's own
   * JavaScript, and `icon.svg` is the favicon.
   */
  matcher: ["/((?!api|_next/static|_next/image|icon.svg).*)"],
};
