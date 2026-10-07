using Reveal.Sdk.Dom;
using Reveal.Sdk.Dom.Data;
using Reveal.Sdk.Dom.Filters;
using Reveal.Sdk.Dom.Visualizations;

namespace DomSamples;

public static class Examples
{
    // Two dashboard filters, a KPI, two charts, a pivot and a grid over the sample sales data.
    public static RdashDocument CreateSalesDashboard()
    {
        var sales = Sales.Item();
        var document = new RdashDocument("Sales") { Theme = Theme.Mountain };

        // Connect a date filter with the date field's name, or it binds a field called "Date".
        var period = new DashboardDateFilter("Order date", DateFilterRule.AllTime);
        var region = new DashboardDataFilter(Sales.Region, "Region", sales);
        document.Filters.Add(period);
        document.Filters.Add(region);

        var revenue = new NumberDataField(Sales.Revenue)
        {
            FieldLabel = "Revenue",
            AggregationType = AggregationType.Sum,
            Formatting = new NumberFormatting
            {
                FormatType = NumberFormattingType.Currency,
                CurrencySymbol = "$",
                DecimalDigits = 0,
                ShowGroupingSeparator = true,
            },
        };
        var byMonth = new DateDataField(Sales.OrderDate) { AggregationType = DateAggregationType.Month };

        document.Visualizations.Add(new KpiTimeVisualization("Revenue", sales)
            .SetDate(Sales.OrderDate).SetValue(revenue)
            .ConnectDashboardFilter(region));
        document.Visualizations.Add(new ColumnChartVisualization("Revenue by month", sales)
            .SetLabel(byMonth).SetValues(revenue)
            .ConnectDashboardFilter(period, Sales.OrderDate).ConnectDashboardFilter(region));
        document.Visualizations.Add(new PieChartVisualization("Revenue by category", sales)
            .SetLabel(Sales.Category).SetValue(Sales.Revenue)
            .ConnectDashboardFilter(period, Sales.OrderDate).ConnectDashboardFilter(region));
        document.Visualizations.Add(new PivotVisualization("Revenue by region and category", sales)
            .SetRows(Sales.Region).SetColumns(Sales.Category).SetValues(Sales.Revenue)
            .ConnectDashboardFilter(period, Sales.OrderDate).ConnectDashboardFilter(region));
        document.Visualizations.Add(new GridVisualization("Orders", sales)
            .SetColumns(Sales.OrderId, Sales.OrderDate, Sales.Region, Sales.Product, Sales.Quantity, Sales.Revenue)
            .ConnectDashboardFilter(period, Sales.OrderDate).ConnectDashboardFilter(region));
        return document;
    }

    // Rename, delete, reorder, and add a visualization that reuses an existing data source item.
    public static RdashDocument EditDashboard(RdashDocument document)
    {
        document.Title += " (edited)";

        var pie = document.Visualizations.Find(v => v.Title == "Revenue by category");
        if (pie != null) pie.Title = "Category mix";

        document.Visualizations.RemoveAll(v => v.Title == "Orders");

        // Reuse the item an existing visualization queries, so the server resolves it the same way.
        // A loaded item's own Fields is empty: the declared fields sit on the visualization's
        // TabularDataDefinition and must be copied back before the item can back a new visualization.
        var source = document.Visualizations.FirstOrDefault(v => v.DataDefinition is TabularDataDefinition { DataSourceItem: not null })
            ?? throw new InvalidOperationException("The dashboard has no data-bound visualization to reuse.");
        var definition = (TabularDataDefinition)source.DataDefinition;
        var item = definition.DataSourceItem;
        if (item.Fields.Count == 0) item.Fields = definition.Fields.ToList();
        var byProduct = new BarChartVisualization("Revenue by product", item)
            .SetLabel(Sales.Product)
            .SetValues(new NumberDataField(Sales.Revenue) { Sorting = SortingType.Desc });

        document.Visualizations.Insert(0, byProduct); // auto layout places visualizations in list order
        return document;
    }

    // The pattern for a database connector. No credentials; host and database are placeholders
    // the app's server-side data source provider overwrites, matching items by these ids.
    public static RdashDocument CreateOrdersDashboard()
    {
        var db = new MicrosoftSqlServerDataSource { Id = "SalesDb", Title = "Sales database", Host = "placeholder", Database = "placeholder" };
        var orders = new MicrosoftSqlServerDataSourceItem("Orders", "orders", db)
        {
            Id = "Orders",
            Fields = new List<IField>
            {
                new NumberField("id"), new DateField("order_date"), new TextField("status"), new NumberField("total_amount"),
            },
        };

        var document = new RdashDocument("Orders");
        var status = new DashboardDataFilter("status", orders);
        document.Filters.Add(status);
        document.Visualizations.Add(new LineChartVisualization("Order value by month", orders)
            .SetLabel(new DateDataField("order_date") { AggregationType = DateAggregationType.Month })
            .SetValues("total_amount")
            .ConnectDashboardFilter(status));
        document.Visualizations.Add(new GridVisualization("Orders", orders)
            .SetColumns("id", "order_date", "status", "total_amount")
            .ConnectDashboardFilter(status));
        return document;
    }

    /// <summary>Validates bound fields, then writes the .rdash file.</summary>
    public static void Save(RdashDocument document, string path)
    {
        Guard.AssertBoundFieldsExist(document.ToJsonString());
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        document.Save(path);
    }
}
