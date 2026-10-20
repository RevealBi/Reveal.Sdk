---
name: reveal-embed
description: "Helps developers embed Reveal SDK (Reveal BI, revealbi.io) dashboards in their own applications. Use for Reveal setup, integration, configuration, security or deployment: ASP.NET Core, Node.js/Express or Java/Spring Boot/Tomcat servers; HTML/JavaScript, Angular, React, Vue or web-component clients; data sources, server-side credentials, user context, row-level security, multi-tenancy, loading, saving and creating dashboards through the app or the Reveal editor, theming, export, licensing and production; and troubleshooting a RevealView that is blank, unstyled, watermarked, failing CORS or export, showing no data or ignoring paging. Not for generating or editing .rdash files in code with the Reveal DOM (use reveal-dashboard-authoring). Not for Power BI, Tableau, Metabase, Grafana, Chart.js or other BI/charting products."
---

# Embedding Reveal in an application

The Reveal SDK is two halves that must agree: a **server** package that hosts the Reveal endpoints inside the customer's backend, and a **client** `RevealView` that renders dashboards in their web app and calls those endpoints. Most failed integrations are a mismatch between the two (wrong base URL, CORS, a provider registered on one side only) or a known setup trap, not an SDK bug. Work out the shape of the customer's app first, give them the smallest thing that renders a dashboard, then add data, security and polish in that order.

## 1. Establish the shape of their app

Find these out from the codebase if there is one (look for `*.csproj`, `package.json`, `pom.xml`, `angular.json`, `vite.config.*`), and ask only for what you cannot see:

| Question | Why it matters |
| --- | --- |
| Server stack: ASP.NET Core, Node.js (JS or TS, Express or NestJS), or Java (Spring Boot or a Jakarta EE 9 container) | Decides package, registration API and provider signatures. Read the matching `references/server-*.md`. On Node, also note CommonJS vs ES modules (`"type"` in `package.json`, `"module"` in `tsconfig.json`): it changes how `reveal-sdk-node` must be imported. |
| Client stack: plain HTML, Angular, React, Vue, other | Decides how to load `reveal-sdk` and where to create the `RevealView`. Read [client.md](references/client.md). |
| Same origin or separate origins for client and server | Separate origins need `RevealSdkSettings.setBaseUrl` **and** a CORS policy on the server. |
| Where the data lives | Decides the connector package and the data source provider. Read [data-sources.md](references/data-sources.md). |
| Do users see different data (per user, per tenant, per role) | Means a user context provider and server-side data source resolution. Read [user-context-security.md](references/user-context-security.md). |
| View only, or do users create and edit dashboards | View only unless they ask for editing. Editing decides `canEdit`, saving, and whether data sources must be offered in the editor. Read [dashboards.md](references/dashboards.md). |
| Does the app have login | Decides who may open dashboards: signed-in users, or, in an app without login, anyone who can open it. |
| Trial or licensed, and where it will be hosted | License key placement, export dependencies (Chromium), body size limits. Read [production.md](references/production.md). |

System requirements: ASP.NET 8.0+; Java 17+ with a Jakarta EE 9 server and Maven 3.6.3+; Node.js 16.13+ (18+ for export).

## 2. Get one dashboard on screen

Always start here, even when the request is about something later in the list. A rendering `RevealView` proves the package, license, routing, CORS and base URL all work, so every later problem is narrowed to the feature being added.

1. Install the server package and register Reveal (see the `server-*` reference). In an existing Express app, mount Reveal **before** any body parser (`express.json()` and friends) and under a prefix such as `/reveal-api/` (at `/` it answers every request, so the app's own pages, routes and dev server after it return 404), behind the app's auth middleware, configured to reject unauthenticated requests (authentication alone does not; see user-context-security.md). If the app has no login, allow anonymous viewing in the server code, never in your own start command (everyone else's `npm run dev` would get 401).
2. Put one `.rdash` in the dashboards folder: `Dashboards/` for ASP.NET, `dashboards/` for Node, the folder given to the per-user `DashboardProvider` for Java (`Dashboards/` in java-minimal, see server-java.md). The dashboard id the client asks for is the file name without `.rdash`. For a sample, use the starters' `Sales.rdash` with its data (below): a dashboard bound to a database the server can't reach renders only errors.
3. Add the client: with a bundler (Vite, webpack, Angular, React) `npm install reveal-sdk` and import it; without one, load it from the jsDelivr URL in client.md (the `dl.revealbi.io` link there is the distribution zip, not a script). Give the host element a real height, call `setBaseUrl` when the origins differ or Reveal is mounted under a prefix (`location.origin + "/reveal-api/"`), then `RVDashboard.loadDashboard("Name")` and assign it to `new RevealView(element).dashboard`.
4. Keep dashboards view only unless the user asked for editing: `canEdit = false` on the view, and a dashboard storage provider that refuses saves on the server (the built-in one saves anywhere, even outside the dashboards folder; dashboards.md). Allow the client origin in CORS for development.
5. From the project folder, run `node <this skill>/assets/verify/check-app.mjs http://localhost:<port>/ --start "<the app's usual start command>"` (Node 18+; it installs what it needs outside the project). It starts the app the way the user does, checks the page in a headless browser and stops the app. Don't start the app yourself, and add nothing to the command. Fix what it reports until it exits 0, and read the screenshot it saves. A server that starts, or an endpoint that answers 200, is not a rendered dashboard: don't report success before exit 0, and if you could not run the check, say so.

**On Node/Express**, do it with [assets/node-minimal](assets/node-minimal). Its `reveal-server.cjs` holds all of the server side (the mount, the auth guard, default-deny providers, validated dashboard storage, the sample data); copy files rather than writing provider code from memory:

1. `npm install reveal-sdk-node@2.2.1 reveal-sdk@2.2.1`.
2. Copy `reveal-server.cjs`, `dashboards/Sales.rdash` and `sample-data/sales.json` into the project root, keeping the folder names. Nothing else from the starter.
3. In the existing server, add one call after its authentication middleware and before `express.json()` and its own routes, static files and dev middleware: `mountReveal(app, { port: PORT })`, with `import { mountReveal } from "./reveal-server.cjs"` (ES modules) or `const { mountReveal } = require("./reveal-server.cjs")` (CommonJS). If the app has no login, pass `allowAnonymous: true`. Pass `allowEditing: true` only if the user asked for editing. Change nothing else in the server: keep its routes and its Vite or webpack middleware.
4. In the client entry (bundler): `import { RevealView, RevealSdkSettings, RVDashboard } from "reveal-sdk"`, `RevealSdkSettings.setBaseUrl(location.origin + "/reveal-api/")`, then `const view = new RevealView(element); view.canEdit = false; view.dashboard = await RVDashboard.loadDashboard("Sales");`, on an element with a real height (with `allowEditing`, leave out `canEdit = false`). The package brings its own styles: add no stylesheet or script tags for Reveal.
5. From the project folder, run `node <this skill>/assets/verify/check-app.mjs http://localhost:<port>/ --start "npm run dev"` until it exits 0.
6. Leave only what the app needs: no logs, scratch scripts or notes in the project. In your summary, say who can open the dashboards (signed-in users, or with `allowAnonymous` anyone who can open the app) and whether they are view only.

[assets/aspnet-minimal](assets/aspnet-minimal), [assets/node-minimal](assets/node-minimal) and [assets/java-minimal](assets/java-minimal) (Spring Boot 3 + Spring Security, Reveal mapped at `/reveal-api/`, CSRF on with the page sending the token) are working starting points: each shows the sample `Sales` dashboard, view only, on http://localhost:5111/ with the plain start command (`dotnet run`, `npm start`, `./mvnw spring-boot:run`). Having no login, they allow anonymous viewing in code or configuration (`allowAnonymous`; java-minimal: `reveal.allow-anonymous`) and listen on localhost only. Adapt them into the customer's project rather than handing over a separate app, unless they asked for a standalone sample. Add the entries in [assets/.gitignore](assets/.gitignore) to the project's `.gitignore` so dashboards users saved at run time are not committed.

What the starters cover, and what they deliberately leave to the app: saves are refused until editing is turned on (`allowEditing`, `reveal.allow-editing`); then each user saves into a private folder and the shared dashboards stay read-only. Identity comes from server-side authentication and fails closed unless anonymous viewing is on. Every data source and item type is denied by default (its location overwritten with one that cannot resolve; on ASP.NET and Java, types with no rule are refused) until the app maps it to a server-side location; the only mapping shipped points the sample's `sales` item at the `sales.json` the app serves. To offer the app's own data, map a source on the server, then add it in `onDataSourcesRequested` (data-sources.md, "Server-side resolution"). Roles, tenants, sharing dashboards between users, rate limiting and the app's real authentication scheme are out of scope. Add them from the references when the customer needs them.

For editing, `revealView.dashboard = new RVDashboard()` opens an empty dashboard; give the view at least one data source (section 3) so the user can build visualizations.

If you start a server yourself rather than through `--start`, stop only that process (keep its PID). Never kill all `node`, `dotnet` or `java` processes: other tools on the machine use them.

## 3. Add what they actually need, in this order

| Need | Reference |
| --- | --- |
| Connect their database or API, keep connection details off the client | [data-sources.md](references/data-sources.md) |
| Pass the signed-in user, tenant or role to the server; row-level security; credentials per user | [user-context-security.md](references/user-context-security.md) |
| Store dashboards somewhere other than a folder (database, blob storage, per-user), Save / Save As, create new, editing permissions | [dashboards.md](references/dashboards.md) |
| Generate, modify or bulk-edit `.rdash` files in code (templates, per-tenant dashboards, dashboards built from a spec or AI output, migrations) | The `reveal-dashboard-authoring` skill (Reveal DOM: `@revealbi/dom`, `Reveal.Sdk.Dom`); summary in [dashboards.md](references/dashboards.md#creating-and-changing-dashboards-in-code) |
| Match their look: themes, fonts, which menus and buttons show | [client.md](references/client.md) |
| License, export (PDF/Image/PowerPoint), size limits, caching, logging, CORS and hosting for production | [production.md](references/production.md) |

## 4. When something does not work

Read [gotchas.md](references/gotchas.md) before calling anything an SDK bug. A blank view, a watermark, "unknown type", empty widgets, paging that does not page, a bare "Export failed", and themes or fonts that do not apply all have known setup causes listed there. Ask for the browser console, the network tab entry for the failing Reveal request, and the **server log**, since several failures surface only there. On Node the engine log goes to `revealbi-logs/reveal-engine.log` under the OS temp folder (`%TEMP%` on Windows) until `engineLogDir` is set in `RevealOptions`; the client gets a bare correlation id and the console stays silent. Widget errors usually arrive as HTTP 200 with an `error` object, so read response bodies.

## Rules for the code you write

- **Connection details, credentials and identity stay on the server.** Anything set on a client data source object is visible and editable in the browser. The client sends ids and titles; the server's data source provider fills in host, database, table, query and credentials.
- **Identity comes from the server's own authentication**, not from a header the client chose. `setAdditionalHeadersProvider` is for forwarding the app's auth token or harmless UI state; treat every header value as untrusted input.
- **Credentials only for your own database or API.** The authentication provider must check that the data source's host, port and database (for REST, the URL's scheme, host and port) are your configured ones before returning a credential or token. Requests can name any host. This check is not a substitute for overwriting locations in the item provider (next rule).
- **Deny unknown data sources in the item provider.** Redirect unknown items to your own database with a query that returns no rows (or overwrite their location with one that cannot resolve), for every connector type, not only the ones you use. Never return `null`: on every platform Reveal then runs the item as the client sent it. On Node never throw either (the item also runs as sent). On ASP.NET and Java throwing fails the widget, but the exception message reaches the browser, so throw a generic one. See data-sources.md.
- **Always register your own dashboard provider** that validates the id and authorizes the user (on Node register both `dashboardProvider` and `dashboardStorageProvider`); never rely on the built-in ones, which let any caller overwrite any dashboard (on Node 2.2.1 even save `../name` outside the folder; dashboards.md).
- **Parameterize custom queries** with `CustomQueryParameters`. Never concatenate user context values into SQL.
- **Keep CORS permissive only in development.** Production gets the explicit client origin.
- **Pin versions.** Server package and client `reveal-sdk` should be the same release; pin the CDN URL to a version in production.
- Match the customer's existing code style, DI and configuration patterns (connection strings from their config, not literals), and register Reveal next to their existing service registration.
- When an answer depends on a version-specific behavior, say which version it applies to. If unsure whether an API exists in their version, check the public docs at https://help.revealbi.io/web/ and the API reference (JavaScript client: https://help.revealbi.io/api/javascript/latest/) rather than guessing.

## Definition of done

- [ ] A dashboard renders in their app, started the way they start it: `check-app.mjs --start "<their start command>"` exits 0, not just a 200 from the server
- [ ] View only, on the server too, unless they asked for editing
- [ ] Who may open dashboards is set in code (their login, or anonymous viewing in an app without one) and stated in your summary
- [ ] Data comes from their source, with connection details and credentials only on the server
- [ ] If data differs per user: identity is taken from server-side auth and verified by switching users
- [ ] License key configured outside source control (no watermark)
- [ ] CORS restricted to real origins outside development
- [ ] If export is enabled: one PDF or image export tried on the target hosting, not only locally
- [ ] Anything skipped is stated, with the reason
