# java-minimal

Minimal Spring Boot 3 + Spring Security host for the Reveal SDK (`reveal-sdk-servlet` 2.2.1, Java 17+). Reveal is mapped at `/reveal-api/`; the page in `src/main/resources/static` is served from the same origin and shows the sample dashboard, `Dashboards/Sales.rdash`, view only.

```bash
./mvnw spring-boot:run      # -> http://localhost:5111/   (Windows: .\mvnw.cmd spring-boot:run)
./mvnw -q package           # fat jar in target/
```

Who may open dashboards is set in `application.properties`, not on the command line. The sample has no login, so `reveal.allow-anonymous=true`: anyone who can open it can view the dashboards, and it listens on 127.0.0.1 only (`SERVER_ADDRESS=0.0.0.0` to reach it from outside a container). Once the app has login, set it to `false` and wire the login into `SecurityConfig`: every Reveal request then needs a signed-in user. Saves are refused unless `reveal.allow-editing=true`. `?dashboard=<name>` loads `Dashboards/<name>.rdash`. License: the raw key in `~/.revealbi-sdk/license.key` of the account running the server, or `REVEAL_LICENSE`.

What it covers:

- `/reveal-api/**` requires authentication unless `reveal.allow-anonymous=true`; `UserContextProvider` takes the user id from the principal and fails on a missing or blank one.
- CSRF stays on: the token goes in an `XSRF-TOKEN` cookie and `index.html` sends it back through `RevealSdkSettings.setAdditionalHeadersProvider` (Reveal POSTs for widget data and saves).
- `DashboardProvider`: shared dashboards are never written; saves are refused unless `reveal.allow-editing=true`, then go per user under `Dashboards/users/<sha256 of user id>/`. The id must fully match `[A-Za-z0-9_-]{1,100}`, writes go to a temp file then an atomic move, and a missing dashboard gives 404.
- `DataSourceProvider`: default deny. REST/web/OData/local-file locations and database hosts are overwritten with values that cannot resolve, and any other connector type is refused. The one exception is the sample: its `sales` item is mapped to `static/sample-data/sales.json`, served by this app. Delete the dashboard, the data and that rule together once the app has its own data.
- `setAsyncSupported(true)`, license only when non-blank, opt-in CORS for one origin (`reveal.client-origin`).

Left to the app: the real authentication scheme (OAuth2/JWT, form login), mapping data sources to real hosts and credentials (`IRVAuthenticationProvider`), tenants and sharing rules for dashboards, durable storage, HTTPS. The deployable carries the native engine for the OS and CPU it was built on; build on the server's platform (see references/server-java.md).
