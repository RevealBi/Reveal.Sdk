using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Reveal.Sdk;

/// <summary>
/// Dashboards in Dashboards/ are shared and read-only. Every user saves into a private
/// folder keyed by their id: they can load the shared dashboards and their own, and can
/// never read or overwrite another user's. The built-in provider lets any caller overwrite
/// any dashboard. Replace with the app's own storage and rules (tenants, sharing) when
/// it needs them.
/// </summary>
public partial class DashboardProvider : IRVDashboardProvider
{
    private static readonly string SharedDir = Path.Combine(Directory.GetCurrentDirectory(), "Dashboards");

    [GeneratedRegex("^[A-Za-z0-9_-]{1,100}$")]
    private static partial Regex ValidId();

    private static string UserDir(IRVUserContext userContext) =>
        Path.Combine(SharedDir, "users", Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(userContext.UserId ?? ""))));

    public Task<Dashboard> GetDashboardAsync(IRVUserContext userContext, string dashboardId)
    {
        if (!ValidId().IsMatch(dashboardId)) throw new ArgumentException("Invalid dashboard id.");
        foreach (var dir in new[] { UserDir(userContext), SharedDir })
        {
            var file = Path.Combine(dir, dashboardId + ".rdash");
            if (File.Exists(file)) return Task.FromResult(new Dashboard(file));
        }
        throw new FileNotFoundException(dashboardId);
    }

    public async Task SaveDashboardAsync(IRVUserContext userContext, string dashboardId, Dashboard dashboard)
    {
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
