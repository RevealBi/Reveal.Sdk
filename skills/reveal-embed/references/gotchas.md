# Symptom → cause

Each of these looks like an SDK defect and is a setup cause. Match the symptom, fix the setup and retest before escalating. Ask for the browser console, the failing request in the network tab (read the **response body**: widget failures often come back as HTTP 200 with an `error` object), and the server log.

**On Node the server log is not where you look.** The Node console shows nothing for engine errors and the client gets only `Something went wrong. Correlation Id: ...`. Until `engineLogDir` is set, 2.2.1 writes `revealbi-logs/reveal-engine.log` under the OS temp folder (`%TEMP%` on Windows). Set `engineLogDir` (and `engineLogLevel: "Debug"`) in `RevealOptions`, reproduce, and search `reveal-engine.log` for the correlation id. On ASP.NET, the app's normal logging includes Reveal.

## Nothing renders

**Blank area, no errors.** The host element has no height. `RevealView` fills its container; a `div` in normal flow is 0px tall. Give it an explicit height, or `height: 100%` with every ancestor sized. In Vite's React and Vue templates `#root`/`#app` have only `min-height`, so `height: 100%` resolves to 0: size `html, body, #root` (or `#app`). Widget requests are still sent, so the network tab looks healthy; check the element's `getBoundingClientRect().height`.

**Blank area, unhandled rejection in the console (`Unauthorized`, `Failed to fetch`).** `loadDashboard` failed (401, 404, CORS) and the code has no rejection handler. Handle it and show the error (see client.md).

**CORS error in the console, or requests going to the wrong host.** The client and server are on different origins and either `setBaseUrl` is missing (requests go to the client's origin and 404) or the server has no CORS policy for the client's origin. If the server mounts Reveal under a prefix (`/reveal-api/`), the base URL must include it, with a trailing slash. Fix both sides.
- With a dev server that has an SPA fallback (Vite, Angular CLI, webpack `historyApiFallback`), a missing `setBaseUrl` does not 404: the dev server answers with `index.html`, and `loadDashboard` fails with `Unexpected token '<', "<!doctype "... is not valid JSON`.
- A CORS failure shows as `Failed to fetch` plus a `blocked by CORS policy` line in the console. If the CORS middleware is missing or runs after an auth guard, the preflight hits the guard and gets 401 (seen with node-minimal and no `CLIENT_ORIGIN`).

**Java + Spring Security: the dashboard title shows, then every widget shows `{"status":403,"error":"Forbidden"}`.** Spring Security's CSRF protection rejects Reveal's POSTs (widget data, save); GETs pass, so a curl of the dashboard works. Send the CSRF token from the page (see server-java.md, "Spring Security CSRF").

**Node: the network tab shows `400` on `.../DashboardFile/<id>`; the page shows an error or an empty "New Dashboard".** Reveal is mounted with `app.use("/prefix/", reveal(...))` **and** `basePath` is set too. Remove `basePath`.

**Node: the dashboard title loads, then every widget spins and fails with `500 Something went wrong. Correlation Id: ...`.** A body parser (`express.json()`, `express.urlencoded()`, `body-parser`) runs before the Reveal mount and consumes the request body Reveal streams to its engine. The engine log shows `Reading the request body timed out due to data arriving too slowly`. Mount Reveal before the parsers, or scope them to the app's routes (see server-node.md).

**Node, ESM or TypeScript with `NodeNext`: the app does not start with `SyntaxError: Named export 'RVUserContext' not found. The requested module 'reveal-sdk-node' is a CommonJS module`, or `tsc` reports "This expression is not callable" on `reveal(...)`.** `reveal-sdk-node` is CommonJS; its classes hang off the default export, so ESM named imports of classes fail. Take the classes from the default import (see server-node.md).

**Module import fails when the page is opened directly.** ES module imports are blocked on `file://`. Serve the page from a local web server or the app.

**Two views, or the dashboard loads twice, in React dev.** StrictMode runs effects twice. Guard creation with a ref (see client.md).

**Angular: DevTools hang when opened.** The prebundled `reveal-sdk` source map is over 30 MB. Move the Angular cache under `node_modules` so DevTools ignore-list it (see client.md).

**Angular: `ng build` fails with `bundle initial exceeded maximum budget`.** `reveal-sdk` (about 14.5 MB) is imported eagerly. Lazy-load the dashboard route or raise the budget (see client.md).

**Create React App production build stalls.** Known CRA 5 + Reveal ESM issue. Use Vite, or the Webpack external + IIFE workaround in the docs' Known Issues.

**Odd layout shifts or a visible element at the bottom of the page.** RevealView adds a hidden `<pre class="rv-multiline-editor">` to the page for text measurement (in 2.2.1 inside `div#DialogTextBox`, not directly under `body`), and a global `pre` style is hitting it. Add `pre.rv-multiline-editor { height: 0 !important; }` (no `body >`: that selector does not match in 2.2.1).

**Tab key cannot leave the dashboard (focus trapped in `RevealView`).** No supported workaround is documented, so do not invent one (key handlers, `tabindex` changes). Confirm the symptom on the installed version, tell the customer how focus behaves, and do not spend time diagnosing their setup for it.

## License

**Node: `The license key is missing or has expired. Engine failed to start`, then `Engine exited abnormally`, while a key file exists.** The `license` option is set to an empty string, usually `license: process.env.REVEAL_LICENSE` with `REVEAL_LICENSE=` in `.env`. An empty or whitespace value overrides the key file. Pass `license` only when the trimmed value is non-empty.

**Watermark, or "license" errors at startup.** The key is not where the **running process** looks: `~/.revealbi-sdk/license.key` of the service account, not the developer. Or the file contains more than the raw key. Or a NuGet cache holds a stale package (clear the Reveal packages and reinstall).

## Data

**"The data source is of an unknown type ('SQLSERVER')" (or another type).** The connector package is referenced but not registered. Call `revealBuilder.DataSources.RegisterMicrosoftSqlServer()` (or `RegisterXxx` for the connector).

**Widget loads empty, or the item cannot be resolved.** The data source provider did not fill in the item. Common causes:
- Host and database set in `ChangeDataSourceAsync` only. The item's own data source is a separate object, so call `ChangeDataSourceAsync(userContext, item.DataSource)` inside `ChangeDataSourceItemAsync`. This often shows up as "password authentication failed" or "login failed" for the app's own database user, because its credentials go to the host stored in the dashboard.
- The provider matches on an item id that differs from the id the dashboard stored. Dashboards built in Reveal BI or generated store GUID item ids; match on the table instead (see data-sources.md). Log the incoming item id and table.
- `Failed to generate SQL query: Missing value for custom query parameter: @x`: the parameter dictionary set in the item provider lacks that key; keys include the `@` (`{ "@x": value }`). If the query and parameters are stored in the dashboard instead, a mismatch may surface as `Failed to generate SQL query: Object reference not set to an instance of an object` (Postgres, Node 2.2.1); check the engine log.
- A local file that is not where `local:/` resolves. The widget shows "File not found: Data\<file>": on ASP.NET the default folder is `Data` under the working directory; on Node 2.2.1 it is `C:\Reveal\Files` unless the `localFileStoragePath` option is set. Set it explicitly on both. Also check the file is copied to the publish output.

**`password authentication failed` / `login failed` / `Failed to connect to <some host>` for a widget whose item your provider rejected.** Returning `null` from the item provider does not stop the query: Reveal falls back to the data source exactly as the client sent it. Throwing differs per platform: on Node the item also runs as sent; on ASP.NET and Java the widget fails, but the exception message reaches the browser, so throw a generic one. Redirect unknown items to your database with an empty query instead, and only release credentials for your own host (see data-sources.md).

**Login failed for the database.** No authentication provider, or it returns `null` for that data source type. Return a credential (`RVUsernamePasswordDataSourceCredential`, `RVBearerTokenDataSourceCredential`, `RVIntegratedAuthenticationCredential`).

**Data never updates.** The server cache; default refresh is once a day per data source. Set the data source's refresh to "Always" while developing, or refresh from the visualization menu.

**Everyone sees the same data after adding a user context provider.** Providers ignore `userContext`, or the user context provider reads the user before the app's auth middleware ran. Log the user id inside the data source provider.

**Excel/CSV loads as one column.** The CSV separator is auto-detected and was guessed wrong for this file; set `separator` on the CSV item to force one, or use the TSV item type for tab files.

## Grids

**The grid shows only the first page of rows (pager "1 of 1", next disabled), or the pager advances but every page shows the same rows.** The remaining rows are dropped silently, not merely unpaged. Paging is honored only when data is processed on the server: `ProcessDataOnServer = true` on a database item from a connector that supports paging (SQL Server, MySQL, MariaDB, PostgreSQL, Oracle, SyBase, Snowflake, BigQuery, Databricks, Athena, Redshift, MongoDB, SQLite, Cube), or `NewLocalProcessingEnabled = true` in settings for Excel/CSV files. Stored-procedure items never page.

**Summaries disappear when paging is turned on.** By design.

**Grid looks or behaves differently after upgrading to 2.2.** The new data grid is the default from 2.2.0. `RevealSdkSettings.betaFeatures.disable("newDataGrid")` before creating the view restores the legacy grid, as a temporary escape hatch only. Conditional formatting with overlapping rules applies differently in the new grid. The new grid has no alternate row shading; that is deliberate, not a setting.

**Grouping, the column menu, filtering, summaries, cell selection with Ctrl+C, or column resize do not exist.** They exist only in the new grid. Check that it is not disabled.

## Export

**A bare "Export failed" toast; `net::ERR_CONNECTION_RESET` in the network tab.** The export POST exceeded the request body limit (Kestrel 30 MB by default, plus any proxy). The server log says `Request body too large` (413). PDF and image exports POST to the server too, not only Excel/CSV. Raise the limit on every hop (see production.md). On Node the engine may enforce the same 30 MB limit itself (issue #703, not tested).

**Excel export has fewer rows than the source, with no warning in the file.** Export contains only the rows the browser holds, capped by `RevealSdkSettings.maxCellsRestriction` (default 100,000 cells: a 3-column grid exported 33,334 of 200,000 rows; the grid shows a warning triangle, the export does not).

**First PDF/Image export is very slow or times out; later ones work.** Chromium (Playwright's headless shell, about 206 MB) is downloaded on the first PDF/image export, not at startup (verified on ASP.NET: about 9 s, first render 12.6 s, later 0.3 s). Pre-install it in production.

**PDF/Image export fails only on the server.** The host cannot run Chromium: Azure App Service on Windows, a container without Chromium's system dependencies, no outbound internet for the download, or Linux ARM64 on Node without a system Chromium at `/usr/bin/chromium`.

**Long text cut off at ~256 characters in grids and in the PDF.** `MaxStringCellSize`. It is server-wide and read at startup, so restart after changing it.

**Custom visualizations are blank in exports.** Known limitation, no workaround.

## Themes and fonts

**Theme changes do nothing.** `RevealSdkSettings.theme` returns the live object, and only the **setter** applies a theme. Read it, change it, assign it back, and do it before constructing the `RevealView`. At runtime the assignment alone re-renders open views (reloading them and closing the editor); `refreshTheme()` is not needed.

**Serif (Times-like) font after a theme change.** The theme object was mutated and never assigned back; views created afterwards lose the theme's fonts. Assign it (see client.md).

**Custom font renders as the fallback, or bold slots render regular.** The face is not loaded by the page, or the name does not match the loaded `@font-face` family exactly. `document.fonts.check()` returns true even for missing families, so it is not proof. Confirm a `FontFace` with `status === "loaded"` exists for that family. An alias cloned from a variable-weight face keeps its weight range and draws regular.

## Filters

**Cascading dashboard filters do not seem to cascade.** With multi-select on, an empty selection means "all", so the dependent list stays full. For a strict cascade, set the parent filter to single-select with no empty selection.

## Saving

**Save As does nothing, or the view stays in edit mode after Save.** Save As has no default implementation; handle `onSave`, and call `args.saveFinished()` once the save should go through. Skip it only on cancel or a failed request, which keeps the user in edit mode with their changes (see dashboards.md).

**Save writes the dashboard under an unexpected name.** `args.name` is the dashboard title; set `args.dashboardId` explicitly.

**Save fails after adding a custom dashboard provider.** The custom provider replaces the default for saving too. Implement `SaveDashboardAsync`.
