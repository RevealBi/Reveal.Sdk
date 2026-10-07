using System.Text.Json.Nodes;

namespace DomSamples;

public static class Guard
{
    // Reveal.Sdk.Dom checks that every data source item declares fields, but not that the
    // names a visualization or a dashboard filter binds exist among them. A typo, or a date
    // filter connected without a field name (it then binds a field called "Date"), saves fine
    // and fails only at render time. Run this on document.ToJsonString() before every save.
    public static void AssertBoundFieldsExist(string dashboardJson)
    {
        foreach (var widget in JsonNode.Parse(dashboardJson)!["Widgets"]!.AsArray())
        {
            var declared = (widget!["DataSpec"]?["Fields"] as JsonArray)?
                .Select(f => (string)f!["FieldName"]!).ToList() ?? new List<string>();
            if (declared.Count == 0) continue; // text box, image and XMLA widgets

            var bound = Bound(widget["VisualizationDataSpec"]).Concat(Bound(widget["DataSpec"]?["Bindings"]));
            foreach (var name in bound)
            {
                if (!declared.Contains(name))
                    throw new InvalidOperationException(
                        $"\"{widget["Title"]}\" binds \"{name}\", which its data source item does not declare. Declared: {string.Join(", ", declared)}");
            }
        }
    }

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
}
