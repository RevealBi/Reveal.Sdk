using System.Text.Json;
using System.Text.Json.Nodes;

namespace DomSamples;

public static class Guard
{
    // Reveal.Sdk.Dom checks that every data source item declares fields, but not that what a
    // dashboard references exists. Each of these saves fine and fails, or silently filters
    // nothing, only at render time. Run this on document.ToJsonString() before every save
    // (Examples.Save does). It checks:
    //  - the fields visualizations bind (values, labels, columns, dates, dashboard filter
    //    connections), including a date filter connected without a field name (binds "Date");
    //  - each dashboard data filter's own field (a typo there renders "Regon: All", no error);
    //  - a date column bound by name as a label, row or column: it is written as a plain
    //    dimension and the widget fails ("Specified cast is not valid", or a spinner forever);
    //  - every dashboard filter connection targets a filter the dashboard has;
    //  - dashboard links: a Column parameter passes a source column, and a GlobalFilter
    //    parameter names a date filter of this dashboard (the target dashboard's filter ids
    //    are not checked: they live in the other file).
    // Pivots over transposed data bind the TransposedFields; XMLA widgets declare no fields
    // and are skipped. A document without Widgets is accepted.
    //
    // Dashboards saved by the Reveal editor can already contain some of these (a connection to
    // a date filter that was deleted, a link to a filter the source no longer has): 9 of 350
    // editor dashboards do. When you change an existing dashboard, pass its original JSON as
    // baselineJson: only problems your change introduced are reported.
    public static void AssertBoundFieldsExist(string dashboardJson, string? baselineJson = null)
    {
        var problems = Problems(dashboardJson);
        if (baselineJson != null) problems = problems.Except(Problems(baselineJson)).ToList();
        if (problems.Count > 0) throw new InvalidOperationException(problems[0]);
    }

    static readonly JsonDocumentOptions Lenient = new() { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip };

    /// <summary>Every problem the guard finds, in document order (empty when it passes).</summary>
    public static List<string> Problems(string dashboardJson)
    {
        var problems = new List<string>();
        void Fail(string message) => problems.Add(message);
        var root = JsonNode.Parse(dashboardJson, documentOptions: Lenient)!;
        var filterIds = ((root["GlobalFilters"] as JsonArray) ?? new JsonArray())
            .Select(f => (string?)f?["Id"]).OfType<string>().ToHashSet();
        var dateFilters = ((root["GlobalFilters"] as JsonArray) ?? new JsonArray())
            .Count(f => ((string?)f?["_type"])?.StartsWith("Date") == true);

        foreach (var widget in (root["Widgets"] as JsonArray) ?? new JsonArray())
        {
            if (widget == null) continue;
            var title = (string?)widget["Title"];
            var dataSpec = widget["DataSpec"];
            var fields = Fields(dataSpec?["Fields"]);
            if (dataSpec?["IsTransposed"]?.GetValue<bool>() == true) fields.AddRange(Fields(dataSpec["TransposedFields"]));
            var declared = fields.Select(f => (string?)f["FieldName"]).OfType<string>().ToList();

            // Strict with a single date filter too: a load + save in either library rewrites the editor's
            // id-less date binding to "_date" (editor Sales.rdash). Rendered with two date filters, a "_date"
            // connection filters nothing; with one, it is NOT verified whether Reveal applies the filter.
            foreach (var target in Targets(dataSpec?["Bindings"]))
            {
                if (filterIds.Contains(target)) continue;
                if (target == "_date" && dateFilters == 1)
                    Fail(
                        $"\"{title}\" is connected to date filter id \"_date\", but the dashboard's only date filter has another id. A load + save in either library rewrites the editor's id-less date binding to \"_date\" (TypeScript writes it for every date filter connection). Not verified whether Reveal then applies the date filter (with two date filters it doesn't): render it with a restrictive date rule, or keep the original.");
                else
                    Fail(
                        $"\"{title}\" is connected to dashboard filter id \"{target}\", which this dashboard does not have. Filter ids: {string.Join(", ", filterIds)}");
            }

            if (declared.Count == 0) continue; // text box, image and XMLA widgets

            var bound = Bound(widget["VisualizationDataSpec"]).Concat(Bound(dataSpec?["Bindings"]));
            foreach (var name in bound)
            {
                if (!declared.Contains(name))
                    Fail(
                        $"\"{title}\" binds \"{name}\", which its data source item does not declare. Declared: {string.Join(", ", declared)}");
            }

            var dates = fields.Where(f => (string?)f["FieldType"] is "Date" or "DateTime")
                .Select(f => (string?)f["FieldName"]).OfType<string>().ToHashSet();
            foreach (var name in Regular(widget["VisualizationDataSpec"]))
            {
                if (dates.Contains(name))
                    Fail(
                        $"\"{title}\" binds date field \"{name}\" as a plain value; pass a DateDataField with an AggregationType instead of the name.");
            }

            foreach (var parameter in LinkParameters(widget["ActionsModel"]))
            {
                var type = (string?)parameter["Type"];
                var value = (string?)parameter["Value"] ?? "";
                if (type == "Column" && !declared.Contains(value))
                    Fail(
                        $"\"{title}\" links with parameter \"{parameter["Name"]}\" = \"{value}\", which is not a column of its data source item, so the target opens unfiltered. Pass the source column name. Declared: {string.Join(", ", declared)}");
                if (type == "GlobalFilter" && !filterIds.Contains(value.Split('.')[0]))
                    Fail(
                        $"\"{title}\" links the dashboard filter \"{value}\", which this dashboard does not have.");
            }
        }

        foreach (var filter in (root["GlobalFilters"] as JsonArray) ?? new JsonArray())
        {
            var field = (string?)filter?["SelectedFieldName"];
            var declared = Fields(filter?["DataSpec"]?["Fields"]).Select(f => (string?)f["FieldName"]).OfType<string>().ToList();
            if (!string.IsNullOrEmpty(field) && declared.Count > 0 && !declared.Contains(field))
                Fail(
                    $"Dashboard filter \"{filter!["Title"]}\" filters on \"{field}\", which its data source item does not declare. Declared: {string.Join(", ", declared)}");
        }
        return problems.Distinct().ToList();
    }

    private static List<JsonNode> Fields(JsonNode? node) =>
        (node as JsonArray)?.Where(f => f != null).Select(f => f!).ToList() ?? new List<JsonNode>();

    // Empty names are placeholders the editor writes; calculated fields live on the
    // visualization, not on the data source item.
    private static IEnumerable<string> Bound(JsonNode? node) => node switch
    {
        JsonArray a => a.SelectMany(Bound),
        JsonObject o => (o["FieldName"] is JsonValue v && v.TryGetValue<string>(out var n) && n.Length > 0
                         && o["IsCalculated"]?.GetValue<bool>() != true ? new[] { n } : Array.Empty<string>())
                        .Concat(o.SelectMany(p => Bound(p.Value))),
        _ => Enumerable.Empty<string>(),
    };

    // Field names bound as plain (non-date) dimensions.
    private static IEnumerable<string> Regular(JsonNode? node) => node switch
    {
        JsonArray a => a.SelectMany(Regular),
        JsonObject o => ((o["_type"] as JsonValue)?.TryGetValue<string>(out var t) == true && t == "SummarizationRegularFieldType"
                         && o["FieldName"] is JsonValue v && v.TryGetValue<string>(out var n) ? new[] { n } : Array.Empty<string>())
                        .Concat(o.SelectMany(p => Regular(p.Value))),
        _ => Enumerable.Empty<string>(),
    };

    // Dashboard filter ids the widget's connections point at. The editor's legacy date binding
    // has no GlobalFilterId and is skipped.
    private static IEnumerable<string> Targets(JsonNode? bindings) =>
        ((bindings?["Bindings"] as JsonArray) ?? new JsonArray())
            .Select(b => (string?)b?["Target"]?["GlobalFilterId"]).Where(id => !string.IsNullOrEmpty(id)).Select(id => id!);

    private static IEnumerable<JsonNode> LinkParameters(JsonNode? actionsModel) =>
        ((actionsModel?["Actions"] as JsonArray) ?? new JsonArray())
            .Where(a => (string?)a?["Type"] == "OpenDashboard")
            .SelectMany(a => (a!["Parameters"] as JsonArray) ?? new JsonArray())
            .Where(p => p != null).Select(p => p!);
}
