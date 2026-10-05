// Minimal ASP.NET Core host for the Reveal SDK. Serves the Reveal endpoints and a
// same-origin page from wwwroot, so the client needs no setBaseUrl and no CORS.
//
//     dotnet run    ->  open the URL it prints
//
// License: put the raw key in ~/.revealbi-sdk/license.key, or set Reveal:License in
// configuration (user secrets, environment variable Reveal__License, key vault).

using Reveal.Sdk;

var builder = WebApplication.CreateBuilder(args);

// Excel/CSV exports POST the widget's data back to the server. Kestrel's 30 MB default
// makes large exports fail with only "Export failed" in the UI. Raise any reverse
// proxy's limit (IIS, nginx, gateway) to match.
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 256L * 1024 * 1024);

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
});

// Only needed when the front end is served from another origin (e.g. an Angular or
// React dev server). Replace AllowAnyOrigin with your real origins outside development.
builder.Services.AddCors(options =>
    options.AddPolicy("RevealDev", p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseCors("RevealDev");
}

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthorization();
app.MapControllers();

app.Run();
