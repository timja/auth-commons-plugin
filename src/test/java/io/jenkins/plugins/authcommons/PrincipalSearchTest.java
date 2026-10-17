package io.jenkins.plugins.authcommons;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

import edu.umd.cs.findbugs.annotations.NonNull;
import hudson.model.UnprotectedRootAction;
import hudson.security.SecurityRealm;
import java.net.URL;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import net.sf.json.JSONArray;
import net.sf.json.JSONObject;
import org.htmlunit.Page;
import org.htmlunit.html.DomElement;
import org.htmlunit.html.HtmlPage;
import org.junit.jupiter.api.Test;
import org.jvnet.hudson.test.JenkinsRule;
import org.jvnet.hudson.test.TestExtension;
import org.jvnet.hudson.test.junit.jupiter.WithJenkins;
import org.kohsuke.stapler.HttpResponse;
import org.kohsuke.stapler.QueryParameter;

@WithJenkins
class PrincipalSearchTest {

    @Test
    void notAvailableWithoutApplicableProvider(JenkinsRule j) {
        j.jenkins.setSecurityRealm(SecurityRealm.NO_AUTHENTICATION);
        assertThat(PrincipalSearch.isAvailable(), is(false));
        assertThat(PrincipalSearch.search("alice", null, 10), empty());
        assertThat(PrincipalSearch.lookup("alice", PrincipalType.USER), nullValue());
    }

    @Test
    void searchesApplicableProviders(JenkinsRule j) {
        j.jenkins.setSecurityRealm(j.createDummySecurityRealm());
        assertThat(PrincipalSearch.isAvailable(), is(true));

        assertThat(sids(PrincipalSearch.search("al", null, 10)), contains("USER:alice", "USER:albert", "GROUP:alpha"));
        assertThat(sids(PrincipalSearch.search(" al ", EnumSet.of(PrincipalType.GROUP), 10)), contains("GROUP:alpha"));
        assertThat(PrincipalSearch.search("a", null, 10), empty());
        assertThat(PrincipalSearch.search("al", null, 1), hasSize(1));
    }

    @Test
    void deduplicatesAndIgnoresFailingProviders(JenkinsRule j) {
        j.jenkins.setSecurityRealm(j.createDummySecurityRealm());
        // DuplicateProvider returns alice again and FailingProvider throws
        List<Principal> results = PrincipalSearch.search("alice", null, 10);
        assertThat(sids(results), contains("USER:alice"));
    }

    @Test
    void lookup(JenkinsRule j) {
        j.jenkins.setSecurityRealm(j.createDummySecurityRealm());
        assertThat(PrincipalSearch.lookup("alice", PrincipalType.USER).displayName(), is("Alice Liddell"));
        assertThat(PrincipalSearch.lookup("alice", PrincipalType.GROUP), nullValue());
        assertThat(PrincipalSearch.lookup(" ", PrincipalType.USER), nullValue());
    }

    @Test
    void searchResponse(JenkinsRule j) throws Exception {
        j.jenkins.setSecurityRealm(j.createDummySecurityRealm());
        try (JenkinsRule.WebClient wc = j.createWebClient()) {
            JSONObject json = getJson(wc, "principalSearchTest/search?q=al&type=GROUP");
            JSONArray results = json.getJSONArray("results");
            assertThat(results.size(), is(1));
            JSONObject alpha = results.getJSONObject(0);
            assertThat(alpha.getString("sid"), is("alpha"));
            assertThat(alpha.getString("type"), is("GROUP"));
            assertThat(alpha.getString("displayName"), is("Alpha Team"));
            assertThat(alpha.has("description"), is(false));
            assertThat(alpha.has("avatarUrl"), is(false));

            JSONObject alice = getJson(wc, "principalSearchTest/search?q=alice")
                    .getJSONArray("results")
                    .getJSONObject(0);
            assertThat(alice.getString("description"), is("alice@example.com"));
            assertThat(alice.getString("avatarUrl"), is("/avatars/alice.png"));

            assertThat(
                    getJson(wc, "principalSearchTest/search?q=al")
                            .getJSONArray("results")
                            .size(),
                    is(3));
            assertThat(
                    getJson(wc, "principalSearchTest/search?q=al&type=EITHER")
                            .getJSONArray("results")
                            .size(),
                    is(3));
            assertThat(
                    getJson(wc, "principalSearchTest/search?q=al&limit=2")
                            .getJSONArray("results")
                            .size(),
                    is(2));

            wc.setThrowExceptionOnFailingStatusCode(false);
            Page page = wc.goTo("principalSearchTest/search?q=al&type=ROBOT", null);
            assertThat(page.getWebResponse().getStatusCode(), is(400));
        }
    }

    @Test
    void taglibRendersWithoutScriptErrors(JenkinsRule j) throws Exception {
        j.jenkins.setSecurityRealm(j.createDummySecurityRealm());
        try (JenkinsRule.WebClient wc = j.createWebClient()) {
            // HtmlUnit fails on script errors, and does not support ES6 classes or custom elements
            HtmlPage page = wc.goTo("principalSearchTest/");
            DomElement element = page.getElementById("picker");
            assertThat(element.getAttribute("search-url"), is("principalSearchTest/search"));
            assertThat(element.getAttribute("type"), is("GROUP"));

            String loader = null;
            for (DomElement script : page.getElementsByTagName("script")) {
                if (script.getAttribute("src").endsWith("/io/jenkins/plugins/authcommons/principal-search.js")) {
                    loader = script.getAttribute("src");
                }
            }
            assertThat(loader, notNullValue());
            String elementScript = loader.replace("principal-search.js", "principal-search-element.js");
            Page js = wc.getPage(new URL(page.getUrl(), elementScript));
            assertThat(js.getWebResponse().getStatusCode(), is(200));
            assertThat(js.getWebResponse().getContentAsString(), containsString("auth-commons-principal-search"));
        }
    }

    private static JSONObject getJson(JenkinsRule.WebClient wc, String path) throws Exception {
        Page page = wc.goTo(path, "application/json");
        return JSONObject.fromObject(page.getWebResponse().getContentAsString());
    }

    private static List<String> sids(List<Principal> principals) {
        List<String> result = new ArrayList<>();
        for (Principal principal : principals) {
            result.add(principal.type() + ":" + principal.sid());
        }
        return result;
    }

    private static boolean isDummyRealm(SecurityRealm realm) {
        return realm.getClass().getName().contains("DummySecurityRealm");
    }

    @TestExtension
    public static class TestProvider extends PrincipalSearchProvider {
        private static final List<Principal> DIRECTORY = List.of(
                Principal.user("alice", "Alice Liddell", "alice@example.com").withAvatarUrl("/avatars/alice.png"),
                Principal.user("albert", null, null),
                Principal.user("bob", "Bob", null),
                Principal.group("alpha", "Alpha Team", null));

        @Override
        public boolean isApplicable(@NonNull SecurityRealm realm) {
            return isDummyRealm(realm);
        }

        @NonNull
        @Override
        public List<Principal> search(@NonNull String query, @NonNull Set<PrincipalType> types, int limit) {
            List<Principal> result = new ArrayList<>();
            for (Principal principal : DIRECTORY) {
                if (principal.sid().startsWith(query) && types.contains(principal.type())) {
                    result.add(principal);
                }
            }
            return result;
        }

        @Override
        public Principal lookup(@NonNull String sid, @NonNull PrincipalType type) {
            for (Principal principal : DIRECTORY) {
                if (principal.sid().equals(sid) && principal.type() == type) {
                    return principal;
                }
            }
            return null;
        }
    }

    @TestExtension("deduplicatesAndIgnoresFailingProviders")
    public static class FailingProvider extends PrincipalSearchProvider {
        @Override
        public boolean isApplicable(@NonNull SecurityRealm realm) {
            return true;
        }

        @NonNull
        @Override
        public List<Principal> search(@NonNull String query, @NonNull Set<PrincipalType> types, int limit)
                throws Exception {
            throw new Exception("directory unavailable");
        }
    }

    @TestExtension("deduplicatesAndIgnoresFailingProviders")
    public static class DuplicateProvider extends PrincipalSearchProvider {
        @Override
        public boolean isApplicable(@NonNull SecurityRealm realm) {
            return true;
        }

        @NonNull
        @Override
        public List<Principal> search(@NonNull String query, @NonNull Set<PrincipalType> types, int limit) {
            return List.of(Principal.user("alice", "Someone else", null));
        }
    }

    @TestExtension({"searchResponse", "taglibRendersWithoutScriptErrors"})
    public static class SearchAction implements UnprotectedRootAction {
        @Override
        public String getIconFileName() {
            return null;
        }

        @Override
        public String getDisplayName() {
            return null;
        }

        @Override
        public String getUrlName() {
            return "principalSearchTest";
        }

        public HttpResponse doSearch(
                @QueryParameter String q, @QueryParameter String type, @QueryParameter Integer limit) {
            return PrincipalSearch.searchResponse(q, type, limit);
        }
    }
}
