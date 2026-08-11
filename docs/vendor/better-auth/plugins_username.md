# Username

Username plugin



The username plugin is a lightweight plugin that adds username support to the email and password authenticator. This allows users to sign in with their username instead of their email.

Installation [#installation]

<Steps>
  <Step>
    Add Plugin to the server [#add-plugin-to-the-server]

    ```ts title="auth.ts"
    import { betterAuth } from "better-auth"
    import { username } from "better-auth/plugins" // [!code highlight]

    export const auth = betterAuth({
        emailAndPassword: { // [!code highlight]
            enabled: true, // [!code highlight]
        }, // [!code highlight]
        plugins: [ // [!code highlight]
            username() // [!code highlight]
        ] // [!code highlight]
    })
    ```
  </Step>

  <Step>
    Migrate the database [#migrate-the-database]

    Run the migration or generate the schema to add the necessary fields and tables to the database.

    <Tabs items={["migrate", "generate"]}>
      <Tab value="migrate">
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
            ```bash
            npx auth migrate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="pnpm">
            ```bash
            pnpm dlx auth migrate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="yarn">
            ```bash
            yarn dlx auth migrate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="bun">
            ```bash
            bun x auth migrate
            ```
          </CodeBlockTab>
        </CodeBlockTabs>
      </Tab>

      <Tab value="generate">
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
            ```bash
            npx auth generate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="pnpm">
            ```bash
            pnpm dlx auth generate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="yarn">
            ```bash
            yarn dlx auth generate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="bun">
            ```bash
            bun x auth generate
            ```
          </CodeBlockTab>
        </CodeBlockTabs>
      </Tab>
    </Tabs>

    See the [Schema](#schema) section to add the fields manually.
  </Step>

  <Step>
    Add the client plugin [#add-the-client-plugin]

    ```ts title="auth-client.ts"
    import { createAuthClient } from "better-auth/client"
    import { usernameClient } from "better-auth/client/plugins" // [!code highlight]

    export const authClient = createAuthClient({
        plugins: [ // [!code highlight]
            usernameClient() // [!code highlight]
        ] // [!code highlight]
    })
    ```
  </Step>
</Steps>

Usage [#usage]

Sign up [#sign-up]

To sign up a user with username, you can use the existing `signUp.email` function provided by the client.
The `signUp` function should take a new `username` property in the object.


### Client Side

```ts
const { data, error } = await authClient.signUp.email({
    email: email@domain.com,
    name: Test User,
    password: password1234,
    username: test, // optional
    displayUsername: Test User123, // optional
});
```

### Server Side

```ts
const data = await auth.api.signUpEmail({
    body: {
        email: email@domain.com,
        name: Test User,
        password: password1234,
        username: test, // optional
        displayUsername: Test User123, // optional
    }
});
```

### Type Definition

```ts
type signUpEmail = {
      /**
       * The email of the user.
      */
      email: string = "email@domain.com"
      /**
       * The name of the user.
      */
      name: string = "Test User"
      /**
       * The password of the user.
      */
      password: string = "password1234"
      /**
       * The username of the user.
      */
      username?: string = "test"
      /**
       * An optional display username of the user.
      */
      displayUsername?: string = "Test User123"
  
}
```


<Callout type="info">
  If only `username` is provided, the `displayUsername` will be set to the pre normalized version of the `username`. You can see the [Username Normalization](#username-normalization) and [Display Username Normalization](#display-username-normalization) sections for more details.
</Callout>

Sign in [#sign-in]

To sign in a user with username, you can use the `signIn.username` function provided by the client.


### Client Side

```ts
const { data, error } = await authClient.signIn.username({
    username: test,
    password: password1234,
});
```

### Server Side

```ts
const data = await auth.api.signInUsername({
    body: {
        username: test,
        password: password1234,
    }
});
```

### Type Definition

```ts
type signInUsername = {
      /**
       * The username of the user.
      */
      username: string = "test"
      /**
       * The password of the user.
      */
      password: string = "password1234"
  
}
```


Update username [#update-username]

To update the username of a user, you can use the `updateUser` function provided by the client.


### Client Side

```ts
const { data, error } = await authClient.updateUser({
    username: new-username, // optional
});
```

### Server Side

```ts
const data = await auth.api.updateUser({
    body: {
        username: new-username, // optional
    }
});
```

### Type Definition

```ts
type updateUser = {
      /**
       * The username to update.
      */
      username?: string = "new-username"
  
}
```


Check if username is available [#check-if-username-is-available]

To check if a username is available, you can use the `isUsernameAvailable` function provided by the client.


### Client Side

```ts
const { data, error } = await authClient.isUsernameAvailable({
    username: new-username,
});
```

### Server Side

```ts
const response = await auth.api.isUsernameAvailable({
    body: {
        username: new-username,
    }
});
```

### Type Definition

```ts
type isUsernameAvailable = {
      /**
       * The username to check.
      */
      username: string = "new-username"
  
}
```


Options [#options]

Min Username Length [#min-username-length]

The minimum length of the username. Default is `3`.

```ts title="auth.ts"
import { betterAuth } from "better-auth"
import { username } from "better-auth/plugins"

const auth = betterAuth({
    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        username({
            minUsernameLength: 5
        })
    ]
})
```

Max Username Length [#max-username-length]

The maximum length of the username. Default is `30`.

```ts title="auth.ts"
import { betterAuth } from "better-auth"
import { username } from "better-auth/plugins"

const auth = betterAuth({
    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        username({
            maxUsernameLength: 100
        })
    ]
})
```

Username Validator [#username-validator]

A function that validates the username. The function should return false if the username is invalid. By default, the username should only contain alphanumeric characters, underscores, and dots.

```ts title="auth.ts"
import { betterAuth } from "better-auth"
import { username } from "better-auth/plugins"

const auth = betterAuth({
    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        username({
            usernameValidator: (username) => {
                if (username === "admin") {
                    return false
                }
                return true
            }
        })
    ]
})
```

Display Username Validator [#display-username-validator]

A function that validates the display username. The function should return false if the display username is invalid. By default, no validation is applied to display username.

```ts title="auth.ts"
import { betterAuth } from "better-auth"
import { username } from "better-auth/plugins"

const auth = betterAuth({
    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        username({
            displayUsernameValidator: (displayUsername) => {
                // Allow only alphanumeric characters, underscores, and hyphens
                return /^[a-zA-Z0-9_-]+$/.test(displayUsername)
            }
        })
    ]
})
```

Username Normalization [#username-normalization]

A function that normalizes the username, or `false` if you want to disable normalization.

By default, usernames are normalized to lowercase, so "TestUser" and "testuser", for example, are considered the same username. The `username` field will contain the normalized (lower case) username, while `displayUsername` will contain the original `username`.

```ts title="auth.ts"
import { betterAuth } from "better-auth"
import { username } from "better-auth/plugins"

const auth = betterAuth({
    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        username({
            usernameNormalization: (username) => {
                return username.toLowerCase()
                    .replaceAll("0", "o")
                    .replaceAll("3", "e")
                    .replaceAll("4", "a");
            }
        })
    ]
})
```

Display Username Normalization [#display-username-normalization]

A function that normalizes the display username, or `false` to disable normalization.

By default, display usernames are not normalized. When only `username` is provided during signup or update, the `displayUsername` will be set to match the original `username` value (before normalization). You can also explicitly set a `displayUsername` which will be preserved as-is. For custom normalization, provide a function that takes the display username as input and returns the normalized version.

```ts title="auth.ts"
import { betterAuth } from "better-auth"
import { username } from "better-auth/plugins"

const auth = betterAuth({
    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        username({
            displayUsernameNormalization: (displayUsername) => displayUsername.toLowerCase(),
        })
    ]
})
```

Validation Order [#validation-order]

By default, username and display username are validated before normalization. You can change this behavior by setting `validationOrder` to `post-normalization`.

```ts title="auth.ts"
import { betterAuth } from "better-auth"
import { username } from "better-auth/plugins"

const auth = betterAuth({
    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        username({
            validationOrder: {
                username: "post-normalization",
                displayUsername: "post-normalization",
            }
        })
    ]
})
```

Disable Is Username Available [#disable-is-username-available]

By default, the plugin exposes an endpoint `/is-username-available` to check if a username is available. You can disable this endpoint by providing `disabledPaths` option to the better-auth configuration. This is useful if you want to protect usernames from being enumerated.

```ts title="auth.ts"
import { betterAuth } from "better-auth"
import { username } from "better-auth/plugins"

const auth = betterAuth({
    emailAndPassword: {
        enabled: true,
    },
    disabledPaths: ["/is-username-available"],
    plugins: [
        username()
    ]
})
```

Schema [#schema]

The plugin requires 2 fields to be added to the user table:

export const usernameUserTableFields = [
	{
		name: "username",
		type: "string",
		description: "The username of the user",
		isUnique: true,
		isOptional: true,
	},
	{
		name: "displayUsername",
		type: "string",
		description: "Non normalized username of the user",
		isOptional: true,
	},
];

<DatabaseTable name="user" fields={usernameUserTableFields} />

