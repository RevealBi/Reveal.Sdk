package com.example.revealembed;

import io.revealbi.core.IRVUserContext;
import io.revealbi.core.RVUserContext;
import io.revealbi.servlet.IRVServletUserContextProvider;
import jakarta.servlet.http.HttpServletRequest;
import java.security.Principal;
import java.util.HashMap;
import java.util.Map;

/**
 * Builds the Reveal user context for each request. Every other provider receives it.
 * Identity comes from the app's authentication (Spring Security sets the principal), never
 * from a header or parameter the browser chose. An exception here ends the request with 500
 * before Reveal runs, so this is a backstop; SecurityConfig is what returns 401.
 */
public class UserContextProvider implements IRVServletUserContextProvider {
    private final boolean allowAnonymous;

    public UserContextProvider(boolean allowAnonymous) {
        this.allowAnonymous = allowAnonymous;
    }

    @Override
    public IRVUserContext getUserContext(HttpServletRequest request) {
        if (request == null) throw new IllegalStateException("No HTTP request");  // fail closed
        Map<String, Object> properties = new HashMap<>();
        // Example: carry a tenant through to the data source provider.
        // properties.put("TenantId", tenantOf(request.getUserPrincipal()));

        Principal principal = request.getUserPrincipal();
        if (principal == null) {
            if (allowAnonymous) {
                return new RVUserContext("anonymous", properties);   // every visitor shares one context
            }
            throw new IllegalStateException("Unauthenticated request");
        }
        // Fail closed: a principal without a stable id must not share a folder with others.
        // Use the claim your scheme treats as the stable id (e.g. the JWT "sub").
        String userId = principal.getName();
        if (userId == null || userId.isBlank()) {
            throw new IllegalStateException("Authenticated user has no stable id");
        }
        return new RVUserContext(userId, properties);
    }
}
