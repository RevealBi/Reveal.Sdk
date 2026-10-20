using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Reveal.Sdk;
using Reveal.Sdk.Data;
using Reveal.Sdk.Data.OData;
using Reveal.Sdk.Data.Rest;

/// <summary>
/// Fills in connection details on the server so the browser only ever sees data source
/// ids and titles. Called for every data source and item a dashboard uses.
/// </summary>
public class DataSourceProvider : IRVDataSourceProvider
{
    // Default deny. The core connectors (REST, web resource, OData, local files) need no
    // registration, so a crafted request can point them at any URL or file path. Returning
    // the item unchanged or returning null runs it as sent (on every platform), so until a location is mapped to
    // a server-controlled value it is overwritten with one that cannot resolve, and every
    // other item type is refused. On ASP.NET 2.2.1 throwing fails the widget (it does not
    // run the item) and shows the exception message in the browser, so keep it generic.
    private const string BlockedUrl = "https://blocked.invalid/"; // .invalid never resolves (RFC 2606)
    private const string BlockedFile = "local:/blocked-by-server";

    private readonly IConfiguration _configuration;
    private readonly IServer _server;

    public DataSourceProvider(IConfiguration configuration, IServer server)
    {
        _configuration = configuration;
        _server = server;
    }

    // The sample dashboard's REST items: item id -> file in wwwroot/sample-data. Whatever URL
    // the dashboard names, the engine reads this app's own copy over loopback. Remove this,
    // SampleUrl and the "sales" case below together with the sample.
    private static readonly Dictionary<string, string> SampleData = new() { ["sales"] = "sales.json" };

    private string SampleUrl(string file)
    {
        var address = _server.Features.Get<IServerAddressesFeature>()?.Addresses
            .FirstOrDefault(a => a.StartsWith("http://")) ?? throw new InvalidOperationException("The sample data needs an http:// address.");
        var port = address.TrimEnd('/')[(address.TrimEnd('/').LastIndexOf(':') + 1)..];
        return $"http://127.0.0.1:{port}/sample-data/{file}";
    }

    public Task<RVDashboardDataSource> ChangeDataSourceAsync(IRVUserContext userContext, RVDashboardDataSource dataSource)
    {
        // Example for SQL Server (needs Reveal.Sdk.Data.Microsoft.SqlServer and
        // RegisterMicrosoftSqlServer() in Program.cs):
        //
        // if (dataSource is RVSqlServerDataSource sql)
        // {
        //     sql.Host = _configuration["Reveal:Sql:Host"];
        //     sql.Database = _configuration["Reveal:Sql:Database"];
        // }

        // Replace with URLs from configuration for the endpoints the app uses.
        switch (dataSource)
        {
            case RVRESTDataSource rest: rest.Url = BlockedUrl; break;
            case RVWebResourceDataSource web: web.Url = BlockedUrl; break;
            case RVODataDataSource odata: odata.Url = BlockedUrl; break;
        }
        return Task.FromResult(dataSource);
    }

    public async Task<RVDataSourceItem> ChangeDataSourceItemAsync(IRVUserContext userContext, string dashboardId, RVDataSourceItem dataSourceItem)
    {
        // Required: the item carries its own copy of the data source, and changes made in
        // ChangeDataSourceAsync are not applied to it automatically.
        await ChangeDataSourceAsync(userContext, dataSourceItem.DataSource);

        // Map item ids to the real table or query here. Parameterize anything that comes
        // from the user context:
        //
        // if (dataSourceItem is RVSqlServerDataSourceItem item && item.Id == "Orders")
        // {
        //     item.CustomQuery = "SELECT * FROM Orders WHERE TenantId = @tenantId";
        //     item.CustomQueryParameters = new Dictionary<string, object>
        //     {
        //         ["@tenantId"] = userContext.Properties["TenantId"]
        //     };
        // }

        // Locations the request chose. Replace with server-side allow-lists, e.g. a local
        // file Uri built only from known ids (see references/data-sources.md, "Files").
        switch (dataSourceItem)
        {
#pragma warning disable CS0618 // Deprecated, but a request can still set it, so overwrite it too.
            case RVRESTDataSourceItem sample when SampleData.TryGetValue(sample.Id ?? "", out var file):
                sample.Url = SampleUrl(file);
                if (sample.DataSource is RVRESTDataSource sampleSource) sampleSource.Url = sample.Url;
                break;
            case RVRESTDataSourceItem rest: rest.Url = BlockedUrl; break;
#pragma warning restore CS0618
            case RVWebResourceDataSourceItem web: web.Url = BlockedUrl; break;
            case RVODataDataSourceItem odata: odata.Url = BlockedUrl; break;
            case RVLocalFileDataSourceItem local: local.Uri = BlockedFile; break;
            // Excel, CSV and JSON items wrap the REST, web or local file item that holds the location.
            case RVResourceBasedDataSourceItem { ResourceItem: RVDataSourceItem resource }:
                await ChangeDataSourceItemAsync(userContext, dashboardId, resource);
                break;
            case RVInMemoryDataSourceItem: break; // data defined by the server
            // Databases and anything else not mapped above (registered connectors included).
            default: throw new InvalidOperationException("Data source not allowed.");
        }
        return dataSourceItem;
    }
}
