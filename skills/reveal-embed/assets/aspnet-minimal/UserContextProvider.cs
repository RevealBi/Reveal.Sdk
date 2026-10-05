using System.Security.Claims;
using Reveal.Sdk;

/// <summary>
/// Builds the Reveal user context for each request. Every other provider receives it,
/// so this is where per-user and per-tenant behavior starts.
///
/// Identity must come from the app's own authentication (cookie, JWT), never from a
/// header the browser chose. Wire up the app's auth middleware and read HttpContext.User.
/// </summary>
public class UserContextProvider : IRVUserContextProvider
{
    public IRVUserContext GetUserContext(HttpContext httpContext)
    {
        var user = httpContext.User;
        // Use a stable identifier claim, not Identity.Name (which can be null), and fail
        // closed if an authenticated principal has none.
        var userId = user.Identity?.IsAuthenticated == true
            ? user.FindFirst(ClaimTypes.NameIdentifier)?.Value
                ?? user.FindFirst("sub")?.Value
                ?? throw new InvalidOperationException("Authenticated user has no stable identifier.")
            : "anonymous";

        var properties = new Dictionary<string, object>();
        // Example: carry a tenant claim through to the data source provider.
        // if (user.FindFirst("tenant_id")?.Value is string tenantId) properties["TenantId"] = tenantId;

        return new RVUserContext(userId, properties);
    }
}
