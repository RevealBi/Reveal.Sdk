using Reveal.Sdk.Dom;

namespace DomSamples;

// The change `dotnet run -- migrate <folder>` applies to every dashboard. Edit Change, then run
// the migration into a new folder, review the table (refused = would lose a user-visible
// setting; run `roundtrip` on that file to see what), and render a few results with ../preview.
public static class Migration
{
    public static RdashDocument Change(RdashDocument document)
    {
        // Example: document.Title += " (migrated)";
        // Example: foreach (var ds in document.DataSources.Where(d => d.Provider == DataSourceProvider.PostgreSQL)) ds.Properties["Host"] = "db.internal";
        return document;
    }
}
