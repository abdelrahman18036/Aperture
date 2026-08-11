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
