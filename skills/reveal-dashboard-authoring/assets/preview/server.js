// Local, read-only Reveal server for previewing generated .rdash files. Never deploy it:
// it is anonymous and listens on 127.0.0.1 only.
//
//     npm install && npm start -- [dashboards folder]      (default: ../dom-ts/out)
//     http://localhost:5112/                               lists the dashboards
//     http://localhost:5112/?dashboard=<id>                opens <folder>/<id>.rdash
//
// Data: REST/JSON items whose id is in SAMPLE_DATA are pointed at the files in
// ./sample-data; every other URL, host or file a dashboard names is blocked. Widgets bound
// to a real database therefore show a connection or authentication error here; check
// those in the app itself. License: ~/.revealbi-sdk/license.key or REVEAL_LICENSE
// (without one the views carry a trial watermark).

const fs = require("fs");
const path = require("path");
const express = require("express");
const reveal = require("reveal-sdk-node");

const PORT = Number(process.env.PORT) || 5112;
const DASHBOARDS_DIR = path.resolve(process.argv[2] || path.join(__dirname, "..", "dom-ts", "out"));
const VALID_ID = /^[A-Za-z0-9_-]{1,100}$/;
const BLOCKED_URL = "https://blocked.invalid/";
const BLOCKED_FILE = "local:/blocked-by-preview";

// Item id -> file in ./sample-data. Generated dashboards set these ids explicitly.
const SAMPLE_DATA = { sales: "sales.json" };
const sampleUrl = (file) => `http://127.0.0.1:${PORT}/sample-data/${file}`;

const app = express();
app.use("/sample-data", express.static(path.join(__dirname, "sample-data")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/info", (req, res) => {
    const ids = fs.existsSync(DASHBOARDS_DIR)
        ? fs.readdirSync(DASHBOARDS_DIR).filter(f => f.endsWith(".rdash")).map(f => f.slice(0, -6)).filter(id => VALID_ID.test(id))
        : [];
    res.json({ dashboardsDir: DASHBOARDS_DIR, dashboards: ids, sdkVersion: require("reveal-sdk-node/package.json").version });
});

const dataSourceProvider = async (userContext, dataSource) => {
    if (dataSource instanceof reveal.RVRESTDataSource
        || dataSource instanceof reveal.RVWebResourceDataSource
        || dataSource instanceof reveal.RVODataDataSource) {
        dataSource.url = BLOCKED_URL;
    }
    return dataSource;
};

const dataSourceItemProvider = async (userContext, item) => {
    if (item.dataSource) await dataSourceProvider(userContext, item.dataSource);
    if (item instanceof reveal.RVRESTDataSourceItem || item instanceof reveal.RVWebResourceDataSourceItem) {
        const file = SAMPLE_DATA[item.id];
        item.url = file ? sampleUrl(file) : BLOCKED_URL;
        if (file && item.dataSource) item.dataSource.url = item.url;
    } else if (item instanceof reveal.RVODataDataSourceItem) {
        item.url = BLOCKED_URL;
    } else if (item instanceof reveal.RVLocalFileDataSourceItem) {
        item.uri = BLOCKED_FILE;
    } else if (item instanceof reveal.RVResourceBasedDataSourceItem && item.resourceItem) {
        // JSON, CSV and Excel items wrap the REST/web/file item that holds the location.
        await dataSourceItemProvider(userContext, item.resourceItem);
    }
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

app.use("/", reveal(revealOptions));

app.listen(PORT, "127.0.0.1", () =>
    console.log(`Preview on http://localhost:${PORT}/  (dashboards: ${DASHBOARDS_DIR})`));
