// Local, read-only Reveal server for previewing generated .rdash files. Never deploy it:
// it is anonymous and listens on 127.0.0.1 only.
//
//     npm install && npm start -- [dashboards folder]      (default: ../dom-ts/out)
//     http://localhost:5112/                               lists the dashboards
//     http://localhost:5112/?dashboard=<id>                opens <folder>/<id>.rdash
//
// Data is default-deny. Only two things are let through:
//   - REST/JSON items whose id is in SAMPLE_DATA, pointed at the files in ./sample-data;
//   - web-resource fetches of this server's own /sample-data/ URLs (Image widgets fetch each
//     image URL through the item provider with a generated id, so they are allowed by URL).
// Every other item and data source, of any type, has its location rewritten to an
// unresolvable value before the engine sees it: REST/web/OData URLs, local files, database
// hosts, and the database file of SQLite/DuckDB. The preview never opens a host or file a
// dashboard names, so treat its output for database widgets as "not checked": they show an
// authentication or "cannot open" error here; check them in the app itself.
// License: ~/.revealbi-sdk/license.key or REVEAL_LICENSE. Without one the engine fails to start
// ("The license key is missing or has expired") and takes this process down seconds after the
// "Preview on" line (reveal-sdk-node 2.2.1), so `check` then sees a refused connection.

const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const reveal = require("reveal-sdk-node");

const PORT = Number(process.env.PORT) || 5112;
const DASHBOARDS_DIR = path.resolve(process.argv[2] || path.join(__dirname, "..", "dom-ts", "out"));
const VALID_ID = /^[A-Za-z0-9_-]{1,100}$/;
const BLOCKED_URL = "https://blocked.invalid/";
const BLOCKED_FILE = "local:/blocked-by-preview";
const BLOCKED_HOST = "blocked.invalid";
// A file in a folder that does not exist: SQLite and DuckDB cannot open or create it.
const BLOCKED_DB = path.join(__dirname, "blocked-by-preview", "does-not-exist", "blocked.db");

// Item id -> file in ./sample-data. Generated dashboards set these ids explicitly.
const SAMPLE_DATA = { sales: "sales.json" };
const SAMPLE_PREFIX = `http://127.0.0.1:${PORT}/sample-data/`;
const sampleUrl = (file) => `${SAMPLE_PREFIX}${file}`;

// Returns the normalized URL when it points into this server's own /sample-data/ folder,
// otherwise null. new URL() resolves "..", "%2e%2e" and backslashes before the prefix test.
const ownSampleUrl = (value) => {
    let u;
    try { u = new URL(String(value ?? "")); } catch { return null; }
    const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
    if (u.protocol !== "http:" || !local || u.port !== String(PORT) || u.username || u.password) return null;
    if (!u.pathname.startsWith("/sample-data/")) return null;
    return `${SAMPLE_PREFIX}${u.pathname.slice("/sample-data/".length)}`;
};

// Every location-bearing property the Node SDK model exposes, and what to overwrite it with.
// Setting a property the object does not have is skipped, so this is safe on any type.
const LOCATION_PROPS = {
    url: BLOCKED_URL, serverUrl: BLOCKED_URL, siteUrl: BLOCKED_URL, webUrl: BLOCKED_URL,
    listUrl: BLOCKED_URL, listItemUrl: BLOCKED_URL, httpPath: BLOCKED_URL, outputLocation: BLOCKED_URL,
    uri: BLOCKED_FILE, path: BLOCKED_FILE, folderRelativePath: BLOCKED_FILE,
    host: BLOCKED_HOST, database: BLOCKED_DB,
};
const neutralize = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const [prop, blocked] of Object.entries(LOCATION_PROPS)) {
        if (prop in obj) obj[prop] = blocked;
    }
};

const app = express();
app.use("/sample-data", express.static(path.join(__dirname, "sample-data")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/info", (req, res) => {
    const ids = fs.existsSync(DASHBOARDS_DIR)
        ? fs.readdirSync(DASHBOARDS_DIR).filter(f => f.endsWith(".rdash")).map(f => f.slice(0, -6)).filter(id => VALID_ID.test(id))
        : [];
    res.json({ dashboardsDir: DASHBOARDS_DIR, dashboards: ids, sdkVersion: require("reveal-sdk-node/package.json").version });
});

// Data sources: keep only this server's own sample URLs; neutralize everything else.
const dataSourceProvider = async (userContext, dataSource) => {
    const own = (dataSource instanceof reveal.RVRESTDataSource || dataSource instanceof reveal.RVWebResourceDataSource)
        ? ownSampleUrl(dataSource.url) : null;
    if (own) dataSource.url = own;
    else neutralize(dataSource);
    return dataSource;
};

const dataSourceItemProvider = async (userContext, item) => {
    if (item instanceof reveal.RVResourceBasedDataSourceItem && item.resourceItem) {
        // JSON, CSV and Excel items wrap the REST/web/file item that holds the location.
        if (item.dataSource) await dataSourceProvider(userContext, item.dataSource);
        await dataSourceItemProvider(userContext, item.resourceItem);
        return item;
    }
    if (item instanceof reveal.RVRESTDataSourceItem || item instanceof reveal.RVWebResourceDataSourceItem) {
        const own = SAMPLE_DATA[item.id] ? sampleUrl(SAMPLE_DATA[item.id]) : ownSampleUrl(item.url);
        if (own) {
            item.url = own;
            if (item.dataSource) item.dataSource.url = own;
            return item;
        }
    }
    // Default deny: any other item, of any type, keeps its shape but loses its location.
    neutralize(item);
    neutralize(item.dataSource);
    return item;
};

const revealOptions = {
    userContextProvider: () => new reveal.RVUserContext("preview", new Map()),
    dashboardProvider: async (userContext, dashboardId) => {
        if (!VALID_ID.test(dashboardId)) return null;
        const file = path.join(DASHBOARDS_DIR, `${dashboardId}.rdash`);
        return fs.existsSync(file) ? fs.createReadStream(file) : null;
    },
    dashboardStorageProvider: async () => {
        throw new Error("The preview server is read-only.");
    },
    dataSourceProvider,
    dataSourceItemProvider,
    engineLogDir: path.join(__dirname, "logs"),
};
const license = process.env.REVEAL_LICENSE?.trim();
if (license) revealOptions.license = license;

// Exported for the offline provider test (test-providers.js); `node server.js` starts the server.
module.exports = { dataSourceProvider, dataSourceItemProvider, ownSampleUrl, BLOCKED_DB };

if (require.main === module) {
    const keyFile = path.join(os.homedir(), ".revealbi-sdk", "license.key");
    if (!license && !fs.existsSync(keyFile)) {
        console.warn(`No Reveal license key (REVEAL_LICENSE or ${keyFile}): the engine will fail to start and this server will exit.`);
    }
    app.use("/", reveal(revealOptions));
    app.listen(PORT, "127.0.0.1", () =>
        console.log(`Preview on http://localhost:${PORT}/  (dashboards: ${DASHBOARDS_DIR})`));
}
