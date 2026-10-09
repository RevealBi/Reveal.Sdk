// Prints what a .rdash contains: data sources, items and their declared fields,
// dashboard filters, and every visualization with its type, item, bound fields and
// filter connections. Reads the raw JSON, so it works on any .rdash (including ones the
// DOM cannot load) and never changes the file.
// Run: npm run inspect -- <file.rdash> [--json]
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
  filters: { id: string; title: string; kind: "date" | "data"; field?: string }[];
  visualizations: {
    index: number; id: string; title: string; type: string; item?: string;
    boundFields: string[]; filterConnections: string[]; span: string;
  }[];
}

export function summarize(d: J): DashboardSummary {
  const filters = (d.GlobalFilters ?? []).map((f: J) => ({
    id: f.Id,
    title: f.Title,
    kind: String(f._type ?? "").includes("Date") || f.Id === "_date" ? "date" : "data",
    field: f.SelectedFieldName ?? f.FieldName,
  }));
  const filterTitle = new Map<string, string>(filters.map((f: J) => [f.id, f.title]));
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
      filterConnections: (ds.Bindings?.Bindings ?? []).map((b: J) =>
        `${filterTitle.get(b.Target?.GlobalFilterId) ?? b.Target?.GlobalFilterId} -> ${b.Source?.FieldName}`),
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
    // Deduplicated by id: the TypeScript DOM writes the data sources of a REST item twice.
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
    process.exit(1);
  }
  const summary = summarize(await readRdashJson(file));
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`${summary.title}  (format ${summary.formatVersion}, theme ${summary.theme}, auto layout ${summary.useAutoLayout}, saved with ${summary.savedWith || summary.createdWith})`);
    console.log("\nData sources:");
    for (const s of summary.dataSources) console.log(`  ${s.id}  ${s.provider}  "${s.title}"  ${JSON.stringify(s.properties ?? {})}`);
    console.log("\nData source items:");
    for (const it of summary.dataSourceItems) console.log(`  ${it.id}  "${it.title}"  source=${it.dataSourceId}  ${JSON.stringify(it.properties ?? {})}\n    fields: ${it.fields.join(", ")}`);
    console.log("\nDashboard filters:");
    for (const f of summary.filters) console.log(`  [${f.kind}] "${f.title}"  id=${f.id}${f.field ? `  field=${f.field}` : ""}`);
    console.log("\nVisualizations:");
    for (const v of summary.visualizations) {
      console.log(`  ${v.index}. "${v.title}"  ${v.type}  item=${v.item ?? "-"}  span=${v.span}  id=${v.id}`);
      if (v.boundFields.length) console.log(`     binds: ${v.boundFields.join(", ")}`);
      if (v.filterConnections.length) console.log(`     filters: ${v.filterConnections.join("; ")}`);
    }
  }
}
