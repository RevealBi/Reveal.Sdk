# User context, row-level security and multi-tenancy

Source: https://help.revealbi.io/web/user-context/. This reference adds the security guidance the customer needs on top of that topic.

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
        // Fail closed: never share one "anonymous" context. Reject here as a backstop even
        // though the authorization fallback policy (below) already turns anonymous callers away.
        if (user.Identity?.IsAuthenticated != true)
            throw new UnauthorizedAccessException("Unauthenticated request.");

        var props = new Dictionary<string, object>
        {
            ["TenantId"] = user.FindFirst("tenant_id")?.Value
                ?? throw new InvalidOperationException("Authenticated user has no tenant."),
            ["Role"]     = user.IsInRole("Admin") ? "Admin" : "User",
        };
        // Identity.Name can be null for an authenticated user; require a stable, non-blank id claim.
        var userId = user.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? user.FindFirst("sub")?.Value;
        if (string.IsNullOrWhiteSpace(userId))
            throw new InvalidOperationException("Authenticated user has no stable identifier.");
        return new RVUserContext(userId, props);
    }
}
```

Protect the Reveal endpoints with the app's normal auth, and make sure it **rejects** anonymous requests. Authentication middleware only identifies the caller; it does not block anyone. In ASP.NET, `UseAuthentication()` populates `HttpContext.User` but an endpoint without an authorization requirement still serves anonymous callers. Reveal's endpoints are controllers without `[Authorize]`, so require it globally:

```csharp
builder.Services.AddAuthorization(o =>
    o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
// ...
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();   // or app.MapControllers().RequireAuthorization();
```

Mark the app's own public endpoints (login, health checks) with `[AllowAnonymous]`.

Node: `userContextProvider: (request) => new reveal.RVUserContext(stableIdOf(request.user), props)`, where `stableIdOf` throws when there is no user or the principal has no stable id, missing or blank (never default to `undefined` or a shared `"anonymous"`; see [assets/node-minimal](../assets/node-minimal)). It runs after the app's auth middleware has populated `request.user` (Passport, express-jwt). Mount the auth middleware before `app.use(..., reveal(...))`, and make sure it returns `401` when there is no user. `passport.authenticate(..., { session: false })` and `express-jwt` with `credentialsRequired: true` (the default) do; `passport.session()` alone, or `express-jwt` with `credentialsRequired: false`, only populate `request.user` and let anonymous requests through. If in doubt, add a guard:

```js
const requireAuth = (req, res, next) => (req.user ? next() : res.sendStatus(401));
app.use("/reveal-api", authenticate, requireAuth, reveal(revealOptions));
```

Java: build it in the `RevealEngineServlet` user context lambda from `request.getUserPrincipal()` or the Spring Security context (see [assets/java-minimal](../assets/java-minimal)).

### A null user context

The other providers can receive a `null` user context (the Node typings declare `IRVUserContext | null`). It has been reported for the authentication provider's second call during the editor's connection verification (RevealBi/Reveal.Sdk#621, on 1.8.2, since fixed), and the SDK's default system user context calls the user context provider with no request (latent: no caller found in 2.2.1; the starters throw there). Never dereference it unchecked:

- **Authentication provider:** decide from the data source (your host and database), not from the user, so a null context still gets the credential for your own server. If the credential genuinely depends on the user, return `null` (no credential) for a null context; never fall back to a shared privileged login.
- **Data source, item and dashboard providers:** fail closed. The starters' dashboard providers throw when there is no user id, so a null context can never resolve to a shared folder.

## Getting the token to the server

If the app authenticates API calls with a bearer token instead of cookies, forward it on Reveal requests from the client:

```js
RevealSdkSettings.setAdditionalHeadersProvider((url) => ({
    Authorization: `Bearer ${getAccessToken()}`
}));

// If the token has to be fetched or refreshed, the provider can be async:
RevealSdkSettings.setAdditionalHeadersProvider(async (url) => ({
    Authorization: `Bearer ${await getAccessTokenAsync()}`
}));
```

The server validates the token as it does for any other API call, then the user context provider reads the validated claims.

Cookie-based auth works without this when the client and server share an origin. Cross-origin cookies need a CORS policy with credentials (`AllowCredentials()` in ASP.NET, `credentials: true` in the Node `cors` options) and named origins, and the client must send cookies on its cross-origin requests: set `RevealSdkSettings.requestWithCredentialsFlag = true` at startup (see client.md). Prefer same-origin hosting or a bearer token.

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

Always replace the table or query the dashboard asked for with the server's own, by item id. If the provider only rewrites known ids, an unknown id must not fall through to an unfiltered table. Do **not** use `null` for that: returning `null` makes Reveal run the item as the client sent it, against the client-supplied host, on every platform, and so does throwing on Node (on ASP.NET and Java throwing fails the widget, but the exception message reaches the browser, so throw a generic one). Redirect it to your database with a query that returns no rows, and have the authentication provider release credentials only for your own host and database (see data-sources.md, "Rejecting an item does not stop the query").

## Dashboards per user or tenant

The dashboard provider also receives the user context. Use it to load from a per-tenant folder or table, and to refuse dashboards the user should not open. See dashboards.md.

A per-tenant dashboard (or a shared template) isolates only the layout. The **data** must still be scoped on the server from the user context's tenant id, in the data source and item providers (one of the patterns above). Filters preselected in the dashboard, and the item or table it names, are user-editable in the editor and in the request, so they are not isolation.

## Checklist

- [ ] Reveal endpoints require authentication like the rest of the API
- [ ] Dashboard load and save are authorized per user or tenant, not just per authenticated session (the default providers let any signed-in user read and overwrite every dashboard), and the dashboard id is validated (letters, digits, dash, underscore) by your own provider; the built-in providers are demo defaults
- [ ] User id, tenant and role are read from validated claims, not client-chosen headers
- [ ] Every data path is restricted server-side (database, parameterized query, procedure or DB RLS), not only by `IRVObjectFilter`
- [ ] No string concatenation of user values into SQL
- [ ] Tested by signing in as two different users and comparing what each sees, including through a dashboard saved by the other
- [ ] HTTPS in production
