# CLI

Learn about the Better Auth CLI commands for generating and migrating database schemas, initializing projects, generating secret keys, and gathering diagnostic info.



Better Auth comes with a built-in CLI to help you manage the database schemas, initialize your project, generate a secret key for your application, and gather diagnostic information about your setup.

Generate [#generate]

The `generate` command creates the schema required by Better Auth. If you're using a database adapter like Prisma or Drizzle, this command will generate the right schema for your ORM. If you're using the built-in Kysely adapter, it will generate an SQL file you can run directly on your database.

<CodeBlockTabs defaultValue="npm" groupId="persist-install" persist>
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="npm">
      npm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="pnpm">
      pnpm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="yarn">
      yarn
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="bun">
      bun
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="npm">
    ```bash title="Terminal"
    npx auth@latest generate
    ```
  </CodeBlockTab>

  <CodeBlockTab value="pnpm">
    ```bash title="Terminal"
    pnpm dlx auth@latest generate
    ```
  </CodeBlockTab>

  <CodeBlockTab value="yarn">
    ```bash title="Terminal"
    yarn dlx auth@latest generate
    ```
  </CodeBlockTab>

  <CodeBlockTab value="bun">
    ```bash title="Terminal"
    bun x auth@latest generate
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Options [#options]

* `--output` - Where to save the generated schema. For Prisma, it will be saved in prisma/schema.prisma. For Drizzle, it goes to schema.ts in your project root. For Kysely, it's an SQL file saved as schema.sql in your project root.
* `--config` - The path to your Better Auth config file. By default, the CLI will search for an auth.ts file in **./**, **./utils**, **./lib**, or any of these directories under the `src` directory.
* `--yes` - Skip the confirmation prompt and generate the schema directly.

Migrate [#migrate]

The migrate command applies the Better Auth schema directly to your database. This is available if you're using the built-in Kysely adapter. For other adapters, you'll need to apply the schema using your ORM's migration tool.

<CodeBlockTabs defaultValue="npm" groupId="persist-install" persist>
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="npm">
      npm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="pnpm">
      pnpm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="yarn">
      yarn
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="bun">
      bun
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="npm">
    ```bash title="Terminal"
    npx auth@latest migrate
    ```
  </CodeBlockTab>

  <CodeBlockTab value="pnpm">
    ```bash title="Terminal"
    pnpm dlx auth@latest migrate
    ```
  </CodeBlockTab>

  <CodeBlockTab value="yarn">
    ```bash title="Terminal"
    yarn dlx auth@latest migrate
    ```
  </CodeBlockTab>

  <CodeBlockTab value="bun">
    ```bash title="Terminal"
    bun x auth@latest migrate
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Options [#options-1]

* `--config` - The path to your Better Auth config file. By default, the CLI will search for an auth.ts file in **./**, **./utils**, **./lib**, or any of these directories under the `src` directory.
* `--yes` - Skip the confirmation prompt and apply the schema directly.

<Callout type="info">
  **Using PostgreSQL with a non-default schema?**

  The migrate command automatically detects your configured `search_path` and creates tables in the correct schema. See the [PostgreSQL adapter documentation](/docs/adapters/postgresql#use-a-non-default-schema) for configuration details.
</Callout>

Init [#init]

The `init` command allows you to initialize Better Auth in your project.

<CodeBlockTabs defaultValue="npm" groupId="persist-install" persist>
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="npm">
      npm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="pnpm">
      pnpm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="yarn">
      yarn
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="bun">
      bun
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="npm">
    ```bash title="Terminal"
    npx auth@latest init
    ```
  </CodeBlockTab>

  <CodeBlockTab value="pnpm">
    ```bash title="Terminal"
    pnpm dlx auth@latest init
    ```
  </CodeBlockTab>

  <CodeBlockTab value="yarn">
    ```bash title="Terminal"
    yarn dlx auth@latest init
    ```
  </CodeBlockTab>

  <CodeBlockTab value="bun">
    ```bash title="Terminal"
    bun x auth@latest init
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Options [#options-2]

* `--name` - The name of your application. (defaults to the `name` property in your `package.json`).
* `--framework` - The framework your codebase is using. Currently, the only supported framework is `Next.js`.
* `--plugins` - The plugins you want to use. You can specify multiple plugins by separating them with a comma.
* `--database` - The database you want to use. Currently, the only supported database is `SQLite`.
* `--package-manager` - The package manager you want to use. Currently, the only supported package managers are `npm`, `pnpm`, `yarn`, `bun` (defaults to the manager you used to initialize the CLI).

Upgrade [#upgrade]

The `upgrade` command updates older `better-auth` and official `@better-auth/*` dependencies to the version of the CLI being run. Dependencies at the same or a newer version are left unchanged.

<CodeBlockTabs defaultValue="npm" groupId="persist-install" persist>
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="npm">
      npm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="pnpm">
      pnpm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="yarn">
      yarn
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="bun">
      bun
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="npm">
    ```bash title="Terminal"
    npx auth@latest upgrade
    ```
  </CodeBlockTab>

  <CodeBlockTab value="pnpm">
    ```bash title="Terminal"
    pnpm dlx auth@latest upgrade
    ```
  </CodeBlockTab>

  <CodeBlockTab value="yarn">
    ```bash title="Terminal"
    yarn dlx auth@latest upgrade
    ```
  </CodeBlockTab>

  <CodeBlockTab value="bun">
    ```bash title="Terminal"
    bun x auth@latest upgrade
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Options [#options-3]

* `--cwd` - The project directory containing the `package.json` to update. Defaults to the current directory.
* `--yes` - Skip the confirmation prompt and install the updates directly.

Info [#info]

The `info` command provides diagnostic information about your Better Auth setup and environment. Useful for debugging and sharing when seeking support.

<CodeBlockTabs defaultValue="npm" groupId="persist-install" persist>
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="npm">
      npm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="pnpm">
      pnpm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="yarn">
      yarn
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="bun">
      bun
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="npm">
    ```bash title="Terminal"
    npx auth@latest info
    ```
  </CodeBlockTab>

  <CodeBlockTab value="pnpm">
    ```bash title="Terminal"
    pnpm dlx auth@latest info
    ```
  </CodeBlockTab>

  <CodeBlockTab value="yarn">
    ```bash title="Terminal"
    yarn dlx auth@latest info
    ```
  </CodeBlockTab>

  <CodeBlockTab value="bun">
    ```bash title="Terminal"
    bun x auth@latest info
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Output [#output]

The command displays:

* **System**: OS, CPU, memory, Node.js version
* **Package Manager**: Detected manager and version
* **Better Auth**: Version and configuration (sensitive data auto-redacted)
* **Frameworks**: Detected frameworks (Next.js, React, Vue, etc.)
* **Databases**: Database clients and ORMs (Prisma, Drizzle, etc.)

Options [#options-4]

* `--config` - Path to your Better Auth config file
* `--json` - Output as JSON for sharing or programmatic use

Examples [#examples]

```bash
# Basic usage
npx auth@latest info

# Custom config path
npx auth@latest info --config ./config/auth.ts

# JSON output
npx auth@latest info --json > auth-info.json
```

Sensitive data like secrets, API keys, and database URLs are automatically replaced with `[REDACTED]` for safe sharing.

Secret [#secret]

The CLI also provides a way to generate a secret key for your Better Auth instance.

<CodeBlockTabs defaultValue="npm" groupId="persist-install" persist>
  <CodeBlockTabsList>
    <CodeBlockTabsTrigger value="npm">
      npm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="pnpm">
      pnpm
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="yarn">
      yarn
    </CodeBlockTabsTrigger>

    <CodeBlockTabsTrigger value="bun">
      bun
    </CodeBlockTabsTrigger>
  </CodeBlockTabsList>

  <CodeBlockTab value="npm">
    ```bash title="Terminal"
    npx auth@latest secret
    ```
  </CodeBlockTab>

  <CodeBlockTab value="pnpm">
    ```bash title="Terminal"
    pnpm dlx auth@latest secret
    ```
  </CodeBlockTab>

  <CodeBlockTab value="yarn">
    ```bash title="Terminal"
    yarn dlx auth@latest secret
    ```
  </CodeBlockTab>

  <CodeBlockTab value="bun">
    ```bash title="Terminal"
    bun x auth@latest secret
    ```
  </CodeBlockTab>
</CodeBlockTabs>

Common Issues [#common-issues]

**Error: Cannot find module X**

The CLI resolves most imports for you: `tsconfig.json` path aliases (including SvelteKit's `$lib`) and stubbed framework virtual modules (`$env/*`, `$app/*`, `cloudflare:workers`, Vite assets like `?raw`). For SvelteKit, run `svelte-kit sync` first so `.svelte-kit/tsconfig.json` exists.

A few module types can't load outside their bundler (e.g. `.svelte` components or `import.meta.glob`). Keep those out of your config file's import graph.

