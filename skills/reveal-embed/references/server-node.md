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
app.use(cors()); // development only; pass { origin: "https://app.example.com" } in production

const revealOptions = {
    license: process.env.REVEAL_LICENSE,          // or ~/.revealbi-sdk/license.key
    userContextProvider,                          // (request) => RVUserContext
    dataSourceProvider,                           // async (userContext, dataSource) => dataSource
    dataSourceItemProvider,                       // async (userContext, dataSourceItem) => dataSourceItem
    authenticationProvider,                       // async (userContext, dataSource) => credential | null
    // dashboardProvider,                         // async (userContext, dashboardId) => Readable | null
    // dashboardStorageProvider,                  // async (userContext, dashboardId, stream) => void (saving)
};

app.use("/", reveal(revealOptions));
app.listen(5111);
```

TypeScript (`npm install -D typescript @types/express @types/cors`):

```ts
import express, { Application } from "express";
import cors from "cors";
import reveal, { RevealOptions } from "reveal-sdk-node";

const app: Application = express();
app.use(cors());

const revealOptions: RevealOptions = { /* same keys as above */ };
app.use("/", reveal(revealOptions));
app.listen(5111);
```

On Node, the providers are **functions passed as options**, not classes. The data source provider is split into two options, `dataSourceProvider` and `dataSourceItemProvider`. SDK types come from the package: `reveal.RVSqlServerDataSource` in JS, named imports in TS.

## Mount path

`app.use("/", reveal(...))` serves the Reveal endpoints at the root. If the app already owns `/`, mount it under a prefix such as `app.use("/reveal-api/", reveal(...))` and set the client's base URL to include that prefix: `RevealSdkSettings.setBaseUrl("https://host/reveal-api/")` (keep the trailing slash).

**Do not also set the `basePath` option when mounting with an Express prefix.** Express already strips the prefix. With both set, `loadDashboard` fails with `400 Bad Request` on `/reveal-api/DashboardFile/<id>` and the view opens an empty "New Dashboard" (verified on 2.2.1). `basePath` is for hosting `reveal()` as a plain request listener that sees the full URL.

## Options

`RevealOptions` (2.2.1) also accepts:

| Option | Use |
| --- | --- |
| `localFileStoragePath` | Folder that `local:/<file>` URIs resolve against. **Set it.** Without it, 2.2.1 looks in `C:\Reveal\Files` on Windows, not the project folder. |
| `cachePath` | Cache and download folder (default: system temp). |
| `engineLogDir`, `engineLogLevel` | Engine log files and level (`Trace` … `None`). |
| `dataSourceItemFilter` | Node's equivalent of `IRVObjectFilter`: `async (userContext, item) => boolean`. |
| `dataModelProvider` | Beta data model provider. |
| `newLocalProcessingEnabled` | Server-side engine for Excel/CSV; needed for grid paging over files. |
| `maxDownloadSize`, `maxStorageCells`, `maxTotalStringsSize`, `maxStringCellSize`, `maxInMemoryCells`, `maxFilterSize` | Limits (see production.md). |
| `redisOptions`, `enableCacheEncryption`, `cacheEncryptionPassword` | Cache configuration. |
| `exportConfiguration` | Export (Chromium) settings. |

## Dashboards

By default dashboards load from a `dashboards` folder (lower case) in the **working directory** of the process, so start the server from the project root, or supply a `dashboardProvider`:

```js
const fs = require("fs");
const path = require("path");

const dashboardProvider = async (userContext, dashboardId) =>
    fs.createReadStream(path.join(__dirname, "dashboards", `${dashboardId}.rdash`));
```

Validate `dashboardId` before building a path from it (see dashboards.md).

## Node-specific limits

- Headless (server-side) export in the Node SDK is not available on Linux or macOS.
- On Linux ARM64, Chromium is not installed automatically for export. Install it with the package manager; Reveal looks for `/usr/bin/chromium`.
- Global filters are not supported in Node headless export.
- Intermittent request timeouts have been seen on developer machines, often caused by OS or antivirus firewalls. Retry before deep debugging.

Starting point: [assets/node-minimal](../assets/node-minimal).
