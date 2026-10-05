# User context, row-level security and multi-tenancy

Source: https://help.revealbi.io/web/user-context. This reference adds the security guidance the customer needs on top of that topic.

## How it fits together

1. Every Reveal request reaches the server's **user context provider**, which builds an `RVUserContext(userId, properties)` from the HTTP request.
2. That context is passed to every other provider: data source, authentication, dashboard, object filter, data model.
3. The providers use it to choose the database, add query parameters, pick credentials, pick which dashboards the user can load, and hide items.

So "users see only their own data" is always implemented **server-side in providers**, keyed off the user context. Nothing done on the client restricts data.

## Build the context from the app's own authentication

The Reveal endpoints sit behind the same authentication as the rest of the customer's API. Read the identity the app already validated.

ASP.NET Core:

```cs
public class UserContextProvider : IRVUserContextProvider
{
    public IRVUserContext GetUserContext(HttpContext http)
    {
        var user = http.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            // Fail closed: an anonymous context should resolve to no data in the providers.
            return new RVUserContext("anonymous", new Dictionary<string, object>());
        }

        var props = new Dictionary<string, object>
        {
            ["TenantId"] = user.FindFirst("tenant_id")?.Value,
            ["Role"]     = user.IsInRole("Admin") ? "Admin" : "User",
        };
        // Identity.Name can be null for an authenticated user; require a stable id claim.
        var userId = user.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? user.FindFirst("sub")?.Value
            ?? throw new InvalidOperationException("Authenticated user has no stable identifier.");
        return new RVUserContext(userId, props);
    }
}
```

Protect the Reveal endpoints with the app's normal auth. In ASP.NET, Reveal's endpoints are controllers, so a global authorization policy (`builder.Services.AddAuthorization(o => o.FallbackPolicy = ...)`) or the app's existing auth middleware applies to them.

Node: `userContextProvider: (request) => new reveal.RVUserContext(request.user?.id, props)`, after the app's auth middleware has populated `request.user` (Passport, express-jwt). Mount the auth middleware before `app.use(..., reveal(...))`.

Java: build it in the `RevealEngineServlet` user context lambda from `request.getUserPrincipal()` or the Spring Security context.

## Getting the token to the server

If the app authenticates API calls with a bearer token instead of cookies, forward it on Reveal requests from the client:

```js
RevealSdkSettings.setAdditionalHeadersProvider((url) => ({
    Authorization: `Bearer ${getAccessToken()}`
}));
```

The server validates the token as it does for any other API call, then the user context provider reads the validated claims.

Cookie-based auth works without this when the client and server share an origin. Cross-origin cookies need a CORS policy with credentials and named origins.

## What must not be trusted

- **Do not treat a header value as identity.** The docs' row-level security example reads `x-header-customerId` from a header and uses it as the user id. That is fine as a demo of the plumbing, but in an app any user can send any header. Identity, tenant and role must come from a validated token, cookie or session.
- Headers are fine for **non-security UI state**: a selected region or a Top-N choice. Validate type and range (parse ints, check against an allow-list) before use.
- Never let a client value choose the host, database, file path or table directly. Map it through a server-side lookup.

## Row-level security patterns

Pick the strongest one the data source allows:

| Pattern | How | Notes |
| --- | --- | --- |
| Database per tenant | `ChangeDataSourceAsync` sets `Host`/`Database` from the tenant id | Strongest isolation. Also update the item's data source in `ChangeDataSourceItemAsync`. |
| Parameterized custom query | `ChangeDataSourceItemAsync` sets `CustomQuery` with `@tenantId` and `CustomQueryParameters` | Use where the connector supports parameters (see data-sources.md). |
| Stored procedure | `item.Procedure` and `ProcedureParameters` from the user context | Disables grid paging for that item. |
| Database-enforced RLS | Per-user credentials in the authentication provider, or session context set by a procedure, and let the database filter | Good when the database already has RLS policies. |
| Hide items from the list | `IRVObjectFilter` | UX only. It must be combined with one of the above. |

Always replace the table or query the dashboard asked for with the server's own, by item id. If the provider only rewrites known ids, an unknown id must not fall through to an unfiltered table. Do **not** use `null` for that: returning `null` (or throwing) makes Reveal run the item as the client sent it, against the client-supplied host. Redirect it to your database with a query that returns no rows, and have the authentication provider release credentials only for your own host and database (see data-sources.md, "Rejecting an item does not stop the query").

## Dashboards per user or tenant

The dashboard provider also receives the user context. Use it to load from a per-tenant folder or table, and to refuse dashboards the user should not open. See dashboards.md.

## Checklist

- [ ] Reveal endpoints require authentication like the rest of the API
- [ ] User id, tenant and role are read from validated claims, not client-chosen headers
- [ ] Every data path is restricted server-side (database, parameterized query, procedure or DB RLS), not only by `IRVObjectFilter`
- [ ] No string concatenation of user values into SQL
- [ ] Tested by signing in as two different users and comparing what each sees, including through a dashboard saved by the other
- [ ] HTTPS in production
