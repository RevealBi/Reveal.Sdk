using System.IO.Compression;
using System.Text.Json.Nodes;

namespace DomSamples;

// What did a Reveal.Sdk.Dom round trip lose? The .NET port of the TypeScript workspace's
// losscheck (same rules): properties present with a non-default value in the original
// Dashboard.json and missing from the output are losses; "visible" ones change what users
// see, the others are often legacy settings Reveal no longer reads. Changed values are listed
// for review only (they may be your own edits). Widgets and filters are matched by Id, so
// ones removed on purpose are not reported.
public sealed record LossReport(List<string> Visible, List<string> Other, List<string> Changes)
{
    public bool Lossy => Visible.Count > 0;

    public void Print(TextWriter o)
    {
        if (Changes.Count > 0)
        {
            o.WriteLine($"{Changes.Count} value(s) changed (expected if you edited them):");
            foreach (var c in Changes.Take(20)) o.WriteLine($"  {c}");
            if (Changes.Count > 20) o.WriteLine($"  ... {Changes.Count - 20} more");
        }
        if (Other.Count > 0) { o.WriteLine($"{Other.Count} other properties dropped (often legacy settings; if one looks visible, render both and compare):"); Groups(o, Other); }
        if (Visible.Count == 0) o.WriteLine("No user-visible settings lost.");
        else { o.WriteLine($"{Visible.Count} user-visible setting(s) lost:"); Groups(o, Visible); }
    }

    static void Groups(TextWriter o, List<string> list)
    {
        foreach (var g in list.GroupBy(l => System.Text.RegularExpressions.Regex.Replace(l, @"\[[^\]]*\]", "[]").Split(':')[0]))
            o.WriteLine($"  {g.Count()} x {g.Key}\n      e.g. {g.First()}");
    }
}

public static class LossCheck
{
    static readonly HashSet<string> FalsyIsMeaningful = new() { "UseAutoLayout", "DecimalDigits" };
    static readonly HashSet<string> Ignore = new() { "_type", "SavedWith", "FormatVersion" };
    static readonly HashSet<string> Visible = new()
    {
        "Widgets", "Filters", "UseAutoLayout", "IsHidden", "Formatting", "DateFormat", "FormatType", "DecimalDigits",
        "CurrencySymbol", "Sorting", "GroupedColumns", "SortedColumns", "Hyperlink", "Pinning", "Settings",
        "DefaultRefreshRate", "Title", "Description", "Filter", "Bindings", "SelectedItems", "RuleType", "ColumnSpan", "RowSpan",
        "CustomRule", "CustomDateRange",
    };
    static readonly System.Text.RegularExpressions.Regex Legacy = new(@"\.SummarizationSpec\b|VisualizationDataSpec\.Columns\[[^\]]*\]\.Sorting");

    /// <summary>Reads the raw Dashboard.json of a .rdash without the DOM.</summary>
    public static JsonNode ReadRdashJson(string path)
    {
        using var zip = ZipFile.OpenRead(path);
        var entry = zip.Entries.FirstOrDefault(e => e.FullName.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidDataException($"{path} has no Dashboard.json");
        using var stream = entry.Open();
        return JsonNode.Parse(stream, documentOptions: new System.Text.Json.JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = System.Text.Json.JsonCommentHandling.Skip })!;
    }

    /// <param name="sameDocument">true for a plain round trip (nothing was removed on purpose, so a
    /// vanished widget or filter is a loss); false when comparing an edited result.</param>
    public static LossReport Compare(JsonNode? before, JsonNode? after, bool sameDocument)
    {
        var losses = new List<string>();
        var changes = new List<string>();
        Walk(before, after, "", "", sameDocument, losses, changes);
        string Dropped(string l) => System.Text.RegularExpressions.Regex.Replace(l.Split(':')[0].Split('.').Last(), @"\[.*$", "");
        var visible = losses.Where(l => Visible.Contains(Dropped(l)) && !Legacy.IsMatch(l)).ToList();
        return new LossReport(visible, losses.Except(visible).ToList(), changes);
    }

    static bool IsDefault(JsonNode? v, string key = "")
    {
        if (v is JsonValue jv)
        {
            var e = jv.GetValueKind();
            if (FalsyIsMeaningful.Contains(key) && (e == System.Text.Json.JsonValueKind.False || (e == System.Text.Json.JsonValueKind.Number && jv.GetValue<double>() == 0))) return false;
            return e switch
            {
                System.Text.Json.JsonValueKind.Null or System.Text.Json.JsonValueKind.False => true,
                System.Text.Json.JsonValueKind.Number => jv.GetValue<double>() == 0,
                System.Text.Json.JsonValueKind.String => jv.GetValue<string>() is "" or "None" or "Auto" or "Inherit",
                _ => false,
            };
        }
        return v switch
        {
            null => true,
            JsonArray a => a.Count == 0,
            JsonObject o => o.All(p => p.Key == "_type" || IsDefault(p.Value, p.Key)),
            _ => false,
        };
    }

    static string Short(JsonNode? v) { var s = v?.ToJsonString() ?? "null"; return s.Length > 80 ? s[..80] : s; }

    static void Walk(JsonNode? a, JsonNode? b, string path, string key, bool same, List<string> losses, List<string> changes)
    {
        switch (a)
        {
            case null or JsonValue:
                if (b is null && !(a is null)) { if (!IsDefault(a, key)) losses.Add($"{path}: {Short(a)} -> (dropped)"); }
                else if (!JsonNode.DeepEquals(a, b)) changes.Add($"{path}: {Short(a)} -> {Short(b)}");
                return;
            case JsonArray arr:
                if (b is not JsonArray barr) { if (!IsDefault(arr)) losses.Add($"{path}: list is gone"); return; }
                var byId = arr.Count > 0 && arr.All(x => x is JsonObject o && o.ContainsKey("Id"));
                for (var i = 0; i < arr.Count; i++)
                {
                    var x = arr[i];
                    var label = byId ? (x!["Title"] ?? x["Id"])!.ToJsonString() : i.ToString();
                    var y = byId ? barr.FirstOrDefault(z => z is JsonObject && JsonNode.DeepEquals(z["Id"], x!["Id"])) : (i < barr.Count ? barr[i] : null);
                    if (byId && y is null) { if (same) losses.Add($"{path}[{label}]: object is gone"); continue; }
                    Walk(x, y, $"{path}[{label}]", "", same, losses, changes);
                }
                return;
            case JsonObject obj:
                if (b is not JsonObject bobj) { if (!IsDefault(obj, key)) losses.Add($"{path}: object is gone"); return; }
                foreach (var (k, v) in obj)
                {
                    if (Ignore.Contains(k)) continue;
                    if (!bobj.ContainsKey(k)) { if (!IsDefault(v, k)) losses.Add($"{path}.{k}: {Short(v)} -> (dropped)"); continue; }
                    Walk(v, bobj[k], $"{path}.{k}", k, same, losses, changes);
                }
                return;
        }
    }
}
