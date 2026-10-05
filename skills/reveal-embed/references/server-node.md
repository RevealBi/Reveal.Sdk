# Reveal server on Node.js

Requires Node.js 16.3 or later. Reveal is Express middleware. Sources: https://help.revealbi.io/web/getting-started-server-node, `getting-started-server-node-typescript`, `getting-started-server-nest`.

## Install and register

```bash
npm install express reveal-sdk-node
npm install cors        # only if client and server are on different origins
```

JavaScript (CommonJS):

```js
const express = require("express");
const cors = require("cors");
const reveal = require("reveal-sdk-node");

const app = express();
// Only when the client is on another origin; never allow every origin.
if (process.env.CLIENT_ORIGIN) app.use(cors({ origin: process.env.CLIENT_ORIGIN }));

const revealOptions = {
    // license: see below; omit it to use ~/.revealbi-sdk/license.key
    userContextProvider,                          // (request) => RVUserContext
    dataSourceProvider,                           // async (userContext, dataSource) => dataSource
    dataSourceItemProvider,                       // async (userContext, dataSourceItem) => dataSourceItem
    authenticationProvider,                       // async (userContext, dataSource) => credential | null
    // dashboardProvider,                         // async (userContext, dashboardId) => Readable | null
    // dashboardStorageProvider,                  // async (userContext, dashboardId, stream) => void (saving)
};

// Only pass a key that is actually set. An empty or whitespace value ("REVEAL_LICENSE=" in .env)
// is passed through as an invalid key: the engine fails to start instead of falling back to the key file.
const license = process.env.REVEAL_LICENSE?.trim();
if (license) revealOptions.license = license;

// Required: the app's real authentication (passport.authenticate(...), express-jwt) must set req.user.
// app.use(authenticate);

// Fail closed: authentication only identifies the caller, this rejects anyone it did not identify.
const requireAuth = (req, res, next) => (req.user ? next() : res.sendStatus(401));

app.use("/", requireAuth, reveal(revealOptions));
app.listen(5111);
```

`userContextProvider` only derives the context. Make it throw when `request.user` has no stable id rather than mapping to a shared "anonymous" user (see [assets/node-minimal](../assets/node-minimal)).

**License on Node:** with `license` omitted, the engine reads `~/.revealbi-sdk/license.key` of the account running the process, or runs as a trial. A `license` option that is present but empty makes 2.2.1 log `The license key is missing or has expired. Engine failed to start` and throw `Engine exited abnormally`, which can take down the whole Node process. Do not add an empty `REVEAL_LICENSE=` to a real `.env`; a commented line in `.env.example` is fine (verified on 2.2.1).

TypeScript compiled to CommonJS (`"module": "commonjs"`, no `"type": "module"`; `npm install -D typescript @types/express @types/cors`):

```ts
import express, { Application } from "express";
import cors from "cors";
import reveal, { RevealOptions } from "reveal-sdk-node";

const app: Application = express();
if (process.env.CLIENT_ORIGIN) app.use(cors({ origin: process.env.CLIENT_ORIGIN }));

const revealOptions: RevealOptions = { /* same keys as above */ };
// requireAuth as defined above, after the app's authentication middleware.
app.use("/", requireAuth, reveal(revealOptions));
app.listen(5111);
```

**TypeScript or JavaScript as ES modules** (`"type": "module"`, or `"module": "NodeNext"`/`"Node16"`): the import above does not work. `reveal-sdk-node` is CommonJS: `module.exports` is the `create` function, and the SDK classes are assigned onto it. In ESM, named imports of classes (`import { RVUserContext } from "reveal-sdk-node"`) are `undefined` at runtime, and under NodeNext `tsc` reports `This expression is not callable` for the default import. Take everything from the default import (verified on 2.2.1):

```ts
import revealSdk, { type IRVUserContext, type RevealOptions } from "reveal-sdk-node";

// CommonJS package: the classes hang off the default export.
const { RVUserContext, RVPostgresDataSource, RVPostgresDataSourceItem, RVUsernamePasswordDataSourceCredential } = revealSdk;
const createReveal = revealSdk as unknown as typeof revealSdk.default;

app.use("/reveal-api", requireAuth, createReveal(revealOptions));
```

Type-only imports (`type RevealOptions`, `type IRVUserContext`) are fine as named imports. Check `"type"` in `package.json` and `"module"` in `tsconfig.json` before writing the import.

On Node, the providers are **functions passed as options**, not classes. The data source provider is split into two options, `dataSourceProvider` and `dataSourceItemProvider`; `dataSourceItemProvider` receives `(userContext, item)` only, with no dashboard id (unlike ASP.NET).

## Mount path

`app.use("/", reveal(...))` serves the Reveal endpoints at the root. If the app already owns `/`, mount it under a prefix such as `app.use("/reveal-api/", reveal(...))` and set the client's base URL to include that prefix: `RevealSdkSettings.setBaseUrl("https://host/reveal-api/")` (keep the trailing slash).

**Mount Reveal before any body parser.** Reveal streams the raw request body to its engine. If `app.use(express.json())`, `express.urlencoded()`, `body-parser` or similar runs first, which is the case in most existing Express apps, the body is already consumed: dashboards still load (a GET), but every `POST .../dashboard/editor/widget/data` hangs for a while and returns `500 Something went wrong. Correlation Id: ...`, with nothing in the Node console (verified on 2.2.1). Put the Reveal mount above the parsers, or scope the parsers to the app's own routes (`app.use("/api", express.json())`). Auth middleware that only reads headers can stay in front of Reveal.

```ts
app.use(cors({ origin: allowedOrigins }));
app.use("/reveal-api", requireAuth, createReveal(revealOptions)); // before express.json()
app.use(express.json());
```

**Do not also set the `basePath` option when mounting with an Express prefix.** Express already strips the prefix. With both set, `loadDashboard` fails with `400 Bad Request` on `/reveal-api/DashboardFile/<id>` (verified on 2.2.1); depending on how the page handles the rejected promise, the user sees an error or an empty "New Dashboard". `basePath` is for hosting `reveal()` as a plain request listener that sees the full URL.

## Options

`RevealOptions` (2.2.1) also accepts:

| Option | Use |
| --- | --- |
| `localFileStoragePath` | Folder that `local:/<file>` URIs resolve against. **Set it.** Without it, 2.2.1 looks in `C:\Reveal\Files` on Windows, not the project folder. |
| `cachePath` | Cache and download folder (default: system temp). |
| `engineLogDir`, `engineLogLevel` | Engine log files and level (`Trace` … `None`). **This is the Node "server log".** Without `engineLogDir`, engine errors are not written anywhere you can see: the Node console stays quiet and the client gets only `Something went wrong. Correlation Id: ...`. Set it (for example `path.resolve("logs")` with `"Debug"`) before troubleshooting, then search `reveal-engine.log` for the correlation id. Use `"Warning"` or higher in production. |
| `dataSourceItemFilter` | Node's equivalent of `IRVObjectFilter`: `async (userContext, item) => boolean`. |
| `dataModelProvider` | Beta data model provider. |
| `newLocalProcessingEnabled` | Server-side engine for Excel/CSV; needed for grid paging over files. |
| `maxDownloadSize`, `maxStorageCells`, `maxTotalStringsSize`, `maxStringCellSize`, `maxInMemoryCells`, `maxFilterSize` | Limits (see production.md). |
| `redisOptions`, `enableCacheEncryption`, `cacheEncryptionPassword` | Cache configuration. |
| `exportConfiguration` | Export (Chromium) settings. |

## Dashboards

By default dashboards load from a `dashboards` folder (lower case) in the **working directory** of the process, so start the server from the project root. **Do not rely on the built-in loader and saver in a real app:** on 2.2.1 they join the client's dashboard id into the path unchecked (`GET /DashboardFile/..%5c..%5cname` read `name.rdash` from outside the folder). Supply a `dashboardProvider` and a `dashboardStorageProvider` that validate the id ([assets/node-minimal](../assets/node-minimal) does both):

```js
const fs = require("fs");
const path = require("path");

const dashboardProvider = async (userContext, dashboardId) => {
    // dashboardId comes from the client: reject anything that could escape the folder.
    if (!/^[A-Za-z0-9_-]+$/.test(dashboardId)) return null;
    return fs.createReadStream(path.join(__dirname, "dashboards", `${dashboardId}.rdash`));
};
```

Always validate `dashboardId` before building a path from it (see dashboards.md).

## Node-specific limits

- Headless (server-side) export in the Node SDK is not available on Linux or macOS.
- On Linux ARM64, Chromium is not installed automatically for export. Install it with the package manager; Reveal looks for `/usr/bin/chromium`.
- Global filters are not supported in Node headless export.
- Intermittent request timeouts have been seen on developer machines, often caused by OS or antivirus firewalls. Retry before deep debugging.

Starting point: [assets/node-minimal](../assets/node-minimal).
