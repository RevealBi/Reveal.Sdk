# Going to production

Sources: https://help.revealbi.io/web/adding-license-key/, `configure-export`, `server-export`, `data-size-limits`, `caching`, `logging`, `known-issues`.

## License

Without a valid key the SDK does not function, or shows a watermark on trial. Either:

- **Key file**: `~/.revealbi-sdk/license.key` in the home directory of the account the server runs as (on IIS or a service, that is the app pool or service account's profile, not the developer's). The file holds only the raw key: no quotes, comments or trailing code. Otherwise startup throws an invalid Base64 error.
- **In code**: `settings.License = ...` (ASP.NET), `settings.setLicense(...)` (Java), `license:` option (Node). Read it from configuration or a secret store, never commit it. Set it only when the configured value is non-blank, and trim it: an empty or whitespace string is treated as an invalid key and does not fall back to the key file (on Node 2.2.1 the engine then fails to start; on Java 2.2.1 the servlet's `init()` throws `The license key is missing or has expired.` and, with `setLoadOnStartup(1)`, Spring Boot does not start).

If a NuGet install still shows the watermark after licensing, clear the Reveal packages from the NuGet cache and reinstall.

## CORS and base URL

- Replace development `AllowAnyOrigin` with the real client origins.
- Behind a reverse proxy or under a virtual directory, the client's `setBaseUrl` must be the public URL including the path prefix, with a trailing slash.
- Prefer serving client and Reveal server from one origin when possible (no CORS, cookies just work).

## Export (PDF, Image, PowerPoint, Excel, CSV)

How export works matters for hosting:

- **Excel, CSV, PDF and image** exports all **POST to the server** (Excel/CSV: the data; PDF/image: the rendered page HTML to `/tools/renderhtml`, plus the data for PDF). Large widgets exceed the host's request body limit (Kestrel's default is 30 MB: a 31.9 MB Excel export POST failed in testing). The UI shows only "Export failed" (the browser sees `ERR_CONNECTION_RESET`); the cause (`Request body too large. The max request body size is 30000000 bytes.`) appears only in the server log. Raise the limit on every hop: Kestrel `MaxRequestBodySize`, IIS `maxAllowedContentLength`, nginx `client_max_body_size` (default 1 MB), Azure Front Door / Application Gateway or any other gateway. On Node the engine may enforce the same 30 MB limit itself, and `RevealOptions` may not expose a setting for it (issue RevealBi/Reveal.Sdk#703; not tested here).
  ```cs
  builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 256L * 1024 * 1024);
  ```
- **Excel and CSV exports contain only the rows the browser holds**, which `RevealSdkSettings.maxCellsRestriction` caps (default 100,000 cells per visualization: a 3-column grid exported 33,334 of 200,000 rows), with no warning in the file. Raise it deliberately, or use server-side export for full extracts.
- **Image, PDF and PowerPoint** render in headless Chromium (ASP.NET through Playwright; the Java 2.x engine has the same Chromium settings). On ASP.NET 2.2.1 nothing is downloaded at startup: the **first** image/PDF export downloads Playwright's Chromium headless shell (about 206 MB in 2.2.1; the first export took about 12 s here), which slows the first user and fails on servers without outbound internet. It goes to `ChromiumDownloadFolder` or the Playwright default; on Node, puppeteer downloads into the server's working directory, which must be writable. For production, pre-install it and configure `settings.Export` (Java: `settings.getExportConfiguration()`):
  - `ChromiumExecutablePath` (pre-installed browser) or `ChromiumDownloadFolder`
  - `CreateChromiumInstancesOnDemand = false` to initialize at startup
  - `MaxConcurrentExportingThreads`, `ExportingTimeout` (default 30000 ms)
  - Pre-install: `dotnet tool install --global Microsoft.Playwright.CLI` then `playwright install chromium`. The SDK itself installs only the headless shell (`install --only-shell chromium`), so point `PLAYWRIGHT_BROWSERS_PATH` and `ChromiumDownloadFolder` at the same folder, or set `ChromiumExecutablePath`.
- **Java 2.x** exports in the native engine with the same Chromium settings (`setChromiumExecutablePath`, `setChromiumDownloadFolder`, `setCreateChromiumInstancesOnDemand`, `setMaxConcurrentExportingThreads`, `setExportingTimeout`). The docs' Java ExportTool and Playwright-Java instructions are 1.x; see server-java.md.
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
- With several server instances behind a load balancer, use the Redis cache (docs: `caching`) or sticky sessions, so instances do not each build their own cache. ASP.NET: package `Reveal.Sdk.Cache.Redis`, `AddRedisCache(o => o.ConnectionString = ...)`; Node: the `redisOptions` option; Java 2.x: `RevealServerBuilder.addRedisCache(o -> o.setConnectionString(...))` (the docs' `enableRedisCache` sample is 1.x).
- The documented Redis options cover connection, TLS, timeouts and retries (`ConnectionString`, `EndPoints`, `User`, `Password`, `UseSsl`, `DefaultDatabase`, `ClientName`, timeouts, `ConnectRetry`, `KeepAliveSeconds`, `AbortOnConnectFail`, `AllowAdmin`, `ReconnectRetryPolicy`, `RetryDelayMs`). There is **no key prefix option** (requested in RevealBi/Reveal.Sdk#625). To keep Reveal's keys apart from other apps, give it its own `DefaultDatabase` (not available on Redis Cluster) or its own Redis instance.
- Make the cache folder writable by the app's account.

## Logging

ASP.NET uses the standard `ILogger` pipeline. Raise the `Reveal.Sdk` category to `Debug` while diagnosing (docs: `logging`). Many client-side failures ("Export failed", empty widget) only explain themselves in the server log.

Node: the engine writes `revealbi-logs/reveal-engine.log` under the OS temp folder until `engineLogDir` is set; the Node console stays quiet (see server-node.md, Options).

Java: the servlet logs through SLF4J (errors carry the correlation id the client shows); the native engine writes `%TEMP%\revealbi-logs\reveal-engine.log` on Windows (per the docs' upgrade guide). See [server-java.md](server-java.md#run).

## Hosting checklist

- [ ] License from configuration or a secret, valid for the service account
- [ ] Shared `Dashboards` (and local data files) included in publish output, but not the per-user `Dashboards/users/` folder; users' saves in durable storage outside the deployment folder
- [ ] Started from the app folder, or absolute paths configured for `Dashboards`, data files (`LocalFileStoragePath`) and `wwwroot`: relative paths resolve against the working directory
- [ ] Node: Node.js 18+ if export is enabled (16.13+ otherwise)
- [ ] Server package and client `reveal-sdk` on the same version; CDN URL pinned
- [ ] CORS restricted; HTTPS
- [ ] Request body limit raised on every hop (app server, IIS, nginx, Front Door or other gateway) if export is enabled
- [ ] Java: deployable built on (or with the engine artifact for) the server's OS and CPU
- [ ] Chromium pre-installed (or downloadable) on the real host; one PDF export tested there
- [ ] Cache folder writable; Redis or sticky sessions if scaled out
- [ ] Reveal endpoints behind the app's authentication
