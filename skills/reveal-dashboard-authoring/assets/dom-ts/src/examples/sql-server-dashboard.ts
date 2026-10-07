// The pattern for a database connector (SQL Server here; PostgreSqlDataSource,
// MySqlDataSource, OracleDataSource, SnowflakeDataSource, ... work the same way).
// The dashboard stores no credentials, and host/database are placeholders: the app's
// server-side data source provider sets the real connection per request and matches
// items by the explicit ids set here. Run: npm run sql
import {
  DashboardDataFilter,
  DateField,
  GridVisualization,
  LineChartVisualization,
  DateDataField,
  DateAggregationType,
  MicrosoftSqlServerDataSource,
  MicrosoftSqlServerDataSourceItem,
  NumberField,
  RdashDocument,
  TextField,
} from "@revealbi/dom";
import { isMain, saveRdash } from "../lib/rdash-file.js";

export function createOrdersDashboard(): RdashDocument {
  const db = new MicrosoftSqlServerDataSource("Sales database");
  db.id = "SalesDb";               // the server's data source provider matches on these ids
  db.host = "placeholder";         // overwritten on the server
  db.database = "placeholder";

  const orders = new MicrosoftSqlServerDataSourceItem("Orders", "orders", db);   // title, table, data source
  orders.id = "Orders";
  orders.fields = [
    new NumberField("id"),
    new DateField("order_date"),
    new TextField("status"),
    new NumberField("total_amount"),
  ];

  const doc = new RdashDocument("Orders");
  const status = new DashboardDataFilter("status", orders);
  doc.filters = [status];

  const byMonth = new DateDataField("order_date");
  byMonth.aggregationType = DateAggregationType.Month;

  doc.visualizations = [
    new LineChartVisualization("Order value by month", orders)
      .setLabel(byMonth).setValues("total_amount").connectDashboardFilter(status),
    new GridVisualization("Orders", orders)
      .setColumns("id", "order_date", "status", "total_amount").connectDashboardFilter(status),
  ];
  return doc;
}

if (isMain(import.meta.url)) {
  const path = process.argv[2] ?? "out/Orders.rdash";
  await saveRdash(createOrdersDashboard(), path);
  console.log(`Wrote ${path}`);
}
