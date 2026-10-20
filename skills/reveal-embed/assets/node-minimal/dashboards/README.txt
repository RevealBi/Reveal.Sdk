Put .rdash files here. The client loads dashboards/Sales.rdash as "Sales".

Sales.rdash is a sample built with the reveal-dashboard-authoring skill on one REST item, id
"sales". Its URL is a placeholder: reveal-server.cjs maps that item id to
../sample-data/sales.json, served by this app, so the sample renders without an outside
connection. Delete the dashboard, sample-data/ and the SAMPLE_DATA rule together when the app
has its own data.
