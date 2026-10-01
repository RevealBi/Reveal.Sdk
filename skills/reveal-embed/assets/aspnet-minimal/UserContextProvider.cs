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
        var userId = user.Identity?.IsAuthenticated == true ? user.Identity.Name! : "anonymous";

        var properties = new Dictionary<string, object>();
        // Example: carry a tenant claim through to the data source provider.
        // if (user.FindFirst("tenant_id")?.Value is string tenantId) properties["TenantId"] = tenantId;

        return new RVUserContext(userId, properties);
    }
}
