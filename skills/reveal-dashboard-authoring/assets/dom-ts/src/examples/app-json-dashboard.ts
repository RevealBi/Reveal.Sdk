// A dashboard on a JSON file the app serves itself, for an app that runs Reveal (reveal-embed):
// a KPI, a column chart, a line chart and a grid. Copy it, then change the field list, the
// item id and the visualizations to the user's file. The whole chain is in SKILL.md, "A
// dashboard on the app's own JSON file": the app serves sample-data/<file>.json, this script
// builds the item with the same id, one line in the server's SAMPLE_DATA maps the id to the
// file, and check-app --start renders it in the app.
//
//     npm run app-json -- <path of the .rdash>      (default: out/SalesOverview.rdash)
import {
  AggregationType,
  ColumnChartVisualization,
  DateAggregationType,
  DateDataField,
  DateField,
  GridVisualization,
  KpiTimeVisualization,
  LineChartVisualization,
  NumberDataField,
  NumberField,
  RdashDocument,
  TextField,
} from "@revealbi/dom";
import { jsonFileItem } from "../lib/sample-data.js";
import { isMain, saveRdash } from "../lib/rdash-file.js";

// The file's field names (sample-data/sales.json here), so a typo is a compile error.
const F = { OrderId: "OrderId", OrderDate: "OrderDate", Region: "Region", Product: "Product", Revenue: "Revenue" } as const;

export function createAppJsonDashboard(): RdashDocument {
  // "sales" must match the server's SAMPLE_DATA key: { sales: "sales.json" }.
  const item = jsonFileItem("sales", "Sales", [
    new NumberField(F.OrderId),
    new DateField(F.OrderDate),
    new TextField(F.Region),
    new TextField(F.Product),
    new NumberField(F.Revenue),
  ]);

  const revenue = new NumberDataField(F.Revenue);
  revenue.aggregationType = AggregationType.Sum;
  const byMonth = new DateDataField(F.OrderDate);   // a date as a label needs a DateDataField
  byMonth.aggregationType = DateAggregationType.Month;

  const doc = new RdashDocument("Sales overview");
  doc.visualizations = [
    new KpiTimeVisualization("Revenue", item).setDate(F.OrderDate).setValue(revenue),
    new ColumnChartVisualization("Revenue by region", item).setLabel(F.Region).setValues(revenue),
    new LineChartVisualization("Revenue by month", item).setLabel(byMonth).setValues(revenue),
    new GridVisualization("Orders", item).setColumns(F.OrderId, F.OrderDate, F.Region, F.Product, F.Revenue),
  ];
  return doc;
}

if (isMain(import.meta.url)) {
  const path = process.argv[2] ?? "out/SalesOverview.rdash";
  await saveRdash(createAppJsonDashboard(), path);   // runs the guard first
  console.log(`Wrote ${path}`);
}
