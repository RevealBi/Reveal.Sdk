// Offline check of the default-deny providers in server.js: no port is opened.
//     npm test
const assert = require("assert");
const reveal = require("reveal-sdk-node");
const { dataSourceProvider, dataSourceItemProvider, ownSampleUrl, BLOCKED_DB } = require("./server.js");

const PORT = Number(process.env.PORT) || 5112;
const own = `http://127.0.0.1:${PORT}/sample-data/`;
const ctx = new reveal.RVUserContext("preview", new Map());
let failures = 0;
const test = async (name, body) => {
    try { await body(); console.log(`ok    ${name}`); }
    catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

(async () => {
    await test("sample REST item is pointed at ./sample-data", async () => {
        const item = new reveal.RVRESTDataSourceItem(new reveal.RVRESTDataSource());
        item.id = "sales"; item.url = "https://example.com/sales.json";
        await dataSourceItemProvider(ctx, item);
        assert.strictEqual(item.url, `${own}sales.json`);
    });
    await test("other REST item is blocked", async () => {
        const item = new reveal.RVRESTDataSourceItem(new reveal.RVRESTDataSource());
        item.id = "other"; item.url = "http://169.254.169.254/latest/meta-data";
        await dataSourceItemProvider(ctx, item);
        assert.strictEqual(item.url, "https://blocked.invalid/");
    });
    await test("image fetch of the server's own sample-data URL is allowed", async () => {
        const item = new reveal.RVWebResourceDataSourceItem(new reveal.RVWebResourceDataSource());
        item.id = "0b8f7c3e-guid"; item.url = `${own}img/a.png`;
        await dataSourceItemProvider(ctx, item);
        assert.strictEqual(item.url, `${own}img/a.png`);
    });
    await test("URLs that leave sample-data are blocked", async () => {
        for (const url of [`${own}../api/info`, `${own}%2e%2e/api/info`, `http://127.0.0.1:${PORT + 1}/sample-data/a.png`, `http://evil.test/sample-data/a.png`]) {
            assert.strictEqual(ownSampleUrl(url), null, url);
        }
    });
    await test("SQLite item cannot open the file it names", async () => {
        const ds = new reveal.RVSQLiteDataSource(); ds.database = "C:/secret/canary.db";
        const item = new reveal.RVSQLiteDataSourceItem(ds); item.table = "t";
        await dataSourceItemProvider(ctx, item);
        assert.strictEqual(item.dataSource.database, BLOCKED_DB);
        await dataSourceProvider(ctx, ds);
        assert.strictEqual(ds.database, BLOCKED_DB);
    });
    await test("DuckDB item cannot open the file it names", async () => {
        const ds = new reveal.RVDuckDBDataSource(); ds.database = "/etc/passwd";
        const item = new reveal.RVDuckDBDataSourceItem(ds);
        await dataSourceItemProvider(ctx, item);
        assert.strictEqual(item.dataSource.database, BLOCKED_DB);
    });
    await test("Postgres and SQL Server hosts are blocked", async () => {
        for (const [Ds, Item] of [[reveal.RVPostgresDataSource, reveal.RVPostgresDataSourceItem], [reveal.RVSqlServerDataSource, reveal.RVSqlServerDataSourceItem]]) {
            const ds = new Ds(); ds.host = "127.0.0.1"; ds.database = "prod";
            const item = new Item(ds);
            await dataSourceItemProvider(ctx, item);
            assert.strictEqual(item.dataSource.host, "blocked.invalid", Ds.name);
        }
    });
    await test("local file wrapped in a JSON item is blocked", async () => {
        const file = new reveal.RVLocalFileDataSourceItem(); file.uri = "local:/../../secret.json";
        const item = new reveal.RVJsonDataSourceItem(file);
        await dataSourceItemProvider(ctx, item);
        assert.strictEqual(file.uri, "local:/blocked-by-preview");
    });
    console.log(failures ? `\n${failures} failed` : "\nAll passed.");
    process.exit(failures ? 1 : 0);
})();
