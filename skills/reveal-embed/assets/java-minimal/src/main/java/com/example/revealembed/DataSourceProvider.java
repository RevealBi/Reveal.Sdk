package com.example.revealembed;

import io.revealbi.core.IRVUserContext;
import io.revealbi.core.data.*;

/**
 * Fills in connection details on the server so the browser only ever sees data source ids
 * and titles. Called for every data source and item a dashboard uses.
 *
 * Data sources and items arrive from the client, for every connector type. Returning
 * null runs the item as sent. Until a location is mapped to a server-controlled value it is
 * overwritten with one that cannot resolve, and a type with no rule here is refused: on Java
 * an exception fails the widget and the item is not run (on Node it would run as sent). The
 * exception message reaches the browser, so keep it generic: a type name, never a host or path.
 */
public class DataSourceProvider implements IRVDataSourceProvider {
    private static final String BLOCKED_URL = "https://blocked.invalid/";  // .invalid never resolves (RFC 2606)
    private static final String BLOCKED_HOST = "blocked.invalid";
    private static final String BLOCKED_FILE = "local:/blocked-by-server";

    @Override
    public RVDashboardDataSource changeDataSource(IRVUserContext userContext, RVDashboardDataSource dataSource) {
        // Example for PostgreSQL (credentials go in an IRVAuthenticationProvider):
        // if (dataSource instanceof RVPostgresDataSource pg) {
        //     pg.setHost(System.getenv("PG_HOST")); pg.setPort(5432); pg.setDatabase("sales");
        //     return dataSource;
        // }
        if (dataSource instanceof RVRESTDataSource rest) rest.setUrl(BLOCKED_URL);
        else if (dataSource instanceof RVWebResourceDataSource web) web.setUrl(BLOCKED_URL);
        else if (dataSource instanceof RVODataDataSource odata) odata.setUrl(BLOCKED_URL);
        else if (dataSource instanceof RVSQLiteDataSource sqlite) sqlite.setDatabase(BLOCKED_FILE); // a file path
        else if (dataSource instanceof RVSqlBasedDataSource sql) sql.setHost(BLOCKED_HOST);
        else if (dataSource instanceof RVLocalFileDataSource || dataSource instanceof RVInMemoryDataSource) {
            // Location is on the item (local files) or defined by the server (in-memory).
        } else {
            throw new IllegalArgumentException("Data source type not allowed: " + dataSource.getProviderKey());
        }
        return dataSource;
    }

    @Override
    public RVDataSourceItem changeDataSourceItem(IRVUserContext userContext, String dashboardId, RVDataSourceItem item) {
        // Required: the item carries its own copy of the data source, and changes made in
        // changeDataSource are not applied to it automatically.
        changeDataSource(userContext, item.getDataSource());

        // Map item ids to the real table or query here; parameterize anything from the user context:
        // if (item instanceof RVPostgresDataSourceItem pg && "Orders".equals(pg.getId())) {
        //     pg.setCustomQuery("SELECT * FROM orders WHERE tenant_id = @tenantId");
        //     pg.setCustomQueryParameters(new HashMap<>(Map.of("@tenantId", userContext.getProperty("TenantId"))));
        // }

        if (item instanceof RVRESTDataSourceItem rest) rest.setUrl(BLOCKED_URL);
        else if (item instanceof RVWebResourceDataSourceItem web) web.setUrl(BLOCKED_URL);
        else if (item instanceof RVODataDataSourceItem odata) odata.setUrl(BLOCKED_URL);
        else if (item instanceof RVLocalFileDataSourceItem local) local.setUri(BLOCKED_FILE);
        // Excel, CSV and JSON items wrap the REST, web or local file item that holds the location.
        else if (item instanceof RVResourceBasedDataSourceItem wrapper
                && wrapper.getResourceItem() instanceof RVDataSourceItem inner) {
            changeDataSourceItem(userContext, dashboardId, inner);
        }
        return item;
    }
}
