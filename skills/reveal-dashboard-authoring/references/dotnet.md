# Reveal.Sdk.Dom (.NET)

Source: https://github.com/RevealBi/Reveal.Sdk.Dom, NuGet `Reveal.Sdk.Dom` (prerelease only; targets .NET Framework 4.6.2 and .NET 6 through 9). It does not reference the Reveal SDK, so it runs in a console tool, a build step, a test or inside the ASP.NET app.

```bash
dotnet add package Reveal.Sdk.Dom --prerelease
```

In a `.csproj`, `<PackageReference Include="Reveal.Sdk.Dom" Version="*-*" />` always restores the latest prerelease. In a .NET 10 file-based script, use `#:package Reveal.Sdk.Dom@*-*`; a single-file script can't include `Guard.cs`, so paste the `Guard` class at the end of the script, move its `using` lines to the top and drop its `namespace DomSamples;` line (otherwise error CS8956; tested with the .NET 10 SDK). Namespaces: `Reveal.Sdk.Dom`, `.Data`, `.Filters`, `.Visualizations`, `.Visualizations.Settings` (the `*Settings` types).

A runnable project with create, edit and database-connector examples, the guard, tests, an API browser, a round-trip command and a bulk-migration runner is in [assets/dom-dotnet](../assets/dom-dotnet/README.md) (`dotnet run -- test`). Read the installed API with `dotnet run -- api` (every type by namespace), `dotnet run -- api ColumnChartVisualization` (constructors, properties, methods and the extension methods that apply, such as `SetLabel` and `ConnectDashboardFilter`) or `dotnet run -- api DateFilterRule`; don't write members from memory.

## Create a dashboard

Compiled and run against the latest prerelease; the output loads in a Reveal 2.2.1 server.

```cs
using Reveal.Sdk.Dom;
using Reveal.Sdk.Dom.Data;
using Reveal.Sdk.Dom.Filters;
using Reveal.Sdk.Dom.Visualizations;

// Host/database are placeholders the server's data source provider overwrites; no credentials here.
var ds = new MicrosoftSqlServerDataSource { Id = "SalesDb", Title = "Sales DB" };
var orders = new MicrosoftSqlServerDataSourceItem("Orders", "orders", ds)   // title, table, data source
{
    Id = "Orders",
    Fields = new List<IField>   // every field any visualization binds, exact names and types
    {
        new NumberField("id"), new TextField("region"), new DateField("order_date"), new NumberField("total_amount"),
    },
};

var document = new RdashDocument("Sales");
var orderDate = new DashboardDateFilter("Order date", DateFilterRule.Last(12, PeriodType.Month));
var region = new DashboardDataFilter("region", orders);
document.Filters.Add(orderDate);
document.Filters.Add(region);

document.Visualizations.Add(new ColumnChartVisualization("Revenue by month", orders)
    .SetLabel(new DateDataField("order_date") { AggregationType = DateAggregationType.Month })
    .SetValues(new NumberDataField("total_amount") { FieldLabel = "Revenue" })
    .ConnectDashboardFilter(orderDate, "order_date")
    .ConnectDashboardFilter(region));
document.Visualizations.Add(new KpiTimeVisualization("Revenue", orders).SetDate("order_date").SetValue("total_amount"));
document.Visualizations.Add(new PivotVisualization("By region", orders).SetRows("region").SetValues("total_amount"));
document.Visualizations.Add(new GridVisualization("Orders", orders).SetColumns("id", "region", "order_date", "total_amount"));

document.Save("Dashboards/Sales.rdash");   // a new file; see "Deliver it" before overwriting one
```

The fluent setters, visualization classes and data source classes mirror the TypeScript library in PascalCase (see visualizations.md). For joins between items, use `item.Join(alias, leftField, rightField, otherItem)` and bind the joined columns as `"<alias>.<field>"`. Joins are .NET only: the TypeScript library has no join API.

### Data source classes

Mostly the TypeScript names in PascalCase, with these differences (Reveal.Sdk.Dom 0.1.688-beta): `PostgreSQLDataSource` and `MongoDBDataSource` (TS: `PostgreSql`, `MongoDb`); `Port` is an `int`; there are no classes for Amazon S3, Azure Analysis Services, OData or a REST/web-service data source (use `new DataSource { Id = ..., Title = ... }` for REST); local Excel files have `ExcelFileDataSourceItem(title, path, sheet)` (pass the path without `local:`, the class adds it).

| Connector | Item constructors | Item properties | `Provider` |
| --- | --- | --- | --- |
| SQL Server | `(title, table, MicrosoftSqlServerDataSource)`, `(title, MicrosoftSqlServerDataSource)`, `(title, DataSource)` | `Table`, `Database`, `Procedure`, `ProcessDataOnServer` (no `Schema`) | `SQLSERVER` |
| Azure SQL, Synapse | `(title)`, `(title, ds)` | as SQL Server | `AZURE_SQL`, `AZURE_SYNAPSE` |
| PostgreSQL | `(title, table, ds)`, `(title, ds)` | `Table`, `Schema`, `FunctionName`, `ProcessDataOnServer` | `POSTGRES` |
| MySQL | `(title, MySqlDataSource)`, `(title, DataSource)` (the `(title, table, ...)` overload wrongly takes a `MicrosoftSqlServerDataSource`) | `Table`, `Procedure`, `ProcessDataOnServer` | `MYSQL` |
| Oracle | `(title, ds)` | `Table`, `Database`, `Procedure` | `ORACLE` |
| Snowflake | `(title, ds)` | `Table`, `Schema`, `ProcessDataOnServer` | `SNOWFLAKE` |
| Redshift | `(title)`, `(title, ds)` | `Table`, `Schema`, `FunctionName` | `AMAZON_REDSHIFT` |
| Athena | `(title, ds)` | `Table` | `AMAZON_ATHENA` |
| BigQuery | `(title)`, `(title, ds)` | `DataSetId`, `ProjectId`, `Table` | `BIG_QUERY` |
| Google Sheets | `(title, identifier)`, `(title, ds)` | `Identifier`, `Sheet`, `NamedRange`, `FirstRowContainsLabels` | `GOOGLESHEETLOCALFILEPROVIDER` |
| MongoDB | `(title, ds)` | `Collection`, `ProcessDataOnServer` | `MONGODB` |
| REST | `(title, url, ds)` and others | `Url`, `IsAnonymous`, `.WithCsv()`, `.WithExcel(sheet)` | `REST` |
| Web service | `(title, url, ds)` and others | `Url`, `IsAnonymous` | `WEBSERVICE` |
| Analysis Services | `(title, ds)` | `Catalog`, `Cube` (XMLA visualizations only; the data source is not written into the file) | `ANALYSISSERVICES` |

Oracle by service name writes `Service`, but Reveal reads `SERVICE_NAME` (found by reading the Reveal source). Setting `ds.Properties["SERVICE_NAME"] = "..."` may work around it (not rendered against an Oracle server); check in the app.

## Date filters

Recent prereleases replaced the old `DateRuleType` / `RuleType` / `CustomDateRange` / `IncludeToday` creation API with `DateFilterRule`:

```cs
new DashboardDateFilter("Sales date", DateFilterRule.Last(90, PeriodType.Day, includeToday: false));
filter.Rule = DateFilterRule.This(PeriodType.Quarter);
new DashboardDateFilter(DateFilterRule.Custom(new DateTime(2026, 1, 1), new DateTime(2026, 3, 31)));   // Unspecified or Utc kind: DateTime.Today is Local and shifts the range a day early east of UTC
visualization.AddDataFilter("OrderDate", new DateTimeFilter(DateFilterRule.Next(7, PeriodType.Day)));
```

`Last` is a rolling window, `Previous` means whole preceding periods, `This` is the current period in full, `ToDate` runs from the start of the period to today, and `DateFilterRule.AllTime` removes the restriction. New documents give every date filter its own GUID. Connect visualizations with `ConnectDashboardFilter(dateFilter, "<date field>")` so the binding carries that id. Dashboard links between date filters take both filters: `new DateLinkFilter(sourceDate, targetDate)`. The [Reveal.Sdk.Dom README](https://github.com/RevealBi/Reveal.Sdk.Dom#readme) documents the tested Reveal SDK baseline (2.2.1 at the time of writing). Older SDKs, such as 1.7.3, rewrite date filter ids. These rules were rendered against dated data in Reveal 2.2.1 and filtered as described.

The TypeScript library still uses the older `DashboardDateFilter.ruleType` / `customDateRange` properties, and doesn't model relative rules: `Last`, `Previous`, `This`, `ToDate` and `Next` are written as a `CustomRule`, which a TypeScript round trip drops, after which Reveal can't open the dashboard (editing.md). Don't hand a .NET dashboard with such rules to TypeScript code that saves it.

## Deliver it

| Target | Code |
| --- | --- |
| File | `document.Save(path)`, and later `RdashDocument.Load(path)`. Over an existing file, save to a temp file and move it over (`File.Move(tmp, path, overwrite: true)`): `Save` over a larger file leaves a corrupt zip (stale tail) that Reveal reads but strict zip readers reject. The workspace's `Examples.Save` (guard + `Workspace.WriteRdash`) does this |
| ASP.NET `IRVDashboardProvider` | `return Dashboard.FromJsonString(document.ToJsonString());` |
| Database column | `document.ToJsonString()`, and later `RdashDocument.LoadFromJson(json)` |
| Stream (blob storage, HTTP upload) | `RdashDocument.Load(stream)` to read; to write, use `Dashboard.FromJsonString(json).ToStream()` from the Reveal SDK, or `Save` to a temp file (no `Save(Stream)`: [#439](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/439)) |
| WPF `RevealView` | `view.Dashboard = await RVDashboard.LoadFromJsonAsync(document.ToJsonString());` Compiles only for `net48` (x64) against `Reveal.Sdk.Wpf` 1.8.4, the latest on NuGet; not on `net8.0-windows`. `Guard.cs` on .NET Framework needs the `System.Text.Json` package |

A provider that builds per-tenant dashboards from a template:

```cs
public async Task<Dashboard> GetDashboardAsync(IRVUserContext userContext, string dashboardId)
{
    if (!ValidId.IsMatch(dashboardId)) throw new ArgumentException("Invalid dashboard id.");
    if (dashboardId == "TenantOverview")
        return Dashboard.FromJsonString(TenantOverview.Build(TenantOf(userContext)).ToJsonString());
    return await LoadStoredAsync(userContext, dashboardId);
}
```

`TenantOf` should read the tenant from `userContext.Properties`, set by the server's user-context provider, never from the request. The template is not isolation (users can change dashboard filters): restrict the rows in the data source provider too (`reveal-embed`).

## Validation

`ToJsonString()` and `Save()` validate first, which catches a visualization with no data source item and an item with no fields. Bound field names are **not** checked. Copy [`Guard.cs`](../assets/dom-dotnet/Guard.cs) and call `Guard.AssertBoundFieldsExist(document.ToJsonString())` before every save (`Examples.Save` does). It also checks dashboard filter fields, date columns bound by name as a label or row, link parameters and filter binding targets, the same rules as the TypeScript guard (typescript.md, Validation, including the strict `"_date"` rule). When you edit a loaded dashboard, pass the original JSON as `baselineJson` so only the problems your change adds fail. On a file: `dotnet run -- guard <file.rdash> [<original.rdash>]`. Then render the file with [assets/preview](../assets/preview/README.md).

To load and save an editor-made dashboard, use `dotnet run -- roundtrip <in.rdash> <out.rdash>`: it never writes the input, runs the guard against the original, prints what was lost (the TypeScript `losscheck` rules, ported) and refuses to write when a user-visible setting would be lost; `--allow-loss` writes it anyway, after you have told the user. `dotnet run -- migrate <folder>` does the same for a folder with your change from `Migration.cs` (editing.md, Bulk migrations).

A .NET load + save of an editor dashboard rewrites its id-less date binding to `"_date"` while the date filter keeps its GUID (seen on `Sales.rdash`; the TypeScript library does the same). The guard flags it, so `roundtrip` and `migrate` refuse those files, `--allow-loss` included. Whether Reveal still applies the date filter there is not verified (typescript.md, Validation).
