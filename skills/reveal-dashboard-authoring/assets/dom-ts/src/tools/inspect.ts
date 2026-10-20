// Prints what a .rdash contains: data sources, items and their declared fields,
// dashboard filters, and every visualization with its type, item, bound fields and
// filter connections and links. Reads the raw JSON, so it works on any .rdash (including ones
// the DOM cannot load, or with trailing commas) and never changes the file.
// Run: npm run inspect -- <file.rdash> [--json]     Exit code 2: the file isn't a readable .rdash.
import { isMain, readRdashJson } from "../lib/rdash-file.js";

type J = Record<string, any>;

function fieldNames(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach(n => fieldNames(n, out));
  else if (node && typeof node === "object") {
    const o = node as J;
    if (typeof o.FieldName === "string" && o.FieldName) out.add(o.IsCalculated ? `${o.FieldName} (calculated)` : o.FieldName);
    Object.values(o).forEach(v => fieldNames(v, out));
  }
  return out;
}

export interface DashboardSummary {
  title: string;
  formatVersion: number;
  theme: string;
  useAutoLayout: boolean;
  createdWith?: string;
  savedWith?: string;
  dataSources: { id: string; provider: string; title?: string; properties?: J }[];
  dataSourceItems: { id: string; title?: string; dataSourceId?: string; properties?: J; fields: string[] }[];
  filters: { id: string; title: string; kind: "date" | "data"; field?: string; rule?: string }[];
  visualizations: {
    index: number; id: string; title: string; type: string; item?: string;
    boundFields: string[]; filterConnections: string[]; links: string[]; span: string;
  }[];
}

function dateRule(f: J): string | undefined {
  if (!f.RuleType) return undefined;
  const r = f.CustomRule;
  if (r) return `${f.RuleType} ${r.Relation ?? ""} ${r.Count ?? ""} ${r.Period ?? ""}`.replace(/\s+/g, " ").trim();
  const range = f.CustomDateRange;
  // Dates are written as {"_type": "date", "value": "..."}.
  const day = (v: J) => (typeof v === "object" ? v?.value : v) ?? "?";
  if (range) return `${f.RuleType} ${day(range.From)} .. ${day(range.To)}`;
  return f.RuleType;
}

export function summarize(d: J): DashboardSummary {
  const filters = (d.GlobalFilters ?? []).map((f: J) => ({
    id: f.Id,
    title: f.Title,
    kind: String(f._type ?? "").includes("Date") || f.Id === "_date" ? "date" : "data",
    field: f.SelectedFieldName ?? f.FieldName,
    rule: dateRule(f),
  }));
  const filterTitle = new Map<string, string>(filters.map((f: J) => [f.id, f.title]));
  // A connection whose filter id the dashboard lacks is dead: the visualization ignores that filter
  // (TypeScript connects date filters to "_date", which loaded dashboards don't have). The editor's
  // legacy date binding has no id and follows the dashboard's date filter.
  const target = (t: J): string => {
    const id = t?.GlobalFilterId;
    if (id) return filterTitle.get(id) ?? `${id} (no such filter)`;
    return String(t?._type ?? "").includes("Date") ? `${t?.GlobalFilterFieldName ?? "date filter"} (legacy binding, no id)` : "(no target)";
  };
  const items = new Map<string, DashboardSummary["dataSourceItems"][number]>();
  const visualizations = (d.Widgets ?? []).map((w: J, i: number) => {
    const ds = w.DataSpec ?? {};
    const item = ds.DataSourceItem;
    if (item?.Id && !items.has(item.Id)) {
      items.set(item.Id, {
        id: item.Id,
        title: item.Title,
        dataSourceId: item.DataSourceId,
        // JSON, CSV and Excel items wrap a resource item (REST, web, local file) that holds the location.
        properties: item.ResourceItem ? { ...item.Properties, resourceItem: item.ResourceItem.Properties } : item.Properties,
        fields: (ds.Fields ?? []).map((f: J) => `${f.FieldName}:${f.FieldType}`),
      });
    }
    const s = w.VisualizationSettings ?? {};
    return {
      index: i,
      id: w.Id,
      title: w.Title,
      type: s.ChartType ?? s.VisualizationType ?? s._type,
      item: item?.Id,
      boundFields: [...fieldNames(w.VisualizationDataSpec)],
      filterConnections: (ds.Bindings?.Bindings ?? []).map((b: J) => `${target(b.Target)} -> ${b.Source?.FieldName ?? "?"}`),
      // Dashboard links pass Name=Value, where Value is the clicked row's column and Namespace the target's filter id.
      links: (w.ActionsModel?.Actions ?? []).map((a: J) => `"${a.Title}" ${a.Type === "OpenUrl" ? "url" : "dashboard"} ${a.Url}` +
        (a.Parameters?.length ? `  passes ${a.Parameters.map((p: J) => `${p.Value} -> filter ${p.Namespace ?? p.Name}`).join(", ")}` : "")),
      span: `${w.RowSpan}x${w.ColumnSpan}`,
    };
  });
  return {
    title: d.Title,
    formatVersion: d.FormatVersion,
    theme: d.ThemeName ?? "(default)",
    useAutoLayout: d.UseAutoLayout,
    createdWith: d.CreatedWith,
    savedWith: d.SavedWith,
    // Deduplicated by id: @revealbi/dom adds a copy of every data source (any connector) each time
    // a new document is serialized.
    dataSources: [...new Map((d.DataSources ?? []).map((s: J) =>
      [s.Id, { id: s.Id, provider: s.Provider, title: s.Title ?? s.Description, properties: s.Properties }])).values()] as DashboardSummary["dataSources"],
    dataSourceItems: [...items.values()],
    filters,
    visualizations,
  };
}

if (isMain(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run inspect -- <file.rdash> [--json]");
    process.exit(2);
  }
  let summary: DashboardSummary;
  try { summary = summarize(await readRdashJson(file)); }
  catch (e) { console.log(`Can't read ${file}: ${(e as Error).message.split("\n")[0]}`); process.exit(2); }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`${summary.title}  (format ${summary.formatVersion}, theme ${summary.theme}, auto layout ${summary.useAutoLayout}, saved with ${summary.savedWith || summary.createdWith})`);
    console.log("\nData sources:");
    for (const s of summary.dataSources) console.log(`  ${s.id}  ${s.provider}  "${s.title}"  ${JSON.stringify(s.properties ?? {})}`);
    console.log("\nData source items:");
    for (const it of summary.dataSourceItems) console.log(`  ${it.id}  "${it.title}"  source=${it.dataSourceId}  ${JSON.stringify(it.properties ?? {})}\n    fields: ${it.fields.join(", ")}`);
    console.log("\nDashboard filters:");
    for (const f of summary.filters) console.log(`  [${f.kind}] "${f.title}"  id=${f.id}${f.field ? `  field=${f.field}` : ""}${f.rule ? `  rule=${f.rule}` : ""}`);
    console.log("\nVisualizations:");
    for (const v of summary.visualizations) {
      console.log(`  ${v.index}. "${v.title}"  ${v.type}  item=${v.item ?? "-"}  span=${v.span}  id=${v.id}`);
      if (v.boundFields.length) console.log(`     binds: ${v.boundFields.join(", ")}`);
      if (v.filterConnections.length) console.log(`     filters: ${v.filterConnections.join("; ")}`);
      for (const l of v.links) console.log(`     link: ${l}`);
    }
  }
}
