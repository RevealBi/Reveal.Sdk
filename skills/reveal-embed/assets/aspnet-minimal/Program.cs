// Minimal ASP.NET Core host for the Reveal SDK. Serves the Reveal endpoints and a
// same-origin page from wwwroot, so the client needs no setBaseUrl and no CORS.
//
//     dotnet run -- --anonymous-demo    ->  http://localhost:5111/
//
// Without --anonymous-demo every Reveal endpoint requires an authenticated user, and
// requests fail until the app's real authentication is added below. The flag is for a
// local first run only: it allows anonymous access and listens on localhost alone.
//
// License: put the raw key in ~/.revealbi-sdk/license.key, or set Reveal:License in
// configuration (user secrets, environment variable Reveal__License, key vault).

using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Reveal.Sdk;

var anonymousDemo = args.Contains("--anonymous-demo");

var builder = WebApplication.CreateBuilder(args.Where(a => a != "--anonymous-demo").ToArray());

// Replace the placeholder with the app's real scheme (cookie, JWT bearer, OpenID Connect), e.g.:
// builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(...);
builder.Services.AddAuthentication("Placeholder")
    .AddScheme<AuthenticationSchemeOptions, PlaceholderAuthenticationHandler>("Placeholder", null);
builder.Services.AddAuthorization(o =>
{
    // Reveal's controllers have no [Authorize] of their own; this fallback policy covers
    // them. UseAuthentication alone only identifies the caller, it does not reject anyone.
    if (!anonymousDemo)
    {
        o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
    }
});

// Excel/CSV exports POST the widget's data back to the server. Kestrel's 30 MB default
// makes large exports fail with only "Export failed" in the UI. Raise any reverse
// proxy's limit (IIS, nginx, gateway) to match.
builder.WebHost.ConfigureKestrel(o =>
{
    o.Limits.MaxRequestBodySize = 256L * 1024 * 1024;
    if (anonymousDemo)
    {
        // Loopback only, whatever --urls or ASPNETCORE_URLS say.
        o.ListenLocalhost(5111);
    }
});

builder.Services.AddControllers().AddReveal(reveal =>
{
    reveal.AddSettings(settings =>
    {
        // Only set a non-blank key; an empty or whitespace one disables the key file fallback.
        var license = builder.Configuration["Reveal:License"]?.Trim();
        if (!string.IsNullOrEmpty(license))
        {
            settings.License = license;
        }
    });

    // Connectors shipped as separate packages must be registered, e.g.:
    // reveal.DataSources.RegisterMicrosoftSqlServer();

    reveal.AddUserContextProvider<UserContextProvider>();
    reveal.AddDataSourceProvider<DataSourceProvider>();
    reveal.AddDashboardProvider<DashboardProvider>();
});

// Only needed when the front end is served from another origin (e.g. an Angular or
// React dev server). Opt in with Reveal:ClientOrigin (e.g. https://app.example.com);
// never allow every origin.
var clientOrigin = builder.Configuration["Reveal:ClientOrigin"];
if (!string.IsNullOrWhiteSpace(clientOrigin))
{
    builder.Services.AddCors(options =>
        options.AddPolicy("RevealClient", p => p.WithOrigins(clientOrigin).AllowAnyHeader().AllowAnyMethod()));
}

var app = builder.Build();

if (!string.IsNullOrWhiteSpace(clientOrigin))
{
    app.UseCors("RevealClient");
}

app.UseDefaultFiles();
app.UseStaticFiles();      // the page itself stays public; the Reveal endpoints do not
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();

// Stands in for the app's real scheme: identifies nobody, so protected requests get 401.
// Delete it once real authentication is configured.
sealed class PlaceholderAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync() =>
        Task.FromResult(AuthenticateResult.NoResult());
}
