// Minimal Express host for the Reveal SDK. Serves the Reveal endpoints and a same-origin
// page from ./public, so the client needs no setBaseUrl.
//
//     npm install && npm run demo    ->  http://localhost:5111/
//
// `npm start` (node main.js) requires an authenticated user on every Reveal request and
// answers 401 until the app's real authentication is added below. `npm run demo` passes
// --anonymous-demo: anonymous access for a local first run, listening on localhost only.
//
// Dashboards in ./dashboards are shared and read-only; each user saves into their own folder.
// Start it from this folder: the default dashboards folder is ./dashboards relative to
// the working directory. License: ~/.revealbi-sdk/license.key or REVEAL_LICENSE.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const express = require("express");
const cors = require("cors");
const reveal = require("reveal-sdk-node");

const anonymousDemo = process.argv.includes("--anonymous-demo");

const app = express();

// Only needed when the front end is served from another origin. Opt in by setting
// CLIENT_ORIGIN (e.g. https://app.example.com); never allow every origin.
if (process.env.CLIENT_ORIGIN) {
    app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
}

app.use(express.static(path.join(__dirname, "public")));

// Identity must come from the app's own auth middleware (mounted before Reveal), never
// from a header the browser chose.
const userContextProvider = (request) => {
    const props = new Map();
    // props.set("TenantId", request.user?.tenantId);
    if (request.user) {
        // Fail closed: never fold a principal without a stable id into a shared context.
        // Change `id` to the property your auth middleware sets (sub, userId, ...).
        const id = request.user.id;
        if (typeof id !== "string" && typeof id !== "number") {
            throw new Error("Authenticated user has no stable id");
        }
        return new reveal.RVUserContext(String(id), props);
    }
    if (!anonymousDemo) {
        throw new Error("Unauthenticated request");
    }
    return new reveal.RVUserContext("anonymous", props);
};

// The core connectors (REST, web resource, OData, local files) need no registration, so a
// crafted request can point them at any URL or file path. Returning the item unchanged,
// returning null and throwing all run it as sent, so until a location is mapped to a
// server-controlled value it is overwritten with one that cannot resolve.
const BLOCKED_URL = "https://blocked.invalid/"; // .invalid never resolves (RFC 2606)
const BLOCKED_FILE = "local:/blocked-by-server";

// Database connectors: redirect the data source AND allow-list the items (both below).
// Enabling only the redirect would run any table or custom query the client sends
// against the app's database with the app's credentials.
// const SQL_ITEMS = { Orders: "SELECT * FROM Orders" };   // item id -> server query
// const NO_ROWS = "SELECT 1 AS Empty WHERE 1 = 0";

const dataSourceProvider = async (userContext, dataSource) => {
    // if (dataSource instanceof reveal.RVSqlServerDataSource) {
    //     dataSource.host = process.env.SQL_HOST;
    //     dataSource.database = process.env.SQL_DATABASE;
    // }

    // Replace with URLs from configuration for the endpoints the app uses.
    if (dataSource instanceof reveal.RVRESTDataSource
        || dataSource instanceof reveal.RVWebResourceDataSource
        || dataSource instanceof reveal.RVODataDataSource) {
        dataSource.url = BLOCKED_URL;
    }
    return dataSource;
};

const dataSourceItemProvider = async (userContext, dataSourceItem) => {
    // Required: the item carries its own copy of the data source.
    await dataSourceProvider(userContext, dataSourceItem.dataSource);

    // Enable together with the SQL redirect above. Every SQL item gets a server query;
    // unknown ids get one that returns no rows (returning null would run the item as sent).
    // if (dataSourceItem instanceof reveal.RVSqlServerDataSourceItem) {
    //     dataSourceItem.table = null;
    //     dataSourceItem.procedure = null;
    //     dataSourceItem.customQuery = SQL_ITEMS[dataSourceItem.id] ?? NO_ROWS;
    //     dataSourceItem.customQueryParameters = {};
    //     return dataSourceItem;
    // }

    // Locations the request chose. Replace with server-side allow-lists, e.g. a local file
    // uri built only from known ids (see references/data-sources.md, "Files").
    if (dataSourceItem instanceof reveal.RVRESTDataSourceItem
        || dataSourceItem instanceof reveal.RVWebResourceDataSourceItem
        || dataSourceItem instanceof reveal.RVODataDataSourceItem) {
        dataSourceItem.url = BLOCKED_URL;
    } else if (dataSourceItem instanceof reveal.RVLocalFileDataSourceItem) {
        dataSourceItem.uri = BLOCKED_FILE;
    } else if (dataSourceItem instanceof reveal.RVResourceBasedDataSourceItem && dataSourceItem.resourceItem) {
        // Excel, CSV and JSON items wrap the REST, web or local file item that holds the location.
        await dataSourceItemProvider(userContext, dataSourceItem.resourceItem);
    }
    return dataSourceItem;
};

// The built-in dashboard loading and saving join the client's dashboard id into a path
// without checking it (an id with ..%5c escapes the folder on 2.2.1), and let any caller
// overwrite any dashboard. So: dashboards/ holds shared, read-only dashboards, and every
// user saves into a private folder keyed by their id. A user can read the shared ones and
// their own, and can never write to (or read) anyone else's. Replace with the app's own
// storage and rules (tenants, sharing) when it needs them.
const DASHBOARDS_DIR = path.join(process.cwd(), "dashboards");
const VALID_ID = /^[A-Za-z0-9_-]{1,100}$/;

const userFolder = (userContext) =>
    path.join(DASHBOARDS_DIR, "users", crypto.createHash("sha256").update(String(userContext.userId)).digest("hex"));

const dashboardProvider = async (userContext, dashboardId) => {
    if (!VALID_ID.test(dashboardId)) return null;
    const file = `${dashboardId}.rdash`;
    for (const dir of [userFolder(userContext), DASHBOARDS_DIR]) {
        const candidate = path.join(dir, file);
        if (fs.existsSync(candidate)) return fs.createReadStream(candidate);
    }
    return null;
};

const dashboardStorageProvider = async (userContext, dashboardId, stream) => {
    if (!VALID_ID.test(dashboardId)) throw new Error("Invalid dashboard id");
    const dir = userFolder(userContext);
    fs.mkdirSync(dir, { recursive: true });
    await pipeline(stream, fs.createWriteStream(path.join(dir, `${dashboardId}.rdash`)));
};

const revealOptions = {
    // local:/<file> URIs resolve here. Without it, Node 2.2.1 looks in C:\Reveal\Files.
    localFileStoragePath: path.join(__dirname, "Data"),
    userContextProvider,
    dashboardProvider,
    dashboardStorageProvider,
    dataSourceProvider,
    dataSourceItemProvider,
};
// Only pass a non-blank key; an empty or whitespace value disables the key file fallback.
const license = process.env.REVEAL_LICENSE?.trim();
if (license) {
    revealOptions.license = license;
}

// Add the app's real authentication here (passport.authenticate(...), express-jwt) so it
// sets request.user. It must run before the guard and before Reveal.
// app.use(authenticate);

// Fail closed: authentication middleware only identifies the caller; this rejects anyone
// it did not identify.
const requireAuth = (req, res, next) => (req.user || anonymousDemo ? next() : res.sendStatus(401));

app.use("/", requireAuth, reveal(revealOptions));

const port = process.env.PORT || 5111;
if (anonymousDemo) {
    app.listen(port, "127.0.0.1", () => console.log(`Anonymous demo on http://localhost:${port}/ (local only)`));
} else {
    app.listen(port, () => console.log(`Reveal server on port ${port}`));
}
