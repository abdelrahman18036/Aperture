import type { NextConfig } from "next";

/**
 * The `/api/*` rewrite is the only integration point between this app and
 * Django. Because it is a rewrite rather than a redirect or a cross-origin
 * fetch, the browser sees a single origin: Django's session cookie stays
 * same-site, CSRF works the way Django expects, and there is no JWT in
 * localStorage and no CORS credential dance.
 *
 * See `01-ARCHITECTURE.md` §3. Next.js is not a backend — no route handlers
 * that talk to Postgres, no server actions duplicating a DRF endpoint.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactCompiler: true,

  /**
   * Dev only. Next refuses to serve its dev chunks to an origin it was not
   * started on, so loading the app from `127.0.0.1` while the server thinks
   * it is `localhost` yields 403s on half the JavaScript and a page that
   * renders its shell and then stops.
   *
   * Listed because those two hostnames are *different cookie origins*, which
   * is how two independent signed-in sessions get opened side by side in one
   * browser — which is exactly what verifying a conversation needs. It has no
   * effect on a production build.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
