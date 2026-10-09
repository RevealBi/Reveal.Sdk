# Editing, deleting and copying in existing dashboards

Load, change the objects, then serialize. Never patch `Dashboard.json` text (SKILL.md, "Use only the DOM").

## Know what a round trip changes first

Loading a dashboard into the DOM and saving it again **rewrites** the JSON. Settings equal to their default are omitted, which is harmless: Reveal applies the same default. But some settings the editor writes aren't modeled by the DOM, so they're dropped. Found by round-tripping 85 dashboards (editor-made and generated) through `@revealbi/dom` 0.3.0 and `Reveal.Sdk.Dom` 0.1.688:

| Dropped on load → save (visible to users) | TypeScript | .NET |
| --- | --- | --- |
| Hidden fields (`IsHidden` on the item's fields): fields the author hid reappear | dropped | dropped |
| Custom date format on a field (`"dd-MMM-yyyy"`): reverts to the default | dropped | dropped |
| Sort order of a field (`DataSpec.Fields[].Sorting`: how a grid or chart is sorted) | dropped | kept |
| Grid grouping, grid column hyperlinks and pinning | dropped | kept |
| Data source refresh rate | dropped | kept |

| Can't load | TypeScript | .NET |
| --- | --- | --- |
| A Candlestick chart (`SettingsConverter: Chart type not supported: Candlestick`) | fails | loads |
| A Top N rule on a text field (`Error setting value to 'DataFilter' on 'TextField'`) | loads | fails |

The tables are a summary; the dashboard in front of you decides. **Before changing a dashboard a person authored, run the loss check** from the TypeScript workspace:

```bash
npm run losscheck -- dashboards/Sales.rdash                       # what a TypeScript round trip drops
npm run losscheck -- dashboards/Sales.rdash out/Sales-edited.rdash # after an edit (any library): what got dropped, what changed
```

Exit code 0 means nothing user-visible is lost (it still lists changed values, so you can confirm they're your edits). Exit code 1 lists what would be lost. Exit code 2 means the TypeScript DOM can't load the file; try the .NET library.

So:

- For dashboards the code **generated**, editing through the DOM is safe. The DOM produced the file in the first place.
- For dashboards **authored in the editor**, run the loss check first. If it reports losses with one library, try the other (the .NET library keeps more). If both lose something, stop and follow "Use only the DOM" in SKILL.md: tell the user what would be lost, offer an issue draft, and ask whether to skip that change, make it in the Reveal editor, or have you edit the JSON by hand. Don't decide that yourself.
- Keep the original, run the loss check on your output before you replace anything, and render it.
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
// That's a DOM gap: do this step with the TypeScript library, or ask the user (SKILL.md, "Use only the DOM").
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
3. Run `npm run losscheck -- <before> <after>` on each result and compare visualization and filter counts. Report every dashboard that would lose settings to the user before writing anything back.
4. Open a sample of the results (at least one per distinct layout) in a `RevealView`.
5. Write back through the same store and provider the app uses, so ids, tenants and authorization stay consistent.
