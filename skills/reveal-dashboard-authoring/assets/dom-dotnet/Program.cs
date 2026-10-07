// dotnet run -- create [out/Sales.rdash]
// dotnet run -- edit   [out/Sales.rdash] [out/Sales-edited.rdash]
// dotnet run -- sql    [out/Orders.rdash]
// dotnet run -- test                         runs every example and checks the documented behaviors
// Preview the files with ../preview:  npm start -- ../dom-dotnet/out
using System.Text.Json.Nodes;
using DomSamples;
using Reveal.Sdk.Dom;
using Reveal.Sdk.Dom.Data;
using Reveal.Sdk.Dom.Filters;
using Reveal.Sdk.Dom.Visualizations;

string Arg(int i, string fallback) => args.Length > i ? args[i] : fallback;

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
    default:
        Console.Error.WriteLine("Usage: dotnet run -- create|edit|sql|test [paths]");
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

        Console.WriteLine(failures == 0 ? "\nAll passed. Dashboards are in out/test; render them with ../preview." : $"\n{failures} failed");
        return failures == 0 ? 0 : 1;
    }
}
