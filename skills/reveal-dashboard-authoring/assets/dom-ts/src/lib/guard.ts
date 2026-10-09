// The DOM checks that every data source item declares fields, but not that the names a
// visualization or a dashboard filter binds exist among them. A typo, or a date filter
// connected without a field name (it then binds a field called "Date"), serializes fine
// and only fails when the dashboard renders. Run this on doc.toJson() before every save.
// It reads the serialized form, so it also checks dashboards made in the editor or by
// Reveal.Sdk.Dom.

type Json = Record<string, unknown>;

function boundFieldNames(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) boundFieldNames(n, out);
  } else if (node && typeof node === "object") {
    const o = node as Json;
    // Empty names are placeholders the editor writes; calculated fields live on the
    // visualization, not on the data source item.
    if (typeof o.FieldName === "string" && o.FieldName && o.IsCalculated !== true) out.push(o.FieldName);
    for (const v of Object.values(o)) boundFieldNames(v, out);
  }
  return out;
}

export function assertBoundFieldsExist(dashboardJson: object): void {
  const widgets = ((dashboardJson as Json).Widgets ?? []) as Json[];
  for (const w of widgets) {
    const dataSpec = w.DataSpec as Json | undefined;
    const declared = ((dataSpec?.Fields ?? []) as Json[]).map(f => f.FieldName);
    if (declared.length === 0) continue; // text box, image and XMLA widgets
    const known = new Set(declared);
    for (const name of boundFieldNames([w.VisualizationDataSpec, dataSpec?.Bindings])) {
      if (!known.has(name)) {
        throw new Error(`"${w.Title}" binds "${name}", which its data source item does not declare. Declared: ${declared.join(", ")}`);
      }
    }
  }
}
