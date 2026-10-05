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

// The core connectors (REST, web resource, OData, local files) need no registration, so a
// crafted request can point them at any URL or file path. Returning the item unchanged,
// returning null and throwing all run it as sent, so until a location is mapped to a
// server-controlled value it is overwritten with one that cannot resolve.
const BLOCKED_URL = "https://blocked.invalid/"; // .invalid never resolves (RFC 2606)
const BLOCKED_FILE = "local:/blocked-by-server";

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
