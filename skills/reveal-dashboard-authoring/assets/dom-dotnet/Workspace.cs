using Reveal.Sdk.Dom;

namespace DomSamples;

// The workspace commands that read or write existing files. Originals are never written:
// every output goes to a new path through a temporary file, and a write that would lose a
// user-visible setting is refused unless allowLoss is set.
public static class Workspace
{
    /// <summary>
    /// Writes the document to path through a temporary file in the same folder, then moves it
    /// into place. RdashDocument.Save over an existing, larger file does not truncate it and
    /// leaves a corrupt zip; the move replaces the file whole.
    /// </summary>
    public static void WriteRdash(RdashDocument document, string path)
    {
        var full = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        var temp = Path.Combine(Path.GetDirectoryName(full)!, $".{Path.GetFileName(full)}.{Guid.NewGuid():N}.tmp");
        try
        {
            document.Save(temp);
            File.Move(temp, full, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    public sealed record Result(string File, string Status, int Visible, int Other, string Detail);

    /// <summary>
    /// Loads input, applies change (none for a plain round trip), runs the guard (problems the
    /// original file already had are tolerated), compares the
    /// output with the original Dashboard.json and writes output unless a user-visible setting
    /// would be lost (then nothing is written and the status is "refused").
    /// </summary>
    public static Result Convert(string input, string output, bool allowLoss, Func<RdashDocument, RdashDocument>? change = null, TextWriter? report = null)
    {
        var name = Path.GetFileName(input);
        if (string.Equals(Path.GetFullPath(input), Path.GetFullPath(output), StringComparison.OrdinalIgnoreCase))
            return new Result(name, "refused", 0, 0, "output is the input file: write to a new path");
        RdashDocument document;
        try { document = RdashDocument.Load(input); }
        catch (Exception e) { return new Result(name, "load failed", 0, 0, FirstLine(e)); }
        if (document.Visualizations is null) return new Result(name, "load failed", 0, 0, "no visualizations (no Dashboard.json?)");

        try
        {
            if (change != null) document = change(document);
            var json = document.ToJsonString();
            var original = LossCheck.ReadRdashJson(input);
            Guard.AssertBoundFieldsExist(json, baselineJson: original.ToJsonString());   // only problems the change introduced
            var loss = LossCheck.Compare(original, System.Text.Json.Nodes.JsonNode.Parse(json), sameDocument: change == null);
            if (report != null) loss.Print(report);
            if (loss.Lossy && !allowLoss)
                return new Result(name, "refused", loss.Visible.Count, loss.Other.Count, $"would lose {loss.Visible.Count} user-visible setting(s); rerun with --allow-loss after review");
            WriteRdash(document, output);
            return new Result(name, loss.Lossy ? "written (lossy)" : "written", loss.Visible.Count, loss.Other.Count, output);
        }
        catch (Exception e) { return new Result(name, "failed", 0, 0, FirstLine(e)); }
    }

    /// <summary>Runs Convert on every .rdash in folder, writing to outDir; prints one row per file.</summary>
    public static List<Result> Migrate(string folder, string outDir, bool allowLoss, Func<RdashDocument, RdashDocument>? change = null)
    {
        if (string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(folder)), Path.TrimEndingDirectorySeparator(Path.GetFullPath(outDir)), StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("The output folder must differ from the input folder: originals are never written.");
        var results = Directory.GetFiles(folder, "*.rdash").OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
            .Select(f => Convert(f, Path.Combine(outDir, Path.GetFileName(f)), allowLoss, change)).ToList();
        var width = Math.Max(4, results.Select(r => r.File.Length).DefaultIfEmpty(0).Max());
        Console.WriteLine($"{"File".PadRight(width)}  {"Status",-15}  Visible  Other  Detail");
        foreach (var r in results) Console.WriteLine($"{r.File.PadRight(width)}  {r.Status,-15}  {r.Visible,7}  {r.Other,5}  {r.Detail}");
        Console.WriteLine($"\n{results.Count(r => r.Status.StartsWith("written"))} written to {outDir}, {results.Count(r => r.Status == "refused")} refused, {results.Count(r => r.Status.Contains("failed"))} failed. Originals untouched.");
        return results;
    }

    static string FirstLine(Exception e) => $"{e.GetType().Name}: {e.Message.Split('\n')[0].Trim()}";
}
