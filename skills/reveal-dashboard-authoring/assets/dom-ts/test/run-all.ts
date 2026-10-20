// Runs every example and checks the behaviors the skill documents, against the installed
// @revealbi/dom. Run: npm test   (type-checks first)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { strToU8, zipSync } from "fflate";
import {
  CandleStickVisualization, ColumnChartVisualization, DashboardDataFilter, DashboardDateFilter, DateAggregationType,
  DateDataField, DateField, DateRange, DateRuleType, GridVisualization, LinkFilter, MicrosoftSqlServerDataSource,
  MicrosoftSqlServerDataSourceItem, NumberField, RdashDocument, RestDataSource, RestDataSourceItem, TextBoxVisualization, TextField,
  VisualizationLinker,
} from "@revealbi/dom";
import { assertBoundFieldsExist, findBindingProblems } from "../src/lib/guard.js";
import { loadRdash, readRdashJson, saveRdash } from "../src/lib/rdash-file.js";
import { salesItem } from "../src/lib/sample-data.js";
import { createAppJsonDashboard } from "../src/examples/app-json-dashboard.js";
import { createSalesDashboard } from "../src/examples/create-sales-dashboard.js";
import { editDashboard } from "../src/examples/edit-dashboard.js";
import { createOrdersDashboard } from "../src/examples/sql-server-dashboard.js";
import { buildDashboard, exampleSpec, SpecError, validateSpec } from "../src/examples/spec-generator.js";
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

await test("app-json: KPI, column, line and grid on a JSON-file item, kept inside its JSON wrapper", async () => {
  await saveRdash(createAppJsonDashboard(), `${dir}/SalesOverview.rdash`);
  const json = await readRdashJson(`${dir}/SalesOverview.rdash`) as any;
  assert.equal(summarize(json).visualizations.length, 4);
  for (const w of json.Widgets) {
    assert.equal(w.DataSpec.DataSourceItem.DataSourceId, "__JSON");
    assert.equal(w.DataSpec.DataSourceItem.ResourceItem.Id, "sales");   // the id the server maps to the file
  }
});

await test("trap: a REST item without its JSON wrapper (no-argument constructor, late .dataSource); the guard catches it", () => {
  // What an agent wrote from memory in a testbed run; every widget then failed with "unknown type ('REST')".
  const rest = new RestDataSource();
  rest.id = "OrdersDataSource";
  const item = new RestDataSourceItem("Orders");
  item.id = "orders";
  item.dataSource = rest;
  item.fields = [new TextField("Region")];
  const doc = new RdashDocument("x");
  doc.visualizations = [new GridVisualization("g", item).setColumns("Region")];
  const json = doc.toJson() as any;
  assert.equal(json.Widgets[0].DataSpec.DataSourceItem.DataSourceId, "OrdersDataSource", "fixed: the item keeps its JSON wrapper now, update SKILL.md");
  assert.throws(() => assertBoundFieldsExist(json), /without its JSON wrapper/);
  // Assigning .dataSource after the three-argument constructor drops the wrapper too.
  const late = salesItem();
  late.dataSource = rest;
  const lateDoc = new RdashDocument("y");
  lateDoc.visualizations = [new GridVisualization("g", late).setColumns("Region")];
  assert.throws(() => assertBoundFieldsExist(lateDoc.toJson()), /without its JSON wrapper/);
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

await test("gap: require(\"@revealbi/dom\") from a CommonJS file throws", async () => {
  // From a file, not node -e: node -e returns {} silently, a .cjs file throws (Node 20+: ReferenceError
  // "exports is not defined in ES module scope"; Node 18: ERR_REQUIRE_ESM).
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/require.cjs`, "try { console.log(typeof require('@revealbi/dom').RdashDocument) } catch (e) { console.log(e.code ?? e.name) }");
  const r = spawnSync(process.execPath, [`${dir}/require.cjs`], { encoding: "utf8" });
  assert.notEqual(r.stdout.trim(), "function", "require() works now: update typescript.md and SKILL.md");
  assert.match(r.stdout + r.stderr, /ReferenceError|ERR_REQUIRE_ESM|exports is not defined/);
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

await test("losscheck: a case-only change is listed for review, not hidden", async () => {
  const r = await loss("case", widget({ Title: "Revenue" }), widget({ Title: "revenue" }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /"Revenue" -> "revenue"/);
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

// Traps found by the 2026-10 skill tests. Each pins the library behavior the skill warns about.
const writeRdash = async (path: string, json: object | string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(zipSync({ "Dashboard.json": strToU8(typeof json === "string" ? json : JSON.stringify(json)) })));
};
const run = (tool: string, ...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", `src/tools/${tool}.ts`, ...args], { encoding: "utf8" });
const bindingsOf = (json: any, i = 0) => json.Widgets[i].DataSpec.Bindings.Bindings as any[];

await test("trap: each setter call replaces the binding, it doesn't add", () => {
  const v = new ColumnChartVisualization("c", item()).setLabel("region").setValues("total").setValues("region");
  const doc = new RdashDocument("x");
  doc.visualizations = [v];
  const values = JSON.stringify((doc.toJson() as any).Widgets[0].VisualizationDataSpec.Values);
  assert.ok(!values.includes('"total"'), `the first setValues is kept: ${values}`);
});

await test("trap: a date column by name is a plain dimension; the guard catches it, a DateDataField passes", () => {
  const doc = new RdashDocument("x");
  doc.visualizations = [new ColumnChartVisualization("c", item()).setLabel("order_date").setValues("total")];
  assert.match(JSON.stringify((doc.toJson() as any).Widgets[0].VisualizationDataSpec), /SummarizationRegularFieldType/);
  assert.throws(() => assertBoundFieldsExist(doc.toJson()), /date field "order_date" as a plain value/);
  const month = new DateDataField("order_date");
  month.aggregationType = DateAggregationType.Month;
  doc.visualizations = [new ColumnChartVisualization("c", item()).setLabel(month).setValues("total")];
  assert.doesNotThrow(() => assertBoundFieldsExist(doc.toJson()));
});

await test("trap: a dashboard data filter on a misspelled field passes the DOM; the guard catches it", () => {
  const doc = new RdashDocument("x");
  doc.filters = [new DashboardDataFilter("regon", item())];   // not connected to anything
  doc.visualizations = [new GridVisualization("g", item()).setColumns("region")];
  assert.doesNotThrow(() => doc.toJsonString());
  assert.throws(() => assertBoundFieldsExist(doc.toJson()), /Dashboard filter "regon" filters on "regon"/);
});

await test("trap: plural connectDashboardFilters binds the date filter to \"Date\" (Reveal then ignores every filter)", () => {
  const doc = new RdashDocument("x");
  const period = new DashboardDateFilter("p");
  const region = new DashboardDataFilter("region", item());
  doc.filters = [period, region];
  doc.visualizations = [new GridVisualization("g", item()).setColumns("region", "total").connectDashboardFilters(period, region)];
  const b = bindingsOf(doc.toJson());
  assert.deepEqual(b.map(x => x.Source.FieldName), ["Date", "region"]);
  assert.equal(b[1].Target.GlobalFilterId, region.id);   // the data filter itself is bound correctly
  assert.throws(() => assertBoundFieldsExist(doc.toJson()), /binds "Date"/);
});

await test("trap: a custom date range from UTC dates is that day; local dates are converted to UTC", () => {
  const period = new DashboardDateFilter("p");
  period.ruleType = DateRuleType.CustomRange;
  period.customDateRange = new DateRange(new Date(Date.UTC(2026, 2, 12)), new Date(2026, 2, 12));
  const doc = new RdashDocument("x");
  doc.filters = [period];
  const range = (doc.toJson() as any).GlobalFilters[0].CustomDateRange;
  assert.equal(range.From.value, "2026-03-12T00:00:00.000Z");
  // East of UTC this is the previous day (2026-03-11T22:00 in Sofia), and Reveal filters that day.
  assert.equal(range.To.value, new Date(2026, 2, 12).toISOString());
});

// A dashboard loaded with two date filters, as the editor or Reveal.Sdk.Dom writes them (GUID ids).
const twoDateFilters = () => {
  const doc = new RdashDocument("x");
  doc.filters = [new DashboardDateFilter("Ordered"), new DashboardDateFilter("Shipped")];
  doc.visualizations = [new TextBoxVisualization("t").setText("x")];
  const json = doc.toJson() as any;
  json.GlobalFilters[0].Id = "0f1e2d3c-0000-4000-8000-000000000001";
  json.GlobalFilters[1].Id = "0f1e2d3c-0000-4000-8000-000000000002";
  return RdashDocument.loadFromJson(JSON.stringify(json));
};

await test("trap: connecting to a loaded date filter binds \"_date\"; the guard catches the missing target", () => {
  const doc = twoDateFilters();
  const ordered = doc.filters[0] as DashboardDateFilter;
  assert.equal(ordered.id, "0f1e2d3c-0000-4000-8000-000000000001");   // loaded filters keep their ids
  doc.visualizations.push(new GridVisualization("g", salesItem()).setColumns("Region").connectDashboardFilter(ordered, "OrderDate"));
  const json = doc.toJson() as any;
  assert.equal(bindingsOf(json, 1)[0].Target.GlobalFilterId, "_date", "fixed: TypeScript binds the real id now, update SKILL.md");
  assert.throws(() => assertBoundFieldsExist(json), /dashboard filter id "_date", which the dashboard doesn't have/);
});

await test("guard: a \"_date\" connection is flagged with ONE loaded date filter too (one-filter case unrendered)", () => {
  // The common case of a dead "_date" connection: an editor dashboard with a single GUID date filter, a widget added in TypeScript.
  // Also the shape a load + save writes for the editor's id-less date binding. Whether Reveal applies a
  // single date filter through "_date" is not verified, so the guard refuses it (guard.ts comment).
  const one = new RdashDocument("x");
  one.filters = [new DashboardDateFilter("Ordered")];
  one.visualizations = [new TextBoxVisualization("t").setText("x")];
  const base = one.toJson() as any;
  base.GlobalFilters[0].Id = "0f1e2d3c-0000-4000-8000-000000000004";
  const doc = RdashDocument.loadFromJson(JSON.stringify(base));
  doc.visualizations.push(new GridVisualization("g", salesItem()).setColumns("Region").connectDashboardFilter(doc.filters[0] as DashboardDateFilter, "OrderDate"));
  const json = doc.toJson() as any;
  assert.equal(bindingsOf(json, 1)[0].Target.GlobalFilterId, "_date");
  assert.throws(() => assertBoundFieldsExist(json, base), /only date filter has another id/);
});

await test("trap: import with includeDashboardFilters copies data filters, not a loaded date filter", async () => {
  // The date filter of an editor or Reveal.Sdk.Dom dashboard has a GUID id (only TypeScript writes "_date").
  const guid = "0f1e2d3c-0000-4000-8000-000000000003";
  const source = RdashDocument.loadFromJson(JSON.stringify(createSalesDashboard().toJson()).replaceAll('"_date"', `"${guid}"`));
  const target = new RdashDocument("target");
  target.visualizations = [new TextBoxVisualization("t").setText("x")];
  target.import(source, source.visualizations[1], { includeDashboardFilters: true });   // "Revenue by month": both filters
  const json = target.toJson() as any;
  assert.deepEqual(json.GlobalFilters.map((f: any) => f._type), ["TabularGlobalFilterType"], "fixed: the date filter is copied now, update editing.md");
  assert.throws(() => assertBoundFieldsExist(json), /dashboard filter id "[^"]+", which the dashboard doesn't have/);
});

// A date filter with a relative rule, as Reveal.Sdk.Dom (DateFilterRule.Last) and the editor write it.
const customRuleJson = () => {
  const json = createSalesDashboard().toJson() as any;
  const period = json.GlobalFilters.find((f: any) => f.Id === "_date");
  period.RuleType = "CustomRule";
  period.CustomRule = { _type: "DateRuleType", Relation: "Last", Count: 2, Period: "Week" };
  return json;
};

await test("gap: a round trip drops a date filter's CustomRule (the result doesn't open)", () => {
  const out = RdashDocument.loadFromJson(JSON.stringify(customRuleJson())).toJson() as any;
  const period = out.GlobalFilters.find((f: any) => f.Id === "_date");
  assert.equal(period.RuleType, "CustomRule");
  assert.equal(period.CustomRule, undefined, "fixed: CustomRule survives now, update editing.md and SKILL.md");
});

await test("losscheck: a dropped CustomRule is a user-visible loss", async () => {
  await writeRdash(`${dir}/CustomRule.rdash`, customRuleJson());
  const r = run("losscheck", `${dir}/CustomRule.rdash`);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /CustomRule/);
});

await test("trap: each serialization of a new document adds a copy of its data sources; saveRdash writes one", async () => {
  const doc = createSalesDashboard();
  const ids = () => (doc.toJson() as any).DataSources.map((d: any) => d.Id).join(",");
  assert.notEqual(ids(), ids().split(",").slice(0, 1).join(","), "fixed: toJson is idempotent now, update typescript.md");
  const fresh = createSalesDashboard();
  await saveRdash(fresh, `${dir}/Once.rdash`);
  const saved = (await readRdashJson(`${dir}/Once.rdash`)).DataSources.map((d: any) => d.Id);
  assert.deepEqual(saved, [...new Set(saved)]);
});

await test("saveRdash: overwriting a larger file leaves no stale tail", async () => {
  const big = createSalesDashboard();
  big.visualizations = Array.from({ length: 30 }, () => big.visualizations).flat().slice(0, 30);
  await saveRdash(big, `${dir}/Over.rdash`);
  const bigSize = (await stat(`${dir}/Over.rdash`)).size;
  await saveRdash(createSalesDashboard(), `${dir}/Over.rdash`);
  assert.ok((await stat(`${dir}/Over.rdash`)).size < bigSize / 2, "the old file's bytes are still there");
  assert.equal((await readRdashJson(`${dir}/Over.rdash`)).Widgets.length, 5);
});

await test("guard: tolerates JSON without Widgets", () => {
  for (const json of [{ Title: "x" }, { Widgets: null }, { Widgets: [] }, { Widgets: [{ Title: "w" }], GlobalFilters: null }]) {
    assert.deepEqual(findBindingProblems(json), []);
  }
});

await test("guard: a link must pass a source column, not the target filter's title (#71)", () => {
  const source = (value: string) => {
    const v = new ColumnChartVisualization("Revenue by region", salesItem()).setLabel("Region").setValues("Revenue");
    v.linker = new VisualizationLinker().addDashboard("Region detail", "RegionDetail", [new LinkFilter("Region", "target-filter-id", value)]);
    const doc = new RdashDocument("x");
    doc.visualizations = [v];
    return doc.toJson();
  };
  assert.doesNotThrow(() => assertBoundFieldsExist(source("Region")));
  assert.throws(() => assertBoundFieldsExist(source("Sales region")), /passing "Sales region", which is not a field/);
});

await test("guard: a pivot over transposed data binds transposed fields", () => {
  const json = createSalesDashboard().toJson() as any;
  const w = json.Widgets[0];
  w.DataSpec.IsTransposed = true;
  w.DataSpec.TransposedFields = [{ FieldName: "23400", FieldType: "Number" }];
  w.VisualizationDataSpec.Extra = { FieldName: "23400" };
  assert.deepEqual(findBindingProblems(json), []);
});

await test("guard: an edit is judged on the problems it adds, not on the original's", () => {
  const original = { GlobalFilters: [], Widgets: [{ Title: "w", DataSpec: { Fields: [{ FieldName: "a" }], Bindings: { Bindings: [{ Target: { GlobalFilterId: "gone" } }] } } }] };
  assert.throws(() => assertBoundFieldsExist(original), /"gone"/);
  assert.doesNotThrow(() => assertBoundFieldsExist(original, original));
});

await test("losscheck: an unreadable file is exit 2, not 1", async () => {
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/not-a-zip.rdash`, "<xml/>");
  assert.equal(run("losscheck", `${dir}/not-a-zip.rdash`).status, 2);
  assert.equal(run("losscheck", `${dir}/Sales.rdash`, `${dir}/missing.rdash`).status, 2);
});

await test("losscheck: a dropped K/M format (ApplyMkFormat) is a loss", async () => {
  const r = await loss("mk", widget({ Formatting: { ApplyMkFormat: true, DecimalDigits: 1 } }), widget({ Formatting: { DecimalDigits: 1 } }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

await test("losscheck: a data source item's Description alone is not a visible loss", async () => {
  const w = (d?: string) => widget({ DataSpec: { DataSourceItem: { Id: "i", Title: "I", ...(d ? { Description: d } : {}) } } });
  const r = await loss("desc", w("Sales table"), w());
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

await test("losscheck: a visible value set to null is a loss", async () => {
  const r = await loss("null", widget({ Formatting: { DecimalDigits: 2 } }), widget({ Formatting: { DecimalDigits: null } }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
});

await test("losscheck: added settings and a recreated visualization (new id) are listed", async () => {
  const before = { Widgets: [{ Id: "w1", Title: "Revenue", Formatting: { DecimalDigits: 2 } }, { Id: "w2", Title: "Other" }] };
  const after = { Widgets: [{ Id: "w9", Title: "Revenue" }, { Id: "w2", Title: "Other", Formatting: { DecimalDigits: 2 } }] };
  const r = await loss("recreated", before, after);
  assert.equal(r.status, 0, r.stdout + r.stderr);   // two files: may be your edits, so listed only
  assert.match(r.stdout, /removed: \.Widgets\["Revenue"\]/);
  assert.match(r.stdout, /added: \.Widgets\["Revenue"\]/);
  assert.match(r.stdout, /Formatting: \(added\)/);
});

await test("inspect: reads trailing commas, prints links and date filter rules, never \"undefined\"", async () => {
  const doc = createSalesDashboard();
  (doc.visualizations[1] as ColumnChartVisualization).linker = new VisualizationLinker().addDashboard("Detail", "Target", [new LinkFilter("Region", "f1", "Region")]);
  const json = JSON.parse(doc.toJsonString());
  json.GlobalFilters[0].RuleType = "CustomRule";
  json.GlobalFilters[0].CustomRule = { Relation: "Last", Count: 2, Period: "Week" };
  bindingsOf(json, 2).push({ Source: { FieldName: "OrderDate" }, Target: { _type: "DateGlobalFilterBindingTargetType" } });
  await writeRdash(`${dir}/Commas.rdash`, JSON.stringify(json, null, 1).replace(/\n(\s*)\}/g, ",\n$1}"));
  const r = run("inspect", `${dir}/Commas.rdash`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /link: "Detail" dashboard Target {2}passes Region -> filter f1/);
  assert.match(r.stdout, /rule=CustomRule Last 2 Week/);
  assert.match(r.stdout, /\(legacy binding, no id\) -> OrderDate/);
  assert.doesNotMatch(r.stdout, /undefined/);
  assert.equal(run("inspect", `${dir}/not-a-zip.rdash`).status, 2);
});

await test("spec: the example spec builds and passes the guard", async () => {
  await saveRdash(buildDashboard(validateSpec(exampleSpec)), `${dir}/Spec.rdash`);
  const s = summarize(await readRdashJson(`${dir}/Spec.rdash`));
  assert.equal(s.visualizations.length, 7);
  assert.match(JSON.stringify((await readRdashJson(`${dir}/Spec.rdash`)).Widgets[1].VisualizationDataSpec), /SummarizationDateField/);
});

await test("spec: a hostile spec is rejected with every problem, nothing built", () => {
  const hostile = {
    title: "x", connectionString: "Server=evil",
    items: [{ id: "o", source: "salesdb", table: "orders", host: "10.0.0.5", customQuery: "SELECT * FROM tenants" },
      { id: "r", source: "rest", table: "x", url: "http://169.254.169.254/" }],
    widgets: [{ type: "grid", title: "All", item: "o", columns: ["id", "tenant_id"] },
      { type: "column", title: "R", item: "o", label: "region", values: ["Total_Amount"], sql: "SELECT 1" }],
  };
  try { validateSpec(hostile); assert.fail("accepted"); }
  catch (e) {
    assert.ok(e instanceof SpecError, String(e));
    for (const p of [/spec\.connectionString: not allowed/, /\.host: not allowed/, /\.customQuery: not allowed/, /\.url: not allowed/,
      /"tenant_id" is not allowed/, /Did you mean "total_amount"/, /\.sql: not allowed/]) assert.match(e.message, p);
  }
  const many = { ...exampleSpec, widgets: Array.from({ length: 13 }, (_, i) => ({ type: "text", title: `t${i}`, text: "x" })) };
  assert.throws(() => validateSpec(many), /limit is 12/);
  assert.throws(() => validateSpec(JSON.parse('{"title":"t","items":[{"id":"s","source":"sample","table":"sales","__proto__":{"x":1}}],"widgets":[]}')), /__proto__: unknown property/);
});

await test("migrate: refuses a lossy write, never touches the original, --allow-loss writes", async () => {
  const inDir = `${dir}/migrate-in`, outDir = `${dir}/migrate-out`;
  await writeRdash(`${inDir}/Lossy.rdash`, customRuleJson());
  await saveRdash(createSalesDashboard(), `${inDir}/Clean.rdash`);
  const original = await readFile(`${inDir}/Lossy.rdash`);
  let r = run("migrate", inDir, "--out", outDir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /refused +Lossy\.rdash/);
  assert.ok(!existsSync(`${outDir}/Lossy.rdash`) && existsSync(`${outDir}/Clean.rdash`));
  assert.match(await readFile(`${outDir}/migrate-log.txt`, "utf8"), /CustomRule/);
  r = run("migrate", inDir, "--out", outDir, "--allow-loss");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(`${outDir}/Lossy.rdash`));
  assert.deepEqual(await readFile(`${inDir}/Lossy.rdash`), original);
  assert.equal(run("migrate", inDir, "--out", inDir).status, 2);
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nAll passed. Dashboards are in out/test; render them with ../preview.");
