// Minimal Spring Boot host for the Reveal SDK. Serves the Reveal endpoints under /reveal-api/
// and a same-origin page from src/main/resources/static that shows the sample dashboard,
// Dashboards/Sales.rdash, view only.
//
//     ./mvnw spring-boot:run    ->  http://localhost:5111/
//
// Who may open dashboards is decided in application.properties, not on the command line. This
// sample has no login, so reveal.allow-anonymous=true. Once the app has login, set it to false
// and wire the login into SecurityConfig: every Reveal request then needs a signed-in user.
// Saves are refused unless reveal.allow-editing=true; each user then saves into a private
// folder (with allow-anonymous, every visitor shares one).
//
// License: put the raw key in ~/.revealbi-sdk/license.key of the account running the server,
// or set REVEAL_LICENSE.
package com.example.revealembed;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class RevealEmbedApplication {
    public static void main(String[] args) {
        SpringApplication.run(RevealEmbedApplication.class, args);
    }
}
