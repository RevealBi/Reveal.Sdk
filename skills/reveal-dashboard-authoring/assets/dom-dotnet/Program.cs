// dotnet run -- create [out/Sales.rdash]
// dotnet run -- edit   [out/Sales.rdash] [out/Sales-edited.rdash]
// dotnet run -- sql    [out/Orders.rdash]
// dotnet run -- test                         runs every example and checks the documented behaviors
// dotnet run -- guard  <file.rdash> [<original.rdash>]
//                                            runs the field/filter/link guard on any .rdash (exit 1 on a problem);
//                                            with the original, reports only problems it did not already have
// dotnet run -- roundtrip <in.rdash> <out.rdash> [--allow-loss]
//                                            load + save to a new path; refuses if a user-visible setting would be lost
// dotnet run -- migrate <folder> [--out <dir>] [--allow-loss]
//                                            the same for every .rdash in folder (default out: <folder>-migrated);
//                                            put your change in Migration.Change; originals are never written
// dotnet run -- api [Type or filter]         lists Reveal.Sdk.Dom types, or one type's members and extension methods
// Preview the files with ../preview:  npm start -- ../dom-dotnet/out
using System.Text.Json.Nodes;
using DomSamples;
using Reveal.Sdk.Dom;
using Reveal.Sdk.Dom.Data;
using Reveal.Sdk.Dom.Filters;
using Reveal.Sdk.Dom.Visualizations;

var flags = args.Where(a => a.StartsWith("--")).ToHashSet();
var positional = args.Where((a, i) => !a.StartsWith("--") && (i == 0 || args[i - 1] != "--out")).ToArray();
string Arg(int i, string fallback) => positional.Length > i ? positional[i] : fallback;
string? Option(string name) => Array.IndexOf(args, name) is var i and >= 0 && i + 1 < args.Length ? args[i + 1] : null;

switch (args.FirstOrDefault())
{
    case "create":
        Examples.Save(Examples.CreateSalesDashboard(), Arg(1, "out/Sales.rdash"));
        Console.WriteLine($"Wrote {Arg(1, "out/Sales.rdash")}");
        return 0;
    case "edit":
        Examples.Save(Examples.EditDashboard(RdashDocument.Load(Arg(1, "out/Sales.rdash"))), Arg(2, "out/Sales-edited.rdash"));
        Console.WriteLine($"Wrote {Arg(2, "out/Sales-edited.rdash")}");
        return 0;
    case "sql":
        Examples.Save(Examples.CreateOrdersDashboard(), Arg(1, "out/Orders.rdash"));
        Console.WriteLine($"Wrote {Arg(1, "out/Orders.rdash")}");
        return 0;
    case "test":
        return Tests.Run();
    case "api":
        return ApiBrowser.Run(positional.ElementAtOrDefault(1));
    case "guard" when positional.Length > 1:
    {
        var problems = Guard.Problems(LossCheck.ReadRdashJson(positional[1]).ToJsonString());
        if (positional.Length > 2) problems = problems.Except(Guard.Problems(LossCheck.ReadRdashJson(positional[2]).ToJsonString())).ToList();
        foreach (var problem in problems) Console.WriteLine($"  {problem}");
        Console.WriteLine(problems.Count == 0 ? $"Guard passed: {positional[1]}" : $"Guard: {problems.Count} problem(s) in {positional[1]}");
        return problems.Count == 0 ? 0 : 1;
    }
    case "roundtrip" when positional.Length > 2:
    {
        var result = Workspace.Convert(positional[1], positional[2], flags.Contains("--allow-loss"), report: Console.Out);
        Console.WriteLine($"{result.Status}: {result.Detail}");
        return result.Status.StartsWith("written") ? 0 : 1;
    }
    case "migrate" when positional.Length > 1:
    {
        var results = Workspace.Migrate(positional[1], Option("--out") ?? Path.TrimEndingDirectorySeparator(positional[1]) + "-migrated",
            flags.Contains("--allow-loss"), Migration.Change);
        return results.All(r => r.Status.StartsWith("written")) ? 0 : 1;
    }
    default:
        Console.Error.WriteLine("Usage: dotnet run -- create|edit|sql|test|guard|roundtrip|migrate|api [paths]  (see the top of Program.cs)");
        return 1;
}

static class Tests
{
    static int failures;

    static void Test(string name, Action body)
    {
        try { body(); Console.WriteLine($"ok    {name}"); }
        catch (Exception e) { failures++; Console.WriteLine($"FAIL  {name}\n      {e.Message}"); }
    }

    static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }

    static JsonNode Json(RdashDocument d) => JsonNode.Parse(d.ToJsonString())!;

    static RdashDocument Doc(IVisualization v) { var d = new RdashDocument("x"); d.Visualizations.Add(v); return d; }

    static string[] BoundNames(IVisualization v) =>
        System.Text.RegularExpressions.Regex.Matches(Json(Doc(v))["Widgets"]![0]!["VisualizationDataSpec"]!.ToJsonString(), "\"FieldName\":\"([^\"]+)\"")
            .Select(m => m.Groups[1].Value).ToArray();

    static MicrosoftSqlServerDataSourceItem GeoItem() =>
        new("geo", "geo", new MicrosoftSqlServerDataSource { Title = "db" })
        {
            Fields = new List<IField> { new TextField("city"), new NumberField("lat"), new NumberField("lon") },
        };

    // Rewrites the Dashboard.json inside an .rdash (for fixtures the DOM can't produce).
    static void AddToJson(string path, Action<JsonNode> edit)
    {
        using var zip = System.IO.Compression.ZipFile.Open(path, System.IO.Compression.ZipArchiveMode.Update);
        var entry = zip.Entries.First(e => e.FullName.EndsWith(".json", StringComparison.OrdinalIgnoreCase));
        JsonNode json;
        using (var s = entry.Open()) json = JsonNode.Parse(s)!;
        edit(json);
        var name = entry.FullName;
        entry.Delete();
        using var writer = new StreamWriter(zip.CreateEntry(name).Open());
        writer.Write(json.ToJsonString());
    }

    public static int Run()
    {
        const string dir = "out/test";
        if (Directory.Exists(dir)) Directory.Delete(dir, true);

        Test("create: sample sales dashboard saves and passes the field guard", () =>
        {
            Examples.Save(Examples.CreateSalesDashboard(), $"{dir}/Sales.rdash");
            var d = RdashDocument.Load($"{dir}/Sales.rdash");
            Assert(d.Visualizations.Count == 5, $"5 visualizations, got {d.Visualizations.Count}");
            Assert(d.Filters.Count == 2, "2 filters");
        });

        Test("edit: load, rename, delete, add and save", () =>
        {
            Examples.Save(Examples.EditDashboard(RdashDocument.Load($"{dir}/Sales.rdash")), $"{dir}/Sales-edited.rdash");
            var titles = RdashDocument.Load($"{dir}/Sales-edited.rdash").Visualizations.Select(v => v.Title).ToArray();
            var expected = new[] { "Revenue by product", "Revenue", "Revenue by month", "Category mix", "Revenue by region and category" };
            Assert(titles.SequenceEqual(expected), string.Join(", ", titles));
        });

        Test("sql: database connector example keeps explicit ids", () =>
        {
            Examples.Save(Examples.CreateOrdersDashboard(), $"{dir}/Orders.rdash");
            var ds = RdashDocument.Load($"{dir}/Orders.rdash").DataSources.Single(d => d.Id == "SalesDb");
            Assert(ds.Provider == DataSourceProvider.MicrosoftSqlServer, $"provider {ds.Provider}");
        });

        // Documented traps: these must keep holding, or the skill's warnings are stale.
        MicrosoftSqlServerDataSourceItem Item()
        {
            var db = new MicrosoftSqlServerDataSource { Title = "db" };
            return new MicrosoftSqlServerDataSourceItem("t", "t", db)
            {
                Fields = new List<IField> { new TextField("region"), new DateField("order_date"), new NumberField("total") },
            };
        }

        Test("trap: a misspelled value field saves, and the guard catches it", () =>
        {
            var d = new RdashDocument("x");
            d.Visualizations.Add(new ColumnChartVisualization("c", Item()).SetLabel("region").SetValues("totl"));
            var json = d.ToJsonString();
            try { Guard.AssertBoundFieldsExist(json); throw new Exception("guard did not throw"); }
            catch (InvalidOperationException e) { Assert(e.Message.Contains("\"totl\""), e.Message); }
        });

        Test("trap: a date filter connected without a field name binds \"Date\"", () =>
        {
            var d = new RdashDocument("x");
            var period = new DashboardDateFilter("p", DateFilterRule.AllTime);
            d.Filters.Add(period);
            d.Visualizations.Add(new GridVisualization("g", Item()).SetColumns("region").ConnectDashboardFilter(period));
            try { Guard.AssertBoundFieldsExist(d.ToJsonString()); throw new Exception("guard did not throw"); }
            catch (InvalidOperationException e) { Assert(e.Message.Contains("\"Date\""), e.Message); }
        });

        Test("trap: a loaded item has no Fields; they are on the TabularDataDefinition", () =>
        {
            var v = RdashDocument.Load($"{dir}/Sales.rdash").Visualizations[1];
            var definition = (TabularDataDefinition)v.DataDefinition;
            Assert(definition.DataSourceItem.Fields.Count == 0, $"item fields {definition.DataSourceItem.Fields.Count}");
            Assert(definition.Fields.Count == 7, $"definition fields {definition.Fields.Count}");
        });

        Test(".NET date filters get distinct ids", () =>
        {
            var d = new RdashDocument("x");
            d.Filters.Add(new DashboardDateFilter("a", DateFilterRule.AllTime));
            d.Filters.Add(new DashboardDateFilter("b", DateFilterRule.AllTime));
            var ids = Json(d)["GlobalFilters"]!.AsArray().Select(f => (string)f!["Id"]!).ToArray();
            Assert(ids.Distinct().Count() == 2, string.Join(", ", ids));
        });

        Test("loaded data sources are base classes: use Provider and Properties", () =>
        {
            var d = RdashDocument.Load($"{dir}/Orders.rdash");
            var ds = d.DataSources.Single(x => x.Id == "SalesDb");
            Assert(ds is not MicrosoftSqlServerDataSource, ds.GetType().Name);
            ds.Properties["Database"] = "sales_prod";
            Assert(d.ToJsonString().Contains("sales_prod"), "property written");
        });

        // Setters: every call replaces the binding, the plural included. Strings and typed fields
        // can't be mixed in one .NET call: SetValues("Quantity", revenue) does not compile, because
        // params string[] and params NumberDataField[] are separate overloads (TypeScript allows it).
        // Bind several fields in ONE call of one kind: SetValues(revenue, new NumberDataField("Quantity")).
        Test("trap: each setter call replaces the binding (SetLabel twice keeps the second)", () =>
        {
            var c = new ColumnChartVisualization("c", Item()).SetLabel("region").SetLabel("order_date").SetValue("total");
            Assert(c.Labels.Count == 1, $"labels {c.Labels.Count}");
            var names = BoundNames(c);
            Assert(names.Contains("order_date") && !names.Contains("region"), string.Join(", ", names));
        });

        Test("trap: plural SetValues replaces too (SetValues(a, b).SetValues(a) binds only a)", () =>
        {
            var c = new ColumnChartVisualization("c", Item()).SetLabel("region").SetValues("total", "region").SetValues("total");
            Assert(c.Values.Count == 1, $"values {c.Values.Count}");
        });

        Test("DateFilterRule factories serialize to their rule types", () =>
        {
            var rules = new (string Name, DateFilterRule Rule)[]
            {
                ("AllTime", DateFilterRule.AllTime),
                ("Last", DateFilterRule.Last(30, PeriodType.Day)),
                ("Previous", DateFilterRule.Previous(1, PeriodType.Month)),
                ("This", DateFilterRule.This(PeriodType.Year)),
                ("ToDate", DateFilterRule.ToDate(PeriodType.Quarter)),
                ("Next", DateFilterRule.Next(2, PeriodType.Week)),
                ("Custom", DateFilterRule.Custom(new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc), new DateTime(2024, 12, 31, 0, 0, 0, DateTimeKind.Utc))),
            };
            var d = new RdashDocument("x");
            foreach (var (name, rule) in rules) d.Filters.Add(new DashboardDateFilter(name, rule));
            var filters = Json(d)["GlobalFilters"]!.AsArray();
            string Rule(string title) => (string)filters.First(f => (string)f!["Title"]! == title)!["RuleType"]!;
            Assert(Rule("AllTime") == "AllTime", Rule("AllTime"));
            Assert(Rule("Custom") == "CustomRange", Rule("Custom"));
            foreach (var name in new[] { "Last", "Previous", "This", "ToDate", "Next" })
                Assert(Rule(name) == "CustomRule", $"{name}: {Rule(name)}");
            Assert(filters.Select(f => (string)f!["Id"]!).Distinct().Count() == rules.Length, "distinct ids");
        });

        Test("trap: a custom range from Local dates is written with the UTC offset", () =>
        {
            string Range(DateTimeKind kind)
            {
                var d = new RdashDocument("x");
                d.Filters.Add(new DashboardDateFilter("p", DateFilterRule.Custom(new DateTime(2024, 1, 1, 0, 0, 0, kind), new DateTime(2024, 1, 31, 0, 0, 0, kind))));
                return (string)Json(d)["GlobalFilters"]![0]!["CustomDateRange"]!["From"]!["value"]!;
            }
            var utc = Range(DateTimeKind.Utc);
            var unspecified = Range(DateTimeKind.Unspecified);
            Assert(utc == "2024-01-01T00:00:00Z", utc);
            Assert(!System.Text.RegularExpressions.Regex.IsMatch(unspecified, @"Z""|[+-]\d\d:\d\d"), unspecified);
            if (TimeZoneInfo.Local.BaseUtcOffset != TimeSpan.Zero)
                Assert(System.Text.RegularExpressions.Regex.IsMatch(Range(DateTimeKind.Local), @"[+-]\d\d:\d\d"), Range(DateTimeKind.Local));
        });

        Test("DateLinkFilter passes the source date filter to the target's filter id", () =>
        {
            var period = new DashboardDateFilter("Order date", DateFilterRule.Last(30, PeriodType.Day));
            var d = new RdashDocument("x");
            d.Filters.Add(period);
            var c = new ColumnChartVisualization("c", Item()).SetLabel("region").SetValue("total").ConnectDashboardFilter(period, "order_date");
            c.Linker = new VisualizationLinker().AddDashboard("Detail", "Target", new DateLinkFilter(period, "target-date-filter"));
            d.Visualizations.Add(c);
            var parameter = Json(d)["Widgets"]![0]!["ActionsModel"]!["Actions"]![0]!["Parameters"]![0]!;
            Assert((string)parameter["Type"]! == "GlobalFilter", parameter.ToJsonString());
            Assert((string)parameter["Namespace"]! == "target-date-filter", parameter.ToJsonString());
            Assert(((string)parameter["Value"]!).StartsWith(period.Id + "."), parameter.ToJsonString());
            Guard.AssertBoundFieldsExist(d.ToJsonString());
        });

        Test("trap: TimeSeries needs a DateFormatting on its date field, or the client crashes", () =>
        {
            string Spec(DateDataField date) => Json(Doc(new TimeSeriesVisualization("t", Item()).SetDate(date).SetValue("total")))
                ["Widgets"]![0]!["VisualizationDataSpec"]!.ToJsonString();
            var bare = Spec(new DateDataField("order_date") { AggregationType = DateAggregationType.Day });
            Assert(!bare.Contains("\"DateFormat\""), $"the library now writes a date format: {bare}");
            var fixedSpec = Spec(new DateDataField("order_date") { AggregationType = DateAggregationType.Day, Formatting = new DateFormatting("dd-MMM-yyyy") });
            Assert(fixedSpec.Contains("\"DateFormat\":\"dd-MMM-yyyy\""), fixedSpec);
        });

        Test("trap: ScatterMap zoom defaults to an empty rectangle; a set zoom survives a round trip", () =>
        {
            ScatterMapVisualization Map() => new ScatterMapVisualization("m", GeoItem()).SetMap<ScatterMapVisualization>("WorldCountries")
                .SetLatitude("lat").SetLongitude("lon").SetLabel<ScatterMapVisualization>("city");
            var empty = Map().Settings.Zoom;
            Assert(empty.DegreesLongitude == 0 && empty.DegreesLatitude == 0, $"default zoom {empty.DegreesLongitude} x {empty.DegreesLatitude}");
            var zoomed = Map().ConfigureSettings(s => { s.Zoom.Longitude = -180; s.Zoom.Latitude = -60; s.Zoom.DegreesLongitude = 360; s.Zoom.DegreesLatitude = 150; });
            Examples.Save(Doc(zoomed), $"{dir}/ScatterMap.rdash");
            var z = ((ScatterMapVisualization)RdashDocument.Load($"{dir}/ScatterMap.rdash").Visualizations[0]).Settings.Zoom;
            Assert(z.Longitude == -180 && z.Latitude == -60 && z.DegreesLongitude == 360 && z.DegreesLatitude == 150, $"{z.Longitude} {z.Latitude} {z.DegreesLongitude} {z.DegreesLatitude}");
        });

        // Guard v2.
        static void Throws(string json, string expected, string? baseline = null)
        {
            try { Guard.AssertBoundFieldsExist(json, baseline); throw new Exception("guard did not throw"); }
            catch (InvalidOperationException e) { Assert(e.Message.Contains(expected), e.Message); }
        }

        Test("trap: a date column bound by name as a label is a plain dimension, and the guard catches it", () =>
        {
            var byName = Doc(new ColumnChartVisualization("c", Item()).SetLabel("order_date").SetValue("total")).ToJsonString();
            Assert(byName.Contains("SummarizationRegularFieldType"), "plain dimension");
            Throws(byName, "binds date field \"order_date\" as a plain value");
            Guard.AssertBoundFieldsExist(Doc(new ColumnChartVisualization("c", Item())
                .SetLabel(new DateDataField("order_date") { AggregationType = DateAggregationType.Month }).SetValue("total")).ToJsonString());
        });

        Test("guard: a dashboard data filter on a misspelled field is caught, connected or not", () =>
        {
            var d = new RdashDocument("x");
            d.Filters.Add(new DashboardDataFilter("regon", Item()));
            d.Visualizations.Add(new GridVisualization("g", Item()).SetColumns("region"));
            Throws(d.ToJsonString(), "filters on \"regon\"");
        });

        Test("guard: a connection to a filter the dashboard does not have is caught; a baseline tolerates old ones", () =>
        {
            var period = new DashboardDateFilter("p", DateFilterRule.AllTime);
            var d = new RdashDocument("x");
            d.Filters.Add(period);
            d.Visualizations.Add(new GridVisualization("g", Item()).SetColumns("region", "order_date").ConnectDashboardFilter(period, "order_date"));
            var json = Json(d);
            Guard.AssertBoundFieldsExist(json.ToJsonString());
            json["Widgets"]![0]!["DataSpec"]!["Bindings"]!["Bindings"]![0]!["Target"]!["GlobalFilterId"] = "_date";   // what TS writes on a loaded dashboard
            var dangling = json.ToJsonString();
            Throws(dangling, "only date filter has another id");   // one date filter: flagged too (unverified case, Guard.cs)
            Guard.AssertBoundFieldsExist(dangling, baselineJson: dangling);   // the original already had it
        });

        Test("guard: a dashboard link must pass a source column", () =>
        {
            var d = new RdashDocument("x");
            var c = new ColumnChartVisualization("c", Item()).SetLabel("region").SetValue("total");
            c.Linker = new VisualizationLinker().AddDashboard("Detail", "Target", new LinkFilter("Region", "target-filter", "region"));
            d.Visualizations.Add(c);
            Guard.AssertBoundFieldsExist(d.ToJsonString());
            c.Linker = new VisualizationLinker().AddDashboard("Detail", "Target", new LinkFilter("Region", "target-filter", "Sales region"));
            Throws(d.ToJsonString(), "not a column of its data source item");
        });

        Test("guard: tolerates JSON without Widgets, null Widgets and trailing commas", () =>
        {
            Guard.AssertBoundFieldsExist("{\"Title\":\"x\"}");
            Guard.AssertBoundFieldsExist("{\"Title\":\"x\",\"Widgets\":null}");
            Guard.AssertBoundFieldsExist("{\"Title\":\"x\",\"Widgets\":[],}");
        });

        Test("guard: a pivot over transposed data binds its TransposedFields (no false positive)", () =>
        {
            const string json = """
                {"Widgets":[{"Title":"t","DataSpec":{"IsTransposed":true,
                  "Fields":[{"FieldName":"Name","FieldType":"String"}],
                  "TransposedFields":[{"FieldName":"23400","FieldType":"Number"}]},
                  "VisualizationDataSpec":{"Values":[{"DataField":{"FieldName":"23400"}}]}}]}
                """;
            Guard.AssertBoundFieldsExist(json);
            Throws(json.Replace("\"IsTransposed\":true", "\"IsTransposed\":false"), "binds \"23400\"");
        });

        Test("trap: Save over a larger file keeps a stale tail; Examples.Save does not", () =>
        {
            RdashDocument Many(int n)
            {
                var d = new RdashDocument("x");
                for (var i = 0; i < n; i++) d.Visualizations.Add(new GridVisualization($"g{i}", Item()).SetColumns("region", "total"));
                return d;
            }
            Directory.CreateDirectory(dir);
            Many(1).Save($"{dir}/fresh.rdash");
            var fresh = new FileInfo($"{dir}/fresh.rdash").Length;
            Many(40).Save($"{dir}/raw.rdash");
            Many(1).Save($"{dir}/raw.rdash");
            // A corrupt overwrite keeps the old end-of-central-directory record after the new one.
            int EndRecords(string path) { var b = File.ReadAllBytes(path); var n = 0; for (var i = 0; i + 3 < b.Length; i++) if (b[i] == 0x50 && b[i + 1] == 0x4B && b[i + 2] == 5 && b[i + 3] == 6) n++; return n; }
            Assert(new FileInfo($"{dir}/raw.rdash").Length > 2 * fresh && EndRecords($"{dir}/raw.rdash") > 1, "document.Save now truncates: the stale-tail trap is fixed in the library");
            Examples.Save(Many(40), $"{dir}/safe.rdash");
            Examples.Save(Many(1), $"{dir}/safe.rdash");
            var safe = new FileInfo($"{dir}/safe.rdash").Length;
            Assert(Math.Abs(safe - fresh) < 16 && EndRecords($"{dir}/safe.rdash") == 1, $"safe {safe} bytes vs fresh {fresh}, {EndRecords($"{dir}/safe.rdash")} end records");
            using (var zip = System.IO.Compression.ZipFile.OpenRead($"{dir}/safe.rdash"))
                foreach (var e in zip.Entries) { using var s = e.Open(); s.CopyTo(Stream.Null); }
            Assert(RdashDocument.Load($"{dir}/safe.rdash").Visualizations.Count == 1, "1 visualization");
            Assert(!Directory.GetFiles(dir, "*.tmp").Any(), "temporary file left behind");
        });

        // TypeScript's import drops date filters; Reveal.Sdk.Dom copies a GUID date filter and its binding.
        Test("Import with IncludeDashboardFilters copies data and date filters, bindings intact (.NET)", () =>
        {
            var source = new RdashDocument("source");
            var period = new DashboardDateFilter("Order date", DateFilterRule.Last(365, PeriodType.Day));
            var region = new DashboardDataFilter("region", Item());
            source.Filters.Add(period);
            source.Filters.Add(region);
            source.Visualizations.Add(new GridVisualization("g", Item()).SetColumns("region", "order_date")
                .ConnectDashboardFilter(period, "order_date").ConnectDashboardFilter(region));
            var target = new RdashDocument("target");
            target.Import(source, new ImportOptions { IncludeDashboardFilters = true });
            Assert(target.Filters.OfType<DashboardDataFilter>().Count() == 1, $"filters {target.Filters.Count}");
            Assert(target.Filters.OfType<DashboardDateFilter>().Single().Id == period.Id, "date filter copied with its id");
            Guard.AssertBoundFieldsExist(target.ToJsonString());   // every copied connection targets a copied filter
        });

        // Workspace commands: roundtrip and migrate never write originals and refuse lossy writes.
        Test("roundtrip: refuses to write over the input, and refuses a lossy write unless allowed", () =>
        {
            var input = $"{dir}/rt-in.rdash";
            Examples.Save(Examples.CreateSalesDashboard(), input);
            AddToJson(input, json => json["Widgets"]![0]!["DataSpec"]!["Fields"]![0]!.AsObject()["IsHidden"] = true);
            var before = File.ReadAllBytes(input);
            Assert(Workspace.Convert(input, input, allowLoss: true).Status == "refused", "wrote over the input");
            var refused = Workspace.Convert(input, $"{dir}/rt-out.rdash", allowLoss: false);
            Assert(refused.Status == "refused" && !File.Exists($"{dir}/rt-out.rdash"), $"{refused}");
            var written = Workspace.Convert(input, $"{dir}/rt-out.rdash", allowLoss: true);
            Assert(written.Status == "written (lossy)" && File.Exists($"{dir}/rt-out.rdash"), $"{written}");
            Assert(File.ReadAllBytes(input).SequenceEqual(before), "input changed");
            var clean = Workspace.Convert($"{dir}/Sales.rdash", $"{dir}/rt-clean.rdash", allowLoss: false);
            Assert(clean.Status == "written", $"{clean}");
        });

        Test("migrate: per-file results, refuses lossy files, leaves originals untouched", () =>
        {
            var folder = $"{dir}/migrate-in";
            Directory.CreateDirectory(folder);
            File.Copy($"{dir}/Sales.rdash", $"{folder}/Sales.rdash", true);
            File.Copy($"{dir}/rt-in.rdash", $"{folder}/Lossy.rdash", true);
            File.WriteAllText($"{folder}/Broken.rdash", "not a zip");
            var stamps = Directory.GetFiles(folder).ToDictionary(f => f, File.ReadAllBytes);
            try { Workspace.Migrate(folder, folder, false); throw new Exception("migrated into the input folder"); } catch (ArgumentException) { }
            var results = Workspace.Migrate(folder, $"{dir}/migrate-out", false, d => { d.Title += " (migrated)"; return d; })
                .ToDictionary(r => r.File, r => r.Status);
            Assert(results["Sales.rdash"] == "written" && results["Lossy.rdash"] == "refused" && results["Broken.rdash"] == "load failed", string.Join(", ", results));
            Assert(RdashDocument.Load($"{dir}/migrate-out/Sales.rdash").Title.EndsWith("(migrated)"), "change applied");
            Assert(!File.Exists($"{dir}/migrate-out/Lossy.rdash"), "lossy file written");
            Assert(stamps.All(p => File.ReadAllBytes(p.Key).SequenceEqual(p.Value)), "an original changed");
        });

        Console.WriteLine(failures == 0 ? "\nAll passed. Dashboards are in out/test; render them with ../preview." : $"\n{failures} failed");
        return failures == 0 ? 0 : 1;
    }
}
