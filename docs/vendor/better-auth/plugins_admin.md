# Admin

Admin plugin for Better Auth



The Admin plugin provides a set of administrative functions for user management in your application. It allows administrators to perform various operations such as creating users, managing user roles, banning/unbanning users, impersonating users, and more.

Installation [#installation]

<Steps>
  <Step>
    Add the plugin to your auth config [#add-the-plugin-to-your-auth-config]

    To use the Admin plugin, add it to your auth config.

    ```ts title="auth.ts"
    import { betterAuth } from "better-auth"
    import { admin } from "better-auth/plugins" // [!code highlight]

    export const auth = betterAuth({
        // ... other config options
        plugins: [
            admin() // [!code highlight]
        ]
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

    Next, include the admin client plugin in your authentication client instance.

    ```ts title="auth-client.ts"
    import { createAuthClient } from "better-auth/client"
    import { adminClient } from "better-auth/client/plugins"  // [!code highlight]

    export const authClient = createAuthClient({
        plugins: [
            adminClient()  // [!code highlight]
        ]
    })
    ```
  </Step>
</Steps>

Usage [#usage]

Before performing any admin operations, the user must be authenticated with an admin account. An admin is any user assigned the `admin` role or any user whose ID is included in the `adminUserIds` option.

Create User [#create-user]

Allows an admin to create a new user.


### Client Side

```ts
const { data, error } = await authClient.admin.createUser({
    email: user@example.com,
    password: some-secure-password,
    name: James Smith,
    role: user, // optional
    data, // optional
});
```

### Server Side

```ts
const newUser = await auth.api.createUser({
    body: {
        email: user@example.com,
        password: some-secure-password,
        name: James Smith,
        role: user, // optional
        data, // optional
    }
});
```

### Type Definition

```ts
type createUser = {
      /**
       * The email of the user. 
       */
      email: string = "user@example.com"
      /**
       * The password of the user. 
       */
      password: string = "some-secure-password"
      /**
       * The name of the user. 
       */
      name: string = "James Smith"
      /**
       * A string or array of strings representing the roles to apply to the new user. 
       */
      role?: string | string[] = "user"
      /**
       * Extra fields for the user. Including custom additional fields. 
       */
      data?: Record<string, any> = { customField: "customValue" 
}
```


List Users [#list-users]

Allows an admin to list all users in the database.


### Client Side

```ts
const { data, error } = await authClient.admin.listUsers({
    searchValue: some name, // optional
    searchField: name, // optional
    searchOperator: contains, // optional
    limit, // optional
    offset, // optional
    sortBy: name, // optional
    sortDirection: desc, // optional
    filterField: email, // optional
    filterValue: hello@example.com, // optional
    filterOperator: eq, // optional
});
```

### Server Side

```ts
const data = await auth.api.listUsers({
    query: {
        searchValue: some name, // optional
        searchField: name, // optional
        searchOperator: contains, // optional
        limit, // optional
        offset, // optional
        sortBy: name, // optional
        sortDirection: desc, // optional
        filterField: email, // optional
        filterValue: hello@example.com, // optional
        filterOperator: eq, // optional
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type listUsers = {
    /**
     * The value to search for. 
     */
    searchValue?: string = "some name"
    /**
     * The field to search in, defaults to email. Can be `email` or `name`. 
     */
    searchField?: "email" | "name" = "name"
    /**
     * The operator to use for the search. Can be `contains`, `starts_with` or `ends_with`. 
     */
    searchOperator?: "contains" | "starts_with" | "ends_with" = "contains"
    /**
     * The number of users to return. Defaults to 100.
     */
    limit?: string | number = 100
    /**
     * The offset to start from. 
     */
    offset?: string | number = 100
    /**
     * The field to sort by. 
     */
    sortBy?: string = "name"
    /**
     * The direction to sort by. 
     */
    sortDirection?: "asc" | "desc" = "desc"
    /**
     * The field to filter by. 
     */
    filterField?: string = "email"
    /**
     * The value to filter by. 
     */
    filterValue?: string | number | boolean | string[] | number[] = "hello@example.com"
    /**
     * The operator to use for the filter.
     */
    filterOperator?: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "not_in" | "contains" | "starts_with" | "ends_with" = "eq"
  
}
```


Query Filtering [#query-filtering]

The `listUsers` function supports various filter operators including `eq`, `contains`, `starts_with`, and `ends_with`.

Pagination [#pagination]

The `listUsers` function supports pagination by returning metadata alongside the user list. The response includes the following fields:

```ts
{
  users: User[],   // Array of returned users
  total: number,   // Total number of users after filters and search queries
  limit: number | undefined,   // The limit provided in the query
  offset: number | undefined   // The offset provided in the query
}
```

How to Implement Pagination [#how-to-implement-pagination]

To paginate results, use the `total`, `limit`, and `offset` values to calculate:

* **Total pages:** `Math.ceil(total / limit)`
* **Current page:** `(offset / limit) + 1`
* **Next page offset:** `Math.min(offset + limit, (total - 1))` – The value to use as `offset` for the next page, ensuring it does not exceed the total number of pages.
* **Previous page offset:** `Math.max(0, offset - limit)` – The value to use as `offset` for the previous page (ensuring it doesn’t go below zero).

Example Usage [#example-usage]

Fetching the second page with 10 users per page:

```ts
import { authClient } from "@/lib/auth-client";

const pageSize = 10;
const currentPage = 2;

const users = await authClient.admin.listUsers({
    query: {
        limit: pageSize,
        offset: (currentPage - 1) * pageSize
    }
});

const totalUsers = users.total;
const totalPages = Math.ceil(totalUsers / pageSize)
```

Get User [#get-user]

Fetches a user's information using an id.


### Client Side

```ts
const { data, error } = await authClient.admin.getUser({
    id: user-id,
});
```

### Server Side

```ts
const data = await auth.api.getUser({
    query: {
        id: user-id,
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type getUser = {
    /**
    * The id of the user you want to fetch.
    */
    id: string = "user-id"
  
}
```


Returns [#returns]

On success, `data` contains the user object. On failure, `error` is populated by `code`, `message`, `status`, and `statusText`.

```ts
type GetUserResponse = {
  data: User | null;
  error: null | {
    message: string;
    status: number; //HTTP status code
    statusText: string;
    code: string;
}
```

Set User Role [#set-user-role]

Changes the role of a user.


### Client Side

```ts
const { data, error } = await authClient.admin.setRole({
    userId: user-id, // optional
    role: admin,
});
```

### Server Side

```ts
const data = await auth.api.setRole({
    body: {
        userId: user-id, // optional
        role: admin,
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type setRole = {
      /**
       * The user id which you want to set the role for.
       */
      userId?: string = "user-id"
      /**
       * The role to set, this can be a string or an array of strings. 
       */
      role: string | string[] = "admin"
  
}
```


Set User Password [#set-user-password]

Sets the password for a user. A credential account is created if the user doesn't already have one.


### Client Side

```ts
const { data, error } = await authClient.admin.setUserPassword({
    newPassword: new-password,
    userId: user-id,
});
```

### Server Side

```ts
const data = await auth.api.setUserPassword({
    body: {
        newPassword: new-password,
        userId: user-id,
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type setUserPassword = {
      /**
       * The new password. 
       */
      newPassword: string = 'new-password'
      /**
       * The user id which you want to set the password for.
       */
      userId: string = 'user-id'
  
}
```


Update user [#update-user]

Update a user's details.


### Client Side

```ts
const { data, error } = await authClient.admin.updateUser({
    userId: user-id,
    data,
});
```

### Server Side

```ts
const data = await auth.api.adminUpdateUser({
    body: {
        userId: user-id,
        data,
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type adminUpdateUser = {
      /**
       * The user id which you want to update.
       */
      userId: string = "user-id"
      /**
       * The data to update.
       */
      data: Record<string, any> = { name: "John Doe" 
}
```


Ban User [#ban-user]

Bans a user, preventing them from signing in and revokes all of their existing sessions.


### Client Side

```ts
const { data, error } = await authClient.admin.banUser({
    userId: user-id,
    banReason: Spamming, // optional
    banExpiresIn, // optional
});
```

### Server Side

```ts
await auth.api.banUser({
    body: {
        userId: user-id,
        banReason: Spamming, // optional
        banExpiresIn, // optional
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type banUser = {
      /**
       * The user id which you want to ban.
       */
      userId: string = "user-id"
      /**
       * The reason for the ban. 
       */
      banReason?: string = "Spamming"
      /**
       * The number of seconds until the ban expires. If not provided, the ban will never expire. 
       */
      banExpiresIn?: number = 60 * 60 * 24 * 7
  
}
```


Unban User [#unban-user]

Removes the ban from a user, allowing them to sign in again.


### Client Side

```ts
const { data, error } = await authClient.admin.unbanUser({
    userId: user-id,
});
```

### Server Side

```ts
await auth.api.unbanUser({
    body: {
        userId: user-id,
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type unbanUser = {
      /**
       * The user id which you want to unban.
       */
      userId: string = "user-id"
  
}
```


List User Sessions [#list-user-sessions]

Lists all sessions for a user.


### Client Side

```ts
const { data, error } = await authClient.admin.listUserSessions({
    userId: user-id,
});
```

### Server Side

```ts
const data = await auth.api.listUserSessions({
    body: {
        userId: user-id,
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type listUserSessions = {
      /**
       * The user id. 
       */
      userId: string = "user-id"
  
}
```


Revoke User Session [#revoke-user-session]

Revokes a specific session for a user.


### Client Side

```ts
const { data, error } = await authClient.admin.revokeUserSession({
    sessionToken: session_token_here,
});
```

### Server Side

```ts
const data = await auth.api.revokeUserSession({
    body: {
        sessionToken: session_token_here,
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type revokeUserSession = {
      /**
       * The session token which you want to revoke. 
       */
      sessionToken: string = "session_token_here"
  
}
```


Revoke All Sessions for a User [#revoke-all-sessions-for-a-user]

Revokes all sessions for a user.


### Client Side

```ts
const { data, error } = await authClient.admin.revokeUserSessions({
    userId: user-id,
});
```

### Server Side

```ts
const data = await auth.api.revokeUserSessions({
    body: {
        userId: user-id,
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type revokeUserSessions = {
      /**
       * The user id which you want to revoke all sessions for. 
       */
      userId: string = "user-id"
  
}
```


Impersonate User [#impersonate-user]

This feature allows an admin to create a session that mimics the specified user. The session will remain active until either the browser session ends or it reaches 1 hour. You can change this duration by setting the `impersonationSessionDuration` option.


### Client Side

```ts
const { data, error } = await authClient.admin.impersonateUser({
    userId: user-id,
});
```

### Server Side

```ts
const data = await auth.api.impersonateUser({
    body: {
        userId: user-id,
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type impersonateUser = {
      /**
       * The user id which you want to impersonate. 
       */
      userId: string = "user-id"
  
}
```


By default, admins cannot impersonate other admin users. To allow this, grant the `impersonate-admins` permission to a role:

```ts title="auth.ts"
const superAdmin = ac.newRole({
  ...adminAc.statements,
  user: ["impersonate-admins", ...adminAc.statements.user],
});
```

<Callout type="info">
  The legacy `allowImpersonatingAdmins` option is still supported, but is deprecated and will be removed in a future version.
</Callout>

Stop Impersonating User [#stop-impersonating-user]

To stop impersonating a user and continue with the admin account, you can use `stopImpersonating`


### Client Side

```ts
const { data, error } = await authClient.admin.stopImpersonating({});
```

### Server Side

```ts
await auth.api.stopImpersonating({

    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type stopImpersonating = {
  
}
```


Remove User [#remove-user]

Hard deletes a user from the database.


### Client Side

```ts
const { data, error } = await authClient.admin.removeUser({
    userId: user-id,
});
```

### Server Side

```ts
const deletedUser = await auth.api.removeUser({
    body: {
        userId: user-id,
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type removeUser = {
      /**
       * The user id which you want to remove. 
       */
      userId: string = "user-id"
  
}
```


Access Control [#access-control]

The admin plugin offers a highly flexible access control system, allowing you to manage user permissions based on their role. You can define custom permission sets to fit your needs.

Roles [#roles]

By default, there are two roles:

`admin`: Users with the admin role have full control over other users.

`user`: Users with the user role have no control over other users.

<Callout>
  A user can have multiple roles. Multiple roles are stored as string separated by comma (",").
</Callout>

Permissions [#permissions]

By default, there are two resources with the following permissions.

**user**:
`create` `list` `set-role` `ban` `impersonate` `impersonate-admins` `delete` `set-password` `set-email` `get` `update`

**session**:
`list` `revoke` `delete`

Users with the admin role have full control over all the resources and actions. Users with the user role have no control over any of those actions.

Custom Permissions [#custom-permissions]

The plugin provides an easy way to define your own set of permissions for each role.

<Steps>
  <Step>
    Create Access Control [#create-access-control]

    You first need to create an access controller by calling the `createAccessControl` function and passing the statement object. The statement object should have the resource name as the key and the array of actions as the value.

    ```ts title="permissions.ts"
    import { createAccessControl } from "better-auth/plugins/access";

    /**
     * make sure to use `as const` so typescript can infer the type correctly
     */
    const statement = { // [!code highlight]
        project: ["create", "share", "update", "delete"], // [!code highlight]
    } as const; // [!code highlight]

    const ac = createAccessControl(statement); // [!code highlight]
    ```

    <Callout type="warning">
      To keep bundle sizes small, make sure to import from `better-auth/plugins/access` instead of `better-auth/plugins`.
    </Callout>
  </Step>

  <Step>
    Create Roles [#create-roles]

    Once you have created the access controller you can create roles with the permissions you have defined.

    ```ts title="permissions.ts"
    import { createAccessControl } from "better-auth/plugins/access";

    export const statement = {
        project: ["create", "share", "update", "delete"], // <-- Permissions available for created roles
    } as const;

    export const ac = createAccessControl(statement);

    export const user = ac.newRole({ // [!code highlight]
        project: ["create"], // [!code highlight]
    }); // [!code highlight]

    export const admin = ac.newRole({ // [!code highlight]
        project: ["create", "update"], // [!code highlight]
    }); // [!code highlight]

    export const myCustomRole = ac.newRole({ // [!code highlight]
        project: ["create", "update", "delete"], // [!code highlight]
        user: ["ban"], // [!code highlight]
    }); // [!code highlight]
    ```

    When you create custom roles for existing roles, the predefined permissions for those roles will be overridden. To add the existing permissions to the custom role, you need to import `defaultStatements` and merge it with your new statement, plus merge the roles' permissions set with the default roles.

    ```ts title="permissions.ts"
    import { createAccessControl } from "better-auth/plugins/access";
    import { defaultStatements, adminAc } from "better-auth/plugins/admin/access";

    const statement = {
        ...defaultStatements, // [!code highlight]
        project: ["create", "share", "update", "delete"],
    } as const;

    const ac = createAccessControl(statement);

    const admin = ac.newRole({
        project: ["create", "update"],
        ...adminAc.statements, // [!code highlight]
    });
    ```
  </Step>

  <Step>
    Pass Roles to the Plugin [#pass-roles-to-the-plugin]

    Once you have created the roles you can pass them to the admin plugin both on the client and the server.

    ```ts title="auth.ts"
    import { betterAuth } from "better-auth"
    import { admin as adminPlugin } from "better-auth/plugins"
    import { ac, admin, user } from "@/auth/permissions"

    export const auth = betterAuth({
        plugins: [
            adminPlugin({
                ac,
                roles: {
                    admin,
                    user,
                    myCustomRole
                }
            }),
        ],
    });
    ```

    You also need to pass the access controller and the roles to the client plugin.

    ```ts title="auth-client.ts"
    import { createAuthClient } from "better-auth/client"
    import { adminClient } from "better-auth/client/plugins"
    import { ac, admin, user, myCustomRole } from "@/auth/permissions"

    export const client = createAuthClient({
        plugins: [
            adminClient({
                ac,
                roles: {
                    admin,
                    user,
                    myCustomRole
                }
            })
        ]
    })
    ```
  </Step>
</Steps>

Access Control Usage [#access-control-usage]

**Has Permission**:

To check a user's permissions, you can use the `hasPermission` function provided by the client.


### Client Side

```ts
const { data, error } = await authClient.admin.hasPermission({
    userId: user-id, // optional
    role: admin, // optional
    permission, // optional
});
```

### Server Side

```ts
const data = await auth.api.userHasPermission({
    body: {
        userId: user-id, // optional
        role: admin, // optional
        permission, // optional
    }
});
```

### Type Definition

```ts
type userHasPermission = {
      /**
       * The user id which you want to check the permissions for. 
       */
      userId?: string = "user-id"
      /**
       * Check role permissions.
       * @serverOnly
       */
      role?: string = "admin"
      /**
       * Optionally check if a single permission is granted. Must use this, or permissions. 
       */
      permission?: Record<string, string[]> = { "project": ["create", "update"] 
}
```


Example usage:

```ts
import { authClient } from "@/lib/auth-client";

const canCreateProject = await authClient.admin.hasPermission({
  permissions: {
    project: ["create"],
  },
});

// You can also check multiple resource permissions at the same time
const canCreateProjectAndCreateSale = await authClient.admin.hasPermission({
  permissions: {
    project: ["create"],
    sale: ["create"]
  },
});
```

If you want to check a user's permissions server-side, you can use the `userHasPermission` action provided by the `api` to check the user's permissions.

```ts title="permission.ts"
import { auth } from "@/lib/auth"

await auth.api.userHasPermission({
  body: {
    userId: 'id', //the user id
    permissions: {
      project: ["create"], // This must match the structure in your access control
    },
  },
});

// You can also just pass the role directly
await auth.api.userHasPermission({
  body: {
   role: "admin",
    permissions: {
      project: ["create"], // This must match the structure in your access control
    },
  },
});

// You can also check multiple resource permissions at the same time
await auth.api.userHasPermission({
  body: {
   role: "admin",
    permissions: {
      project: ["create"], // This must match the structure in your access control
      sale: ["create"]
    },
  },
});
```

**Check Role Permission**:

Use the `checkRolePermission` function on the client side to verify whether a given **role** has a specific **permission**. This is helpful after defining roles and their permissions, as it allows you to perform permission checks without needing to contact the server.

Note that this function does **not** check the permissions of the currently logged-in user directly. Instead, it checks what permissions are assigned to a specified role. The function is synchronous, so you don't need to use `await` when calling it.

```ts
import { authClient } from "@/lib/auth-client";

const canCreateProject = authClient.admin.checkRolePermission({
  permissions: {
    user: ["delete"],
  },
  role: "admin",
});

// You can also check multiple resource permissions at the same time
const canDeleteUserAndRevokeSession = authClient.admin.checkRolePermission({
  permissions: {
    user: ["delete"],
    session: ["revoke"]
  },
  role: "admin",
});
```

Schema [#schema]

This plugin adds the following fields to the `user` table:

export const adminUserTableFields = [
	{
		name: "role",
		type: "string",
		description:
			"The user's role. Defaults to `user`. Admins will have the `admin` role.",
		isOptional: true,
	},
	{
		name: "banned",
		type: "boolean",
		description: "Indicates whether the user is banned.",
		isOptional: true,
	},
	{
		name: "banReason",
		type: "string",
		description: "The reason for the user's ban.",
		isOptional: true,
	},
	{
		name: "banExpires",
		type: "date",
		description: "The date when the user's ban will expire.",
		isOptional: true,
	},
];

<DatabaseTable name="user" fields={adminUserTableFields} />

And adds one field in the `session` table:

export const adminSessionTableFields = [
	{
		name: "impersonatedBy",
		type: "string",
		description: "The ID of the admin that is impersonating this session.",
		isOptional: true,
	},
];

<DatabaseTable name="session" fields={adminSessionTableFields} />

Email Enumeration Protection [#email-enumeration-protection]

If you use [email enumeration protection](/docs/authentication/email-password#email-enumeration-protection) (`requireEmailVerification` or `autoSignIn: false`), you need to configure `customSyntheticUser` to include the admin plugin fields in the fake sign-up response:

```ts title="auth.ts"
export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
      ...coreFields,
      // Admin plugin fields (in schema order)
      role: "user", // or your configured defaultRole
      banned: false,
      banReason: null,
      banExpires: null,
      ...additionalFields,
      id,
    }),
  },
  plugins: [admin()],
});
```

Options [#options]

Default Role [#default-role]

The default role for a user. Defaults to `user`.

```ts title="auth.ts"
admin({
  defaultRole: "regular",
});
```

Admin Roles [#admin-roles]

Specifies which roles are considered admin roles. Defaults to `["admin"]`. Custom roles (for example, `superadmin`) must be defined in custom access control.

```ts title="auth.ts"
admin({
  // Requires custom access control with `superadmin` defined in `roles`
  adminRoles: ["admin", "superadmin"],
});
```

<Callout type="warning">
  **Note:** The `adminRoles` option is **not required** when using custom access control (via `ac` and `roles`). When you define custom roles with specific permissions, those roles will have exactly the permissions you grant them through the access control system.

  **Warning:** When **not** using custom access control, only `admin` and `user` exist as valid roles. Any role that isn't in the `adminRoles` list will **not** be able to perform admin operations.
</Callout>

Admin userIds [#admin-userids]

You can pass an array of userIds that should be considered as admin. Default to `[]`

```ts title="auth.ts"
admin({
    adminUserIds: ["user_id_1", "user_id_2"]
})
```

If a user is in the `adminUserIds` list, they will be able to perform any admin operation.

impersonationSessionDuration [#impersonationsessionduration]

The duration of the impersonation session in seconds. Defaults to 1 hour.

```ts title="auth.ts"
admin({
  impersonationSessionDuration: 60 * 60 * 24, // 1 day
});
```

Default Ban Reason [#default-ban-reason]

The default ban reason for a user created by the admin. Defaults to `No reason`.

```ts title="auth.ts"
admin({
  defaultBanReason: "Spamming",
});
```

Default Ban Expires In [#default-ban-expires-in]

The default ban expires in for a user created by the admin in seconds. Defaults to `undefined` (meaning the ban never expires).

```ts title="auth.ts"
admin({
  defaultBanExpiresIn: 60 * 60 * 24, // 1 day
});
```

bannedUserMessage [#bannedusermessage]

The message to show when a banned user tries to sign in. Defaults to "You have been banned from this application. Please contact support if you believe this is an error."

```ts title="auth.ts"
admin({
  bannedUserMessage: "Custom banned user message",
});
```

