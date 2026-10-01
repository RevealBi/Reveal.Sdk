# Going to production

Sources: https://help.revealbi.io/web/adding-license-key, `configure-export`, `server-export`, `data-size-limits`, `caching`, `logging`, `known-issues`.

## License

Without a valid key the SDK does not function, or shows a watermark on trial. Either:

- **Key file**: `~/.revealbi-sdk/license.key` in the home directory of the account the server runs as (on IIS or a service, that is the app pool or service account's profile, not the developer's). The file holds only the raw key: no quotes, comments or trailing code. Otherwise startup throws an invalid Base64 error.
- **In code**: `settings.License = ...` (ASP.NET), `settings.setLicense(...)` (Java), `license:` option (Node). Read it from configuration or a secret store, never commit it.

If a NuGet install still shows the watermark after licensing, clear the Reveal packages from the NuGet cache and reinstall.

## CORS and base URL

- Replace development `AllowAnyOrigin` with the real client origins.
- Behind a reverse proxy or under a virtual directory, the client's `setBaseUrl` must be the public URL including the path prefix, with a trailing slash.
- Prefer serving client and Reveal server from one origin when possible (no CORS, cookies just work).

## Export (PDF, Image, PowerPoint, Excel, CSV)

How export works matters for hosting:

- **Excel and CSV** exports, and visualization exports, **POST the data back to the server**. Large widgets exceed the host's request body limit (Kestrel's default is 30 MB). The UI shows only "Export failed"; the cause (`Request body too large`) appears only in the server log. Raise the limit on every hop: Kestrel `MaxRequestBodySize`, IIS `maxAllowedContentLength`, nginx `client_max_body_size`, any gateway.
  ```cs
  builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 256L * 1024 * 1024);
  ```
- **Image, PDF and PowerPoint** render in headless Chromium through Playwright (ASP.NET). The first export downloads Chromium, which slows the first user and fails on servers without outbound internet. For production, pre-install it and configure `settings.Export`:
  - `ChromiumExecutablePath` (pre-installed browser) or `ChromiumDownloadFolder`
  - `CreateChromiumInstancesOnDemand = false` to initialize at startup
  - `MaxConcurrentExportingThreads`, `ExportingTimeout` (default 30000 ms)
  - Pre-install: `dotnet tool install --global Microsoft.Playwright.CLI` then `playwright install chromium`
- **Java** uses Playwright for images and a bundled ExportTool for Excel, PDF and PowerPoint. Linux needs extra system packages (see `configure-export`).
- **Azure App Service on Windows cannot export** to Image/PDF/PowerPoint (no Playwright support). Use a Linux plan with `Microsoft.Playwright.Program.Main(new[] { "install", "chromium", "--with-deps" })` at startup, or a Windows container.
- Docker/Linux: install Chromium's dependencies in the image (`--with-deps`), or Chromium silently fails to launch.
- Custom visualizations export blank. There is no workaround.
- Text in PDF grid and pivot cells is limited by `MaxStringCellSize` (default 256 characters), the same as on screen.
- Server-side (headless) export without a browser user: docs topic `server-export`. Not available in the Node SDK on Linux or macOS.

## Size limits

Defaults, server-side (ASP.NET `RevealEmbedSettings`):

| Setting | Default |
| --- | --- |
| `MaxDownloadSize` | 200 MB per CSV/JSON/Excel download |
| `MaxStorageCells` | 10 million cells |
| `MaxTotalStringsSize` | 64 million characters in a grid or pivot |
| `MaxStringCellSize` | 256 characters per string value, server-wide, read at startup |

Client: `RevealSdkSettings.maxCellsRestriction` (default 100,000 cells per visualization), set before creating the view. Raise limits deliberately; large raw grids are usually better as aggregated visualizations or paged grids with server-side processing.

## Caching and scale-out

- Results are cached on disk per server; default refresh is once a day per data source. Users can change it, or pick "Always".
- With several server instances behind a load balancer, use the Redis cache (docs: `caching`) or sticky sessions, so instances do not each build their own cache.
- Make the cache folder writable by the app's account.

## Logging

ASP.NET uses the standard `ILogger` pipeline. Raise the `Reveal` category to `Debug` while diagnosing (docs: `logging`). Many client-side failures ("Export failed", empty widget) only explain themselves in the server log.

## Hosting checklist

- [ ] License from configuration or a secret, valid for the service account
- [ ] `Dashboards` (and local data files) included in publish output, or a custom provider pointing at durable storage
- [ ] Server package and client `reveal-sdk` on the same version; CDN URL pinned
- [ ] CORS restricted; HTTPS
- [ ] Request body limit raised on every hop if export is enabled
- [ ] Chromium pre-installed (or downloadable) on the real host; one PDF export tested there
- [ ] Cache folder writable; Redis or sticky sessions if scaled out
- [ ] Reveal endpoints behind the app's authentication
