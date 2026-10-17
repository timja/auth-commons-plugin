package io.jenkins.plugins.authcommons;

import edu.umd.cs.findbugs.annotations.CheckForNull;
import edu.umd.cs.findbugs.annotations.NonNull;
import hudson.security.SecurityRealm;
import java.io.IOException;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.logging.Level;
import java.util.logging.Logger;
import jenkins.model.Jenkins;
import net.sf.json.JSONArray;
import net.sf.json.JSONObject;
import org.kohsuke.stapler.HttpResponse;
import org.kohsuke.stapler.HttpResponses;
import org.kohsuke.stapler.StaplerRequest2;
import org.kohsuke.stapler.StaplerResponse2;

/**
 * Entry point for authorization strategies to search the configured security realm for users and groups.
 *
 * <p>This class performs no permission checks. Callers must verify that the current user is allowed to
 * configure access in the relevant context before exposing results, typically from a {@code doXxx}
 * web method on their descriptor.
 */
public final class PrincipalSearch {

    private static final Logger LOGGER = Logger.getLogger(PrincipalSearch.class.getName());

    /** Queries shorter than this return no results. */
    public static final int MIN_QUERY_LENGTH = 2;

    public static final int DEFAULT_LIMIT = 20;

    public static final int MAX_LIMIT = 50;

    private PrincipalSearch() {}

    /**
     * Whether any provider can search the current security realm.
     */
    public static boolean isAvailable() {
        return !applicableProviders().isEmpty();
    }

    /**
     * Search all applicable providers.
     *
     * @param query the text to search for
     * @param types the kinds of principals to return, an empty set means all kinds
     * @param limit the maximum number of results, capped at {@link #MAX_LIMIT}
     * @return matching principals without duplicates, or an empty list if none could be found
     */
    @NonNull
    public static List<Principal> search(
            @CheckForNull String query, @CheckForNull Set<PrincipalType> types, int limit) {
        String q = query == null ? "" : query.trim();
        if (q.length() < MIN_QUERY_LENGTH) {
            return List.of();
        }
        Set<PrincipalType> effectiveTypes =
                types == null || types.isEmpty() ? EnumSet.allOf(PrincipalType.class) : EnumSet.copyOf(types);
        int effectiveLimit = limit <= 0 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT);

        Map<String, Principal> results = new LinkedHashMap<>();
        for (PrincipalSearchProvider provider : applicableProviders()) {
            List<Principal> found;
            try {
                found = provider.search(q, effectiveTypes, effectiveLimit);
            } catch (Exception | LinkageError e) {
                LOGGER.log(
                        Level.WARNING,
                        "Failed to search principals using "
                                + provider.getClass().getName(),
                        e);
                continue;
            }
            for (Principal principal : found) {
                if (!effectiveTypes.contains(principal.type())) {
                    continue;
                }
                results.putIfAbsent(principal.type() + ":" + principal.sid(), principal);
                if (results.size() >= effectiveLimit) {
                    return new ArrayList<>(results.values());
                }
            }
        }
        return new ArrayList<>(results.values());
    }

    /**
     * Look up a principal by SID using the applicable providers.
     *
     * @return the first principal found, or {@code null}
     */
    @CheckForNull
    public static Principal lookup(@CheckForNull String sid, @NonNull PrincipalType type) {
        if (sid == null || sid.isBlank()) {
            return null;
        }
        for (PrincipalSearchProvider provider : applicableProviders()) {
            try {
                Principal principal = provider.lookup(sid, type);
                if (principal != null) {
                    return principal;
                }
            } catch (Exception | LinkageError e) {
                LOGGER.log(
                        Level.FINE,
                        "Failed to look up " + type + " " + sid + " using "
                                + provider.getClass().getName(),
                        e);
            }
        }
        return null;
    }

    /**
     * Build a JSON response for a search request, of the form {@code {"results": [{"sid", "type", "displayName", "description"}]}}.
     *
     * @param query the text to search for
     * @param type {@code USER}, {@code GROUP}, or empty / {@code null} for both
     * @param limit the maximum number of results, or {@code null} for the default
     */
    @NonNull
    public static HttpResponse searchResponse(
            @CheckForNull String query, @CheckForNull String type, @CheckForNull Integer limit) {
        Set<PrincipalType> types = EnumSet.noneOf(PrincipalType.class);
        if (type != null && !type.isBlank() && !type.equalsIgnoreCase("EITHER")) {
            try {
                types.add(PrincipalType.valueOf(type.trim().toUpperCase(Locale.ROOT)));
            } catch (IllegalArgumentException e) {
                return HttpResponses.errorWithoutStack(400, "Unknown principal type: " + type);
            }
        }
        JSONArray array = new JSONArray();
        for (Principal principal : search(query, types, limit == null ? DEFAULT_LIMIT : limit)) {
            array.add(principal.toJson());
        }
        JSONObject json = new JSONObject();
        json.put("results", array);
        return new JsonResponse(json);
    }

    private record JsonResponse(JSONObject json) implements HttpResponse {
        @Override
        public void generateResponse(StaplerRequest2 req, StaplerResponse2 rsp, Object node) throws IOException {
            rsp.setContentType("application/json;charset=UTF-8");
            rsp.setHeader("Cache-Control", "no-store");
            rsp.getWriter().write(json.toString());
        }
    }

    private static List<PrincipalSearchProvider> applicableProviders() {
        SecurityRealm realm = Jenkins.get().getSecurityRealm();
        List<PrincipalSearchProvider> providers = new ArrayList<>();
        for (PrincipalSearchProvider provider : PrincipalSearchProvider.all()) {
            try {
                if (provider.isApplicable(realm)) {
                    providers.add(provider);
                }
            } catch (RuntimeException | LinkageError e) {
                LOGGER.log(
                        Level.WARNING,
                        "Failed to check applicability of "
                                + provider.getClass().getName(),
                        e);
            }
        }
        return providers;
    }
}
