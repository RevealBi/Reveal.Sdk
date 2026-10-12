// A dashboard from a JSON spec (a user form or an LLM). The spec is UNTRUSTED:
// - it may only NAME entries of the server-side CATALOG below (source, table, fields); the data
//   source, provider, host, URL and item ids come from the catalog, never from the spec;
// - every object is checked against an exact key list, so a spec can't smuggle in host, url,
//   connectionString, sql, customQuery, ... (unknown keys are rejected, not ignored);
// - each field is checked against the catalog and its binding (values need numbers, KPI dates need
//   dates, data filters need text; a date label always becomes a DateDataField);
// - widget, filter, item and string sizes are capped; every problem is reported at once and
//   nothing is built from a bad spec. Reveal 2.2.1 renders titles and text boxes as text, not HTML.
//   Run: npm run spec -- <spec.json> [out/Spec.rdash]   Exit 0: written. 4: spec rejected.
import { readFile } from "node:fs/promises";
import {
  AggregationType,
  BarChartVisualization,
  ColumnChartVisualization,
  DashboardDataFilter,
  DashboardDateFilter,
  DataSourceItem,
  DateAggregationType,
  DateDataField,
  DateField,
  DateRuleType,
  GridVisualization,
  KpiTimeVisualization,
  LineChartVisualization,
  NumberDataField,
  NumberField,
  PieChartVisualization,
  PivotVisualization,
  PostgreSqlDataSource,
  PostgreSqlDataSourceItem,
  RdashDocument,
  TextBoxVisualization,
  TextField,
} from "@revealbi/dom";
import { salesItem } from "../lib/sample-data.js";
import { isMain, saveRdash } from "../lib/rdash-file.js";

// ---- the server-side catalog: the only place data locations come from ------------------------
type FieldKind = "text" | "number" | "date";
interface TableEntry {
  title: string;
  fields: Record<string, FieldKind>;
  /** Builds the item with a stable id: the server's data source item provider looks it up in its own allow-list. */
  build(): DataSourceItem;
}

export const CATALOG: Record<string, Record<string, TableEntry>> = {
  sample: {
    sales: {
      title: "Sales",
      fields: { OrderId: "number", OrderDate: "date", Region: "text", Product: "text", Category: "text", Quantity: "number", Revenue: "number" },
      build: salesItem,
    },
  },
  salesdb: {
    orders: {
      title: "Orders",
      // tenant_id is deliberately NOT listed: a spec can't bind or display it.
      fields: { id: "number", order_date: "date", status: "text", region: "text", total_amount: "number" },
      build() {
        const ds = new PostgreSqlDataSource("Sales database");
        ds.id = "SalesDb";
        ds.host = "placeholder";      // the server's data source provider sets the real one
        ds.database = "placeholder";
        const item = new PostgreSqlDataSourceItem("Orders", ds);
        item.id = "Orders";
        item.table = "orders";
        item.fields = Object.entries(this.fields).map(([name, kind]) =>
          kind === "number" ? new NumberField(name) : kind === "date" ? new DateField(name) : new TextField(name));
        return item;
      },
    },
  },
};

export const LIMITS = { widgets: 12, items: 3, filters: 4, title: 120, text: 2000, fieldsPerWidget: 8 } as const;

const WIDGET_TYPES = ["kpi", "column", "bar", "line", "pie", "grid", "pivot", "text"] as const;
type WidgetType = typeof WIDGET_TYPES[number];
const AGGREGATIONS = ["sum", "avg", "min", "max", "count", "countDistinct"] as const;
const DATE_GROUPS = ["year", "quarter", "month", "day"] as const;
const DATE_RULES = ["allTime", "yearToDate", "thisYear", "previousYear", "lastYear", "thisQuarter", "previousQuarter"] as const;

// Keys that are dangerous in a spec. They are rejected anyway (unknown key), but get a
// message that says why.
const FORBIDDEN = /^(host|hostname|server|port|url|uri|endpoint|connection(string)?|connstr|database|db|schema|sql|query|customquery|procedure|function|credentials?|user(name)?|password|token|apikey|provider|datasource|path|file)$/i;

export class SpecError extends Error {
  constructor(public readonly problems: string[]) {
    super(`The dashboard spec was rejected (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n` +
      problems.map(p => `  - ${p}`).join("\n"));
    this.name = "SpecError";
  }
}

// ---- the validated, typed spec ---------------------------------------------------------
interface ItemRef { id: string; entry: TableEntry }
interface ValueRef { field: string; agg: typeof AGGREGATIONS[number] }
interface DimRef { field: string; group?: typeof DATE_GROUPS[number] }
type Widget =
  | { type: "kpi"; title: string; item: string; date: string; value: ValueRef }
  | { type: "column" | "bar" | "line"; title: string; item: string; label: DimRef; values: ValueRef[] }
  | { type: "pie"; title: string; item: string; label: DimRef; value: ValueRef }
  | { type: "grid"; title: string; item: string; columns: string[] }
  | { type: "pivot"; title: string; item: string; rows: DimRef[]; columns: DimRef[]; values: ValueRef[] }
  | { type: "text"; title: string; text: string };
type Filter =
  | { type: "data"; title: string; item: string; field: string }
  | { type: "date"; title: string; item: string; field: string; rule: typeof DATE_RULES[number] };
export interface Spec { title: string; items: ItemRef[]; filters: Filter[]; widgets: Widget[] }

// ---- validation ----------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// No control characters (newlines included) in titles; the text box allows newlines.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/;

class Checker {
  problems: string[] = [];
  fail(path: string, msg: string): undefined { this.problems.push(`${path}: ${msg}`); return undefined; }

  keys(o: Obj, path: string, required: string[], optional: string[] = []): boolean {
    let ok = true;
    for (const k of Object.keys(o)) {
      if (required.includes(k) || optional.includes(k)) continue;
      ok = false;
      if (FORBIDDEN.test(k)) this.fail(`${path}.${k}`, `not allowed: a spec can't choose hosts, URLs, connection strings, credentials, databases or queries. Data locations come only from the server's catalog (sources: ${Object.keys(CATALOG).join(", ")})`);
      else this.fail(`${path}.${k}`, `unknown property (allowed: ${[...required, ...optional].join(", ")})`);
    }
    for (const k of required) if (!(k in o)) { ok = false; this.fail(path, `missing "${k}"`); }
    return ok;
  }

  str(v: unknown, path: string, max: number, allowNewlines = false): string | undefined {
    if (typeof v !== "string") return this.fail(path, "must be a string");
    if (v.trim() === "") return this.fail(path, "must not be empty");
    if (v.length > max) return this.fail(path, `longer than ${max} characters`);
    if (CONTROL.test(v) || (!allowNewlines && /[\r\n]/.test(v))) return this.fail(path, "contains control characters");
    return v;
  }

  oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T | undefined {
    if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
    return this.fail(path, `must be one of ${allowed.join(", ")} (got ${JSON.stringify(v)?.slice(0, 60)})`);
  }

  array(v: unknown, path: string, max: number, min = 0): unknown[] | undefined {
    if (!Array.isArray(v)) return this.fail(path, "must be an array");
    if (v.length > max) return this.fail(path, `has ${v.length} entries; the limit is ${max}`);
    if (v.length < min) return this.fail(path, `needs at least ${min} entr${min === 1 ? "y" : "ies"}`);
    return v;
  }
}

function suggest(name: string, known: string[]): string {
  const ci = known.find(k => k.toLowerCase() === name.toLowerCase());
  return ci ? ` Did you mean "${ci}"? Field names are case-sensitive.` : "";
}

export function validateSpec(input: unknown): Spec {
  const c = new Checker();
  if (!isObj(input)) throw new SpecError(["spec: must be a JSON object"]);
  c.keys(input, "spec", ["title", "items", "widgets"], ["filters"]);
  const title = c.str(input.title, "spec.title", LIMITS.title);

  // items: { id, source, table } -> a catalog entry
  const items: ItemRef[] = [];
  for (const [i, raw] of (c.array(input.items, "spec.items", LIMITS.items, 1) ?? []).entries()) {
    const p = `spec.items[${i}]`;
    if (!isObj(raw)) { c.fail(p, "must be an object"); continue; }
    c.keys(raw, p, ["id", "source", "table"]);
    const id = typeof raw.id === "string" && SAFE_ID.test(raw.id) ? raw.id : c.fail(`${p}.id`, "must match " + SAFE_ID);
    const source = c.oneOf(raw.source, `${p}.source`, Object.keys(CATALOG));
    const table = source ? c.oneOf(raw.table, `${p}.table`, Object.keys(CATALOG[source])) : undefined;
    if (id && items.some(x => x.id === id)) c.fail(`${p}.id`, `duplicate item id "${id}"`);
    if (id && source && table) items.push({ id, entry: CATALOG[source][table] });
  }
  const itemById = (v: unknown, path: string): ItemRef | undefined => {
    const found = items.find(x => x.id === v);
    return found ?? c.fail(path, `unknown item ${JSON.stringify(v)} (spec items: ${items.map(x => x.id).join(", ") || "none"})`);
  };
  const field = (item: ItemRef | undefined, v: unknown, path: string, kinds: FieldKind[]): string | undefined => {
    if (!item) return undefined;
    if (typeof v !== "string") return c.fail(path, "must be a field name string");
    const known = Object.keys(item.entry.fields);
    const kind = Object.prototype.hasOwnProperty.call(item.entry.fields, v) ? item.entry.fields[v] : undefined;
    if (!kind) return c.fail(path, `field "${v.slice(0, 60)}" is not allowed for ${item.entry.title} (allowed: ${known.join(", ")}).${suggest(v, known)}`);
    if (!kinds.includes(kind)) return c.fail(path, `field "${v}" is ${kind}; this binding needs ${kinds.join(" or ")}`);
    return v;
  };
  const value = (item: ItemRef | undefined, v: unknown, path: string): ValueRef | undefined => {
    if (typeof v === "string") { const f = field(item, v, path, ["number"]); return f ? { field: f, agg: "sum" } : undefined; }
    if (!isObj(v)) return c.fail(path, "must be a field name or { field, agg }");
    c.keys(v, path, ["field"], ["agg"]);
    const agg = v.agg === undefined ? "sum" : c.oneOf(v.agg, `${path}.agg`, AGGREGATIONS);
    // count aggregations work on any field; the others need a number
    const f = field(item, v.field, `${path}.field`, agg === "count" || agg === "countDistinct" ? ["number", "text", "date"] : ["number"]);
    return f && agg ? { field: f, agg } : undefined;
  };
  const dim = (item: ItemRef | undefined, v: unknown, path: string): DimRef | undefined => {
    const raw = isObj(v) ? v : { field: v };
    if (isObj(v)) c.keys(v, path, ["field"], ["group"]);
    const f = field(item, raw.field, isObj(v) ? `${path}.field` : path, ["text", "date", "number"]);
    if (!f || !item) return undefined;
    if (item.entry.fields[f] === "date") {
      // a date column bound by name breaks the widget; it must be grouped (DateDataField)
      const group = raw.group === undefined ? "month" : c.oneOf(raw.group, `${path}.group`, DATE_GROUPS);
      return group ? { field: f, group } : undefined;
    }
    if (raw.group !== undefined) return c.fail(`${path}.group`, `only date fields take a group; "${f}" is ${item.entry.fields[f]}`);
    return { field: f };
  };

  const filters: Filter[] = [];
  for (const [i, raw] of (input.filters === undefined ? [] : c.array(input.filters, "spec.filters", LIMITS.filters) ?? []).entries()) {
    const p = `spec.filters[${i}]`;
    if (!isObj(raw)) { c.fail(p, "must be an object"); continue; }
    const type = c.oneOf(raw.type, `${p}.type`, ["data", "date"] as const);
    if (!type) continue;
    c.keys(raw, p, ["type", "item", "field"], type === "date" ? ["title", "rule"] : ["title"]);
    const item = itemById(raw.item, `${p}.item`);
    const t = raw.title === undefined ? undefined : c.str(raw.title, `${p}.title`, LIMITS.title);
    if (type === "date") {
      const f = field(item, raw.field, `${p}.field`, ["date"]);
      const rule = raw.rule === undefined ? "allTime" : c.oneOf(raw.rule, `${p}.rule`, DATE_RULES);
      if (filters.some(x => x.type === "date")) c.fail(p, "only one date filter per dashboard (@revealbi/dom 0.3.0 gives every date filter the id _date)");
      if (item && f && rule) filters.push({ type, title: t ?? f, item: item.id, field: f, rule });
    } else {
      const f = field(item, raw.field, `${p}.field`, ["text"]);
      if (item && f) filters.push({ type, title: t ?? f, item: item.id, field: f });
    }
  }

  const widgets: Widget[] = [];
  for (const [i, raw] of (c.array(input.widgets, "spec.widgets", LIMITS.widgets, 1) ?? []).entries()) {
    const p = `spec.widgets[${i}]`;
    if (!isObj(raw)) { c.fail(p, "must be an object"); continue; }
    const type = c.oneOf(raw.type, `${p}.type`, WIDGET_TYPES) as WidgetType | undefined;
    if (!type) continue;
    const t = c.str(raw.title, `${p}.title`, LIMITS.title);
    if (type === "text") {
      c.keys(raw, p, ["type", "title", "text"]);
      const text = c.str(raw.text, `${p}.text`, LIMITS.text, true);
      if (t && text) widgets.push({ type, title: t, text });
      continue;
    }
    const shape: Record<Exclude<WidgetType, "text">, string[]> = {
      kpi: ["date", "value"], column: ["label", "values"], bar: ["label", "values"], line: ["label", "values"],
      pie: ["label", "value"], grid: ["columns"], pivot: ["rows", "values"],
    };
    c.keys(raw, p, ["type", "title", "item", ...shape[type]], type === "pivot" ? ["columns"] : []);
    const item = itemById(raw.item, `${p}.item`);
    const list = (v: unknown, path: string, min = 1) => c.array(v, path, LIMITS.fieldsPerWidget, min) ?? [];
    let w: Widget | undefined;
    switch (type) {
      case "kpi": {
        const date = field(item, raw.date, `${p}.date`, ["date"]);
        const v = value(item, raw.value, `${p}.value`);
        if (date && v) w = { type, title: t!, item: item!.id, date, value: v };
        break;
      }
      case "column": case "bar": case "line": {
        const label = dim(item, raw.label, `${p}.label`);
        const values = list(raw.values, `${p}.values`).map((v, j) => value(item, v, `${p}.values[${j}]`));
        if (label && values.length && values.every(Boolean)) w = { type, title: t!, item: item!.id, label, values: values as ValueRef[] };
        break;
      }
      case "pie": {
        const label = dim(item, raw.label, `${p}.label`);
        const v = value(item, raw.value, `${p}.value`);
        if (label && v) w = { type, title: t!, item: item!.id, label, value: v };
        break;
      }
      case "grid": {
        const cols = list(raw.columns, `${p}.columns`).map((v, j) => field(item, v, `${p}.columns[${j}]`, ["text", "number", "date"]));
        if (cols.length && cols.every(Boolean)) w = { type, title: t!, item: item!.id, columns: cols as string[] };
        break;
      }
      case "pivot": {
        const rows = list(raw.rows, `${p}.rows`).map((v, j) => dim(item, v, `${p}.rows[${j}]`));
        const cols = list(raw.columns ?? [], `${p}.columns`, 0).map((v, j) => dim(item, v, `${p}.columns[${j}]`));
        const values = list(raw.values, `${p}.values`).map((v, j) => value(item, v, `${p}.values[${j}]`));
        if (rows.length && [...rows, ...cols, ...values].every(Boolean))
          w = { type, title: t!, item: item!.id, rows: rows as DimRef[], columns: cols as DimRef[], values: values as ValueRef[] };
        break;
      }
    }
    if (w && t) widgets.push(w);
  }

  if (c.problems.length) throw new SpecError(c.problems);
  return { title: title!, items, filters, widgets };
}

// ---- building ------------------------------------------------------------------------------
const AGG: Record<ValueRef["agg"], AggregationType> = {
  sum: AggregationType.Sum, avg: AggregationType.Avg, min: AggregationType.Min, max: AggregationType.Max,
  count: AggregationType.CountRows, countDistinct: AggregationType.CountDistinct,
};
const GROUP: Record<NonNullable<DimRef["group"]>, DateAggregationType> = {
  year: DateAggregationType.Year, quarter: DateAggregationType.Quarter, month: DateAggregationType.Month, day: DateAggregationType.Day,
};
const RULE: Record<Extract<Filter, { type: "date" }>["rule"], DateRuleType> = {
  allTime: DateRuleType.AllTime, yearToDate: DateRuleType.YearToDate, thisYear: DateRuleType.ThisYear,
  previousYear: DateRuleType.PreviousYear, lastYear: DateRuleType.LastYear, thisQuarter: DateRuleType.ThisQuarter,
  previousQuarter: DateRuleType.PreviousQuarter,
};

function numberField(v: ValueRef): NumberDataField {
  const f = new NumberDataField(v.field);
  f.aggregationType = AGG[v.agg];
  if (v.agg !== "sum") f.fieldLabel = `${v.field} (${v.agg})`;
  return f;
}
function dimField(d: DimRef): string | DateDataField {
  if (!d.group) return d.field;
  const f = new DateDataField(d.field);
  f.aggregationType = GROUP[d.group];
  return f;
}

export function buildDashboard(spec: Spec): RdashDocument {
  const doc = new RdashDocument(spec.title);
  // One DataSourceItem object per spec item, built from the catalog (never from the spec).
  const built = new Map<string, DataSourceItem>(spec.items.map(i => [i.id, i.entry.build()]));
  const itemOf = (id: string) => built.get(id)!;

  const dashFilters = spec.filters.map(f => {
    if (f.type === "date") {
      const df = new DashboardDateFilter(f.title);
      df.ruleType = RULE[f.rule];                       // default would be LastYear
      return { spec: f, filter: df };
    }
    return { spec: f, filter: new DashboardDataFilter(f.field, f.title, itemOf(f.item)) };
  });
  doc.filters = dashFilters.map(x => x.filter);

  doc.visualizations = spec.widgets.map(w => {
    if (w.type === "text") return new TextBoxVisualization(w.title).setText(w.text);
    const item = itemOf(w.item);
    const v = (() => {
      switch (w.type) {
        case "kpi": return new KpiTimeVisualization(w.title, item).setDate(w.date).setValue(numberField(w.value));
        case "column": return new ColumnChartVisualization(w.title, item).setLabel(dimField(w.label)).setValues(...w.values.map(numberField));
        case "bar": return new BarChartVisualization(w.title, item).setLabel(dimField(w.label)).setValues(...w.values.map(numberField));
        case "line": return new LineChartVisualization(w.title, item).setLabel(dimField(w.label)).setValues(...w.values.map(numberField));
        case "pie": return new PieChartVisualization(w.title, item).setLabel(dimField(w.label)).setValue(numberField(w.value));
        case "grid": return new GridVisualization(w.title, item).setColumns(...w.columns);
        case "pivot": return new PivotVisualization(w.title, item)
          .setRows(w.rows.map(dimField)).setColumns(w.columns.map(dimField)).setValues(...w.values.map(numberField));
      }
    })();
    // Connect every dashboard filter whose item is this widget's item; always name the field.
    for (const { spec: f, filter } of dashFilters) {
      if (f.item !== w.item) continue;
      v.connectDashboardFilter(filter, f.field);
    }
    return v;
  });
  return doc;
}

/** A spec that passes: the sample sales data, both filters, every widget type. */
export const exampleSpec = {
  title: "Regional sales (generated from a spec)",
  items: [{ id: "s", source: "sample", table: "sales" }],
  filters: [
    { type: "date", item: "s", field: "OrderDate", title: "Order date", rule: "allTime" },
    { type: "data", item: "s", field: "Region" },
  ],
  widgets: [
    { type: "kpi", title: "Revenue", item: "s", date: "OrderDate", value: "Revenue" },
    { type: "column", title: "Revenue by month", item: "s", label: { field: "OrderDate", group: "month" }, values: ["Revenue"] },
    { type: "pie", title: "Revenue by category", item: "s", label: "Category", value: "Revenue" },
    { type: "bar", title: "Orders by product", item: "s", label: "Product", values: [{ field: "OrderId", agg: "count" }] },
    { type: "pivot", title: "Region x year", item: "s", rows: ["Region"], columns: [{ field: "OrderDate", group: "year" }], values: ["Revenue"] },
    { type: "text", title: "About", text: "Generated from a JSON spec.\nOnly allow-listed sources and fields." },
    { type: "grid", title: "Orders", item: "s", columns: ["OrderId", "OrderDate", "Region", "Product", "Revenue"] },
  ],
};

if (isMain(import.meta.url)) {
  const [specPath, outPath = "out/Spec.rdash"] = process.argv.slice(2);
  let input: unknown = exampleSpec;
  if (specPath) {
    try { input = JSON.parse(await readFile(specPath, "utf8")); }
    catch (e) { console.error(`spec: not valid JSON (${(e as Error).message})`); process.exit(4); }
  }
  try {
    const doc = buildDashboard(validateSpec(input));
    await saveRdash(doc, outPath);                 // the guard runs here
    console.log(`Wrote ${outPath} (${doc.visualizations.length} visualizations, ${doc.filters.length} filters)`);
  } catch (e) {
    if (e instanceof SpecError) { console.error(e.message); process.exit(4); }
    throw e;
  }
}
