/*
 * <auth-commons-principal-search> - a text input that autocompletes users and groups.
 * Loaded by principal-search.js; include the io.jenkins.plugins.authcommons.principal-search adjunct rather than this file.
 *
 * Attributes:
 *   search-url   URL returning {"results": [{sid, type, displayName, description, avatarUrl}]} for ?q=&type=
 *   type         USER, GROUP, or empty for both
 *   name         name of the inner input
 *   placeholder  placeholder for the inner input
 *   value        initial value
 *   data-message-searching, data-message-no-results, data-message-error, data-message-user, data-message-group
 *
 * Properties: value, selectedPrincipal, selectedType, input
 * Events: "principal-selected" (detail: the selected principal); "input" bubbles from the inner input.
 */
(function () {
  "use strict";

  if (window.customElements.get("auth-commons-principal-search")) {
    return;
  }

  const DEBOUNCE_MS = 250;
  const MIN_QUERY_LENGTH = 2;
  const SVG_NS = "http://www.w3.org/2000/svg";
  // ionicons (MIT) person-outline / people-outline
  const ICONS = {
    USER: [
      "M344 144c-3.92 52.87-44 96-88 96s-84.15-43.12-88-96c-4-55 35-96 88-96s92 42 88 96z",
      "M256 304c-87 0-175.3 48-191.64 138.6C62.39 453.52 68.57 464 80 464h352c11.44 0 17.62-10.48 15.65-21.4C431.3 352 343 304 256 304z",
    ],
    GROUP: [
      "M402 168c-2.93 40.67-33.1 72-66 72s-63.12-31.32-66-72c-3-42.31 26.37-72 66-72s69 30.46 66 72z",
      "M336 304c-65.17 0-127.84 32.37-143.54 95.41-2.08 8.34 3.15 16.59 11.72 16.59h263.65c8.57 0 13.77-8.25 11.72-16.59C463.85 335.36 401.18 304 336 304z",
      "M200 185.94c-2.34 32.48-26.72 58.06-53 58.06s-50.7-25.57-53-58.06C91.61 152.15 115.34 128 147 128s55.39 24.77 53 57.94z",
      "M206 306c-18.05-8.27-37.93-11.45-59-11.45-52 0-102.1 25.85-114.65 76.2-1.65 6.66 2.53 13.25 9.37 13.25H154",
    ],
  };

  let instanceCounter = 0;

  function createAvatar(principal) {
    if (!principal.avatarUrl) {
      return createIcon(principal.type);
    }
    const img = document.createElement("img");
    img.className = "auth-commons-principal-search__avatar";
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.width = 28;
    img.height = 28;
    // no photo, or not allowed to see it
    img.addEventListener("error", () => img.replaceWith(createIcon(principal.type)), { once: true });
    img.src = principal.avatarUrl;
    return img;
  }

  function createIcon(type) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 512 512");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("auth-commons-principal-search__icon");
    for (const d of ICONS[type] || ICONS.USER) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "32");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
    }
    return svg;
  }

  class PrincipalSearchElement extends HTMLElement {
    static get observedAttributes() {
      return ["type", "placeholder", "name"];
    }

    constructor() {
      super();
      this._results = [];
      this._activeIndex = -1;
      this._selected = null;
      this._debounce = null;
      this._abort = null;
      this._lastQuery = null;
      this._id = "auth-commons-principal-search-" + ++instanceCounter;
    }

    connectedCallback() {
      if (this._input) {
        return;
      }
      this.classList.add("auth-commons-principal-search");

      const input = document.createElement("input");
      input.type = "text";
      input.className = "jenkins-input";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-expanded", "false");
      input.setAttribute("aria-controls", this._id + "-listbox");
      input.value = this.getAttribute("value") || "";

      const listbox = document.createElement("ul");
      listbox.id = this._id + "-listbox";
      listbox.className = "auth-commons-principal-search__listbox";
      listbox.setAttribute("role", "listbox");
      listbox.hidden = true;

      const status = document.createElement("div");
      status.className = "auth-commons-principal-search__status";
      status.setAttribute("aria-live", "polite");
      status.hidden = true;

      this.append(input, status, listbox);
      this._input = input;
      this._listbox = listbox;
      this._status = status;
      this._syncAttributes();

      input.addEventListener("input", () => this._onInput());
      input.addEventListener("keydown", (e) => this._onKeyDown(e));
      input.addEventListener("blur", () => {
        // allow clicks on options to register first
        setTimeout(() => this._close(), 150);
      });
      listbox.addEventListener("mousedown", (e) => e.preventDefault());
      listbox.addEventListener("click", (e) => {
        const option = e.target.closest("[role=option]");
        if (option) {
          this._select(Number(option.dataset.index));
        }
      });
    }

    disconnectedCallback() {
      clearTimeout(this._debounce);
      if (this._abort) {
        this._abort.abort();
      }
    }

    attributeChangedCallback() {
      this._syncAttributes();
    }

    get input() {
      return this._input;
    }

    get value() {
      return this._input ? this._input.value : this.getAttribute("value") || "";
    }

    set value(v) {
      if (this._input) {
        this._input.value = v == null ? "" : String(v);
      } else {
        this.setAttribute("value", v == null ? "" : String(v));
      }
      this._selected = null;
    }

    /** The principal chosen from the list, or null if the text was typed or edited since. */
    get selectedPrincipal() {
      return this._selected;
    }

    get selectedType() {
      return this._selected ? this._selected.type : null;
    }

    focus(options) {
      if (this._input) {
        this._input.focus(options);
      }
    }

    _syncAttributes() {
      if (!this._input) {
        return;
      }
      const placeholder = this.getAttribute("placeholder");
      if (placeholder) {
        this._input.placeholder = placeholder;
      }
      const name = this.getAttribute("name");
      if (name) {
        this._input.name = name;
      }
      if (this._lastQuery !== null) {
        // type filter changed; results may no longer apply
        this._lastQuery = null;
        this._close();
      }
    }

    _message(key, fallback) {
      return this.dataset[key] || fallback;
    }

    _onInput() {
      this._selected = null;
      clearTimeout(this._debounce);
      const query = this._input.value.trim();
      if (query.length < MIN_QUERY_LENGTH) {
        if (this._abort) {
          this._abort.abort();
        }
        this._lastQuery = null;
        this._close();
        return;
      }
      this._debounce = setTimeout(() => this._search(query), DEBOUNCE_MS);
    }

    async _search(query) {
      const searchUrl = this.getAttribute("search-url");
      if (!searchUrl || query === this._lastQuery) {
        return;
      }
      this._lastQuery = query;
      if (this._abort) {
        this._abort.abort();
      }
      const abort = new AbortController();
      this._abort = abort;

      const url = new URL(searchUrl, window.location.href);
      url.searchParams.set("q", query);
      const type = this.getAttribute("type");
      if (type) {
        url.searchParams.set("type", type);
      }

      this._showStatus(this._message("messageSearching", "Searching…"));
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: abort.signal,
        });
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        const json = await response.json();
        if (abort.signal.aborted) {
          return;
        }
        this._render(Array.isArray(json.results) ? json.results : []);
      } catch (e) {
        if (e.name === "AbortError") {
          return;
        }
        this._lastQuery = null;
        this._results = [];
        this._listbox.hidden = true;
        this._showStatus(this._message("messageError", "Unable to search for users and groups"));
      }
    }

    _render(results) {
      this._results = results;
      this._activeIndex = -1;
      this._listbox.replaceChildren();
      if (results.length === 0) {
        this._listbox.hidden = true;
        this._input.setAttribute("aria-expanded", "false");
        this._showStatus(this._message("messageNoResults", "No matching users or groups"));
        return;
      }
      this._hideStatus();
      results.forEach((principal, index) => {
        const option = document.createElement("li");
        option.id = this._id + "-option-" + index;
        option.className = "auth-commons-principal-search__option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.dataset.index = String(index);

        const text = document.createElement("span");
        text.className = "auth-commons-principal-search__text";
        const name = document.createElement("span");
        name.className = "auth-commons-principal-search__name";
        name.textContent = principal.displayName || principal.sid;
        const description = document.createElement("span");
        description.className = "auth-commons-principal-search__description";
        const typeLabel =
          principal.type === "GROUP"
            ? this._message("messageGroup", "Group")
            : this._message("messageUser", "User");
        description.textContent = principal.description
          ? typeLabel + " · " + principal.description
          : typeLabel;
        text.append(name, description);

        option.append(createAvatar(principal), text);
        this._listbox.appendChild(option);
      });
      this._listbox.hidden = false;
      this._input.setAttribute("aria-expanded", "true");
    }

    _onKeyDown(e) {
      const open = !this._listbox.hidden && this._results.length > 0;
      switch (e.key) {
        case "ArrowDown":
          if (open) {
            e.preventDefault();
            this._setActive(Math.min(this._activeIndex + 1, this._results.length - 1));
          }
          break;
        case "ArrowUp":
          if (open) {
            e.preventDefault();
            this._setActive(Math.max(this._activeIndex - 1, 0));
          }
          break;
        case "Enter":
          if (open && this._activeIndex >= 0) {
            e.preventDefault();
            e.stopPropagation();
            this._select(this._activeIndex);
          }
          break;
        case "Escape":
          if (open || !this._status.hidden) {
            e.preventDefault();
            e.stopPropagation();
            this._close();
          }
          break;
        default:
          break;
      }
    }

    _setActive(index) {
      const options = this._listbox.querySelectorAll("[role=option]");
      options.forEach((option, i) => {
        const active = i === index;
        option.classList.toggle("auth-commons-principal-search__option--active", active);
        option.setAttribute("aria-selected", String(active));
        if (active) {
          option.scrollIntoView({ block: "nearest" });
        }
      });
      this._activeIndex = index;
      if (index >= 0) {
        this._input.setAttribute("aria-activedescendant", this._id + "-option-" + index);
      } else {
        this._input.removeAttribute("aria-activedescendant");
      }
    }

    _select(index) {
      const principal = this._results[index];
      if (!principal) {
        return;
      }
      this._input.value = principal.sid;
      this._selected = principal;
      this._lastQuery = principal.sid;
      this._close();
      this.dispatchEvent(
        new CustomEvent("principal-selected", { detail: principal, bubbles: true, composed: true }),
      );
    }

    _close() {
      if (!this._listbox) {
        return;
      }
      this._listbox.hidden = true;
      this._input.setAttribute("aria-expanded", "false");
      this._input.removeAttribute("aria-activedescendant");
      this._activeIndex = -1;
      this._hideStatus();
    }

    _showStatus(message) {
      this._status.textContent = message;
      this._status.hidden = false;
    }

    _hideStatus() {
      this._status.hidden = true;
      this._status.textContent = "";
    }
  }

  window.customElements.define("auth-commons-principal-search", PrincipalSearchElement);
})();
