/*
 * <auth-commons-principal-search> - a field that autocompletes users and groups and shows the chosen ones as chips.
 * Loaded by principal-search.js; include the io.jenkins.plugins.authcommons.principal-search adjunct rather than this file.
 *
 * Attributes:
 *   search-url   URL returning {"results": [{sid, type, displayName, description, avatarUrl}]} for ?q=&type=
 *   type         USER, GROUP, or empty for both
 *   multiple     allow more than one principal to be chosen
 *   name         name of the inner text input
 *   placeholder  placeholder of the inner text input
 *   value        initial text
 *   data-message-searching, data-message-no-results, data-message-no-users, data-message-no-groups,
 *   data-message-error, data-message-user, data-message-group, data-message-remove,
 *   data-message-free-user, data-message-free-group ("{0}" is replaced by the typed text or name)
 *
 * Text that matches nothing can still be chosen, through "Add 'text' as a user/group" options, so every chip has a type.
 *
 * Properties:
 *   selectedPrincipals  the chosen principals, in order
 *   selectedPrincipal   the first chosen principal, or null
 *   selectedType        its type, or null
 *   value               the first chosen principal's sid, otherwise the typed text
 *   pendingText         text typed but not chosen yet
 *   input               the inner text input
 *   exclude             optional function(principal) returning true for principals not to offer, e.g. ones already added
 * Methods: clear()
 * Events (bubbling): "principal-selected" and "principal-removed" (detail: the principal),
 *   "change" whenever selectedPrincipals changes; "input" bubbles from the inner input.
 */
(function () {
  "use strict";

  if (window.customElements.get("auth-commons-principal-search")) {
    return;
  }

  const DEBOUNCE_MS = 250;
  const MIN_QUERY_LENGTH = 2;
  const SVG_NS = "http://www.w3.org/2000/svg";
  // ionicons (MIT) person-outline / people-outline / close-outline
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
    CLOSE: ["M368 368L144 144", "M368 144L144 368"],
  };

  let instanceCounter = 0;

  function createAvatar(principal, size) {
    if (!principal.avatarUrl) {
      return createIcon(principal.type);
    }
    const img = document.createElement("img");
    img.className = "auth-commons-principal-search__avatar";
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.width = size;
    img.height = size;
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

  function sameKey(a, b) {
    return a.type === b.type && a.sid === b.sid;
  }

  class PrincipalSearchElement extends HTMLElement {
    static get observedAttributes() {
      return ["type", "placeholder", "name", "multiple"];
    }

    constructor() {
      super();
      this._options = [];
      this._activeIndex = -1;
      this._chosen = [];
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

      const field = document.createElement("div");
      field.className = "jenkins-input auth-commons-principal-search__field";

      const chips = document.createElement("ul");
      chips.className = "auth-commons-principal-search__chips";
      chips.hidden = true;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "auth-commons-principal-search__input";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-expanded", "false");
      input.setAttribute("aria-controls", this._id + "-listbox");
      input.value = this.getAttribute("value") || "";

      field.append(chips, input);

      const status = document.createElement("div");
      status.className = "auth-commons-principal-search__status";
      status.setAttribute("aria-live", "polite");
      status.hidden = true;

      const listbox = document.createElement("ul");
      listbox.id = this._id + "-listbox";
      listbox.className = "auth-commons-principal-search__listbox";
      listbox.setAttribute("role", "listbox");
      listbox.hidden = true;

      this.append(field, status, listbox);
      this._field = field;
      this._chips = chips;
      this._input = input;
      this._listbox = listbox;
      this._status = status;
      this._syncAttributes();

      field.addEventListener("mousedown", (e) => {
        if (e.target === field || e.target === chips) {
          e.preventDefault();
          this.focus();
        }
      });
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
          this._choose(Number(option.dataset.index));
        }
      });
    }

    disconnectedCallback() {
      clearTimeout(this._debounce);
      if (this._abort) {
        this._abort.abort();
      }
    }

    attributeChangedCallback(name) {
      if (name === "multiple" && this._input && !this.multiple && this._chosen.length > 1) {
        this._chosen = this._chosen.slice(0, 1);
        this._renderChips();
        this._fireChange();
      }
      this._syncAttributes();
    }

    get input() {
      return this._input;
    }

    get multiple() {
      return this.hasAttribute("multiple");
    }

    set multiple(v) {
      this.toggleAttribute("multiple", Boolean(v));
    }

    get selectedPrincipals() {
      return this._chosen.slice();
    }

    get selectedPrincipal() {
      return this._chosen.length > 0 ? this._chosen[0] : null;
    }

    get selectedType() {
      const principal = this.selectedPrincipal;
      return principal ? principal.type : null;
    }

    get pendingText() {
      return (this._input ? this._input.value : this.getAttribute("value") || "").trim();
    }

    get value() {
      const principal = this.selectedPrincipal;
      return principal ? principal.sid : this.pendingText;
    }

    set value(v) {
      this.clear();
      if (this._input) {
        this._input.value = v == null ? "" : String(v);
      } else {
        this.setAttribute("value", v == null ? "" : String(v));
      }
    }

    clear() {
      const hadChips = this._chosen.length > 0;
      this._chosen = [];
      if (this._input) {
        this._input.value = "";
        this._lastQuery = null;
        this._close();
        this._renderChips();
      }
      if (hadChips) {
        this._fireChange();
      }
    }

    focus(options) {
      if (!this._input) {
        return;
      }
      if (this._input.hidden) {
        const remove = this._chips.querySelector("button");
        if (remove) {
          remove.focus(options);
        }
      } else {
        this._input.focus(options);
      }
    }

    _syncAttributes() {
      if (!this._input) {
        return;
      }
      this._renderChips();
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

    _message(key, fallback, arg) {
      const message = this.dataset[key] || fallback;
      return arg === undefined ? message : message.replace("{0}", arg);
    }

    _types() {
      const type = this.getAttribute("type");
      return type === "USER" || type === "GROUP" ? [type] : ["USER", "GROUP"];
    }

    _onInput() {
      clearTimeout(this._debounce);
      if (this._abort) {
        this._abort.abort();
      }
      const query = this.pendingText;
      if (query.length === 0) {
        this._lastQuery = null;
        this._close();
        return;
      }
      if (query.length < MIN_QUERY_LENGTH || !this.getAttribute("search-url")) {
        this._lastQuery = null;
        this._renderOptions([], query, false);
        return;
      }
      this._debounce = setTimeout(() => this._search(query), DEBOUNCE_MS);
    }

    async _search(query) {
      if (query === this._lastQuery) {
        return;
      }
      this._lastQuery = query;
      const abort = new AbortController();
      this._abort = abort;

      const url = new URL(this.getAttribute("search-url"), window.location.href);
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
        this._renderOptions(Array.isArray(json.results) ? json.results : [], query, true);
      } catch (e) {
        if (e.name === "AbortError") {
          return;
        }
        this._lastQuery = null;
        this._renderOptions([], query, false);
        this._showStatus(this._message("messageError", "Unable to search for users and groups"));
      }
    }

    _noResultsMessage() {
      const types = this._types();
      if (types.length === 2) {
        return this._message("messageNoResults", "No matching users or groups");
      }
      return types[0] === "GROUP"
        ? this._message("messageNoGroups", "No matching groups")
        : this._message("messageNoUsers", "No matching users");
    }

    _renderOptions(results, query, searched) {
      const isChosen = (p) =>
        this._chosen.some((c) => sameKey(c, p)) || (typeof this.exclude === "function" && this.exclude(p));
      const options = results.filter((r) => !isChosen(r)).map((principal) => ({ principal }));
      for (const type of this._types()) {
        const candidate = { sid: query, type: type, displayName: query, description: null, avatarUrl: null };
        if (!results.some((r) => sameKey(r, candidate)) && !isChosen(candidate)) {
          options.push({ principal: candidate, freeText: true });
        }
      }

      this._options = options;
      this._activeIndex = -1;
      this._listbox.replaceChildren();
      options.forEach((entry, index) => this._listbox.appendChild(this._renderOption(entry, index)));

      if (searched && results.length === 0) {
        this._showStatus(this._noResultsMessage());
      } else {
        this._hideStatus();
      }
      const open = options.length > 0;
      this._listbox.hidden = !open;
      this._input.setAttribute("aria-expanded", String(open));
      if (open) {
        this._setActive(0);
      }
    }

    _renderOption(entry, index) {
      const principal = entry.principal;
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

      if (entry.freeText) {
        option.classList.add("auth-commons-principal-search__option--free-text");
        name.textContent =
          principal.type === "GROUP"
            ? this._message("messageFreeGroup", "Add “{0}” as a group", principal.sid)
            : this._message("messageFreeUser", "Add “{0}” as a user", principal.sid);
        text.append(name);
        option.append(createIcon(principal.type), text);
        return option;
      }

      name.textContent = principal.displayName || principal.sid;
      const description = document.createElement("span");
      description.className = "auth-commons-principal-search__description";
      const typeLabel = this._typeLabel(principal.type);
      description.textContent = principal.description ? typeLabel + " · " + principal.description : typeLabel;
      text.append(name, description);
      option.append(createAvatar(principal, 28), text);
      return option;
    }

    _typeLabel(type) {
      return type === "GROUP" ? this._message("messageGroup", "Group") : this._message("messageUser", "User");
    }

    _onKeyDown(e) {
      const open = !this._listbox.hidden && this._options.length > 0;
      switch (e.key) {
        case "ArrowDown":
          if (open) {
            e.preventDefault();
            this._setActive(Math.min(this._activeIndex + 1, this._options.length - 1));
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
            this._choose(this._activeIndex);
          }
          break;
        case "Escape":
          if (open || !this._status.hidden) {
            e.preventDefault();
            e.stopPropagation();
            this._close();
          }
          break;
        case "Backspace":
          if (this._input.selectionStart === 0 && this._input.selectionEnd === 0 && this._chosen.length > 0) {
            e.preventDefault();
            this._remove(this._chosen.length - 1);
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

    _choose(index) {
      const entry = this._options[index];
      if (!entry) {
        return;
      }
      const principal = entry.principal;
      const replaced = this.multiple ? [] : this._chosen;
      this._chosen = this.multiple ? this._chosen.concat([principal]) : [principal];
      this._input.value = "";
      this._lastQuery = null;
      this._close();
      this._renderChips();
      this.focus();
      for (const old of replaced) {
        this._fire("principal-removed", old);
      }
      this._fire("principal-selected", principal);
      this._fireChange();
    }

    _remove(index) {
      const principal = this._chosen[index];
      if (!principal) {
        return;
      }
      this._chosen = this._chosen.filter((_, i) => i !== index);
      this._renderChips();
      this._input.focus();
      this._fire("principal-removed", principal);
      this._fireChange();
    }

    _renderChips() {
      this._chips.replaceChildren();
      this._chosen.forEach((principal, index) => {
        const label = principal.displayName || principal.sid;
        const details = [this._typeLabel(principal.type)];
        if (principal.description) {
          details.push(principal.description);
        }
        if (principal.sid !== label) {
          details.push(principal.sid);
        }

        const chip = document.createElement("li");
        chip.className = "auth-commons-principal-search__chip";
        chip.dataset.sid = principal.sid;
        chip.dataset.type = principal.type;
        chip.title = label + " (" + details.join(" · ") + ")";

        const name = document.createElement("span");
        name.className = "auth-commons-principal-search__chip-name";
        name.textContent = label;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "auth-commons-principal-search__chip-remove";
        remove.setAttribute("aria-label", this._message("messageRemove", "Remove {0}", label));
        remove.appendChild(createIcon("CLOSE"));
        remove.addEventListener("click", () => this._remove(index));
        remove.addEventListener("keydown", (e) => {
          if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            this._remove(index);
          }
        });

        chip.append(createAvatar(principal, 20), name, remove);
        this._chips.appendChild(chip);
      });
      this._chips.hidden = this._chosen.length === 0;
      // a single-valued field is full once something is chosen
      this._input.hidden = !this.multiple && this._chosen.length > 0;
      this._input.placeholder = this._chosen.length > 0 ? "" : this.getAttribute("placeholder") || "";
    }

    _fire(name, principal) {
      this.dispatchEvent(new CustomEvent(name, { detail: principal, bubbles: true, composed: true }));
    }

    _fireChange() {
      this.dispatchEvent(new Event("change", { bubbles: true }));
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
