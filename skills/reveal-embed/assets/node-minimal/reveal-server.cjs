// The Reveal SDK side of an Express app, in one call. Copy this file into the project as is:
//
//     import { mountReveal } from "./reveal-server.cjs";          // ES modules
//     const { mountReveal } = require("./reveal-server.cjs");    // CommonJS
//     mountReveal(app, { port: PORT });
//
// Call it after the app's authentication middleware and before express.json() and the app's
// own routes, static files and dev middleware (Vite, webpack). It adds:
//   /reveal-api/   the Reveal endpoints, behind a guard that rejects unauthenticated requests.
//                  The page calls RevealSdkSettings.setBaseUrl(location.origin + "/reveal-api/").
//   /sample-data/  the data of the sample dashboard dashboards/Sales.rdash.
//
// Local run without the app's authentication: start the process with --anonymous-demo and put
// the flag in the dev script, so the plain `npm run dev` works. Refused when NODE_ENV=production.
//
// Everything is denied by default. Change only what the app needs: its authentication
// (request.user), its data sources (isMapped and the item rules) and dashboard storage.
// dashboards/ and sample-data/ resolve against the working directory. License:
// ~/.revealbi-sdk/license.key or REVEAL_LICENSE (without either the engine fails to start).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const express = require("express");
const reveal = require("reveal-sdk-node");

function mountReveal(app, {
    port,
    prefix = "/reveal-api/",
    dashboardsDir = path.join(process.cwd(), "dashboards"),
    sampleDataDir = path.join(process.cwd(), "sample-data"),
    anonymousDemo = process.argv.includes("--anonymous-demo"),
} = {}) {
    if (!port) throw new Error("mountReveal needs the port the app listens on (for the sample data URL)");
    if (anonymousDemo && process.env.NODE_ENV === "production") {
        throw new Error("--anonymous-demo is for local runs only; refusing to start with NODE_ENV=production");
    }

    // The sample dashboard's data. Its `sales` item names a placeholder URL; the item provider
    // points it at this copy, so the dashboard renders without any outside connection.
    // Remove this route and the SAMPLE_DATA rule together with the sample.
    app.use("/sample-data", express.static(sampleDataDir));

    // Identity must come from the app's own auth middleware (mounted before Reveal), never
    // from a header the browser chose.
    const userContextProvider = (request) => {
        // The SDK's default system context calls this without a request: fail closed.
        if (!request) throw new Error("No HTTP request");
        const props = new Map();
        // props.set("TenantId", request.user?.tenantId);
        if (request.user) {
            // Fail closed: never fold a principal without a stable id into a shared context.
            // Change `id` to the property your auth middleware sets (sub, userId, ...).
            const id = request.user.id;
            if ((typeof id !== "string" && typeof id !== "number") || String(id).trim() === "") {
                throw new Error("Authenticated user has no stable id");
            }
            return new reveal.RVUserContext(String(id), props);
        }
        if (!anonymousDemo) {
            throw new Error("Unauthenticated request");
        }
        return new reveal.RVUserContext("anonymous", props);
    };

    // Default deny. Data sources and items arrive from the client. On Node, returning null or
    // throwing runs the item as sent (never do either). So every data source and item of every
    // connector type gets its url, host, path, file and database locations overwritten (and a
    // no-rows query) below unless a rule maps it to a server-controlled location.
    const BLOCKED_URL = "https://blocked.invalid/"; // .invalid never resolves (RFC 2606)
    const BLOCKED_FILE = "local:/blocked-by-server";
    const NO_ROWS = "SELECT 1 AS Empty WHERE 1 = 0";
    const BLOCKED = {
        url: BLOCKED_URL, webUrl: BLOCKED_URL, siteUrl: BLOCKED_URL, serverUrl: BLOCKED_URL,
        accountEndpoint: BLOCKED_URL, connectionString: "", host: "blocked.invalid",
        uri: BLOCKED_FILE, path: BLOCKED_FILE, database: null, // SQLite/DuckDB: a file path
        table: null, procedure: null, functionName: null, customQuery: NO_ROWS,
    };
    const neutralize = (obj) => {
        for (const [field, value] of Object.entries(BLOCKED)) {
            if (obj && field in obj) obj[field] = value;
        }
        if (obj && "customQueryParameters" in obj) obj.customQueryParameters = {};
    };

    // Allow-list: map the data sources and items the app uses to values from configuration.
    // Parameterize anything taken from the user context (customQueryParameters).
    // const SQL_ITEMS = { Orders: "SELECT * FROM Orders" };   // item id -> server query
    const isMapped = (dataSource) =>
        false; // e.g. dataSource instanceof reveal.RVSqlServerDataSource && dataSource.id === "AppDb"

    // REST items served from sample-data/: item id -> file. Whatever URL the dashboard names,
    // the engine reads this server's own copy over loopback.
    const SAMPLE_DATA = { sales: "sales.json" };
    const sampleUrl = (file) => `http://127.0.0.1:${port}/sample-data/${file}`;

    const dataSourceProvider = async (userContext, dataSource) => {
        if (isMapped(dataSource)) {
            // dataSource.host = process.env.SQL_HOST;
            // dataSource.database = process.env.SQL_DATABASE;
        } else if (!(dataSource instanceof reveal.RVInMemoryDataSource)) {
            neutralize(dataSource);
        }
        return dataSource;
    };

    const dataSourceItemProvider = async (userContext, dataSourceItem) => {
        // Required: the item carries its own copy of the data source.
        await dataSourceProvider(userContext, dataSourceItem.dataSource);

        if (dataSourceItem instanceof reveal.RVResourceBasedDataSourceItem && dataSourceItem.resourceItem) {
            // Excel, CSV and JSON items wrap the REST, web or local file item that holds the location.
            await dataSourceItemProvider(userContext, dataSourceItem.resourceItem);
        } else if (dataSourceItem instanceof reveal.RVRESTDataSourceItem && SAMPLE_DATA[dataSourceItem.id]) {
            dataSourceItem.url = sampleUrl(SAMPLE_DATA[dataSourceItem.id]);
            if (dataSourceItem.dataSource) dataSourceItem.dataSource.url = dataSourceItem.url;
        } else if (isMapped(dataSourceItem.dataSource)) {
            // Every item on the app's database gets a server query; unknown ids get no rows.
            // dataSourceItem.database = process.env.SQL_DATABASE;
            // dataSourceItem.table = null;
            // dataSourceItem.procedure = null;
            // dataSourceItem.customQuery = SQL_ITEMS[dataSourceItem.id] ?? NO_ROWS;
            // dataSourceItem.customQueryParameters = {};
            neutralize(dataSourceItem); // remove once the lines above are enabled
        } else if (!(dataSourceItem instanceof reveal.RVInMemoryDataSourceItem)) {
            // REST, web, OData and local file locations stay blocked until mapped to a
            // server-side allow-list (see references/data-sources.md, "Files").
            console.warn(`Blocked data source item: ${dataSourceItem.constructor.name} (${dataSourceItem.id})`);
            neutralize(dataSourceItem);
        }
        return dataSourceItem;
    };

    // Both dashboard options are supplied, so loading and saving go through the same validated,
    // authorized path (the built-in ones are demo defaults that let any caller overwrite any
    // dashboard). The id must be letters, digits, dash or underscore.
    // dashboards/ holds shared, read-only dashboards, and every user saves into a private
    // folder keyed by their id. A user can read the shared ones and
    // their own, and can never write to (or read) anyone else's. Replace with the app's own
    // storage and rules (tenants, sharing) when it needs them.
    const VALID_ID = /^[A-Za-z0-9_-]{1,100}$/;

    // Fail closed: the user context can be null (system calls, connection verification);
    // never fold a missing id into a shared folder.
    const requireUserId = (userContext) => {
        const id = userContext?.userId;
        if (id == null || String(id).trim() === "") throw new Error("No user");
        return String(id);
    };

    const userFolder = (userContext) =>
        path.join(dashboardsDir, "users", crypto.createHash("sha256").update(requireUserId(userContext)).digest("hex"));

    // Returns a stream: on 2.2.1 a Buffer or string here crashes the Node process.
    const dashboardProvider = async (userContext, dashboardId) => {
        if (!VALID_ID.test(dashboardId)) return null;
        const file = `${dashboardId}.rdash`;
        for (const dir of [userFolder(userContext), dashboardsDir]) {
            const candidate = path.join(dir, file);
            if (fs.existsSync(candidate)) return fs.createReadStream(candidate);
        }
        return null;
    };

    const dashboardStorageProvider = async (userContext, dashboardId, stream) => {
        if (!VALID_ID.test(dashboardId)) throw new Error("Invalid dashboard id");
        const dir = userFolder(userContext);
        fs.mkdirSync(dir, { recursive: true });
        // Write to a temp file and swap it in only once complete, so a failed or interrupted
        // save never truncates the previous version.
        const tmp = path.join(dir, `${dashboardId}.${crypto.randomUUID()}.tmp`);
        try {
            await pipeline(stream, fs.createWriteStream(tmp));
            await fs.promises.rename(tmp, path.join(dir, `${dashboardId}.rdash`));
        } catch (err) {
            await fs.promises.rm(tmp, { force: true });
            throw err;
        }
    };

    const revealOptions = {
        // local:/<file> URIs resolve here. Without it, Node 2.2.1 looks in C:\Reveal\Files.
        localFileStoragePath: path.join(process.cwd(), "Data"),
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

    // Fail closed: authentication middleware only identifies the caller; this rejects anyone
    // it did not identify.
    const requireAuth = (req, res, next) => (req.user || anonymousDemo ? next() : res.sendStatus(401));

    // Under a prefix, so the app's own pages and routes keep working (mounted at "/", Reveal
    // answers every request and everything registered after it returns 404). Above any body
    // parser (express.json() and friends).
    app.use(prefix, requireAuth, reveal(revealOptions));
}

module.exports = { mountReveal };
