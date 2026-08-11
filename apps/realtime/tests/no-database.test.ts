import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Rule 6, enforced rather than remembered.
 *
 * "`apps/realtime` never touches Postgres. No ORM, no database driver, no
 * business logic — it authenticates a socket, subscribes it to Redis, pushes
 * bytes. A database dependency appearing in its `package.json` means
 * something went wrong."
 *
 * The failure this prevents is not dramatic, which is exactly why it needs a
 * test: someone adds a query here because it is convenient, and the split
 * that justifies three deployables quietly stops being true. A grep in a
 * checklist decays; this does not.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..");

const DATABASE_PACKAGES =
  /^(pg|pg-.*|postgres|postgres\.js|knex|prisma|@prisma\/.*|typeorm|sequelize|drizzle-orm|mysql2?|sqlite3|better-sqlite3|mongoose|mongodb|kysely)$/i;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

describe("apps/realtime holds no database", () => {
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as PackageJson;

  it("declares no database package", () => {
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    const offenders = declared.filter((name) => DATABASE_PACKAGES.test(name));

    expect(offenders).toEqual([]);
  });

  it("declares only what a socket gateway needs", () => {
    // Listed explicitly so that adding a runtime dependency is a decision
    // somebody makes on purpose, in a diff, rather than a drift nobody sees.
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@repo/realtime-events",
      "ioredis",
      "jose",
      "ws",
    ]);
  });

  it("writes no SQL and reads no DATABASE_URL", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, "src"))) {
      const contents = readFileSync(file, "utf8");
      if (/DATABASE_URL|\bSELECT\s+\w+\s+FROM\b|\bINSERT\s+INTO\b/i.test(contents)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
