# @revealbi/dom (TypeScript / JavaScript)

Source: https://github.com/RevealBi/revealbi-dom, package `@revealbi/dom`. It ships an ES module build (bundlers, Node ESM) and a script-tag build (`index.iife.js`, global `RevealDom`).

**CommonJS:** in 0.3.0 the package's CommonJS entry doesn't work: from a CommonJS file, `require("@revealbi/dom")` throws `ReferenceError: exports is not defined` on Node 20+ and `ERR_REQUIRE_ESM` on Node 18 ([#64](https://github.com/RevealBi/revealbi-dom/issues/64)). Only `node -e` returns an empty object instead, so don't test the fix there. From CommonJS code, which includes most `reveal-sdk-node` servers, load it with a dynamic import:

```js
const { RdashDocument, ColumnChartVisualization } = await import("@revealbi/dom");
```

Scripts can also be ES modules: `.mjs` files, or a folder whose `package.json` has `"type": "module"` (the workspace in this skill is one).

```bash
npm install @revealbi/dom@latest
```

Runnable versions of everything below, plus tests, an API browser, an inspector, the guard, a loss check, a bulk-migration runner and a spec-to-dashboard generator, are in [assets/dom-ts](../assets/dom-ts/README.md).

## Setup

**TypeScript configuration:** with `"moduleResolution": "NodeNext"` or `"Node16"`, TypeScript reports `has no exported member` (TS2305) for every import from `@revealbi/dom` except `RdashDocument`, which silently becomes `any`: a file that imports only `RdashDocument` compiles with typos and no error. The cause is that the package's declarations re-export directories without file extensions ([#68](https://github.com/RevealBi/revealbi-dom/issues/68)). Projects on `"Bundler"` (Vite, webpack, Angular, `tsx`) are fine. In a NodeNext app:

- Don't change only `moduleResolution`: with `"module": "NodeNext"` that is error TS5095 / TS5109.
- Don't switch the whole app to Bundler: it stops checking `.js` extensions on relative imports, and the app then fails at run time with `ERR_MODULE_NOT_FOUND`.
- Put the dashboard code in its own folder with its own `tsconfig.json`, and run it with `tsx`:

```json
{ "extends": "../tsconfig.json", "compilerOptions": { "module": "ESNext", "moduleResolution": "Bundler", "noEmit": true }, "include": ["."] }
```

Check it with `npx tsc --noEmit -p <folder>`. The JavaScript itself runs fine either way.

## When the Reveal SDK is needed

Most of the DOM needs no SDK at all: creating, editing, `loadFromJson`, `loadFromBuffer`, `load(blob)`, `toJson`, `toJsonString` and `toBlob` all run in plain Node or a browser. Only the calls that talk to a live Reveal client need `reveal-sdk`:

- `RdashDocument.load(id)` asks the Reveal server, exactly like `RVDashboard.loadDashboard`; `RdashDocument.load(rvDashboard)` reads a live `RVDashboard`. (`load(blob)` unzips locally.)
- `doc.toRVDashboard()`: turns the document into an `RVDashboard` for a `RevealView`.

Register the SDK once at startup when you use them from npm:

```ts
import * as RevealSdk from "reveal-sdk";
import { registerRevealSdk } from "@revealbi/dom";

registerRevealSdk(RevealSdk);
RevealSdk.RevealSdkSettings.setBaseUrl("https://your-server/reveal-api/");   // only if origins differ
```

With script tags, load `reveal-sdk` first and the DOM after it. The `Reveal` global is detected automatically. If the SDK is loaded from its ESM URL there is no global, so call `registerRevealSdk` yourself. Older code that used the 1.x `$.ig` global and `window.dom` must move to `reveal-sdk` and `window.RevealDom`. The `load()` and `toRVDashboard()` calls themselves are unchanged.

## Create a dashboard

```ts
import {
  RdashDocument, MicrosoftSqlServerDataSource, MicrosoftSqlServerDataSourceItem,
  TextField, NumberField, DateField, DateDataField, DateAggregationType, NumberDataField, AggregationType,
  ColumnChartVisualization, KpiTimeVisualization, PivotVisualization, GridVisualization,
  DashboardDataFilter, DashboardDateFilter, DateRuleType,
} from "@revealbi/dom";

// Data: one data source, one item per table. Host/database are placeholders the
// server's data source provider overwrites; no credentials here.
const ds = new MicrosoftSqlServerDataSource("Sales DB");
ds.id = "SalesDb";                                      // stable ids if the server matches on them
const orders = new MicrosoftSqlServerDataSourceItem("Orders", "orders", ds);   // title, table, data source
orders.id = "Orders";
orders.fields = [                                       // every field any visualization binds, exact names and types
  new NumberField("id"),
  new TextField("region"),
  new DateField("order_date"),
  new NumberField("total_amount"),
];

const doc = new RdashDocument("Sales");

const region = new DashboardDataFilter("region", orders);
const orderDate = new DashboardDateFilter("Order date");
orderDate.ruleType = DateRuleType.AllTime;               // the default is LastYear ("last 365 days")
doc.filters = [orderDate, region];

const byMonth = new DateDataField("order_date");
byMonth.aggregationType = DateAggregationType.Month;
const revenue = new NumberDataField("total_amount");
revenue.fieldLabel = "Revenue";
revenue.aggregationType = AggregationType.Sum;

doc.visualizations = [
  new ColumnChartVisualization("Revenue by month", orders)
    .setLabel(byMonth).setValues(revenue)
    .connectDashboardFilter(orderDate, "order_date")      // without a name it binds a field called "Date"
    .connectDashboardFilter(region),
  new KpiTimeVisualization("Revenue", orders).setDate("order_date").setValue("total_amount"),
  new PivotVisualization("By region", orders).setRows(["region"]).setValues("total_amount"),
  new GridVisualization("Orders", orders).setColumns("id", "region", "order_date", "total_amount"),
];
```

This exact document was generated with `@revealbi/dom` 0.3.0 and renders in a Reveal 2.2.1 Node server with its title, both filters and all four visualizations.

### Other data sources

Constructors and the item properties that matter differ per connector (checked against `@revealbi/dom` 0.3.0). Only SQL Server takes the table in the constructor; everywhere else set `item.table` (or the listed property). Run `npm run api -- <Name>DataSourceItem` for the rest.

| Connector | Data source (properties) | Item constructor | Item properties | `provider` |
| --- | --- | --- | --- | --- |
| SQL Server | `MicrosoftSqlServerDataSource` (`host`, `port`, `database`, `schema`, `encrypt`) | `(title, table, ds)`, `(title, ds)`, `(title, table)`, `(title)` | `table`, `database`, `procedure`, `procedureParameters`, `processDataOnServer` (no `schema`: set it on the data source) | `SQLSERVER` |
| Azure SQL, Synapse | `MicrosoftAzureSqlServerDataSource` (+ `trustServerCertificate`), `MicrosoftAzureSynapseAnalyticsDataSource` | `(title, ds)` only | as SQL Server | `AZURE_SQL`, `AZURE_SYNAPSE` |
| PostgreSQL | `PostgreSqlDataSource` (`host`, `port` as a string, `database`, `schema`) | `(title, ds)` | `table`, `schema`, `database`, `functionName`, `functionParameters`, `processDataOnServer` | `POSTGRES` |
| MySQL | `MySqlDataSource` (`host`, `port`, `database`) | `(title, ds)` | `table`, `database`, `procedure`, `processDataOnServer` | `MYSQL` |
| Oracle | `OracleDataSource` (`host`, `port`, `database`, `service`, `sid`) | `(title, ds)` | `table`, `database`, `procedure` | `ORACLE` |
| Snowflake | `SnowflakeDataSource` (`host`, `account`, `warehouse`, `role`, `database`; no `schema`) | `(title, ds)` | `table`, `schema`, `database`, `processDataOnServer` | `SNOWFLAKE` |
| Amazon Redshift | `AmazonRedshiftDataSource` (`host`, `port`, `database`, `schema`) | `(title, ds)` | `table`, `schema`, `database`, `functionName` | `AMAZON_REDSHIFT` |
| Amazon Athena | `AmazonAthenaDataSource` (`database`, `region`, `workgroup`, `dataCatalog`, `outputLocation`) | `(title, ds)` | `table` | `AMAZON_ATHENA` |
| Google BigQuery | `GoogleBigQueryDataSource` (`projectId`) | `(title, ds)` | `dataSetId`, `projectId`, `table` | `BIG_QUERY` |
| MongoDB | `MongoDbDataSource` (`connectionString`, `database`) | `(title, ds)` | `collection`, `processDataOnServer` | `MONGODB` |
| REST (JSON, CSV, Excel) | `DataSource` (or `RestDataSource`) | `(title, uri, ds)` and others | `uri`, `isAnonymous`, `useCsv()`, `useExcel(sheet)`, `addHeader()` | `REST` (+ `JSON` / `CSVLOCALFILEPROVIDER` / `EXCELLOCALFILEPROVIDER` wrapper) |

Treat these as unreliable in 0.3.0 and check them in the app before shipping (or build them in the Reveal editor or with Reveal.Sdk.Dom): Athena, BigQuery and MongoDB (the DOM writes property names that differ from the ones the Reveal 2.2.1 client reads), Oracle by service name (`Service` instead of `SERVICE_NAME`, both libraries), OData and web service items (`URL` key; the web service item is not wrapped as JSON), Google Sheets (no spreadsheet id), Amazon S3, Analysis Services (the data source is not written into the file; a Grid is rejected, only XMLA visualizations work), and local files (`CsvDataSource`, `ExcelDataSource`, `JsonDataSource`, `LocalFileDataSource` have no item class).

A REST endpoint returning JSON, CSV or Excel:

```ts
import { DataSource, RestDataSourceItem, TextField, NumberField, PieChartVisualization } from "@revealbi/dom";

const item = new RestDataSourceItem("Sales by Category", "https://api.example.com/sales", new DataSource("Sales API"));
item.isAnonymous = true;               // false when the server's authentication provider supplies a token
item.fields = [new TextField("CategoryName"), new NumberField("ProductSales")];
// item.useCsv();  item.useExcel("Sheet1");   // when the endpoint returns CSV or a workbook

const pie = new PieChartVisualization("Sales", item).setLabel("CategoryName").setValue("ProductSales");
```

The URL is stored in the dashboard and visible to anyone who can load it. On the server, the data source provider should still force the URL to an allowed host (`reveal-embed` data-sources.md).

## Write it out

Node, to a file in the dashboards folder:

```ts
import fs from "node:fs/promises";
await fs.writeFile("dashboards/Sales.rdash", Buffer.from(await doc.toBlob().arrayBuffer()));
```

Node, built per request inside a `reveal-sdk-node` dashboard provider (validate the id and authorize the user first, as `reveal-embed` dashboards.md requires):

```js
const { Readable } = require("node:stream");
const dom = import("@revealbi/dom");          // CommonJS server: require("@revealbi/dom") throws in 0.3.0

const dashboardProvider = async (userContext, dashboardId) => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(dashboardId)) return null;
  if (dashboardId === "TenantOverview") {
    const doc = buildTenantOverview(await dom, tenantOf(userContext));   // returns an RdashDocument
    return Readable.from(Buffer.from(await doc.toBlob().arrayBuffer()));
  }
  return loadStoredDashboard(userContext, dashboardId);
};
```

A per-tenant dashboard is not data isolation: users can change its filters. Take the tenant from the user context's properties (set by the server's user-context provider) and restrict the rows in the data source provider too (`reveal-embed`).

Browser, straight into a view (SDK registered as above):

```ts
const view = new RevealView(document.getElementById("viewer"));
view.dashboard = await doc.toRVDashboard();
```

A working page that does this with the script-tag builds is in [assets/preview/public/client-side.html](../assets/preview/public/client-side.html). It covers both building in the browser and `RdashDocument.load(id)` → edit → `toRVDashboard()`, and both were rendered against a Reveal 2.2.1 server.

As JSON (for a database column): `doc.toJsonString()`, and later `RdashDocument.loadFromJson(json)`.

## Load an existing dashboard

| Source | Call | Needs SDK |
| --- | --- | --- |
| `.rdash` bytes (`fs.readFile`, a DB blob, an `ArrayBuffer`) | `await RdashDocument.loadFromBuffer(bytes)` (typed `ArrayBuffer \| Buffer`: wrap a `Uint8Array` in `Buffer.from(bytes)`; its `.buffer` doesn't type-check on TypeScript 5.7+ and holds other bytes when the array is a view, [#72](https://github.com/RevealBi/revealbi-dom/issues/72)) | No |
| `Dashboard.json` text | `RdashDocument.loadFromJson(json)` | No |
| A `Blob` (file input, `fetch(...).blob()`) | `await RdashDocument.load(blob)` | No |
| A dashboard id on the Reveal server | `await RdashDocument.load("Sales")` | Yes |
| The dashboard currently in a `RevealView` | `await RdashDocument.load(view.dashboard)` | Yes |

Loading from the live view picks up the user's unsaved edits. Use it to post-process a dashboard in `onSave` before it is stored.

**Joins:** 0.3.0 has no join API. A hand-built `AdditionalTable` compiles and passes the guard and the loss check, but every widget fails in Reveal (`length ('-1')`). Join in .NET (`item.Join`, dotnet.md), in a database view, or in the data the server returns.

**Reading loaded documents:** `TabularDataDefinition` isn't exported in 0.3.0 and `doc.toJson()` is typed `object`. Read a widget's item with `(viz.dataDefinition as { dataSourceItem?: DataSourceItem; fields?: IField[] }).dataSourceItem`, and cast `doc.toJson()` to the shape you read. Identify a connector by `provider`, not `constructor.name` (the build is minified).

## Validation

`toJsonString()`, `toJson()` and `toBlob()` run `validate()` first. It throws when a visualization has no data source item or an item has no `fields`. It does **not** check that bound field names exist. Copy [`src/lib/guard.ts`](../assets/dom-ts/src/lib/guard.ts) and call `assertBoundFieldsExist(doc.toJson())` before every save (`saveRdash` in `src/lib/rdash-file.ts` does). It works on the serialized form, so it also checks dashboards made by the .NET DOM or the editor.

It checks visualization bindings, dashboard filter fields, date columns bound by name as a label or row, link parameters (a `LinkFilter` value must be a source column) and that every filter binding points at a filter the dashboard has. Run it on an existing file with `npm run guard -- <file>` (exit 1 lists the problems, 2 means the file can't be read). The binding checks were tested against typos in chart values, grid columns, KPI dates and a date filter left on its default `"Date"` field (all caught). On the 350 dashboards authored in the Reveal editor (joins and calculated fields included), 342 pass; the other 8 already contain dead filter connections (a binding to a filter that was deleted). The earlier false positive on a pivot over transposed data is fixed. When you edit such a file, pass the original so only the problems your change adds fail: `saveRdash(doc, path, await readRdashJson(src))`.

The binding-target check is deliberately strict. A `"_date"` binding with two date filters was rendered and filters nothing. A load + save in either library also rewrites the editor's id-less date binding to `"_date"`; in 4 of the 350 editor dashboards (`Sales.rdash` among them) the date filter has a GUID, so the result points at no filter. Whether Reveal then still applies that filter is **not verified**, so the guard flags it and `saveRdash` refuses such a round trip. Tell the user, and render the result with a restrictive date rule before overriding.

The guard checks the file against itself, not against the data: rendering in [assets/preview](../assets/preview/README.md) catches some of the rest (`no such column: <name>` for a chart value the data doesn't have), but not a misspelled grid column or a declared field the data lacks.
