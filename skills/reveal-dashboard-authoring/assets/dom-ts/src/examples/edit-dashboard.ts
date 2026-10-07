// Loads a dashboard, renames, deletes and reorders visualizations, adds one that reuses
// an existing data source item, and writes the result to a new file.
// Run: npm run edit -- [in.rdash] [out.rdash]   (defaults: out/Sales.rdash -> out/Sales-edited.rdash)
import { BarChartVisualization, DataSourceItem, NumberDataField, RdashDocument, SortingType } from "@revealbi/dom";
import type { IField } from "@revealbi/dom";
import { isMain, loadRdash, saveRdash } from "../lib/rdash-file.js";

export function editDashboard(doc: RdashDocument): RdashDocument {
  doc.title = `${doc.title} (edited)`;

  // Find by title (or by id when you have it; titles are not unique) and change it.
  const pie = doc.visualizations.find(v => v.title === "Revenue by category");
  if (pie) pie.title = "Category mix";

  // Delete.
  doc.visualizations = doc.visualizations.filter(v => v.title !== "Orders");

  // Add a visualization that reuses the data source item an existing one queries, so the
  // server resolves it the same way. A loaded item is a base DataSourceItem and its own
  // `fields` is empty: the declared fields sit on the visualization's data definition, and
  // must be copied back before the item can back a new visualization.
  const source = doc.visualizations.find(v => v.dataDefinition.dataSourceItem);
  const item: DataSourceItem | undefined = source?.dataDefinition.dataSourceItem;
  if (!source || !item) throw new Error("The dashboard has no data-bound visualization to reuse.");
  if (item.fields.length === 0) item.fields = (source.dataDefinition as { fields?: IField[] }).fields ?? [];
  const names = new Set(item.fields.map(f => f.fieldName));
  if (!names.has("Product") || !names.has("Revenue")) throw new Error("Expected the sample sales fields.");

  const revenue = new NumberDataField("Revenue");
  revenue.sorting = SortingType.Desc;
  const byProduct = new BarChartVisualization("Revenue by product", item).setLabel("Product").setValues(revenue);

  // With auto layout (the default) visualizations are placed in list order.
  doc.visualizations = [byProduct, ...doc.visualizations];
  return doc;
}

if (isMain(import.meta.url)) {
  const [input = "out/Sales.rdash", output = "out/Sales-edited.rdash"] = process.argv.slice(2);
  await saveRdash(editDashboard(await loadRdash(input)), output);
  console.log(`Wrote ${output}`);
}
