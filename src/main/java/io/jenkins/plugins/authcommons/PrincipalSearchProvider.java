package io.jenkins.plugins.authcommons;

import edu.umd.cs.findbugs.annotations.CheckForNull;
import edu.umd.cs.findbugs.annotations.NonNull;
import hudson.ExtensionList;
import hudson.ExtensionPoint;
import hudson.security.SecurityRealm;
import java.util.List;
import java.util.Set;

/**
 * Looks up users and groups in a directory, so that authorization strategies can offer autocompletion
 * when choosing who gets access.
 *
 * <p>Typically implemented by plugins that provide a {@link SecurityRealm}, and consumed by authorization
 * strategy plugins through {@link PrincipalSearch}. Implementations do not need to check permissions;
 * callers are responsible for that.
 */
public abstract class PrincipalSearchProvider implements ExtensionPoint {

    /**
     * Whether this provider can search the given security realm.
     *
     * @param realm the currently configured security realm
     */
    public abstract boolean isApplicable(@NonNull SecurityRealm realm);

    /**
     * Search for principals matching a query.
     *
     * @param query free text entered by the user, at least {@link PrincipalSearch#MIN_QUERY_LENGTH} characters
     * @param types the kinds of principals to return, never empty
     * @param limit the maximum number of results to return
     * @return matching principals, best matches first
     * @throws Exception if the directory could not be searched
     */
    @NonNull
    public abstract List<Principal> search(@NonNull String query, @NonNull Set<PrincipalType> types, int limit)
            throws Exception;

    /**
     * Look up a single principal by SID, so that a friendly name can be shown for SIDs that are not
     * meaningful by themselves (such as object ids).
     *
     * @return the principal, or {@code null} if it is unknown or this provider does not support lookups
     * @throws Exception if the directory could not be queried
     */
    @CheckForNull
    public Principal lookup(@NonNull String sid, @NonNull PrincipalType type) throws Exception {
        return null;
    }

    public static ExtensionList<PrincipalSearchProvider> all() {
        return ExtensionList.lookup(PrincipalSearchProvider.class);
    }
}
