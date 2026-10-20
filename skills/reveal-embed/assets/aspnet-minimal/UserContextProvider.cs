using System.Security.Claims;
using Reveal.Sdk;

/// <summary>
/// Builds the Reveal user context for each request. Every other provider receives it,
/// so this is where per-user and per-tenant behavior starts.
///
/// Identity must come from the app's own authentication (cookie, JWT), never from a
/// header the browser chose. Wire up the app's auth middleware and read HttpContext.User.
/// </summary>
public class UserContextProvider(RevealAccess access) : IRVUserContextProvider
{
    public IRVUserContext GetUserContext(HttpContext httpContext)
    {
        // Fail closed if there is no request to take an identity from.
        var user = httpContext?.User ?? throw new UnauthorizedAccessException("No HTTP request.");
        string userId;
        if (user.Identity?.IsAuthenticated == true)
        {
            // Use a stable identifier claim, not Identity.Name (which can be null), and fail
            // closed if an authenticated principal has none (missing or blank).
            userId = user.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? user.FindFirst("sub")?.Value ?? "";
            if (string.IsNullOrWhiteSpace(userId))
                throw new InvalidOperationException("Authenticated user has no stable identifier.");
        }
        else if (access.AllowAnonymous)
        {
            userId = "anonymous";   // allowAnonymous only: every visitor shares one context
        }
        else
        {
            // Backstop for the fallback policy in Program.cs: never share one "anonymous" context.
            throw new UnauthorizedAccessException("Unauthenticated request.");
        }

        var properties = new Dictionary<string, object>();
        // Example: carry a tenant claim through to the data source provider.
        // if (user.FindFirst("tenant_id")?.Value is string tenantId) properties["TenantId"] = tenantId;

        return new RVUserContext(userId, properties);
    }
}
