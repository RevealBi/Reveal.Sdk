// Runs every example and checks the behaviors the skill documents, against the installed
// @revealbi/dom. Run: npm test   (type-checks first)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { strToU8, zipSync } from "fflate";
import {
  CandleStickVisualization, ColumnChartVisualization, DashboardDateFilter, DateField, DateRuleType, GridVisualization,
  MicrosoftSqlServerDataSource, MicrosoftSqlServerDataSourceItem, NumberField, RdashDocument, TextField,
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

await test("trap: a new date filter defaults to the last 365 days, not all time", () => {
  assert.equal(new DashboardDateFilter("p").ruleType, DateRuleType.LastYear);
});

// Known DOM gaps (SKILL.md, "Use only the DOM"). When one of these fails, the library fixed it:
// update SKILL.md and the references.
await test("gap: a Candlestick chart can't be loaded back, even the DOM's own", () => {
  const doc = new RdashDocument("x");
  doc.visualizations = [new CandleStickVisualization("c", item()).setLabel("region").setOpen("total").setHigh("total").setLow("total").setClose("total")];
  assert.throws(() => RdashDocument.loadFromJson(doc.toJsonString()), /Chart type not supported: Candlestick/);
});

await test("gap: require(\"@revealbi/dom\") from CommonJS gives no RdashDocument", () => {
  const r = spawnSync(process.execPath, ["-e", "try { console.log(typeof require('@revealbi/dom').RdashDocument) } catch (e) { console.log(e.code) }"], { encoding: "utf8" });
  assert.notEqual(r.stdout.trim(), "function", "require() works now: update typescript.md and SKILL.md");
});

await test("losscheck: a generated dashboard loses nothing in a round trip", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/tools/losscheck.ts", `${dir}/Sales.rdash`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// losscheck must exit 1 when something visible is lost. Two hand-made files, compared directly.
const loss = async (name: string, before: object, after: object) => {
  await mkdir(dir, { recursive: true });
  const zip = (o: object) => Buffer.from(zipSync({ "Dashboard.json": strToU8(JSON.stringify(o)) }));
  await writeFile(`${dir}/${name}-before.rdash`, zip(before));
  await writeFile(`${dir}/${name}-after.rdash`, zip(after));
  return spawnSync(process.execPath, ["--import", "tsx", "src/tools/losscheck.ts", `${dir}/${name}-before.rdash`, `${dir}/${name}-after.rdash`], { encoding: "utf8" });
};
const widget = (extra: object) => ({ Widgets: [{ Id: "w1", Title: "W", ...extra }] });

await test("losscheck: a dropped DecimalDigits of 0 is a loss (0 is a real setting)", async () => {
  const r = await loss("digits", widget({ Formatting: { DecimalDigits: 0 } }), widget({ Formatting: {} }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

await test("losscheck: a dropped UseAutoLayout of false is a loss (its default is true)", async () => {
  const r = await loss("layout", widget({ UseAutoLayout: false }), widget({}));
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

await test("losscheck: a dropped Formatting block is a loss", async () => {
  const r = await loss("format", widget({ Formatting: { CurrencySymbol: "$" } }), widget({}));
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

await test("losscheck: a dropped default value (false, None) is not a loss", async () => {
  const r = await loss("default", widget({ IsHidden: false, Pinning: "None" }), widget({}));
  assert.equal(r.status, 0, r.stdout + r.stderr);
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
