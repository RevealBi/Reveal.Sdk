using Reveal.Sdk;
using Reveal.Sdk.Data;

/// <summary>
/// Fills in connection details on the server so the browser only ever sees data source
/// ids and titles. Called for every data source and item a dashboard uses.
/// </summary>
public class DataSourceProvider : IRVDataSourceProvider
{
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
        return dataSourceItem;
    }
}
