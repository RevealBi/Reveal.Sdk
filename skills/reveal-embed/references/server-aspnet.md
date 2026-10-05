# Reveal server on ASP.NET Core

Requires ASP.NET 8.0 or later. Source: https://help.revealbi.io/web/install-server-sdk and https://help.revealbi.io/web/getting-started-server

## Install and register

```bash
dotnet add package Reveal.Sdk.AspNetCore
```

The same package serves trial and licensed use; only the license configuration differs (see production.md). Do not use the old `Reveal.Sdk.Web.AspNetCore.Trial` package: it stopped at 1.3.0 and does not match the 2.x client.

`AddReveal()` hangs off the MVC builder the app already has: `AddControllers()`, `AddControllersWithViews()`, `AddRazorPages()` or `AddMvc()`. The endpoints are served by controllers, so the app must call `app.MapControllers()` (or the Razor Pages / MVC equivalent that maps controllers).

```cs
using Reveal.Sdk;

builder.Services.AddControllers().AddReveal(revealBuilder =>
{
    revealBuilder.AddSettings(settings =>
    {
        // Prefer configuration over a literal; see production.md for the license file option.
        // Only assign a non-blank value; an empty one is an invalid key and disables the file fallback.
        var license = builder.Configuration["Reveal:License"]?.Trim();
        if (!string.IsNullOrEmpty(license))
        {
            settings.License = license;
        }
    });

    // Connectors shipped as separate packages must be registered, not just referenced.
    revealBuilder.DataSources.RegisterMicrosoftSqlServer();

    revealBuilder.AddDataSourceProvider<DataSourceProvider>();
    revealBuilder.AddAuthenticationProvider<AuthenticationProvider>();
    revealBuilder.AddUserContextProvider<UserContextProvider>();
    // Optional:
    // revealBuilder.AddDashboardProvider<DashboardProvider>();
    // revealBuilder.AddObjectFilter<ObjectFilterProvider>();
});
```

Every provider registration is optional. With none, Reveal loads `.rdash` files from a `Dashboards` folder in the working directory and saves back to it.

Make sure `Dashboards/**` (and any local data files) are copied to the output and publish folders:

```xml
<ItemGroup>
  <Content Include="Dashboards\**" CopyToOutputDirectory="PreserveNewest" />
</ItemGroup>
```

## Provider interfaces

| Interface | Registration | Purpose |
| --- | --- | --- |
| `IRVDataSourceProvider` | `AddDataSourceProvider<T>()` | Fill in connection details per data source and item: `ChangeDataSourceAsync`, `ChangeDataSourceItemAsync`. See data-sources.md. |
| `IRVAuthenticationProvider` | `AddAuthenticationProvider<T>()` | Return credentials for a data source: `ResolveCredentialsAsync`. See data-sources.md. |
| `IRVUserContextProvider` | `AddUserContextProvider<T>()` | Build `RVUserContext` from the `HttpContext` per request. See user-context-security.md. |
| `IRVDashboardProvider` | `AddDashboardProvider<T>()` | Load and save dashboards from anywhere: `GetDashboardAsync`, `SaveDashboardAsync`. See dashboards.md. |
| `IRVObjectFilter` | `AddObjectFilter<T>()` | Hide data sources and items from a user in the editor's data source list. |
| `IRVDataModelProvider` (beta) | `AddDataModelProvider<T>()` | Relabel fields, add calculated fields and measures server-side. |

All provider methods receive the `IRVUserContext`, so any of them can vary by user.

## CORS for development

Needed only when the client is served from a different origin than this server.

```cs
builder.Services.AddCors(options =>
    options.AddPolicy("RevealDev", p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

app.UseHttpsRedirection();
if (app.Environment.IsDevelopment())
{
    app.UseCors("RevealDev");
}
app.UseAuthorization();
app.MapControllers();
```

`UseCors` must come after `UseRouting`/`UseHttpsRedirection` and before `UseAuthorization`. In production, use `WithOrigins("https://app.example.com")` instead of `AllowAnyOrigin`. If the client sends credentials (cookies), `AllowAnyOrigin` is not allowed with `AllowCredentials`; name the origins.

## Settings worth knowing (`RevealEmbedSettings`, via `AddSettings`)

| Setting | Use |
| --- | --- |
| `License` | License key string. Alternative to the `~/.revealbi-sdk/license.key` file. |
| `LocalFileStoragePath` | Folder that `local:/<file>` URIs resolve against for Excel/CSV/JSON files. |
| `NewLocalProcessingEnabled` | Process local files (Excel/CSV) with the server-side engine. Required for grid paging over local files. |
| `MaxStringCellSize` | Characters kept per string cell (default 256). Server-wide, read at startup. Affects grids and PDF export alike. |
| `MaxDownloadSize`, `MaxStorageCells`, `MaxTotalStringsSize` | Server resource limits. See production.md. |
| `Export` | Chromium/Playwright options for PDF, Image and PowerPoint export. See production.md. |

## Hosting the client in the same app

Serving the HTML/JS from the same ASP.NET app (Razor page, MVC view or `wwwroot` with `UseDefaultFiles()` + `UseStaticFiles()`) means no CORS and no `setBaseUrl`. This is the simplest setup when the customer already has an ASP.NET front end.

Starting point: [assets/aspnet-minimal](../assets/aspnet-minimal).
