// Runs every example and checks the behaviors the skill documents, against the installed
// @revealbi/dom. Run: npm test   (type-checks first)
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import {
  ColumnChartVisualization, DashboardDateFilter, DateField, GridVisualization, MicrosoftSqlServerDataSource,
  MicrosoftSqlServerDataSourceItem, NumberField, RdashDocument, TextField,
} from "@revealbi/dom";
import { assertBoundFieldsExist } from "../src/lib/guard.js";
import { loadRdash, readRdashJson, saveRdash } from "../src/lib/rdash-file.js";
import { createSalesDashboard } from "../src/examples/create-sales-dashboard.js";
import { editDashboard } from "../src/examples/edit-dashboard.js";
import { createOrdersDashboard } from "../src/examples/sql-server-dashboard.js";
import { summarize } from "../src/tools/inspect.js";

const dir = "out/test";
let failures = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`ok    ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}

await rm(dir, { recursive: true, force: true });

await test("create: sample sales dashboard saves and passes the field guard", async () => {
  await saveRdash(createSalesDashboard(), `${dir}/Sales.rdash`);
  const s = summarize(await readRdashJson(`${dir}/Sales.rdash`));
  assert.equal(s.visualizations.length, 5);
  assert.equal(s.filters.length, 2);
  assert.deepEqual(s.dataSourceItems.map(i => i.id), ["sales"]);
  assert.ok(s.visualizations[1].filterConnections.includes("Order date -> OrderDate"));
});

await test("edit: load, rename, delete, add and save", async () => {
  const doc = editDashboard(await loadRdash(`${dir}/Sales.rdash`));
  await saveRdash(doc, `${dir}/Sales-edited.rdash`);
  const s = summarize(await readRdashJson(`${dir}/Sales-edited.rdash`));
  assert.equal(s.title, "Sales (edited)");
  assert.deepEqual(s.visualizations.map(v => v.title),
    ["Revenue by product", "Revenue", "Revenue by month", "Category mix", "Revenue by region and category"]);
  assert.equal(s.visualizations[0].item, "sales");
});

await test("sql: database connector example keeps explicit ids", async () => {
  await saveRdash(createOrdersDashboard(), `${dir}/Orders.rdash`);
  const s = summarize(await readRdashJson(`${dir}/Orders.rdash`));
  assert.equal(s.dataSources[0].id, "SalesDb");
  assert.equal(s.dataSources[0].provider, "SQLSERVER");
  assert.deepEqual(s.dataSourceItems.map(i => i.id), ["Orders"]);
});

await test("json: toJsonString / loadFromJson round trip keeps the structure", () => {
  const doc = RdashDocument.loadFromJson(createSalesDashboard().toJsonString());
  assert.equal(doc.visualizations.length, 5);
  assert.equal(doc.filters.length, 2);
});

// Documented traps: these must keep failing the guard, or the skill's warnings are stale.
const item = () => {
  const db = new MicrosoftSqlServerDataSource("db");
  const it = new MicrosoftSqlServerDataSourceItem("t", "t", db);
  it.fields = [new TextField("region"), new DateField("order_date"), new NumberField("total")];
  return it;
};

await test("trap: a misspelled value field serializes, and the guard catches it", () => {
  const doc = new RdashDocument("x");
  doc.visualizations = [new ColumnChartVisualization("c", item()).setLabel("region").setValues("totl")];
  assert.doesNotThrow(() => doc.toJsonString());
  assert.throws(() => assertBoundFieldsExist(doc.toJson()), /binds "totl"/);
});

await test("trap: a date filter connected without a field name binds \"Date\"", () => {
  const doc = new RdashDocument("x");
  const period = new DashboardDateFilter("p");
  doc.filters = [period];
  doc.visualizations = [new GridVisualization("g", item()).setColumns("region").connectDashboardFilter(period)];
  assert.throws(() => assertBoundFieldsExist(doc.toJson()), /binds "Date"/);
});

await test("trap: an item without fields fails validation", () => {
  const db = new MicrosoftSqlServerDataSource("db");
  const doc = new RdashDocument("x");
  doc.visualizations = [new GridVisualization("g", new MicrosoftSqlServerDataSourceItem("t", "t", db)).setColumns("a")];
  assert.throws(() => doc.toJsonString(), /Fields/);
});

await test("trap: every TypeScript date filter gets the id _date", () => {
  const doc = new RdashDocument("x");
  doc.filters = [new DashboardDateFilter("a"), new DashboardDateFilter("b")];
  assert.deepEqual((doc.toJson() as any).GlobalFilters.map((f: any) => f.Id), ["_date", "_date"]);
});

await test("trap: a loaded item has no fields; they are on the visualization's data definition", async () => {
  const doc = await loadRdash(`${dir}/Sales.rdash`);
  const v = doc.visualizations[1];
  assert.equal(v.dataDefinition.dataSourceItem!.fields.length, 0);
  assert.equal((v.dataDefinition as { fields?: unknown[] }).fields?.length, 7);
});

await test("loaded data sources are base classes: use provider and properties", async () => {
  const doc = await loadRdash(`${dir}/Orders.rdash`);
  const ds = doc.dataSources.find(d => d.id === "SalesDb")!;
  assert.equal(ds instanceof MicrosoftSqlServerDataSource, false);
  assert.equal(ds.provider, "SQLSERVER");
  ds.properties.Database = "sales_prod";
  assert.equal((doc.toJson() as any).DataSources.find((d: any) => d.Id === "SalesDb").Properties.Database, "sales_prod");
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nAll passed. Dashboards are in out/test; render them with ../preview.");
