// Creates out/Sales.rdash from the sample sales data: two dashboard filters, a KPI, two
// charts, a pivot and a grid.   Run: npm run create   Preview: see ../preview/README.md
import {
  AggregationType,
  ColumnChartVisualization,
  DashboardDataFilter,
  DashboardDateFilter,
  DateAggregationType,
  DateDataField,
  DateRuleType,
  GridVisualization,
  KpiTimeVisualization,
  NumberDataField,
  NumberFormatting,
  NumberFormattingType,
  PieChartVisualization,
  PivotVisualization,
  RdashDocument,
  Theme,
} from "@revealbi/dom";
import { Sales, salesItem } from "../lib/sample-data.js";
import { isMain, saveRdash } from "../lib/rdash-file.js";

export function createSalesDashboard(): RdashDocument {
  const sales = salesItem();
  const doc = new RdashDocument("Sales");
  doc.theme = Theme.Mountain;

  // Dashboard filters. Connect a date filter with the date field's name, or it binds a
  // field called "Date". The TypeScript DOM supports one date filter per dashboard.
  const period = new DashboardDateFilter("Order date");
  period.ruleType = DateRuleType.AllTime;
  const region = new DashboardDataFilter(Sales.Region, "Region", sales);
  doc.filters = [period, region];

  const revenue = new NumberDataField(Sales.Revenue);
  revenue.fieldLabel = "Revenue";
  revenue.aggregationType = AggregationType.Sum;
  revenue.formatting = new NumberFormatting();
  revenue.formatting.formatType = NumberFormattingType.Currency;
  revenue.formatting.currencySymbol = "$";
  revenue.formatting.decimalDigits = 0;
  revenue.formatting.showGroupingSeparator = true;

  const byMonth = new DateDataField(Sales.OrderDate);
  byMonth.aggregationType = DateAggregationType.Month;

  doc.visualizations = [
    new KpiTimeVisualization("Revenue", sales)
      .setDate(Sales.OrderDate).setValue(revenue)
      .connectDashboardFilter(region),
    new ColumnChartVisualization("Revenue by month", sales)
      .setLabel(byMonth).setValues(revenue)
      .connectDashboardFilter(period, Sales.OrderDate).connectDashboardFilter(region),
    new PieChartVisualization("Revenue by category", sales)
      .setLabel(Sales.Category).setValue(Sales.Revenue)
      .connectDashboardFilter(period, Sales.OrderDate).connectDashboardFilter(region),
    new PivotVisualization("Revenue by region and category", sales)
      .setRows([Sales.Region]).setColumns([Sales.Category]).setValues(Sales.Revenue)   // arrays here
      .connectDashboardFilter(period, Sales.OrderDate).connectDashboardFilter(region),
    new GridVisualization("Orders", sales)
      .setColumns(Sales.OrderId, Sales.OrderDate, Sales.Region, Sales.Product, Sales.Quantity, Sales.Revenue)
      .connectDashboardFilter(period, Sales.OrderDate).connectDashboardFilter(region),
  ];
  return doc;
}

if (isMain(import.meta.url)) {
  const path = process.argv[2] ?? "out/Sales.rdash";
  await saveRdash(createSalesDashboard(), path);
  console.log(`Wrote ${path}`);
}
