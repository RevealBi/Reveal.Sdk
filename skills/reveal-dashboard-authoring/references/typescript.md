# @revealbi/dom (TypeScript / JavaScript)

Source: https://github.com/RevealBi/revealbi-dom, package `@revealbi/dom`. It ships an ES module build (bundlers, Node ESM) and a script-tag build (`index.iife.js`, global `RevealDom`).

**CommonJS:** in 0.3.0 the package's CommonJS entry doesn't work: `require("@revealbi/dom")` returns an empty object on Node 20 and 22 (no error, `RdashDocument` is `undefined`) and throws `ERR_REQUIRE_ESM` on Node 18 ([#64](https://github.com/RevealBi/revealbi-dom/issues/64)). From CommonJS code, which includes most `reveal-sdk-node` servers, load it with a dynamic import:

```js
const { RdashDocument, ColumnChartVisualization } = await import("@revealbi/dom");
```

Scripts can also be ES modules: `.mjs` files, or a folder whose `package.json` has `"type": "module"` (the workspace in this skill is one).

```bash
npm install @revealbi/dom@latest
```

Runnable versions of everything below, plus tests, an API browser and an inspector, are in [assets/dom-ts](../assets/dom-ts/README.md).

**TypeScript configuration:** with `"moduleResolution": "NodeNext"` or `"Node16"`, TypeScript reports `has no exported member` for every import from `@revealbi/dom`, and `RdashDocument` silently becomes `any`, because the package's declarations re-export directories without file extensions ([#68](https://github.com/RevealBi/revealbi-dom/issues/68)). Use `"Bundler"` (Vite, webpack, Angular and `tsx` projects usually already do) or `"Node10"`. The JavaScript itself runs fine either way.

## When the Reveal SDK is needed

Most of the DOM needs no SDK at all: creating, editing, `loadFromJson`, `loadFromBuffer`, `toJson`, `toJsonString` and `toBlob` all run in plain Node. Only the two methods that talk to a live Reveal client need `reveal-sdk`:

- `RdashDocument.load(idOrBlobOrRVDashboard)`: by id it asks the Reveal server, exactly like `RVDashboard.loadDashboard`.
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

Every connector has a `<Name>DataSource` / `<Name>DataSourceItem` pair: `PostgreSqlDataSource`, `MySqlDataSource`, `OracleDataSource`, `SnowflakeDataSource`, `GoogleBigQueryDataSource`, `MongoDbDataSource`, `AmazonAthenaDataSource`, `MicrosoftAzureSqlServerDataSource`, `ODataDataSource`, `RestDataSource` and more. Database items take `(title, table, dataSource)`. Extras differ per connector (the SQL Server item has `database`, `procedure` and `processDataOnServer` but no `schema`), so run `npm run api -- <Name>DataSourceItem` before using one.

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
const dom = import("@revealbi/dom");          // CommonJS server: require("@revealbi/dom") is empty in 0.3.0

const dashboardProvider = async (userContext, dashboardId) => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(dashboardId)) return null;
  if (dashboardId === "TenantOverview") {
    const doc = buildTenantOverview(await dom, tenantOf(userContext));   // returns an RdashDocument
    return Readable.from(Buffer.from(await doc.toBlob().arrayBuffer()));
  }
  return loadStoredDashboard(userContext, dashboardId);
};
```

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
| `.rdash` bytes (`fs.readFile`, a DB blob, an `ArrayBuffer`) | `await RdashDocument.loadFromBuffer(bytes)` (typed `ArrayBuffer \| Buffer`: wrap a `Uint8Array` in `Buffer.from(...)` or pass its `.buffer`, [#72](https://github.com/RevealBi/revealbi-dom/issues/72)) | No |
| `Dashboard.json` text | `RdashDocument.loadFromJson(json)` | No |
| A `Blob` (file input, `fetch(...).blob()`) | `await RdashDocument.load(blob)` | Yes |
| A dashboard id on the Reveal server | `await RdashDocument.load("Sales")` | Yes |
| The dashboard currently in a `RevealView` | `await RdashDocument.load(view.dashboard)` | Yes |

Loading from the live view picks up the user's unsaved edits. Use it to post-process a dashboard in `onSave` before it is stored.

## Validation

`toJsonString()`, `toJson()` and `toBlob()` run `validate()` first. It throws when a visualization has no data source item or an item has no `fields`. It does **not** check that bound field names exist. Copy [`src/lib/guard.ts`](../assets/dom-ts/src/lib/guard.ts) and call `assertBoundFieldsExist(doc.toJson())` before every save (`saveRdash` in `src/lib/rdash-file.ts` does). It works on the serialized form, so it also checks dashboards made by the .NET DOM or the editor.

It checks visualization bindings and dashboard filter bindings. Tested against typos in chart values, grid columns, KPI dates and a date filter left on its default `"Date"` field (all caught), and against 55 dashboards authored in the Reveal editor, including calculated fields (no false positives). The guard catches what the DOM lets through, and rendering in [assets/preview](../assets/preview/README.md) catches the rest: Reveal reports `no such column: <name>` for a field the data doesn't have.
