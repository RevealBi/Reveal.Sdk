package com.example.revealembed;

import io.revealbi.core.RevealServerBuilder;
import io.revealbi.servlet.RevealEngineServlet;
import java.nio.file.Paths;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RevealConfig {

    @Bean
    ServletRegistrationBean<RevealEngineServlet> revealServlet(@Value("${reveal.dashboards-dir}") String dashboardsDir) {
        // The Supplier runs in the servlet's init(); the engine process starts there and
        // stops in destroy().
        RevealEngineServlet servlet = new RevealEngineServlet(
            () -> new RevealServerBuilder()
                // Always set one that validates the id and authorizes the user: without it
                // Reveal falls back to RVDashboardProvider on ~/dashboards, a demo default
                // that lets any caller overwrite any dashboard.
                .setDashboardProvider(new DashboardProvider(Paths.get(dashboardsDir)))
                .setDataSourceProvider(new DataSourceProvider())
                // Add the app's credentials here, e.g. .setAuthenticationProvider(new AuthenticationProvider())
                .addSettings(settings -> {
                    // Only set a non-blank key; an empty or whitespace one disables the key file fallback.
                    String license = System.getenv("REVEAL_LICENSE");
                    if (license != null && !license.isBlank()) {
                        settings.setLicense(license.strip());
                    }
                })
                .build(),
            new UserContextProvider(RevealEmbedApplication.anonymousDemo));

        // The client's base URL must include this prefix (see static/index.html).
        ServletRegistrationBean<RevealEngineServlet> reg = new ServletRegistrationBean<>(servlet, "/reveal-api/*");
        // Required: the servlet calls request.startAsync(). Without it every Reveal request fails
        // with IllegalStateException "A filter or servlet of the current chain does not support
        // asynchronous operations".
        reg.setAsyncSupported(true);
        reg.setLoadOnStartup(1);
        return reg;
    }
}
