using Reveal.Sdk.Dom.Data;
using Reveal.Sdk.Dom.Visualizations;

namespace DomSamples;

// The sample sales data served by ../preview (sample-data/sales.json). The URL stored in the
// dashboard is a placeholder: the preview server maps the item id "sales" to the real
// location, the same way an app's server-side data source provider should treat every URL,
// host or table a dashboard names (see the reveal-embed skill, data-sources.md).
public static class Sales
{
    // Field names as constants, so a typo is a compile error instead of a broken widget.
    public const string OrderId = "OrderId";
    public const string OrderDate = "OrderDate";
    public const string Region = "Region";
    public const string Product = "Product";
    public const string Category = "Category";
    public const string Quantity = "Quantity";
    public const string Revenue = "Revenue";

    public static RestDataSourceItem Item()
    {
        var dataSource = new DataSource { Id = "SampleData", Title = "Sample data" };
        return new RestDataSourceItem("Sales", "https://sample-data.invalid/sales.json", dataSource)
        {
            Id = "sales",
            IsAnonymous = true,
            Fields = new List<IField>
            {
                new NumberField(OrderId),
                new DateField(OrderDate),
                new TextField(Region),
                new TextField(Product),
                new TextField(Category),
                new NumberField(Quantity),
                new NumberField(Revenue),
            },
        };
    }
}
