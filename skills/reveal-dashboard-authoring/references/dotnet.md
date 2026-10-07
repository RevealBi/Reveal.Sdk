# Reveal.Sdk.Dom (.NET)

Source: https://github.com/RevealBi/Reveal.Sdk.Dom, NuGet `Reveal.Sdk.Dom` (prerelease only; targets .NET Framework 4.6.2 and .NET 6 through 9). It does not reference the Reveal SDK, so it runs in a console tool, a build step, a test or inside the ASP.NET app.

```bash
dotnet add package Reveal.Sdk.Dom --prerelease
```

In a `.csproj`, `<PackageReference Include="Reveal.Sdk.Dom" Version="*-*" />` always restores the latest prerelease. In a .NET 10 file-based script, use `#:package Reveal.Sdk.Dom@*-*`. Namespaces: `Reveal.Sdk.Dom`, `.Data`, `.Filters`, `.Visualizations`.

A runnable project with create, edit and database-connector examples, the field guard and tests is in [assets/dom-dotnet](../assets/dom-dotnet/README.md) (`dotnet run -- test`).

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

document.Save("Dashboards/Sales.rdash");
```

The fluent setters, visualization classes and data source classes mirror the TypeScript library in PascalCase (see visualizations.md). For joins between items, use `item.Join(alias, leftField, rightField, otherItem)` and bind the joined columns as `"<alias>.<field>"`.

## Date filters

Recent prereleases replaced the old `DateRuleType` / `RuleType` / `CustomDateRange` / `IncludeToday` creation API with `DateFilterRule`:

```cs
new DashboardDateFilter("Sales date", DateFilterRule.Last(90, PeriodType.Day, includeToday: false));
filter.Rule = DateFilterRule.This(PeriodType.Quarter);
new DashboardDateFilter(DateFilterRule.Custom(new DateTime(2026, 1, 1), new DateTime(2026, 3, 31)));
visualization.AddDataFilter("OrderDate", new DateTimeFilter(DateFilterRule.Next(7, PeriodType.Day)));
```

`Last` is a rolling window, `Previous` means whole preceding periods, `This` is the current period in full, `ToDate` runs from the start of the period to today, and `DateFilterRule.AllTime` removes the restriction. New documents give every date filter its own GUID. Connect visualizations with `ConnectDashboardFilter(dateFilter, "<date field>")` so the binding carries that id. Dashboard links between date filters take both filters: `new DateLinkFilter(sourceDate, targetDate)`. The repo README documents the tested Reveal SDK baseline (2.2.1 at the time of writing). Older SDKs, such as 1.7.3, rewrite date filter ids.

The TypeScript library still uses the older `DashboardDateFilter.ruleType` / `customDateRange` properties.

## Deliver it

| Target | Code |
| --- | --- |
| File | `document.Save(path)`, and later `RdashDocument.Load(path)` |
| ASP.NET `IRVDashboardProvider` | `return Dashboard.FromJsonString(document.ToJsonString());` |
| Database column | `document.ToJsonString()`, and later `RdashDocument.LoadFromJson(json)` |
| Stream (blob storage, HTTP upload) | `RdashDocument.Load(stream)` to read; to write, use `Dashboard.FromJsonString(json).ToStream()` from the Reveal SDK, or `Save` to a temp file |
| WPF `RevealView` | `view.Dashboard = await RVDashboard.LoadFromJsonAsync(document.ToJsonString());` |

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

## Validation

`ToJsonString()` and `Save()` validate first, which catches a visualization with no data source item and an item with no fields. Bound field names are **not** checked. Copy [`Guard.cs`](../assets/dom-dotnet/Guard.cs) and call `Guard.AssertBoundFieldsExist(document.ToJsonString())` before every save (`Examples.Save` does). Then render the file with [assets/preview](../assets/preview/README.md).
