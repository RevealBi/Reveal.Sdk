# Reveal server on Java

Requires Java 17+, a Jakarta EE 9 compliant server (Tomcat 10+, Spring Boot 3.x; Spring Boot 2.x is not supported), Maven 3.6.3+. Windows, Linux and macOS on x64 and ARM64. AIX and other platforms that cannot run the native components are not supported. Sources: https://help.revealbi.io/web/getting-started-spring-boot and `install-server-sdk`, plus `upgrade-guide-v2.0.0-java` for anyone coming from 1.x.

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

If the app runs on Jetty, its version can conflict with the Jetty Reveal uses internally (12.0.12).

## Spring Boot

Register `RevealEngineServlet` as a servlet bean. Packages are `io.revealbi.core.*` and `io.revealbi.servlet.*` from 2.0 onwards (1.x used `com.infragistics.reveal.sdk.*`).

```java
import io.revealbi.core.RevealServerBuilder;
import io.revealbi.servlet.RevealEngineServlet;

@Bean
ServletRegistrationBean<RevealEngineServlet> revealServlet() {
    // The constructor takes a Supplier<IRevealServer> (or a built IRevealServer) plus the user context provider.
    RevealEngineServlet servlet = new RevealEngineServlet(
        () -> new RevealServerBuilder()
            .setDashboardProvider(new DashboardProvider(Paths.get("Dashboards")))   // per-user, see Dashboards below
            .setDataSourceProvider(new DataSourceProvider())
            .setAuthenticationProvider(new AuthenticationProvider())
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
```

- The second constructor argument builds the user context from the `HttpServletRequest`. Read the user from the app's existing security (Spring Security principal, session), not from a client-chosen header.
- **Protect the endpoint; reading the principal does not reject anonymous callers.** Add an explicit rule, for example in Spring Security: `http.authorizeHttpRequests(a -> a.requestMatchers("/reveal-api/**").authenticated())` (or `.anyRequest().authenticated()`), and have `userIdFrom(request)` throw when `request.getUserPrincipal()` is null instead of falling back to a default id. Without Spring Security, add a `<security-constraint>` for `/reveal-api/*` in `web.xml` (or `@ServletSecurity` on a servlet subclass). Verify an unauthenticated request to `/reveal-api/` gets 401/403.
- The mapping (`/reveal-api/*` here) must match the client's base URL: `RevealSdkSettings.setBaseUrl("https://host/reveal-api/")`. The getting-started sample maps `/*` so no base URL path is needed.
- `setAsyncSupported(true)` is required.
- **There is no default dashboards folder on Java.** Always set a dashboard provider (see [Dashboards](#dashboards)).

## Tomcat (no Spring)

Same builder, registered from a `ServletContextListener`. Also add a `<security-constraint>` for `/reveal-api/*` in `web.xml` (with an `auth-constraint` role) so anonymous requests are rejected:

```java
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

The built-in `RVDashboardProvider(path)` loads and saves `.rdash` files from one shared folder and lets any caller overwrite any dashboard. Use a provider that validates the client's dashboard id and scopes saves to the caller, the same pattern as the ASP.NET and Node starters: shared dashboards are read-only, and each user saves into a private folder keyed by a hash of their id (compiled against `reveal-sdk-core` 2.2.0):

```java
import io.revealbi.core.IRVDashboardProvider;
import io.revealbi.core.IRVUserContext;
import java.io.FileNotFoundException;
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
    private static final Pattern VALID_ID = Pattern.compile("^[A-Za-z0-9_-]{1,100}$");
    private final Path sharedDir;

    public DashboardProvider(Path sharedDir) {
        this.sharedDir = sharedDir.toAbsolutePath();
    }

    private Path userDir(IRVUserContext userContext) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                .digest(String.valueOf(userContext.getUserId()).getBytes(StandardCharsets.UTF_8));
            return sharedDir.resolve("users").resolve(HexFormat.of().formatHex(hash));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    @Override
    public InputStream getDashboard(IRVUserContext userContext, String dashboardId) throws IOException {
        if (!VALID_ID.matcher(dashboardId).matches()) throw new IllegalArgumentException("Invalid dashboard id");
        for (Path dir : List.of(userDir(userContext), sharedDir)) {
            Path file = dir.resolve(dashboardId + ".rdash");
            if (Files.exists(file)) return Files.newInputStream(file);
        }
        throw new FileNotFoundException(dashboardId);
    }

    @Override
    public void saveDashboard(IRVUserContext userContext, String dashboardId, InputStream dashboard) throws IOException {
        if (!VALID_ID.matcher(dashboardId).matches()) throw new IllegalArgumentException("Invalid dashboard id");
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

Same concepts as ASP.NET with synchronous Java signatures:

| Interface | Builder method |
| --- | --- |
| `IRVDataSourceProvider` (`changeDataSource`, `changeDataSourceItem`) | `setDataSourceProvider` |
| `IRVAuthenticationProvider` (`resolveCredentials`) | `setAuthenticationProvider` |
| `IRVDashboardProvider` (`getDashboard` returns `InputStream`, `saveDashboard`) | `setDashboardProvider` |
| `IRVObjectFilter` (data-source-item overload only from 2.0) | `setObjectFilter` |
| `IRVDataModelProvider` (beta) | `setDataModelProvider` |

## CORS for development

A permissive servlet `Filter` that echoes the `Origin`, allows the requested method and headers, and answers `OPTIONS` with 204 is in the Spring Boot getting-started topic. Restrict it to known origins in production.

## Export on Java

Image export uses Playwright; Excel, PDF and PowerPoint use a bundled **ExportTool**. Both download on first use. On locked-down servers or Linux, install the dependencies ahead of time; see `configure-export` in the docs.

## Run

```bash
./mvnw spring-boot:run -Dspring-boot.run.arguments=--server.port=5111
```
