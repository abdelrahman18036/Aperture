/**
 * The typed contract between Django and the browser.
 *
 * `schema.d.ts` next to this file is **generated output** — produced by
 * drf-spectacular from the DRF serializers, then by openapi-typescript from
 * that schema. Never hand-edit it. A serializer change that is not reflected
 * in a regenerated client is a broken build, not a runtime surprise, and CI
 * enforces exactly that by regenerating and failing on any diff.
 *
 * This file is the one hand-written thing in the package, and all it does is
 * re-export. If you find yourself adding a TypeScript interface here that
 * restates a Django serializer, stop — that is the failure mode
 * `01-ARCHITECTURE.md` §3 exists to prevent.
 *
 * Regenerate with `pnpm generate` from the repo root.
 */

export type { components, operations, paths, webhooks } from "./schema.js";

import type { components } from "./schema.js";

/** Every response and request body the API defines, by name. */
export type Schemas = components["schemas"];
