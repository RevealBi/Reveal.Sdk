# Editing, deleting and copying in existing dashboards

Load, change the objects, then serialize. Never patch `Dashboard.json` text.

## Know what a round trip changes first

Loading a dashboard into the DOM and saving it again **rewrites** the JSON, and the result is not byte-identical. These results come from round-tripping 55 dashboards authored in the Reveal editor through both libraries:

| Effect | Harmless? |
| --- | --- |
| Settings equal to their default are omitted (for example pie `LabelDisplayMode: "Percentage"`) | Yes. Reveal applies the same default. |
| Two properties of the data source item's field list are not modeled, so they're dropped: `IsHidden` (fields the author hid from the editor's field list reappear) and per-field date `Formatting` such as `"dd-MMM-yyyy"` (a custom date format reverts) | **No.** Visible to users. |
| TypeScript 0.3.0 can't load some editor-made visualizations (`SettingsConverter: Chart type not supported: Candlestick`). The .NET library loaded all of them. | Load throws, so nothing is written. |

So:

- For dashboards the code **generated**, editing through the DOM is safe. The DOM produced the file in the first place.
- For dashboards **authored in the editor**, prefer the .NET library, keep the original, diff the output, and open both in a `RevealView` before replacing anything. If a lost setting matters, make the change in the editor instead.
- Wrap each load in try/catch, and leave a file untouched when it fails to load.

## Find, change and delete visualizations

TypeScript:

```ts
const doc = await RdashDocument.loadFromBuffer(await fs.readFile("dashboards/Sales.rdash"));

const pivot = doc.visualizations.find(v => v.title === "By region");
if (pivot) pivot.title = "Revenue by region";

doc.visualizations = doc.visualizations.filter(v => v.title !== "Orders");   // delete

const [moved] = doc.visualizations.splice(2, 1);                            // reorder (auto layout follows list order)
doc.visualizations.unshift(moved);

doc.filters = doc.filters.filter(f => f.title !== "region");                // delete a dashboard filter
```

.NET (`Visualizations` is a `List<IVisualization>`, and `Filters` a `List<DashboardFilter>`):

```cs
var doc = RdashDocument.Load("Dashboards/Sales.rdash");
doc.Visualizations.Find(v => v.Title == "By region")!.Title = "Revenue by region";
doc.Visualizations.RemoveAll(v => v.Title == "Orders");
doc.Filters.RemoveAll(f => f.Title == "region");
doc.Save("Dashboards/Sales.rdash");
```

Match on `id` when the caller has it. Titles aren't unique. When you delete a dashboard filter, the bindings that pointed at it go dead: remove them from the visualizations' `filterBindings` too, or the filter must be re-added with the same id.

To add a visualization to a loaded dashboard, reuse the data source item an existing visualization already uses, so the new one queries the same data and the server resolves it the same way. A loaded item's own `fields` is **empty**: the declared fields are on the visualization's data definition. Copy them back first, or validation throws `Fields for DataSourceItem ... is null`:

```ts
const source = doc.visualizations.find(v => v.dataDefinition.dataSourceItem)!;
const item = source.dataDefinition.dataSourceItem!;
if (item.fields.length === 0) item.fields = (source.dataDefinition as { fields?: IField[] }).fields ?? [];   // import type { IField }
doc.visualizations.push(new BarChartVisualization("Revenue by product", item).setLabel("Product").setValues("Revenue"));
```

```cs
var definition = (TabularDataDefinition)doc.Visualizations.First(v => v.DataDefinition is TabularDataDefinition).DataDefinition;
if (definition.DataSourceItem.Fields.Count == 0) definition.DataSourceItem.Fields = definition.Fields.ToList();
doc.Visualizations.Add(new BarChartVisualization("Revenue by product", definition.DataSourceItem).SetLabel("Product").SetValues("Revenue"));
```

Both are in the workspaces' `edit` examples and run there.

## Redirect data sources

Loaded data sources and items are base classes in both libraries (no `instanceof` / `is` for the connector type). Use `provider` and `properties`:

```ts
for (const ds of doc.dataSources) {
  if (ds.provider === "SQLSERVER") {
    ds.properties.Host = "db.internal";
    ds.properties.Database = "sales_prod";
  }
}
// Item properties (Table, Schema, ...) are public in TypeScript:
//   (viz.dataDefinition as any).dataSourceItem.properties.Table = "orders_v2";
```

```cs
foreach (var ds in doc.DataSources.Where(d => d.Provider == DataSourceProvider.MicrosoftSqlServer))
{
    ds.Properties["Host"] = "db.internal";
    ds.Properties["Database"] = "sales_prod";
}
// Item properties are internal in .NET; a loaded item's table can't be changed through the public API.
```

Rewriting the file is only right for a one-off migration, for example moving shipped dashboards off a retired database. Per-tenant or per-environment connections belong in the server's data source provider at request time (`reveal-embed` data-sources.md). That stays correct for dashboards users save later, and it keeps connection details out of the files.

## Copy visualizations between dashboards

```ts
target.import(source);                                    // every visualization
target.import(source, "<visualization id>");              // one, by id or by object
target.import(source, viz, { includeDashboardFilters: true, includeVisualizationFilters: true });
```

```cs
target.Import(source);
target.Import(source, visualization, new ImportOptions { IncludeDashboardFilters = true });
```

The import brings the visualization's data source along, so the target can render it without further wiring. Tested in both libraries.

## Bulk migrations

1. Read from a copy or a backup, never from the only live store.
2. For each dashboard: load (catch and log failures), apply the change, run the bound-field guard (typescript.md / dotnet.md), and serialize.
3. Compare visualization and filter counts before and after, and log any difference.
4. Open a sample of the results (at least one per distinct layout) in a `RevealView`.
5. Write back through the same store and provider the app uses, so ids, tenants and authorization stay consistent.
