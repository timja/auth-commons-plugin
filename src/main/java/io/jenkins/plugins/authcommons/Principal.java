package io.jenkins.plugins.authcommons;

import edu.umd.cs.findbugs.annotations.CheckForNull;
import edu.umd.cs.findbugs.annotations.NonNull;
import java.util.Objects;
import net.sf.json.JSONObject;

/**
 * A user or group known to the security realm, as returned by a {@link PrincipalSearchProvider}.
 *
 * @param sid the identifier to store in authorization configuration, e.g. a username or a group object id
 * @param type whether this is a user or a group
 * @param displayName a human readable name, e.g. the user's full name; the factory methods fall back to the SID
 * @param description optional secondary information that helps tell similar principals apart, e.g. an email address
 * @param avatarUrl optional URL of a small picture of the principal, e.g. a profile photo; it is loaded by the browser,
 *     so it is typically served by the providing plugin with the same permission checks as the search
 */
public record Principal(
        @NonNull String sid,
        @NonNull PrincipalType type,
        @NonNull String displayName,
        @CheckForNull String description,
        @CheckForNull String avatarUrl) {

    public Principal {
        Objects.requireNonNull(sid, "sid");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(displayName, "displayName");
    }

    public Principal(
            @NonNull String sid,
            @NonNull PrincipalType type,
            @NonNull String displayName,
            @CheckForNull String description) {
        this(sid, type, displayName, description, null);
    }

    public static Principal user(
            @NonNull String sid, @CheckForNull String displayName, @CheckForNull String description) {
        return new Principal(sid, PrincipalType.USER, displayNameOrSid(sid, displayName), description);
    }

    public static Principal group(
            @NonNull String sid, @CheckForNull String displayName, @CheckForNull String description) {
        return new Principal(sid, PrincipalType.GROUP, displayNameOrSid(sid, displayName), description);
    }

    /**
     * @return a copy of this principal with the given avatar URL
     */
    @NonNull
    public Principal withAvatarUrl(@CheckForNull String avatarUrl) {
        return new Principal(sid, type, displayName, description, avatarUrl);
    }

    private static String displayNameOrSid(String sid, @CheckForNull String displayName) {
        return displayName == null || displayName.isBlank() ? sid : displayName;
    }

    @NonNull
    public JSONObject toJson() {
        JSONObject json = new JSONObject();
        json.put("sid", sid);
        json.put("type", type.name());
        json.put("displayName", displayName);
        if (description != null) {
            json.put("description", description);
        }
        if (avatarUrl != null) {
            json.put("avatarUrl", avatarUrl);
        }
        return json;
    }
}
