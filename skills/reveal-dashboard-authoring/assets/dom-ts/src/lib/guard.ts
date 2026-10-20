// The DOM checks that every data source item declares fields, but not that the names a
// visualization or a dashboard filter binds exist among them. A typo, a date filter connected
// without a field name (it then binds a field called "Date"), a binding to a filter the
// dashboard doesn't have, or a link that passes a non-column serializes fine and fails only
// when the dashboard renders, often with no error at all. Run this on doc.toJson() before
// every save (saveRdash does). It reads the serialized form, so it also checks dashboards
// made in the editor or by Reveal.Sdk.Dom: npm run guard -- <file.rdash>
//
// Checked: bound field names (values, labels, columns, dates, dashboard filter connections),
// each dashboard data filter's own field, date fields bound as plain values, that every
// binding's target filter exists, dashboard link parameters, and REST items read without
// their JSON wrapper. Not checked: text boxes and Analysis Services (XMLA) widgets declare no
// fields; render those.

type Json = Record<string, any>;

function collect(node: unknown, pick: (o: Json) => string | undefined, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, pick, out);
  } else if (node && typeof node === "object") {
    const name = pick(node as Json);
    if (name) out.push(name);
    for (const v of Object.values(node)) collect(v, pick, out);
  }
  return out;
}
// Empty names are placeholders the editor writes; calculated fields live on the
// visualization, not on the data source item.
const boundName = (o: Json) =>
  typeof o.FieldName === "string" && o.FieldName && o.IsCalculated !== true ? o.FieldName : undefined;
// A date column bound by name is written as a plain dimension, and Reveal fails the widget
// ("Specified cast is not valid", or a spinner that never stops). It needs a DateDataField.
const plainDimension = (o: Json) =>
  o._type === "SummarizationRegularFieldType" && typeof o.FieldName === "string" ? o.FieldName : undefined;
// Editor JSON may lack a list or hold null; never crash on it.
const list = (v: unknown): Json[] => (Array.isArray(v) ? v : []);

/** Every problem the guard finds, one line each. Empty when the dashboard passes. */
export function findBindingProblems(dashboardJson: object): string[] {
  const d = dashboardJson as Json;
  const problems: string[] = [];
  const filterIds = new Set(list(d.GlobalFilters).map(f => f.Id));
  const dateFilters = list(d.GlobalFilters).filter(f => String(f._type).startsWith("Date")).length;
  const providers = new Map(list(d.DataSources).map(s => [s.Id, s.Provider]));
  for (const w of list(d.Widgets)) {
    const dataSpec = w.DataSpec as Json | undefined;
    // A REST item gives rows only inside its JSON (or CSV, Excel) wrapper. The no-argument
    // RestDataSourceItem constructor, or assigning item.dataSource afterwards, puts the widget
    // straight on the REST data source, and Reveal 2.2.1 fails it: "unknown type ('REST')".
    const item = dataSpec?.DataSourceItem as Json | undefined;
    if (item && providers.get(item.DataSourceId) === "REST") {
      problems.push(`"${w.Title}" reads item "${item.Id}" straight from REST data source "${item.DataSourceId}", without its JSON wrapper, ` +
        `so Reveal fails it with "unknown type ('REST')". Build the item with new RestDataSourceItem(title, url, dataSource) ` +
        `(or jsonFileItem in sample-data.ts) and don't assign item.dataSource afterwards.`);
    }
    // Binding targets don't depend on fields. TypeScript binds every date filter connection to "_date",
    // which a loaded dashboard's date filters (GUID ids) and an imported visualization's target don't
    // have. Rendered (two GUID date filters): the widget shows unfiltered data, no error.
    // Deliberately strict with ONE date filter too: a load + save in either library also rewrites the
    // editor's legacy id-less date binding to "_date". Whether Reveal then still applies that single
    // filter is NOT verified (the one render of it, editor Sales.rdash, can't tell: its data may all lie
    // inside the filter's range). Relax this only after a render with a restrictive rule shows it filters.
    // 8 of 350 editor dashboards already carry dead bindings (copied visualizations); when you edit
    // one, pass the original to assertBoundFieldsExist so only new problems fail.
    for (const b of list(dataSpec?.Bindings?.Bindings)) {
      const id = b?.Target?.GlobalFilterId;
      if (!id || filterIds.has(id)) continue;
      if (id === "_date" && dateFilters === 1) {
        problems.push(`"${w.Title}" is connected to date filter id "_date", but the dashboard's only date filter has another id. ` +
          `TypeScript writes "_date" for every date filter connection, and a load + save in either library rewrites the editor's id-less date binding to it. ` +
          `Not verified whether Reveal then applies the date filter (with two date filters it doesn't): connect date filters only on dashboards TypeScript created, ` +
          `and for a round trip render it with a restrictive date rule or keep the original.`);
      } else {
        problems.push(`"${w.Title}" is connected to dashboard filter id "${id}", which the dashboard doesn't have, so the filter is ignored.` +
          (id === "_date" ? ` TypeScript connects date filters to "_date": do it only on dashboards TypeScript created.` : ""));
      }
    }
    // A pivot over transposed data binds the transposed field names (editor VisualizationsLoc.rdash).
    const fields = [...list(dataSpec?.Fields), ...(dataSpec?.IsTransposed ? list(dataSpec?.TransposedFields) : [])];
    const declared = fields.map(f => f.FieldName);
    if (declared.length === 0) continue; // text box and XMLA widgets (image widgets do declare fields)
    const known = new Set(declared);
    for (const name of new Set(collect([w.VisualizationDataSpec, dataSpec?.Bindings], boundName))) {
      if (!known.has(name)) problems.push(`"${w.Title}" binds "${name}", which its data source item does not declare. Declared: ${declared.join(", ")}`);
    }
    const dates = new Set(fields.filter(f => f.FieldType === "Date" || f.FieldType === "DateTime").map(f => f.FieldName));
    for (const name of new Set(collect(w.VisualizationDataSpec, plainDimension))) {
      if (dates.has(name)) problems.push(`"${w.Title}" binds date field "${name}" as a plain value; pass a DateDataField (with an aggregation) instead of the name.`);
    }
    // A dashboard link passes the clicked value of a source column. Any other value (the library's
    // own sample passes the target filter's title, revealbi-dom #71) opens the target unfiltered, with no error.
    for (const a of list(w.ActionsModel?.Actions)) {
      for (const p of list(a?.Parameters)) {
        if (p?.Type === "Column" && p.Value && !known.has(p.Value)) {
          problems.push(`"${w.Title}" links to "${a.Title}" passing "${p.Value}", which is not a field of its data source item; pass the source column name. Declared: ${declared.join(", ")}`);
        }
      }
    }
  }
  for (const f of list(d.GlobalFilters)) {
    const declared = list(f.DataSpec?.Fields).map(x => x.FieldName);
    if (f.SelectedFieldName && declared.length && !declared.includes(f.SelectedFieldName)) {
      problems.push(`Dashboard filter "${f.Title}" filters on "${f.SelectedFieldName}", which its data source item does not declare. Declared: ${declared.join(", ")}`);
    }
  }
  return problems;
}

/**
 * Throws, listing every problem, when a binding can't work. With `original` (the Dashboard.json
 * you loaded), problems the original already had are not raised: an edit is judged on what it adds.
 */
export function assertBoundFieldsExist(dashboardJson: object, original?: object): void {
  const existing = new Set(original ? findBindingProblems(original) : []);
  const problems = findBindingProblems(dashboardJson).filter(p => !existing.has(p));
  if (problems.length) throw new Error(problems.join("\n"));
}
