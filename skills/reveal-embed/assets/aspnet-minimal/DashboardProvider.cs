using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Reveal.Sdk;

/// <summary>
/// Dashboards in Dashboards/ are shared and never written. Saves are refused unless
/// allowEditing is set (Program.cs); then every user saves into a private folder keyed by
/// their id: they can load the shared dashboards and their own, and can never read or
/// overwrite another user's. The built-in provider lets any caller overwrite any dashboard.
/// Replace with the app's own storage and rules (tenants, sharing) when it needs them.
/// </summary>
public partial class DashboardProvider(RevealAccess access) : IRVDashboardProvider
{
    // Resolved against the working directory: start the app from its folder (dotnet run does),
    // or make this an absolute path from configuration. wwwroot resolves the same way.
    private static readonly string SharedDir = Path.Combine(Directory.GetCurrentDirectory(), "Dashboards");

    // \z, not $: in .NET "$" also matches before a final "\n", so "Sales\n" would pass.
    [GeneratedRegex(@"^[A-Za-z0-9_-]{1,100}\z")]
    private static partial Regex ValidId();

    // Fail closed: the user context can be null (system calls, connection verification);
    // never fold a missing id into a shared folder.
    private static string UserDir(IRVUserContext userContext)
    {
        var userId = userContext?.UserId;
        if (string.IsNullOrWhiteSpace(userId)) throw new InvalidOperationException("No user.");
        return Path.Combine(SharedDir, "users", Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(userId))));
    }

    // null makes Reveal answer 404; an exception would be a 500 with a stack trace in the log.
    public Task<Dashboard?> GetDashboardAsync(IRVUserContext userContext, string dashboardId)
    {
        if (!ValidId().IsMatch(dashboardId)) return Task.FromResult<Dashboard?>(null);
        var dirs = access.AllowEditing ? new[] { UserDir(userContext), SharedDir } : new[] { SharedDir };
        foreach (var dir in dirs)
        {
            var file = Path.Combine(dir, dashboardId + ".rdash");
            if (File.Exists(file)) return Task.FromResult<Dashboard?>(new Dashboard(file));
        }
        return Task.FromResult<Dashboard?>(null);
    }

    public async Task SaveDashboardAsync(IRVUserContext userContext, string dashboardId, Dashboard dashboard)
    {
        // View only: the page hides editing (canEdit = false); this closes the endpoint too.
        if (!access.AllowEditing) throw new InvalidOperationException("Saving dashboards is turned off.");
        if (!ValidId().IsMatch(dashboardId)) throw new ArgumentException("Invalid dashboard id.");
        var dir = UserDir(userContext);
        Directory.CreateDirectory(dir);
        // Write to a temp file and swap it in only once complete, so a failed or interrupted
        // save never truncates the previous version.
        var tmp = Path.Combine(dir, $"{dashboardId}.{Guid.NewGuid():N}.tmp");
        try
        {
            await dashboard.SaveToFileAsync(tmp);
            File.Move(tmp, Path.Combine(dir, dashboardId + ".rdash"), overwrite: true);
        }
        catch
        {
            File.Delete(tmp);
            throw;
        }
    }
}
