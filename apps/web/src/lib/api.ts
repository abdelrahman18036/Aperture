import createClient from "openapi-fetch";

import type { paths } from "@repo/api-client";

/**
 * The API client, configured once.
 *
 * Paths, params and responses are all typed from Django's OpenAPI schema —
 * there is no hand-written description of any endpoint anywhere in this app.
 * Zod exists here for form validation only; it does not restate the API
 * contract. See `01-ARCHITECTURE.md` §3.
 *
 * The base URL is a bare `/api` because Next.js rewrites `/api/*` to Django.
 * That keeps the browser on one origin, which is what makes Django's session
 * cookie same-site and CSRF work the way Django expects.
 */
export const api = createClient<paths>({
  baseUrl: "/api",
  credentials: "same-origin",
});

/** Name of the cookie Django writes the CSRF token into. */
export const CSRF_COOKIE_NAME = "aperture_csrftoken";

/** Header Django reads the CSRF token back from. */
export const CSRF_HEADER_NAME = "X-CSRFToken";

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

/**
 * Echo Django's CSRF cookie back as a header on unsafe methods.
 *
 * Django's `CsrfViewMiddleware` compares the two, so without this every POST,
 * PUT, PATCH and DELETE is a 403.
 */
api.use({
  onRequest({ request }) {
    if (["GET", "HEAD", "OPTIONS", "TRACE"].includes(request.method)) {
      return request;
    }
    const token = readCookie(CSRF_COOKIE_NAME);
    if (token) {
      request.headers.set(CSRF_HEADER_NAME, token);
    }
    return request;
  },
});
