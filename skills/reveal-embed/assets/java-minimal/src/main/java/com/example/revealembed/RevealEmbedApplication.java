// Minimal Spring Boot host for the Reveal SDK. Serves the Reveal endpoints under /reveal-api/
// and a same-origin page from src/main/resources/static.
//
//     ./mvnw spring-boot:run -Dspring-boot.run.arguments=--anonymous-demo   ->  http://localhost:5111/
//
// Without --anonymous-demo every Reveal request requires an authenticated user and gets 401
// until the app's real authentication is wired into SecurityConfig. The flag is for a local
// first run only: anonymous access, and the server listens on 127.0.0.1 alone.
//
// License: put the raw key in ~/.revealbi-sdk/license.key of the account running the server,
// or set REVEAL_LICENSE.
package com.example.revealembed;

import java.net.InetAddress;
import java.util.Arrays;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.boot.web.servlet.server.ConfigurableServletWebServerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;

@SpringBootApplication
public class RevealEmbedApplication {
    static boolean anonymousDemo;

    public static void main(String[] args) {
        anonymousDemo = Arrays.asList(args).contains("--anonymous-demo");
        SpringApplication.run(RevealEmbedApplication.class,
            Arrays.stream(args).filter(a -> !a.equals("--anonymous-demo")).toArray(String[]::new));
    }

    // Runs after Spring's own customizer, so loopback wins whatever server.address says.
    @Bean
    @Order(Ordered.LOWEST_PRECEDENCE)
    WebServerFactoryCustomizer<ConfigurableServletWebServerFactory> demoLoopbackOnly() {
        return factory -> {
            if (anonymousDemo) {
                factory.setAddress(InetAddress.getLoopbackAddress());
            }
        };
    }
}
