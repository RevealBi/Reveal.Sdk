# Editing, deleting and copying in existing dashboards

Load, change the objects, then serialize. Never patch `Dashboard.json` text (SKILL.md, "Use only the DOM").

## Know what a round trip changes first

Loading a dashboard into the DOM and saving it again **rewrites** the JSON. Some settings the editor writes aren't modeled, so they're dropped; a few are rewritten. Found by round-tripping the 350 editor-made dashboards in the Reveal SDK's test and sample folders through `@revealbi/dom` 0.3.0 and `Reveal.Sdk.Dom` 0.1.688 and rendering a sample before and after:

| Lost or changed on load → save (visible to users) | TypeScript | .NET |
| --- | --- | --- |
| Hidden fields (`IsHidden` on the item's fields): hidden columns reappear in grids and in the field list ([#73](https://github.com/RevealBi/revealbi-dom/issues/73), [.NET #440](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/440)). In almost every editor dashboard. | dropped | dropped |
| Large-number format ("$34M" becomes "$33,982,382") | dropped | dropped |
| Number format of a field that had none: the DOM writes its own (2 decimals, no thousands separator), so "5,749,825" becomes "5749825.45" | added | added |
| Custom date format on a field (`"dd-MMM-yyyy"`) ([#73](https://github.com/RevealBi/revealbi-dom/issues/73), [.NET #440](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/440)) | dropped | dropped |
| Date format set on a visualization (pivot rows, chart axis, KPI date: "96-Q3" becomes "1996-Q3") | dropped | kept |
| Conditional formatting rules, including gauge bands | dropped | dropped |
| Scatter map zoom: the map renders empty after a save | corrupted | kept |
| A date filter's relative rule (`CustomRule`: "last 2 weeks", .NET `DateFilterRule.Last/Previous/This/ToDate/Next`), on dashboard and visualization filters: a dashboard date filter without its rule makes Reveal fail to open the dashboard (`Cannot read properties of null (reading 'toLegacyRule')`) | dropped | kept |
| A dashboard filter marked read-only | dropped | kept |
| Analysis Services: a dashboard filter's data source item, and measure number formats | dropped | kept |
| Sort order of a field ([#58](https://github.com/RevealBi/revealbi-dom/issues/58)) | dropped | kept |
| Grid grouping, column hyperlinks and pinning ([#62](https://github.com/RevealBi/revealbi-dom/issues/62)) | dropped | kept |
| Data source refresh rate ([#73](https://github.com/RevealBi/revealbi-dom/issues/73)) | dropped | kept |
| Chart annotations | dropped | kept |

Also dropped by both, effect not confirmed by rendering: legend position, choropleth region and color settings, tree map layout and colors.

| Can't load | TypeScript | .NET |
| --- | --- | --- |
| A Candlestick chart (`Chart type not supported: Candlestick`, [#67](https://github.com/RevealBi/revealbi-dom/issues/67)) | fails | loads |
| A web resource / OData item (`ResourceDataSpecType`) | fails | fails |
| A theme saved by its display name (`"Coral Reef"`, `"Hot Air Balloon"`, `"Default Theme"`): about 1 editor dashboard in 30 | loads | fails |
| A field whose filter doesn't match its type: a Top N rule on a text field ([.NET #437](https://github.com/RevealBi/Reveal.Sdk.Dom/issues/437)), a text filter on a date field | loads | fails |
| Date aggregation by week, `Tags` written as a list, or a `Dashboard.json` that starts with a byte-order mark | loads | fails |
| `Dashboard.json` with trailing commas, or stored in a folder inside the zip | fails | loads |
| `.rplus` files (the older XML format): neither library reads them, and the .NET `Load` returns an empty document instead of throwing (check `doc.Visualizations != null`) | fails | fails |

Reveal itself opens all of these. When one library can't load a file, try the other.

The tables are a summary; the dashboard in front of you decides. **Before changing a dashboard a person authored, run the loss check** from the TypeScript workspace:

```bash
npm run losscheck -- path/to/Sales.rdash                        # what a TypeScript round trip drops
npm run losscheck -- path/to/Sales.rdash out/Sales-edited.rdash # after an edit (any library): what got dropped, what changed
```

Exit code 0 means no setting the tool knows to be visible was lost or added (it still lists changed values and other dropped properties, so you can confirm they're your edits). It doesn't prove the dashboard looks the same: render the original and the result and compare them (the preview `check`, or the app). Exit code 1 means a visible setting was lost, or, with one file, one the round trip added (a number format where there was none); with two files, additions and visualizations matched by id that were removed or added are listed, not failed, so read that list (a visualization recreated with a new id shows as removed + added). Exit code 2 means a file can't be read or the TypeScript DOM can't load it; try the .NET library.

So:

- For dashboards the code **generated**, editing through the DOM is safe. The DOM produced the file in the first place.
- For dashboards **authored in the editor**, run the loss check first. If it reports losses, try the .NET library, which keeps more: `dotnet run -- roundtrip <file> out/<file>` in the .NET workspace loads and saves it to a new path, prints what was lost and refuses to write on a visible loss (`--allow-loss` writes it for comparison and rendering). If both lose something, stop and follow "Use only the DOM" in SKILL.md: tell the user what would be lost, offer an issue draft, and ask whether to skip that change, make it in the Reveal editor, or have you edit the JSON by hand. Don't decide that yourself.
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
doc.Save("Dashboards/Sales.tmp.rdash");                                   // not over the original: Save over a larger
File.Move("Dashboards/Sales.tmp.rdash", "Dashboards/Sales.rdash", true);  // existing file leaves a corrupt zip
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

### Connecting to a loaded date filter

**TypeScript: connect date filters only on dashboards it created.** Every date filter binding TypeScript writes targets the id `_date`, and only date filters TypeScript creates have that id. Date filters on a loaded dashboard (editor- or .NET-made) keep their GUIDs, so a visualization you add and connect to one of them ignores it: no error, the widget shows unfiltered numbers. Rendered with two date filters: the new widget showed all-time totals. The guard reports a binding whose target filter doesn't exist, and `npm run inspect` prints each binding's target (`<id> (no such filter)`). Use Reveal.Sdk.Dom for that edit (it binds the real id), or ask the user:

```cs
newViz.ConnectDashboardFilter(doc.Filters.OfType<DashboardDateFilter>().Single(f => f.Title == "Order date"), "OrderDate");
```

**Both libraries: a plain load + save of an editor dashboard can do the same.** The editor's older date binding has no filter id and follows the dashboard's date filter. A load + save in either library writes it as `"_date"` while the filter keeps its GUID (4 of 350 editor dashboards, `Sales.rdash` among them). The one render of that (`Sales.rdash`, filter "Last 365 Days") showed the same numbers before and after, but its data may all lie inside the filter's range, so it is **not verified** whether Reveal still applies the filter. The guard flags these bindings, so `saveRdash`, `roundtrip` and `migrate` stop on such a file. Tell the user; if they want to go ahead, render the result with a date rule that excludes part of the data and compare with the original before overriding.

## Redirect data sources

Loaded data sources and items are base classes in both libraries (no `instanceof` / `is` for the connector type, and the minified TypeScript build makes `constructor.name` meaningless). Use `provider` and `properties`:

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
// That's a DOM gap (Reveal.Sdk.Dom #438): do this step with the TypeScript library, or ask the user (SKILL.md, "Use only the DOM").
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

The import brings the visualization's data source along, so the target renders it without further wiring (both libraries, Reveal 2.2.1). `includeDashboardFilters` copies the **data** filters the visualization is connected to. TypeScript does **not copy date filters**: the copy keeps a binding to a date filter the target doesn't have and shows unfiltered dates. Neither library copies the date filter behind the editor's id-less date binding (rendered: the copy showed all-time data). Reveal.Sdk.Dom copies a GUID date filter with its id, bindings intact (workspace test, not rendered); TypeScript doesn't (workspace test). Add a date filter to the target yourself and connect it by field name (in TypeScript only if the target is a dashboard TypeScript created, see above), then run the guard. Copying an editor-made visualization also loses what any round trip loses (table above), K/M formats included.

## Bulk migrations

Both workspaces have a runner. Put your change in `migrate()` at the top of `src/tools/migrate.ts`, or in `Migration.Change` in the .NET workspace's `Migration.cs`, then:

```bash
npm run migrate -- <folder> [--out <dir>] [--allow-loss]      # TypeScript
dotnet run -- migrate <folder> [--out <dir>] [--allow-loss]   # .NET
```

For each file it loads in try/catch, applies the change, runs the guard against the original (only problems the change adds fail), compares the result with the original (the loss check) and writes it to the out folder (default `<folder>-migrated`; the input folder is refused, originals are never written). A file with guard problems or a user-visible loss is refused, not written, and listed with the reason: TypeScript writes `migrate-log.txt` in the out folder and prints a tally of lost properties; .NET prints one row per file (status, visible and other losses, detail). `--allow-loss` writes lossy files but never ones with guard problems. Exit code 1 when any file was refused or failed. Then:

1. Read from a copy or a backup, never from the only live store.
2. Run the runner without `--allow-loss` first. Expect most editor-made dashboards to be refused: both libraries drop hidden fields (316 of 332 in testing). Group the report by kind of loss (hidden fields, number formats, date formats, ...) and ask the user once per kind, not per file; rerun with `--allow-loss` only for the kinds they accepted. Files that fail to load or have guard problems stay untouched: report them together (a `"_date"` guard problem on an editor file is the date binding rewrite above).
3. Check the written files: compare visualization and filter counts with what you meant to change (`npm run losscheck -- <before> <after>` per file shows the details). Exit 0 is not proof: render the before and after of a sample and compare.
4. Open a sample of the results (at least one per distinct layout) in a `RevealView` or the preview.
5. Write back through the same store and provider the app uses, so ids, tenants and authorization stay consistent. In .NET, write each file to a temp path and move it over the original (`Workspace.WriteRdash` does).
