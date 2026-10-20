import { DataSource, DateField, type IField, NumberField, RestDataSourceItem, TextField } from "@revealbi/dom";

// JSON files that the app's own server serves: reveal-embed's node-minimal app and ../preview
// both serve sample-data/<file> and map an item id to its file (SAMPLE_DATA in
// reveal-server.cjs and in ../preview/server.js). The URL stored in the dashboard is a
// placeholder that never resolves, the same way an app's server-side data source provider
// should treat every URL, host or table a dashboard names (reveal-embed, data-sources.md).

/**
 * An item for a JSON file (an array of flat objects) that the app's server serves itself.
 * `id` is what the server maps to the file, so keep it stable; declare every field the
 * visualizations bind, with its type. Build REST/JSON items only this way: the no-argument
 * `new RestDataSourceItem()`, or assigning `item.dataSource` afterwards, drops the JSON wrapper
 * Reveal needs, and every widget fails with "unknown type ('REST')" (@revealbi/dom 0.3.0).
 */
export function jsonFileItem(id: string, title: string, fields: IField[]): RestDataSourceItem {
  const dataSource = new DataSource("Sample data");
  dataSource.id = "SampleData";
  const item = new RestDataSourceItem(title, `https://sample-data.invalid/${id}.json`, dataSource);
  item.id = id;
  item.isAnonymous = true;
  item.fields = fields;
  return item;
}

/** Field names as constants, so a typo is a compile error instead of a broken widget. */
export const Sales = {
  OrderId: "OrderId",
  OrderDate: "OrderDate",
  Region: "Region",
  Product: "Product",
  Category: "Category",
  Quantity: "Quantity",
  Revenue: "Revenue",
} as const;

/** The sample sales data: sample-data/sales.json, item id "sales". */
export function salesItem(): RestDataSourceItem {
  return jsonFileItem("sales", "Sales", [
    new NumberField(Sales.OrderId),
    new DateField(Sales.OrderDate),
    new TextField(Sales.Region),
    new TextField(Sales.Product),
    new TextField(Sales.Category),
    new NumberField(Sales.Quantity),
    new NumberField(Sales.Revenue),
  ]);
}
