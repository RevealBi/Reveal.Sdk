package com.example.revealembed;

import jakarta.servlet.Filter;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http,
            @Value("${reveal.client-origin:}") String clientOrigin,
            @Value("${reveal.allow-anonymous:false}") boolean allowAnonymous) throws Exception {
        http.authorizeHttpRequests(a -> {
            if (!allowAnonymous) {
                // Reading the principal in UserContextProvider does not reject anyone; this does.
                a.requestMatchers("/reveal-api/**").authenticated();
            }
            a.anyRequest().permitAll(); // the page itself stays public
        });

        // Add the app's real scheme, e.g. .oauth2ResourceServer(o -> o.jwt(...)) or
        // .formLogin(...). Until then nobody is authenticated, so with
        // reveal.allow-anonymous=false every Reveal request gets 401.
        http.exceptionHandling(e -> e.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)));

        // Spring Security rejects every POST without a CSRF token (403), and the Reveal client
        // POSTs for widget data and saves. Keep CSRF on for cookie sessions: the token goes in
        // an XSRF-TOKEN cookie and index.html sends it back through
        // RevealSdkSettings.setAdditionalHeadersProvider. (With bearer tokens and no cookies,
        // .csrf(c -> c.ignoringRequestMatchers("/reveal-api/**")) is the alternative.)
        http.csrf(c -> c
            .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()));
        http.addFilterAfter(csrfCookieFilter(), CsrfFilter.class);

        // Only when the front end is served from another origin; never allow every origin.
        if (!clientOrigin.isBlank()) {
            CorsConfiguration cors = new CorsConfiguration();
            cors.setAllowedOrigins(List.of(clientOrigin));
            cors.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
            cors.setAllowedHeaders(List.of("*"));
            UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
            source.registerCorsConfiguration("/reveal-api/**", cors);
            http.cors(c -> c.configurationSource(source));
        }
        return http.build();
    }

    // Spring Security 6 loads the CSRF token lazily; touching it writes the cookie on the
    // first page load, before the first Reveal POST.
    private static Filter csrfCookieFilter() {
        return (request, response, chain) -> {
            CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
            if (token != null) token.getToken();
            chain.doFilter(request, response);
        };
    }
}
