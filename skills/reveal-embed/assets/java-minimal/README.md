# java-minimal

Minimal Spring Boot 3 + Spring Security host for the Reveal SDK (`reveal-sdk-servlet` 2.2.1, Java 17+). Reveal is mapped at `/reveal-api/`; the page in `src/main/resources/static` is served from the same origin.

```bash
./mvnw spring-boot:run -Dspring-boot.run.arguments=--anonymous-demo   # -> http://localhost:5111/
./mvnw -q package                                                      # fat jar in target/
```

Without `--anonymous-demo` every Reveal request needs an authenticated user and gets 401 until the app's real authentication is wired into `SecurityConfig`. The flag is for a local first run only: anonymous access, and the server listens on 127.0.0.1 alone. `?dashboard=Sales` loads `Dashboards/Sales.rdash`; with none, an empty dashboard opens in the editor. License: the raw key in `~/.revealbi-sdk/license.key` of the account running the server, or `REVEAL_LICENSE`.

What it covers:

- `/reveal-api/**` requires authentication; `UserContextProvider` takes the user id from the principal and fails on a missing or blank one.
- CSRF stays on: the token goes in an `XSRF-TOKEN` cookie and `index.html` sends it back through `RevealSdkSettings.setAdditionalHeadersProvider` (Reveal POSTs for widget data and saves).
- `DashboardProvider`: shared dashboards read-only, saves per user under `Dashboards/users/<sha256 of user id>/`, the id must fully match `[A-Za-z0-9_-]{1,100}`, temp file then atomic move, missing dashboard gives 404.
- `DataSourceProvider`: default deny. REST/web/OData/local-file locations and database hosts are overwritten with values that cannot resolve, and any other connector type is refused.
- `setAsyncSupported(true)`, license only when non-blank, opt-in CORS for one origin (`reveal.client-origin`).

Left to the app: the real authentication scheme (OAuth2/JWT, form login), mapping data sources to real hosts and credentials (`IRVAuthenticationProvider`), tenants and sharing rules for dashboards, durable storage, HTTPS. The deployable carries the native engine for the OS and CPU it was built on; build on the server's platform (see references/server-java.md).
