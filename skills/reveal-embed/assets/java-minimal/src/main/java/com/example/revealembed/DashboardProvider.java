package com.example.revealembed;

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

/**
 * Dashboards in the shared folder are read-only. Every user saves into a private folder keyed
 * by a hash of their id: they load the shared dashboards and their own, and can never read or
 * overwrite another user's. The built-in RVDashboardProvider lets any caller overwrite any
 * dashboard. Replace with the app's own storage and rules (tenants, sharing) when needed.
 */
public class DashboardProvider implements IRVDashboardProvider {
    // Matcher.matches() must match the whole input, so "id\n" is rejected (unlike .NET's $).
    private static final Pattern VALID_ID = Pattern.compile("[A-Za-z0-9_-]{1,100}");
    private final Path sharedDir;

    public DashboardProvider(Path sharedDir) {
        this.sharedDir = sharedDir.toAbsolutePath().normalize();
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

    // Fail closed: the user context can be null (system calls, connection verification);
    // never fold a missing id into a shared folder.
    private static String requireUserId(IRVUserContext userContext) {
        String id = userContext == null ? null : userContext.getUserId();
        if (id == null || id.isBlank()) throw new IllegalStateException("No user");
        return id;
    }

    private static void requireValidId(String dashboardId) {
        // The id arrives in the URL on load and in the JSON body on save; the servlet
        // container's URL checks do not cover the save.
        if (dashboardId == null || !VALID_ID.matcher(dashboardId).matches()) {
            throw new IllegalArgumentException("Invalid dashboard id");
        }
    }

    @Override
    public InputStream getDashboard(IRVUserContext userContext, String dashboardId) throws IOException {
        requireValidId(dashboardId);
        for (Path dir : List.of(userDir(userContext), sharedDir)) {
            Path file = dir.resolve(dashboardId + ".rdash");
            if (Files.isRegularFile(file)) return Files.newInputStream(file);
        }
        return null; // the client gets 404; throwing would give 500
    }

    @Override
    public void saveDashboard(IRVUserContext userContext, String dashboardId, InputStream dashboard) throws IOException {
        requireValidId(dashboardId);
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
