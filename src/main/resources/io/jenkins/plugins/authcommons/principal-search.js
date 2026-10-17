/*
 * Loads the <auth-commons-principal-search> element (principal-search-element.js).
 *
 * Written in ES5 and only loads the element when custom elements are supported,
 * so that pages stay usable in HtmlUnit based tests.
 */
(function () {
  "use strict";
  if (!window.customElements || window.customElements.get("auth-commons-principal-search")) {
    return;
  }
  var current = document.currentScript;
  if (!current || !current.src || document.querySelector("script[data-auth-commons-principal-search]")) {
    return;
  }
  var script = document.createElement("script");
  script.type = "module";
  script.src = current.src.replace(/principal-search\.js(\?.*)?$/, "principal-search-element.js");
  script.setAttribute("data-auth-commons-principal-search", "true");
  document.head.appendChild(script);
})();
