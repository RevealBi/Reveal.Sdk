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
    // The core connectors (REST, web resource, OData, local files) need no registration,
    // so a crafted request can point them at any URL or file path. Returning the item
    // unchanged, returning null and throwing all run it as sent, so until a location is
    // mapped to a server-controlled value it is overwritten with one that cannot resolve.
    private const string BlockedUrl = "https://blocked.invalid/"; // .invalid never resolves (RFC 2606)
    private const string BlockedFile = "local:/blocked-by-server";

    private readonly IConfiguration _configuration;

    public DataSourceProvider(IConfiguration configuration) => _configuration = configuration;

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
            case RVRESTDataSourceItem rest: rest.Url = BlockedUrl; break;
#pragma warning restore CS0618
            case RVWebResourceDataSourceItem web: web.Url = BlockedUrl; break;
            case RVODataDataSourceItem odata: odata.Url = BlockedUrl; break;
            case RVLocalFileDataSourceItem local: local.Uri = BlockedFile; break;
            // Excel, CSV and JSON items wrap the REST, web or local file item that holds the location.
            case RVResourceBasedDataSourceItem { ResourceItem: RVDataSourceItem resource }:
                await ChangeDataSourceItemAsync(userContext, dashboardId, resource);
                break;
        }
        return dataSourceItem;
    }
}
