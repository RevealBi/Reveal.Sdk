# Reveal server on Java

Requires Java 17+, a Jakarta EE 9 compliant server (Tomcat 10+, Spring Boot 3.x; Spring Boot 2.x is not supported), Maven 3.6.3+. Windows, Linux and macOS on x64 and ARM64. AIX and other platforms that cannot run the native components are not supported. Sources: https://help.revealbi.io/web/getting-started-spring-boot/ and `install-server-sdk`, plus `upgrade-guide-v2.0.0-java` for anyone coming from 1.x.

## Install

```xml
<repositories>
    <repository>
        <id>reveal.public</id>
        <url>https://maven.revealbi.io/repository/public</url>
    </repository>
</repositories>

<dependency>
    <groupId>io.revealbi</groupId>
    <artifactId>reveal-sdk-servlet</artifactId>
    <version><!-- same version as the client reveal-sdk --></version>
</dependency>
```

If the app runs on Jetty, its version can conflict with the Jetty Reveal uses internally (12.0.12). Under the Spring Boot parent, Boot's managed Jetty version wins (12.0.11 with Boot 3.3.2); that worked with 2.2.1.

**The native engine matches the build machine.** `reveal-sdk-core` picks the `reveal-sdk-engine-<os>-<arch>` artifact (about 145 MB) with profiles activated by the OS and CPU of the machine that runs Maven, so a fat jar built on Windows carries only the Windows engine and may not start the engine on Linux. `-P linux-x86_64` (the docs' advice) and `-P linux-amd64` have no effect (tested on 2.2.1). Build the deployable on the server's platform (for example in the Docker build stage), or add the target engine explicitly:

```xml
<dependency>
    <groupId>io.revealbi</groupId>
    <artifactId>reveal-sdk-engine-linux-x86_64</artifactId>  <!-- also -linux-aarch64, -windows-x86_64, -windows-aarch64, -mac-x86_64, -mac-aarch64 -->
    <version>2.2.1</version>
</dependency>
```

## Spring Boot

Register `RevealEngineServlet` as a servlet bean. Packages are `io.revealbi.core.*` and `io.revealbi.servlet.*` from 2.0 onwards (1.x used `com.infragistics.reveal.sdk.*`).

[assets/java-minimal](../assets/java-minimal) is a tested Spring Boot 3 + Spring Security starter with all of the pieces below (per-user dashboards, default-deny data sources, CSRF, loopback-only demo mode). The snippet below compiles against 2.2.1 together with the `DashboardProvider` and `DataSourceProvider` classes further down.

```java
import io.revealbi.core.RVUserContext;
import io.revealbi.core.RevealServerBuilder;
import io.revealbi.servlet.RevealEngineServlet;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.file.Paths;
import java.security.Principal;
import java.util.HashMap;
import java.util.Map;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RevealConfig {

    @Bean
    ServletRegistrationBean<RevealEngineServlet> revealServlet() {
        // The constructor takes a Supplier<IRevealServer> (or a built IRevealServer) plus the user context provider.
        RevealEngineServlet servlet = new RevealEngineServlet(
            () -> new RevealServerBuilder()
                .setDashboardProvider(new DashboardProvider(Paths.get("Dashboards")))   // per-user, see Dashboards below
                .setDataSourceProvider(new DataSourceProvider())                        // see Providers below
                // .setAuthenticationProvider(...)  an IRVAuthenticationProvider with the app's credentials
                .addSettings(settings -> {
                    // Only set a non-blank key; an empty one disables the license file fallback.
                    String license = System.getenv("REVEAL_LICENSE");
                    if (license != null && !license.isBlank()) {
                        settings.setLicense(license.strip());
                    }
                })
                .build(),
            request -> new RVUserContext(userIdFrom(request), propertiesFrom(request)));

        ServletRegistrationBean<RevealEngineServlet> reg = new ServletRegistrationBean<>(servlet, "/reveal-api/*");
        reg.setAsyncSupported(true);
        reg.setLoadOnStartup(1);
        return reg;
    }

    // Identity from the app's authentication (Spring Security sets the principal), never from a header.
    static String userIdFrom(HttpServletRequest request) {
        Principal p = request.getUserPrincipal();
        if (p == null || p.getName() == null || p.getName().isBlank())
            throw new IllegalStateException("Unauthenticated request");
        return p.getName();
    }

    // Values the providers read through userContext.getProperty(...), e.g. a tenant id.
    static Map<String, Object> propertiesFrom(HttpServletRequest request) {
        return new HashMap<>();
    }
}
```

- The second constructor argument (an `IRVServletUserContextProvider`) builds the user context from the `HttpServletRequest`; `RVUserContext(String, Map<String,Object>)`. Read the user from the app's existing security (Spring Security principal, session), not from a client-chosen header. If it throws, the request ends with 500 `Something went wrong. Correlation id …` before Reveal runs, so it is a backstop, not the access rule.
- **Protect the endpoint; reading the principal does not reject anonymous callers.** Add an explicit rule, for example in Spring Security: `http.authorizeHttpRequests(a -> a.requestMatchers("/reveal-api/**").authenticated())` (or `.anyRequest().authenticated()`), and have `userIdFrom(request)` throw when `request.getUserPrincipal()` is null instead of falling back to a default id. Without Spring Security, add a `<security-constraint>` for `/reveal-api/*` in `web.xml` (or `@ServletSecurity` on a servlet subclass). Verify an unauthenticated request to `/reveal-api/` gets 401/403.
- **Spring Security CSRF.** Every widget loads with a POST (`/reveal-api/dashboard/editor/widget/data`), and saves POST too. With Spring Security's default CSRF protection, once a user signs in the dashboard title renders and every widget shows `{"status":403,"error":"Forbidden",...}`; GETs still work, so a curl check of `/DashboardFile/<id>` passes. For cookie sessions keep CSRF on and send the token from the page (tested on 2.2.1, as in `assets/java-minimal`):
  ```java
  // Inside the SecurityFilterChain bean; imports from org.springframework.security.web.csrf
  // (CookieCsrfTokenRepository, CsrfTokenRequestAttributeHandler, CsrfToken, CsrfFilter).
  http.csrf(c -> c
      .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
      .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()));
  // Spring Security 6 loads the token lazily; touch it so the XSRF-TOKEN cookie is written on the page load.
  http.addFilterAfter((request, response, chain) -> {
      CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
      if (token != null) token.getToken();
      chain.doFilter(request, response);
  }, CsrfFilter.class);
  ```
  ```js
  RevealSdkSettings.setAdditionalHeadersProvider(() => {
      const token = document.cookie.split("; ").find(c => c.startsWith("XSRF-TOKEN="))?.slice(11);
      return token ? { "X-XSRF-TOKEN": decodeURIComponent(token) } : {};
  });
  ```
  With bearer tokens and no cookies, `http.csrf(c -> c.ignoringRequestMatchers("/reveal-api/**"))` is acceptable. Verify by rendering a dashboard while signed in, not with a GET.
- The mapping (`/reveal-api/*` here) must match the client's base URL: `RevealSdkSettings.setBaseUrl("https://host/reveal-api/")`, or `location.origin + "/reveal-api/"` when the same Spring app serves the page. The getting-started sample maps `/*` so no base URL path is needed.
- `setAsyncSupported(true)` is required. Without it every Reveal request returns 500 and the log shows `IllegalStateException: A filter or servlet of the current chain does not support asynchronous operations.` The docs' `install-server-sdk` Spring Boot snippet omits it.
- With `setLoadOnStartup(1)` the engine starts during application startup (not lazily on the first request). The first start extracts the engine (about 145 MB) to `%TEMP%\revealbi\<os>-<arch>-<version>\` and took about 26 s here; later starts 3-6 s.
- **Always set a dashboard provider.** Without one, Reveal uses the built-in `RVDashboardProvider()` on `~/dashboards` of the account running the server. That provider lets any caller overwrite any dashboard; treat it as a demo default and set your own that validates the id (letters, digits, dash, underscore) and authorizes the user. See [Dashboards](#dashboards).

## Tomcat (no Spring)

Same builder, registered from a `ServletContextListener`. Also add a `<security-constraint>` for `/reveal-api/*` in `web.xml` (with an `auth-constraint` role) so anonymous requests are rejected. `userIdFrom` is the method from the Spring Boot snippet:

```java
import io.revealbi.core.RVUserContext;
import io.revealbi.core.RevealServerBuilder;
import io.revealbi.servlet.RevealEngineServlet;
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.ServletRegistration;
import jakarta.servlet.annotation.WebListener;
import java.nio.file.Paths;

@WebListener
public class AppInitializer implements ServletContextListener {
    @Override
    public void contextInitialized(ServletContextEvent sce) {
        RevealEngineServlet servlet = new RevealEngineServlet(() -> new RevealServerBuilder()
                .setDashboardProvider(new DashboardProvider(Paths.get("/srv/app/dashboards")))
                .build(),
            request -> new RVUserContext(userIdFrom(request), null));

        ServletRegistration.Dynamic reg = sce.getServletContext().addServlet("reveal", servlet);
        reg.setAsyncSupported(true);
        reg.addMapping("/reveal-api/*");
    }
}
```

## Dashboards

The built-in `RVDashboardProvider(path)` loads and saves `.rdash` files from one shared folder and lets any caller overwrite any dashboard. Use a provider that validates the client's dashboard id and scopes saves to the caller, the same pattern as the ASP.NET and Node starters: shared dashboards are read-only, and each user saves into a private folder keyed by a hash of their id (compiled and tested against `reveal-sdk-core` 2.2.1). Validate the id in both `getDashboard` and `saveDashboard`:

```java
import io.revealbi.core.IRVDashboardProvider;
import io.revealbi.core.IRVUserContext;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.regex.Pattern;

public class DashboardProvider implements IRVDashboardProvider {
    private static final Pattern VALID_ID = Pattern.compile("[A-Za-z0-9_-]{1,100}");  // used with matches(): the whole id must match
    private final Path sharedDir;

    public DashboardProvider(Path sharedDir) {
        this.sharedDir = sharedDir.toAbsolutePath();
    }

    private Path userDir(IRVUserContext userContext) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                .digest(requireUserId(userContext).getBytes(StandardCharsets.UTF_8));
            return sharedDir.resolve("users").resolve(HexFormat.of().formatHex(hash));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    // Fail closed: the user context can be null (see user-context-security.md); never fold it into a shared folder.
    private static String requireUserId(IRVUserContext userContext) {
        String id = userContext == null ? null : userContext.getUserId();
        if (id == null || id.isBlank()) throw new IllegalStateException("No user");
        return id;
    }

    @Override
    public InputStream getDashboard(IRVUserContext userContext, String dashboardId) throws IOException {
        if (dashboardId == null || !VALID_ID.matcher(dashboardId).matches()) throw new IllegalArgumentException("Invalid dashboard id");
        for (Path dir : List.of(userDir(userContext), sharedDir)) {
            Path file = dir.resolve(dashboardId + ".rdash");
            if (Files.isRegularFile(file)) return Files.newInputStream(file);
        }
        return null; // the client gets 404; throwing (e.g. FileNotFoundException) gives 500
    }

    @Override
    public void saveDashboard(IRVUserContext userContext, String dashboardId, InputStream dashboard) throws IOException {
        if (dashboardId == null || !VALID_ID.matcher(dashboardId).matches()) throw new IllegalArgumentException("Invalid dashboard id");
        Path dir = userDir(userContext);
        Files.createDirectories(dir);
        // Temp file, then swap: a failed or interrupted save never truncates the previous version.
        Path tmp = Files.createTempFile(dir, dashboardId + ".", ".tmp");
        try {
            Files.copy(dashboard, tmp, StandardCopyOption.REPLACE_EXISTING);
            Files.move(tmp, dir.resolve(dashboardId + ".rdash"),
                StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException | RuntimeException e) {
            Files.deleteIfExists(tmp);
            throw e;
        }
    }
}
```

`userIdFrom(request)` must reject a missing or blank principal name (throw), so no two users share a folder. Replace with the app's own storage and rules (tenants, sharing) when it needs them; see dashboards.md.

## Providers

Same concepts as ASP.NET. The Java signatures are synchronous except the data model provider:

| Interface | Builder method |
| --- | --- |
| `IRVDataSourceProvider` (`changeDataSource(IRVUserContext, RVDashboardDataSource)`, `changeDataSourceItem(IRVUserContext, String dashboardId, RVDataSourceItem)`) | `setDataSourceProvider` |
| `IRVAuthenticationProvider` (`resolveCredentials`) | `setAuthenticationProvider` |
| `IRVDashboardProvider` (`getDashboard` returns `InputStream`, `saveDashboard`) | `setDashboardProvider` |
| `IRVObjectFilter` (data-source-item overload only from 2.0) | `setObjectFilter` |
| `IRVDataModelProvider` (beta): `editSchema`, `getCalculatedFields`, `getMeasures` take an `IRequestContext` and return `CompletableFuture<List<…>>` (the docs show only the C# `Task` signatures) | `setDataModelProvider` |

Java specifics for the data source provider (2.2.1):

- **The Java engine includes the connectors** through `reveal-sdk-servlet` alone; there is nothing to install or register. Items and data sources arrive from the client: overwrite the location for each type you use, and refuse any other type.
- **Throwing from `changeDataSourceItem` fails the widget** ("Change data source item failed unexpectedly…"); the item is not run. This differs from Node, where throwing runs the item as sent. On Java, throwing for unknown types is a valid fail-closed default, but the exception message reaches the browser, so throw a generic one (a type name, never a host, path or SQL). Returning `null` runs the item as sent, as on every platform.
- Java items have no `setDataSource`: change the item's own data source by mutating `item.getDataSource()`.
- `CustomQueryParameters`: the Java Oracle item has `setCustomQuery` but no `setCustomQueryParameters`, and the Java SDK has no MariaDB classes. For Oracle on Java, validate and allow-list any value before it reaches the query, or use a view per case.

```java
import io.revealbi.core.IRVUserContext;
import io.revealbi.core.data.*;

public class DataSourceProvider implements IRVDataSourceProvider {
    private static final String BLOCKED_URL = "https://blocked.invalid/";   // .invalid never resolves
    private static final String BLOCKED_HOST = "blocked.invalid";
    private static final String BLOCKED_FILE = "local:/blocked-by-server";
    private static final String NO_ROWS = "SELECT 1 AS id WHERE 1 = 0";   // adjust the columns to what the dashboards bind

    @Override
    public RVDashboardDataSource changeDataSource(IRVUserContext userContext, RVDashboardDataSource ds) {
        if (ds instanceof RVPostgresDataSource pg) {               // the type this app uses
            pg.setHost(System.getenv("PG_HOST")); pg.setPort(5432); pg.setDatabase("sales");
        }
        else if (ds instanceof RVRESTDataSource rest) rest.setUrl(BLOCKED_URL);
        else if (ds instanceof RVWebResourceDataSource web) web.setUrl(BLOCKED_URL);
        else if (ds instanceof RVODataDataSource odata) odata.setUrl(BLOCKED_URL);
        else if (ds instanceof RVSQLiteDataSource sqlite) sqlite.setDatabase(BLOCKED_FILE);
        else if (ds instanceof RVSqlBasedDataSource sql) sql.setHost(BLOCKED_HOST);
        else if (!(ds instanceof RVLocalFileDataSource || ds instanceof RVInMemoryDataSource))
            throw new IllegalArgumentException("Data source type not allowed: " + ds.getProviderKey());
        return ds;
    }

    @Override
    public RVDataSourceItem changeDataSourceItem(IRVUserContext userContext, String dashboardId, RVDataSourceItem item) {
        changeDataSource(userContext, item.getDataSource());   // the item carries its own copy
        if (item instanceof RVPostgresDataSourceItem pg) {      // the type this app uses
            // The client names the table, schema, procedure and query: replace all of them with
            // server-controlled values keyed by the item id, and give unknown ids no rows.
            pg.setSchema(null); pg.setProcedure(null); pg.setFunctionName(null);
            if ("Orders".equals(pg.getId())) { pg.setTable("orders"); pg.setCustomQuery(null); }
            else { pg.setTable(null); pg.setCustomQuery(NO_ROWS); }
        }
        else if (item instanceof RVRESTDataSourceItem rest) rest.setUrl(BLOCKED_URL);
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
```

Credentials go in an `IRVAuthenticationProvider`; return them only for the host the data source provider set (see data-sources.md).

## CORS for development

A permissive servlet `Filter` that echoes the `Origin`, allows the requested method and headers, and answers `OPTIONS` with 204 is in the Spring Boot getting-started topic. Restrict it to known origins in production.

## Export on Java

2.x exports in the native engine, like ASP.NET: Image, PDF and PowerPoint render in headless Chromium, downloaded on first use. Configure it in `addSettings` through `settings.getExportConfiguration()`: `setChromiumExecutablePath`, `setChromiumDownloadFolder`, `setCreateChromiumInstancesOnDemand(false)`, `setMaxConcurrentExportingThreads`, `setExportingTimeout`. The docs' `configure-export` instructions for Java (bundled ExportTool, `setExportToolContainerPath`, `-Dreveal.exportToolContainerPath`, the Playwright-Java CLI) describe 1.x and do not apply to 2.2.1. Server-side export: `servlet.getRevealServer().getDashboardExporter().exportToPdf(id)` returns a `CompletableFuture<InputStream>` (the docs' `server-export` Java sample is 1.x JAX-RS). Checked against the 2.2.1 API; Java export itself was not run. Hosting notes (request size, first-export download) are in [production.md](production.md#export-pdf-image-powerpoint-excel-csv).

## Run

```bash
./mvnw spring-boot:run -Dspring-boot.run.arguments=--server.port=5111
```

- An empty or whitespace license key makes the servlet's `init()` throw `The license key is missing or has expired.`; with `setLoadOnStartup(1)` Spring Boot then fails to start (`Unable to start embedded Tomcat server`). Set the key only when it is non-blank.
- Logs: the servlet logs through SLF4J (errors carry the `Correlation id` the client shows). The native engine writes `%TEMP%\revealbi-logs\reveal-engine.log` on Windows (per the docs' upgrade guide). The engine process is stopped only on a clean shutdown.
- Reveal's internal Jetty callback server (engine to servlet) listens on all interfaces (`0.0.0.0:<random port>`); calls are gated by a per-run token. Block that port range from outside with the host firewall if the server is reachable directly.
- macOS on Apple silicon may need `codesign -s -` on the extracted engine (docs' upgrade guide).

Starting point: [assets/java-minimal](../assets/java-minimal).
