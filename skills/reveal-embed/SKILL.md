---
name: reveal-embed
description: "Helps developers embed Reveal SDK (Reveal BI, revealbi.io) dashboards in their own applications. Use for Reveal setup, integration, configuration, security or deployment: ASP.NET Core, Node.js/Express or Java/Spring Boot/Tomcat servers; HTML/JavaScript, Angular, React, Vue or web-component clients; data sources, server-side credentials, user context, row-level security, multi-tenancy, loading, saving and creating dashboards, theming, export, licensing and production; and troubleshooting a RevealView that is blank, unstyled, watermarked, failing CORS or export, showing no data or ignoring paging. Not for Power BI, Tableau, Metabase, Grafana, Chart.js or other BI/charting products."
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
| View only, or do users create and edit dashboards | Decides `canEdit`, saving, and whether data sources must be offered in the editor. Read [dashboards.md](references/dashboards.md). |
| Trial or licensed, and where it will be hosted | License key placement, export dependencies (Chromium), body size limits. Read [production.md](references/production.md). |

System requirements: ASP.NET 8.0+; Java 17+ with a Jakarta EE 9 server and Maven 3.6.3+; Node.js 16.3+.

## 2. Get one dashboard on screen

Always start here, even when the request is about something later in the list. A rendering `RevealView` proves the package, license, routing, CORS and base URL all work, so every later problem is narrowed to the feature being added.

1. Install the server package and register Reveal (see the `server-*` reference). In an existing Express app, mount Reveal **before** any body parser (`express.json()` and friends), behind the app's auth middleware.
2. Put one `.rdash` in the dashboards folder: `Dashboards/` for ASP.NET, `dashboards/` for Node, an explicit path given to `RVDashboardProvider` for Java. The dashboard id the client asks for is the file name without `.rdash`.
3. Add the client: install `reveal-sdk` (or load it from a CDN), give the host element a real height, call `setBaseUrl` if the origins differ, then `RVDashboard.loadDashboard("Name")` and assign it to `new RevealView(element).dashboard`.
4. Allow the client origin in CORS for development.
5. Run both and open the page from `http(s)://`, not `file://`.

[assets/aspnet-minimal](assets/aspnet-minimal) and [assets/node-minimal](assets/node-minimal) are working starting points with a same-origin page. Adapt them into the customer's project rather than handing over a separate app, unless they asked for a standalone sample.

If there is no `.rdash` yet, set `revealView.dashboard = new RVDashboard()` to open an empty dashboard, and give the view at least one data source (step 3) so the user can build visualizations.

## 3. Add what they actually need, in this order

| Need | Reference |
| --- | --- |
| Connect their database or API, keep connection details off the client | [data-sources.md](references/data-sources.md) |
| Pass the signed-in user, tenant or role to the server; row-level security; credentials per user | [user-context-security.md](references/user-context-security.md) |
| Store dashboards somewhere other than a folder (database, blob storage, per-user), Save / Save As, create new, editing permissions | [dashboards.md](references/dashboards.md) |
| Match their look: themes, fonts, which menus and buttons show | [client.md](references/client.md) |
| License, export (PDF/Image/PowerPoint), size limits, caching, logging, CORS and hosting for production | [production.md](references/production.md) |

## 4. When something does not work

Read [gotchas.md](references/gotchas.md) before calling anything an SDK bug. A blank view, a watermark, "unknown type", empty widgets, paging that does not page, a bare "Export failed", and themes or fonts that do not apply all have known setup causes listed there. Ask for the browser console, the network tab entry for the failing Reveal request, and the **server log**, since several failures surface only there. On Node that log exists only once `engineLogDir` is set in `RevealOptions`; until then the client gets a bare correlation id and the console stays silent. Widget errors usually arrive as HTTP 200 with an `error` object, so read response bodies.

## Rules for the code you write

- **Connection details, credentials and identity stay on the server.** Anything set on a client data source object is visible and editable in the browser. The client sends ids and titles; the server's data source provider fills in host, database, table, query and credentials.
- **Identity comes from the server's own authentication**, not from a header the client chose. `setAdditionalHeadersProvider` is for forwarding the app's auth token or harmless UI state; treat every header value as untrusted input.
- **Credentials only for your own database.** The authentication provider must check that the data source's host, port and database are your configured ones before returning a credential. Requests can name any host, and rejecting an item with `null` makes Reveal use the client's connection details as sent.
- **Parameterize custom queries** with `CustomQueryParameters`. Never concatenate user context values into SQL.
- **Keep CORS permissive only in development.** Production gets the explicit client origin.
- **Pin versions.** Server package and client `reveal-sdk` should be the same release; pin the CDN URL to a version in production.
- Match the customer's existing code style, DI and configuration patterns (connection strings from their config, not literals), and register Reveal next to their existing service registration.
- When an answer depends on a version-specific behavior, say which version it applies to. If unsure whether an API exists in their version, check the public docs at https://help.revealbi.io/web/ and the API reference at https://help.revealbi.io/api/ rather than guessing.

## Definition of done

- [ ] A dashboard renders in their app, opened in a browser, not just a 200 from the server
- [ ] Data comes from their source, with connection details and credentials only on the server
- [ ] If data differs per user: identity is taken from server-side auth and verified by switching users
- [ ] License key configured outside source control (no watermark)
- [ ] CORS restricted to real origins outside development
- [ ] If export is enabled: one PDF or image export tried on the target hosting, not only locally
- [ ] Anything skipped is stated, with the reason
