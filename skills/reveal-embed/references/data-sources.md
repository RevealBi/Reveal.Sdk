# Data sources

Source: https://help.revealbi.io/web/datasources and the `adding-data-sources/*` topics.

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

Referencing the package without the `RegisterXxx()` call fails with "The data source is of an unknown type". On Node and Java, follow the data source's own docs topic for what to install.

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

        if (dataSourceItem is RVSqlServerDataSourceItem item && item.Id == "Orders")
        {
            item.Table = "Orders";
        }
        return dataSourceItem;
    }
}
```

Providers registered with `AddDataSourceProvider<T>()` are created by DI, so constructor-inject configuration and services. On Node the same logic is two functions, `dataSourceProvider` and `dataSourceItemProvider`. On Java it is `changeDataSource` and `changeDataSourceItem`.

**Always update the underlying data source inside `ChangeDataSourceItemAsync`.** This is the most common provider bug: the host is set in `ChangeDataSourceAsync`, but the item's query still goes to the old host. Typical symptom: database widgets fail with an authentication or connection error naming the app's own user (for Postgres, `28P01: password authentication failed for user "<app user>"`), because the app's credentials are sent to the host stored in the dashboard. It looks like a credentials bug; it is a redirect bug (verified on Node 2.2.1).

### Matching items: ids vs tables

Match on `item.Id` only for items your own app defines in `onDataSourcesRequested`, where you chose the ids. A dashboard built in Reveal BI, by an analyst, or generated with the DOM stores **generated GUIDs** as item ids, and the same table can appear under several ids. For those, key on what the item points at (`Table`, plus `Schema` or `Database` if relevant) through an allow-list, and replace it with the server's own query:

```js
// Node
const TENANT_QUERIES = {
  orders: "SELECT id, tenant_id, order_date, status, total_amount FROM orders WHERE tenant_id = @tenant_id",
};

const dataSourceItemProvider = async (userContext, item) => {
  if (item instanceof RVPostgresDataSourceItem) {
    await dataSourceProvider(userContext, item.dataSource);     // redirect the item's own data source
    const query = TENANT_QUERIES[item.table];
    // Unknown table: keep it on our database with a query that returns nothing (see below).
    item.customQuery = query ?? "SELECT NULL::int AS id WHERE false";
    item.customQueryParameters = query ? { "@tenant_id": tenantIdFrom(userContext) } : {};
    item.processDataOnServer = true;
    return item;
  }
  // There is no safe default here: returning null (or throwing) runs the client's item
  // unchanged, with whatever host, URL or file path it names (see below). Add a branch like
  // the one above for every connector type the app enables (REST: overwrite the URL from
  // server config; files: resolve the URI from an allow-list), and enable no others.
  console.error(`Unhandled data source item type: ${item.constructor.name}`);
  return null;
};
```

Open the `.rdash` (a zip with `Dashboard.json`) to see which tables and data source ids it uses before writing the allow-list.

### Rejecting an item does not stop the query

Returning `null` from the item provider, or throwing, does **not** block the request (verified on Node 2.2.1). Reveal then runs the item exactly as the client sent it, with the client-supplied host, port and database, discards your changes to `item.dataSource`, and asks the authentication provider for credentials for that host. A request can name any host. So:

- **Credentials only for your own database.** In the authentication provider, return a credential only when the data source's host, port and database equal your configured values; otherwise return `null`. This is the control that keeps the password from going to a host named in a request.
- **Do not reject database items with `null`.** Redirect them to your database and give unknown ones a query that returns no rows, as above.
- Always overwrite host, port and database in the data source provider for your connector type, never only for known ids.
- **Handle every connector type you enable.** A fallthrough `null` is not a fail-closed default: a REST or local-file item that reaches it keeps the URL or path the client chose. Give each enabled type its own branch that overwrites the location with a server-controlled value, and do not register connectors the app does not use.

### Per-tenant or per-user databases

Branch on `userContext` in `ChangeDataSourceAsync`: look up the tenant's host/database from the user context's tenant id. Never take the host or database name from a client header directly. See user-context-security.md.

## Credentials

Credentials come from an `IRVAuthenticationProvider`, never the client:

```cs
public class AuthenticationProvider : IRVAuthenticationProvider
{
    public Task<IRVDataSourceCredential> ResolveCredentialsAsync(IRVUserContext userContext, RVDashboardDataSource dataSource)
    {
        IRVDataSourceCredential credential = dataSource switch
        {
            // Only for our own server: a request can name any host (see "Rejecting an item" above).
            RVSqlServerDataSource sql when IsOurDatabase(sql) => new RVUsernamePasswordDataSourceCredential(user, password), // optional third arg: domain
            RVRESTDataSource      => new RVBearerTokenDataSourceCredential(token, userId),
            _ => null
        };
        return Task.FromResult(credential);
    }
}
```

- `RVIntegratedAuthenticationCredential` uses the server process's Windows identity (useful for LocalDB and Windows auth).
- Microsoft Entra ID: acquire a token with MSAL and return it as `RVBearerTokenDataSourceCredential`.
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

**Parameter keys include the `@`**, exactly as written in the query: `{ "@tenantId": 5 }`, not `{ tenantId: 5 }`. Without it the widget fails with `Missing value for custom query parameter: @tenantId`. Reveal returns that error as HTTP 200 with an `error` object in the body, so check response bodies, not status codes (verified on Node 2.2.1, Postgres). Node property names are camelCase: `item.customQuery`, `item.customQueryParameters`.

`CustomQueryParameters` is supported on SQL Server, Azure SQL, Synapse, PostgreSQL, MySQL, MariaDB (not on Java), Snowflake, BigQuery, Databricks, Athena, Redshift, ClickHouse and Elasticsearch. DuckDB, SQLite and Oracle support `CustomQuery` but **not** parameters; there, validate and whitelist any value before it reaches the query, or use a view per case.

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
    && fileItem.ResourceItem is RVLocalFileDataSourceItem local
    && AllowedFiles.Contains(dataSourceItem.Id))
{
    local.Uri = $"local:/{dataSourceItem.Id}";
}
```

On the client, build an `RVLocalFileDataSourceItem` and wrap it in `RVExcelDataSourceItem` / `RVCsvDataSourceItem` / `RVJsonDataSourceItem`. Keep an explicit allow-list of file names; a URI built from an unchecked client id is a path traversal. CSV items assume a comma separator. Local files are processed in memory unless `NewLocalProcessingEnabled` is on, which is required for grid paging over files.

## In-memory data

When the data already lives in the app (an ORM, a service call), implement `IRVDataProvider` and return objects for an `RVInMemoryDataSourceItem`. Docs topic: `adding-data-sources/in-memory-data`.

## Hiding sources per user

`IRVObjectFilter.Filter(userContext, dataSourceItem)` returns false to hide an item from that user's data source list. This hides items in the editor's list only. It does not stop a dashboard that already references the item, so enforce access in the data source provider too.

## Data model (beta)

`IRVDataModelProvider` relabels fields and adds calculated fields and measures server-side, so business definitions live in code. Docs topic: `beta-features`.

## Caching

Query results are cached on the server; the default refresh is once a day and is set per data source in the UI ("Always" effectively bypasses the cache). Redis is supported for multi-instance deployments. Docs topic: `caching`. If "my data does not update", check this first.
