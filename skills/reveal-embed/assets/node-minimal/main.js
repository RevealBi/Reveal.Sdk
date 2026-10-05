// Minimal Express host for the Reveal SDK. Serves the Reveal endpoints and a same-origin
// page from ./public, so the client needs no setBaseUrl.
//
//     npm install && npm start    ->  http://localhost:5111/
//
// Start it from this folder: the default dashboards folder is ./dashboards relative to
// the working directory. License: ~/.revealbi-sdk/license.key or REVEAL_LICENSE.

const path = require("path");
const express = require("express");
const cors = require("cors");
const reveal = require("reveal-sdk-node");

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
    return new reveal.RVUserContext(request.user?.id ?? "anonymous", props);
};

const dataSourceProvider = async (userContext, dataSource) => {
    // if (dataSource instanceof reveal.RVSqlServerDataSource) {
    //     dataSource.host = process.env.SQL_HOST;
    //     dataSource.database = process.env.SQL_DATABASE;
    // }
    return dataSource;
};

const dataSourceItemProvider = async (userContext, dataSourceItem) => {
    // Required: the item carries its own copy of the data source.
    await dataSourceProvider(userContext, dataSourceItem.dataSource);
    return dataSourceItem;
};

const revealOptions = {
    // local:/<file> URIs resolve here. Without it, Node 2.2.1 looks in C:\Reveal\Files.
    localFileStoragePath: path.join(__dirname, "Data"),
    userContextProvider,
    dataSourceProvider,
    dataSourceItemProvider,
};
if (process.env.REVEAL_LICENSE) {
    revealOptions.license = process.env.REVEAL_LICENSE;
}

app.use("/", reveal(revealOptions));

const port = process.env.PORT || 5111;
app.listen(port, () => console.log(`Reveal server on http://localhost:${port}/`));
