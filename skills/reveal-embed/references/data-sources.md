# Data sources

Source: https://help.revealbi.io/web/datasources/ and the `adding-data-sources/*` topics.

Two concepts:

- **Data source**: where data comes from (a SQL Server, a REST endpoint).
- **Data source item**: one thing inside it (a table, view, stored procedure, custom query, sheet, endpoint).

A dashboard stores the data source and item it was built on. At query time, the server's data source provider gets each one and can change it. That is how one dashboard can point at a different database per environment or per tenant.

## Pick the connector

| Source | Package (ASP.NET) |
| --- | --- |
| Microsoft SQL Server, Azure SQL | `Reveal.Sdk.Data.Microsoft.SqlServer` |
| Azure Synapse | `Reveal.Sdk.Data.Microsoft.SynapseAnalytics` |
| Analysis Services (on-prem or Azure) | `Reveal.Sdk.Data.Microsoft.AnalysisServices` |
| PostgreSQL | `Reveal.Sdk.Data.PostgreSQL` |
| MySQL / MariaDB | `Reveal.Sdk.Data.MySql` / `Reveal.Sdk.Data.MariaDB` |
| Oracle | `Reveal.Sdk.Data.Oracle` |
| SQLite / DuckDB | `Reveal.Sdk.Data.SQLite` / `Reveal.Sdk.Data.DuckDB` |
| Snowflake, Databricks, ClickHouse, Cube | `Reveal.Sdk.Data.Snowflake`, `.Databricks`, `.ClickHouse`, `.Cube` |
| Google BigQuery / Google Sheets | `Reveal.Sdk.Data.Google.BigQuery` / `Reveal.Sdk.Data.Google.Drive` |
| Amazon Athena, Redshift, S3 | `Reveal.Sdk.Data.Amazon.Athena`, `.Redshift`, `.S3` |
| MongoDB, Elasticsearch, Cosmos DB | `Reveal.Sdk.Data.MongoDb`, `.Elasticsearch`, `.AzureCosmosDB` |
| CSV, TSV, Excel, JSON, REST, OData, In-Memory | Included in the core SDK |

On ASP.NET, a separate connector package must be **installed and registered**:

```cs
builder.Services.AddControllers().AddReveal(b =>
{
    b.DataSources.RegisterMicrosoftSqlServer();   // RegisterXxx naming for each connector
});
```

Referencing the package without the `RegisterXxx()` call fails with "The data source is of an unknown type". On Node and Java there is nothing to install or register: the connectors come with the engine, so the item provider's default deny (below) is what covers the types the app does not use.

## Server-side resolution (the recommended pattern)

The client describes data sources by **id and title only**. The server fills in everything else. This keeps hosts, databases and credentials out of the browser, and lets you vary them per user.

Client, offered in the editor's "Select a Data Source" dialog:

```js
revealView.onDataSourcesRequested = (callback) => {
    const ds = new RVSqlServerDataSource();
    ds.id = "SalesDb";
    ds.title = "Sales";

    const orders = new RVSqlServerDataSourceItem(ds);
    orders.id = "Orders";
    orders.title = "Orders";

    // third argument false: show only these, not the ones stored in the dashboard
    callback(new RevealDataSources([ds], [orders], false));
};
```

Server (ASP.NET):

```cs
public class DataSourceProvider : IRVDataSourceProvider
{
    // Server-side allow-list: item id -> the query the server runs for it.
    private static readonly Dictionary<string, string> SqlItems = new()
    {
        ["Orders"] = "SELECT * FROM Orders",
    };
    private const string NoRows = "SELECT 1 AS Empty WHERE 1 = 0";

    private readonly IConfiguration _config;
    public DataSourceProvider(IConfiguration config) => _config = config;

    public Task<RVDashboardDataSource> ChangeDataSourceAsync(IRVUserContext userContext, RVDashboardDataSource dataSource)
    {
        if (dataSource is RVSqlServerDataSource sql)
        {
            sql.Host = _config["Reveal:Sql:Host"];
            sql.Database = _config["Reveal:Sql:Database"];
        }
        return Task.FromResult(dataSource);
    }

    public async Task<RVDataSourceItem> ChangeDataSourceItemAsync(IRVUserContext userContext, string dashboardId, RVDataSourceItem dataSourceItem)
    {
        // Required: changes made in ChangeDataSourceAsync do not carry over to the item's own data source.
        await ChangeDataSourceAsync(userContext, dataSourceItem.DataSource);

        // Handle every SQL Server item, not only known ids: the client can send any table,
        // procedure or custom query, and it would run with the app's credentials.
        if (dataSourceItem is RVSqlServerDataSourceItem item)
        {
            item.Table = null;
            item.Procedure = null;
            item.CustomQuery = SqlItems.TryGetValue(item.Id ?? "", out var query) ? query : NoRows;
            item.CustomQueryParameters = new Dictionary<string, object>();
        }
        // Add a branch like this for every other connector type the app enables (see below).
        // Default deny: refuse every other type. On ASP.NET throwing fails the widget (null
        // would run the item as sent); the message reaches the browser, so keep it generic.
        else if (dataSourceItem is not RVInMemoryDataSourceItem)
        {
            throw new InvalidOperationException("Data source not allowed");
        }
        return dataSourceItem;
    }
}
```

Providers registered with `AddDataSourceProvider<T>()` are created by DI, so constructor-inject configuration and services. On Node the same logic is two functions, `dataSourceProvider` and `dataSourceItemProvider`. On Java it is `changeDataSource` and `changeDataSourceItem`.

**Always update the underlying data source inside `ChangeDataSourceItemAsync`.** This is the most common provider bug: the host is set in `ChangeDataSourceAsync`, but the item's query still goes to the old host. Typical symptom: database widgets fail with an authentication or connection error naming the app's own user (for Postgres, `28P01: password authentication failed for user "<app user>"`), because the app's credentials are sent to the host stored in the dashboard. It looks like a credentials bug; it is a redirect bug (verified on Node 2.2.1).

### Matching items: ids vs tables

Use `item.Id` as a lookup key only for items whose ids your app chose: those defined in `onDataSourcesRequested`, or set explicitly (`item.id = "Orders"`) when generating a dashboard with the Reveal DOM. Treat every incoming id as client-controlled: a stable id is not authorization, so verify that `userContext` may access the mapped item and replace it with the server's own query and source details. A dashboard built in Reveal BI, by an analyst, or generated with the DOM without explicit ids stores **generated GUIDs** as item ids, and the same table can appear under several ids. For those, key on what the item points at (`Table`, plus `Schema` or `Database` if relevant) through an allow-list, authorize the mapped item, and replace it with the server's own query:

```js
// Node
const TENANT_QUERIES = {
  orders: "SELECT id, tenant_id, order_date, status, total_amount FROM orders WHERE tenant_id = @tenant_id",
};

const dataSourceItemProvider = async (userContext, item) => {
  if (item instanceof RVPostgresDataSourceItem) {
    await dataSourceProvider(userContext, item.dataSource);     // redirect the item's own data source
    const query = item.table ? TENANT_QUERIES[item.table] : undefined; // table is nullable (strict TS)
    // Unknown table: keep it on our database with a query that returns nothing (see below).
    item.table = null;
    item.procedure = null;
    item.functionName = null;
    item.customQuery = query ?? "SELECT NULL::int AS id WHERE false";
    item.customQueryParameters = query ? { "@tenant_id": tenantIdFrom(userContext) } : {};
    item.processDataOnServer = true;
    return item;
  }
  // Default deny: returning null (or, on Node, throwing) runs the client's item unchanged,
  // with whatever host, URL or file path it names (see below). Add a branch like the one
  // above for every connector type the app enables (REST: overwrite the URL from server
  // config; files: resolve the URI from an allow-list), and neutralize everything else.
  console.warn(`Blocked data source item type: ${item.constructor.name}`);
  neutralize(item); // overwrite url/host/uri/database, no-rows query: see assets/node-minimal/main.js
  return item;
};
```

Open the `.rdash` (a zip with `Dashboard.json`) to see which tables and data source ids it uses before writing the allow-list.

A no-rows query that does not have the item's columns makes the widget show an error such as `42703: column "tenant_id" does not exist` (Postgres) instead of an empty result. That is still safe; to show an empty widget instead, select the item's columns with `WHERE 1 = 0`. On Node also clear `procedure` and `functionName` on the item.

### Rejecting an item does not stop the query

Returning `null` from the item provider does **not** block the request (verified on Node and ASP.NET 2.2.1). Reveal then runs the item exactly as the client sent it, with the client-supplied host, port and database, discards your changes to `item.dataSource`, and asks the authentication provider for credentials for that host. A request can name any host. Throwing differs per platform: on **Node** the exception is logged and the item also runs as sent; on **ASP.NET** and **Java** the widget fails (verified on 2.2.1), but the exception message reaches the browser, so throw a generic one: never put paths, hosts or SQL in it. The safe pattern on every platform is the same: **redirect unknown items to your own database with a query that returns no rows, or overwrite their location with one that cannot resolve; never return `null`, and on Node never throw.** So:

- **Credentials only for your own database or API.** In the authentication provider, return a credential only when the data source's host, port and database (or, for REST, the URL's scheme, host and port) equal your configured values; otherwise return `null`. This is the control that keeps a password or bearer token from going to a host named in a request.
- **Do not reject database items with `null`.** Redirect them to your database and give unknown ones a query that returns no rows, as above.
- Always overwrite host, port and database in the data source provider for your connector type, never only for known ids.
- **Handle every connector type, including the ones you do not use.** A fallthrough `null` is not a fail-closed default: an item that reaches it keeps the URL, host or path the client chose. Give each enabled type its own branch that overwrites the location with a server-controlled value, and neutralize every other type in a default branch. On ASP.NET, also do not register connectors the app does not use. On **Node and Java** the connectors come with the engine, so the default branch is what covers the types the app does not use.
- **A credential check is not a substitute.** Items and data sources arrive from the client: for every connector type you do not explicitly handle, overwrite its url, host, path, file and database locations (and give it a query that returns no rows) in the item provider instead of returning `null`. Checking the host in the authentication provider does not replace that.

### Per-tenant or per-user databases

Branch on `userContext` in `ChangeDataSourceAsync`: look up the tenant's host/database from the user context's tenant id. Never take the host or database name from a client header directly. See user-context-security.md.

## Credentials

Credentials come from an `IRVAuthenticationProvider`, never the client. Decide from the data source, not the user: `userContext` can be `null` here (see user-context-security.md, "A null user context"):

```cs
public class AuthenticationProvider : IRVAuthenticationProvider
{
    public Task<IRVDataSourceCredential> ResolveCredentialsAsync(IRVUserContext userContext, RVDashboardDataSource dataSource)
    {
        IRVDataSourceCredential credential = dataSource switch
        {
            // Only for our own server: a request can name any host (see "Rejecting an item" above).
            RVSqlServerDataSource sql when IsOurDatabase(sql) => new RVUsernamePasswordDataSourceCredential(user, password), // optional third arg: domain
            // Same for tokens: the URL is the client's unless the data source provider overwrote it.
            RVRESTDataSource rest when IsOurApi(rest)         => new RVBearerTokenDataSourceCredential(token, userId),
            _ => null
        };
        return Task.FromResult(credential);
    }
}
```

- `RVIntegratedAuthenticationCredential` uses the server process's Windows identity (useful for LocalDB and Windows auth).
- Microsoft Entra ID and Azure Managed Identity (Azure SQL): get an access token for the scope `https://database.windows.net/.default` and return it as `RVBearerTokenDataSourceCredential(token, accountName)`, only for your own server. The docs' `authentication` topic acquires the token with MSAL (client credentials); with a managed identity, take it from `Azure.Identity` instead (pattern below, not tested here; the Reveal docs do not cover managed identity). Register the `TokenCredential` once (singleton) so it caches and refreshes the token, and create the database user for the identity (`CREATE USER [<identity name>] FROM EXTERNAL PROVIDER`):
  ```cs
  // using Azure.Core; using Azure.Identity;  _tokenCredential = new ManagedIdentityCredential() (or DefaultAzureCredential)
  public async Task<IRVDataSourceCredential> ResolveCredentialsAsync(IRVUserContext userContext, RVDashboardDataSource dataSource)
  {
      if (dataSource is not RVSqlServerDataSource sql || !IsOurDatabase(sql)) return null;
      var token = await _tokenCredential.GetTokenAsync(
          new TokenRequestContext(new[] { "https://database.windows.net/.default" }), CancellationToken.None);
      return new RVBearerTokenDataSourceCredential(token.Token, _identityName);
  }
  ```
- Key-pair (Snowflake) and AWS credentials have their own classes. See the docs topic `authentication`.
- Read secrets from the app's secret store or configuration, not literals.

## Custom queries and stored procedures

Set them on the item in `ChangeDataSourceItemAsync`. Parameterize:

```cs
item.CustomQuery = "SELECT * FROM Sales.Orders WHERE TenantId = @tenantId";
item.CustomQueryParameters = new Dictionary<string, object> { ["@tenantId"] = tenantId };

// or a stored procedure
item.Procedure = "OrdersByCustomer";
item.ProcedureParameters = new Dictionary<string, object> { ["@CustomerID"] = customerId };
```

**Parameter keys include the `@`**, exactly as written in the query: `{ "@tenantId": 5 }`, not `{ tenantId: 5 }`. Without it the widget fails with `Failed to generate SQL query: Missing value for custom query parameter: @tenantId` when the parameters are set in the item provider; if the query and parameters are stored in the dashboard instead, a mismatch may surface as `Failed to generate SQL query: Object reference not set to an instance of an object`. Reveal returns that error as HTTP 200 with an `error` object in the body, so check response bodies, not status codes (verified on Node 2.2.1, Postgres). Node property names are camelCase: `item.customQuery`, `item.customQueryParameters`.

`CustomQueryParameters` is supported on SQL Server, Azure SQL, Synapse, PostgreSQL, MySQL, MariaDB, Oracle (not on Java), SQLite, DuckDB, Snowflake, BigQuery, Databricks, Athena, Redshift, ClickHouse and Elasticsearch (docs topic `custom-queries`). Use parameters instead of putting values into the query text. On Java the Oracle item has `setCustomQuery` but no `setCustomQueryParameters`, and there are no MariaDB classes: for Oracle on Java, validate and allow-list any value before it reaches the query, or use a view per case.

Grid paging is disabled when the item is a stored procedure.

## Server-side processing

Database items have `ProcessDataOnServer`. When true, aggregation, filtering and paging run as queries in the database instead of pulling the table into Reveal. Grid paging requires it. Turn it on for large tables:

```cs
item.ProcessDataOnServer = true;
```

## Files: Excel, CSV, JSON

File-based items wrap a resource item that holds the file location. A `local:/<file>` URI resolves against a `Data` folder in the server's working directory by default on ASP.NET, and `C:\Reveal\Files` on Node (both verified on 2.2.1). Set `LocalFileStoragePath` (ASP.NET) or the `localFileStoragePath` option (Node) explicitly. Resolve the URI in the provider so the client never chooses a path:

```cs
// settings.LocalFileStoragePath = "Data";
if (dataSourceItem is RVResourceBasedDataSourceItem fileItem
    && fileItem.ResourceItem is RVLocalFileDataSourceItem local)
{
    // Overwrite in both cases: leaving an unknown id alone keeps the client's path.
    local.Uri = AllowedFiles.Contains(dataSourceItem.Id)
        ? $"local:/{dataSourceItem.Id}"
        : "local:/blocked-by-server";
}
```

On the client, build an `RVLocalFileDataSourceItem` and wrap it in `RVExcelDataSourceItem` / `RVCsvDataSourceItem` / `RVJsonDataSourceItem`. Keep an explicit allow-list of file names; a URI built from an unchecked client id is a path traversal. The CSV separator is auto-detected (a semicolon file loaded without settings); set `separator` on the CSV item to force one. A widget whose file is blocked or missing shows an error that may include the server's absolute data path, so do not treat paths under `localFileStoragePath` as secret. Local files are processed in memory unless `NewLocalProcessingEnabled` is on, which is required for grid paging over files.

## In-memory data

When the data already lives in the app (an ORM, a service call), implement `IRVDataProvider` and return objects for an `RVInMemoryDataSourceItem`. Docs topic: `adding-data-sources/in-memory-data`.

## Hiding sources per user

`IRVObjectFilter.Filter(userContext, dataSourceItem)` returns false to hide an item from that user's data source list. This hides items in the editor's list only. It does not stop a dashboard that already references the item, so enforce access in the data source provider too.

## Data model (beta)

`IRVDataModelProvider` relabels fields and adds calculated fields and measures server-side, so business definitions live in code. Docs topic: `beta-features`.

## Caching

Query results are cached on the server; the default refresh is once a day and is set per data source in the UI ("Always" effectively bypasses the cache). Redis is supported for multi-instance deployments. Docs topic: `caching`. If "my data does not update", check this first.
