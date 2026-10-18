# Authentication and Authorization Commons

## Introduction

This library plugin holds functionality shared between security realm and authorization strategy plugins.

It currently provides **principal search**. Security realms implement `PrincipalSearchProvider` to search their directory
for users and groups. Authorization strategies use `PrincipalSearch` and the `<auth-commons-principal-search>` element
to autocomplete users and groups when an administrator grants access.

## For security realm plugins

```java
@Extension
public class MyPrincipalSearchProvider extends PrincipalSearchProvider {
    @Override
    public boolean isApplicable(SecurityRealm realm) {
        return realm instanceof MySecurityRealm;
    }

    @Override
    public List<Principal> search(String query, Set<PrincipalType> types, int limit) {
        // query the directory; return the SID that should be stored in the authorization configuration
        return List.of(Principal.user("alice", "Alice Liddell", "alice@example.com"));
    }

    @Override
    public Principal lookup(String sid, PrincipalType type) {
        // optional: friendly names for SIDs that are not meaningful by themselves, like object ids
        return null;
    }
}
```

## For authorization strategy plugins

Expose a web method that checks permissions in its context and delegates to `PrincipalSearch`:

```java
@GET
public HttpResponse doSearchPrincipals(@QueryParameter String q, @QueryParameter String type, @QueryParameter Integer limit) {
    Jenkins.get().checkPermission(Jenkins.ADMINISTER);
    return PrincipalSearch.searchResponse(q, type, limit);
}
```

The response looks like `{"results": [{"sid": "...", "type": "USER", "displayName": "...", "description": "..."}]}`.

Render the input in Jelly with:

```xml
<j:jelly xmlns:j="jelly:core" xmlns:ac="/lib/auth-commons">
  <j:if test="${descriptor.principalSearchAvailable}">
    <ac:principalSearch searchUrl="${descriptor.descriptorFullUrl}/searchPrincipals" type="USER"/>
  </j:if>
</j:jelly>
```

or include the `io.jenkins.plugins.authcommons.principal-search` adjunct and use the element directly, for example from React:

```html
<auth-commons-principal-search search-url="…/searchPrincipals" type="GROUP"></auth-commons-principal-search>
```

Chosen users and groups are shown as chips: avatar or icon, display name, and a button to remove them. Set the `multiple`
attribute (or `multiple="true"` on the taglib) to allow more than one. Text that matches nothing can still be chosen,
through "Add “…” as a user/group" options, so users can enter SIDs that the directory does not know about, and every
chosen principal has a type. Setting `type` limits both the search and those options to users or groups.

The element exposes:

* `selectedPrincipals`, the chosen principals in order, and `selectedPrincipal` / `selectedType` for the first one
* `value`, the first chosen SID, otherwise the typed text, and `pendingText`, text typed but not chosen yet
* `exclude`, an optional `function (principal)` returning `true` for principals not to offer, e.g. ones already added
* `clear()`

It dispatches `principal-selected` and `principal-removed` events with the principal as `detail`, and a `change` event
whenever the chosen principals change.

`PrincipalSearch.isAvailable()` tells you whether a provider can search the current security realm. If none can, keep your
existing plain text input.

## LICENSE

Licensed under MIT, see [LICENSE](LICENSE.md)
