import { DataSource, DateField, NumberField, RestDataSourceItem, TextField } from "@revealbi/dom";

// The sample sales data served by ../preview (sample-data/sales.json). The URL stored in
// the dashboard is a placeholder: the preview server maps the item id "sales" to the real
// location, the same way an app's server-side data source provider should treat every
// URL, host or table a dashboard names (see the reveal-embed skill, data-sources.md).

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

export function salesItem(): RestDataSourceItem {
  const dataSource = new DataSource("Sample data");
  dataSource.id = "SampleData";

  const item = new RestDataSourceItem("Sales", "https://sample-data.invalid/sales.json", dataSource);
  item.id = "sales";
  item.isAnonymous = true;
  item.fields = [
    new NumberField(Sales.OrderId),
    new DateField(Sales.OrderDate),
    new TextField(Sales.Region),
    new TextField(Sales.Product),
    new TextField(Sales.Category),
    new NumberField(Sales.Quantity),
    new NumberField(Sales.Revenue),
  ];
  return item;
}
