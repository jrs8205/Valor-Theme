/* Valor Collection — facet filtering, sorting, and mobile drawer.
 *
 * Behaviour summary:
 *   - Filter checkbox change → AJAX-fetch the new URL with the
 *     facet params, then replace the product grid + facets sidebar
 *     in place. No full page reload.
 *   - Sort dropdown change → same path.
 *   - Internal navigation links (active-filter pill removal,
 *     "Clear all", pagination, empty-state "Clear filters") all
 *     have their own click intercept so they take the AJAX path
 *     instead of triggering a full reload.
 *   - Mobile filter button → opens the facets drawer with body scroll
 *     lock. ESC and the close button reverse it.
 *
 * Section-level rendering is used so we get back exactly the markup
 * that would have appeared on a fresh load — no client-side
 * reconstruction of products or filter counts. The only piece of
 * state we manage manually is the URL via history.pushState so back
 * / forward buttons work; popstate calls _fetchAndReplace with
 * updateHistory=false to avoid pushing the popped state back onto
 * the stack.
 *
 * Only one collection wrapper is expected per page; if multiple
 * exist (unlikely) each wrapper handles itself.
 *
 * Shopify standard storefront events (see storefront-events.js):
 *   - collection template: a filter or sort change dispatches
 *     shopify:collection:update from this element, resolved with the
 *     number of matching products once the new markup is in;
 *   - search template: the same change dispatches shopify:search:update,
 *     and a search results page load dispatches it once for the search
 *     the buyer just submitted.
 * Pagination alone (only ?page= changes) is not a filter change and
 * dispatches nothing. The Liquid host carries the identity and counts:
 * data-template, data-collection-id / -handle, data-products-count
 * (unfiltered) and data-results-count (after filters).
 */

(function () {
  if (typeof customElements === "undefined") return;
  if (customElements.get("valor-collection")) return;

  const SECTION_DATA_ATTR = "data-collection-section-id";

  class ValorCollection extends HTMLElement {
    connectedCallback() {
      this._sectionId = this.getAttribute(SECTION_DATA_ATTR);
      if (!this._sectionId) return;

      // All listeners are delegated on the host element (`this`), so
      // _fetchAndReplace's innerHTML swap doesn't detach them. The
      // host itself only ever connects once per page in practice,
      // but Theme Editor could in theory disconnect/reconnect the
      // element — guard with _bound so we never double-bind global
      // events. Same pattern as cart-drawer.js.
      if (this._bound) return;
      this._bound = true;

      this._bindFilterChange();
      this._bindSortChange();
      this._bindLinkClicks();
      this._bindDrawer();
      this._bindFacetsBar();
      this._bindPopState();

      // Filter/sort state last rendered, used to tell a real filter or sort
      // change from pagination when deciding whether to dispatch an event.
      this._lastFilterKey = this._filterKey(window.location.search);

      // Only after shopify:page:view (storefront-events.js dispatches it on
      // DOMContentLoaded, once every deferred script has run), so the page
      // view always comes first and apps have attached their listeners.
      // Timers and readyState are not used: a slow later deferred script
      // can hold DOMContentLoaded back well past a setTimeout.
      const ev = window.ValorEvents;
      if (ev && typeof ev.afterPageView === "function") {
        ev.afterPageView(() => this._dispatchInitialSearch());
      }
    }

    /* Normalised filter + sort + query state of a query string, ignoring
       the page number and the section_id plumbing. */
    _filterKey(search) {
      const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
      const pairs = [];
      params.forEach(function (value, key) {
        if (key === "page" || key === "section_id") return;
        pairs.push(key + "=" + value);
      });
      return pairs.sort().join("&");
    }

    /* shopify:search:update for the search the buyer submitted to reach
       this results page (a full page load, so no fetch is involved). */
    _dispatchInitialSearch() {
      const ev = window.ValorEvents;
      if (!ev || this.getAttribute("data-template") !== "search") return;
      const query = this.getAttribute("data-search-query") || "";
      if (!query) return;
      const operation = ev.searchUpdate(this, { query: query, params: window.location.search });
      operation.resolve(this.getAttribute("data-results-count"));
    }

    /* Start shopify:collection:update / shopify:search:update for a fetch
       to `search`. Returns an operation with resolve(count) / fail(error);
       inert when nothing about the filters or sort order changes. */
    _startUpdateEvent(search) {
      const inert = { resolve: function () {}, fail: function () {} };
      const ev = window.ValorEvents;
      if (!ev) return inert;
      const key = this._filterKey(search);
      if (key === this._lastFilterKey) return inert;
      this._lastFilterKey = key;

      if (this.getAttribute("data-template") === "search") {
        const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
        return ev.searchUpdate(this, {
          query: params.get("q") || this.getAttribute("data-search-query") || "",
          params: params,
        });
      }
      return ev.collectionUpdate(this, {
        collection: {
          id: this.getAttribute("data-collection-id") || null,
          handle: this.getAttribute("data-collection-handle") || "",
          productsCount: this.getAttribute("data-products-count"),
        },
        params: search,
      });
    }

    /* All <input> changes inside the facets form trigger a refetch.
       For price inputs we also debounce by 350 ms so a user who tabs
       quickly from min to max doesn't trigger two back-to-back fetches.
       Note: text/number inputs only emit `change` on blur or Enter,
       so this isn't keystroke-live — it's "applies on commit". That's
       the same behaviour Dawn ships and it avoids spamming the server
       mid-typing.

       Mobile drawer behaviour:
         - Checkbox / boolean / list filters → close the drawer after
           the fetch resolves. The customer sees the filtered grid
           immediately, with confirmation that the click registered.
         - Price range inputs → keep the drawer open. The customer
           may want to set both min and max, and a closing drawer
           between the two would interrupt the flow.
       Closing happens after the fetch (not on click) so a slow
       network or a failure doesn't make the drawer disappear before
       anything actually changed. */
    _bindFilterChange() {
      const self = this;
      let priceTimer = null;

      this.addEventListener("change", function (e) {
        const facetsForm = e.target.closest("[data-facets]");
        if (!facetsForm) return;

        // Sort selects can live inside the horizontal facets bar form.
        // They have their own handler below; don't also submit the
        // facets form or a sort change would trigger two AJAX requests.
        if (e.target.closest("[data-collection-sort]")) return;

        if (e.target.matches("[data-facets-price-min], [data-facets-price-max]")) {
          // Price inputs commit on blur or Enter; small debounce so
          // tabbing min → max doesn't fire two requests. Don't close
          // the drawer — user may still be editing the other bound.
          clearTimeout(priceTimer);
          priceTimer = setTimeout(function () {
            self._submitFacets(facetsForm, { closeDrawerOnSuccess: false });
          }, 350);
          return;
        }

        // Checkbox / boolean / list filters: close the drawer after
        // the fetch resolves so the customer sees the result.
        self._submitFacets(facetsForm, { closeDrawerOnSuccess: true });
      });

      // Catch Enter inside price inputs so submit doesn't navigate
      // away from the page.
      this.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        if (!e.target.matches("[data-facets-price-min], [data-facets-price-max]")) return;
        e.preventDefault();
        clearTimeout(priceTimer);
        const facetsForm = e.target.closest("[data-facets]");
        if (facetsForm) self._submitFacets(facetsForm, { closeDrawerOnSuccess: false });
      });
    }

    /* Sort dropdown change. Delegated on the host element rather than
       bound directly to the <select>, because _fetchAndReplace replaces
       this.innerHTML wholesale on every refresh — a direct listener
       would point at a detached <select> after the first AJAX update
       and silently stop firing.

       The sort <select> lives outside [data-facets], so the filter
       change handler above won't see it. The two listeners share the
       host's change event but operate on disjoint targets.

       Mobile: when the change comes from the drawer copy of the sort
       select, close the drawer after the fetch resolves — sort is a
       single decisive choice, not a multi-step interaction. */
    _bindSortChange() {
      const self = this;
      this.addEventListener("change", function (e) {
        const sort = e.target.closest("[data-collection-sort]");
        if (!sort) return;

        const params = new URLSearchParams(window.location.search);
        params.set("sort_by", sort.value);
        params.delete("page"); // jump back to page 1 on sort change
        self._fetchAndReplace("?" + params.toString(), true, { closeDrawerOnSuccess: true });
      });
    }

    /* Intercept clicks on internal navigation links so they go
       through the AJAX path. Three sources:
         1. Active filter pills    — .valor-facets__pill
         2. Clear-all link         — .valor-facets__clear / empty-state link
         3. Pagination links       — .valor-pagination a

       Modifier-key clicks (Cmd/Ctrl/Shift) and middle-clicks fall
       through to the browser so users can still open in new tab.

       Mobile: every one of these closes the drawer after a successful
       fetch. The pills and Clear-all live inside the drawer, so the
       user clearly wants to see the result. Pagination and the empty
       state link aren't in the drawer, but the close is a no-op when
       the drawer wasn't open in the first place. */
    _bindLinkClicks() {
      const self = this;
      this.addEventListener("click", function (e) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        const link = e.target.closest(
          ".valor-facets__pill, .valor-facets__clear, " +
            ".valor-facets-bar__pill, .valor-facets-bar__clear, " +
            ".valor-pagination a[href], " +
            ".valor-collection__empty a[href]",
        );
        if (!link) return;

        const href = link.getAttribute("href");
        if (!href) return;
        // Skip external / cross-origin links
        let parsed;
        try {
          parsed = new URL(href, window.location.origin);
        } catch (err) {
          return;
        }
        if (parsed.origin !== window.location.origin) return;

        e.preventDefault();
        self._fetchAndReplace(parsed.search || "?", true, { closeDrawerOnSuccess: true });
      });
    }

    /* Build a URL from the facets form's current state and fetch.
       options is forwarded to _fetchAndReplace (e.g. for the mobile
       "close drawer after success" behaviour). */
    _submitFacets(facetsForm, options) {
      const formData = new FormData(facetsForm);
      const params = new URLSearchParams(window.location.search);

      // Start from the current URL so search context is preserved
      // (q, type, options[prefix], sort_by, etc). Then remove only
      // Shopify filter params and page before adding the currently
      // checked / filled filter values from the form. This avoids stale
      // unchecked filters staying in the URL while keeping the search
      // query intact on the search results page.
      params.delete("page");
      Array.from(params.keys()).forEach(function (key) {
        if (key.indexOf("filter.") === 0) params.delete(key);
      });

      for (const [key, value] of formData.entries()) {
        if (value === "" || value == null) continue;
        params.append(key, value);
      }
      this._fetchAndReplace("?" + params.toString(), true, options);
    }

    /* Section-level fetch: hits the current URL with the new params
       and ?section_id=... so Shopify renders only the section we
       need to swap. updateHistory defaults to true; popstate passes
       false so we don't push the popped state right back onto the
       stack and break browser back/forward.

       options.closeDrawerOnSuccess: when true, the mobile filter
       drawer is closed after the new markup is in place. We close
       AFTER the fetch resolves rather than on click so the user
       sees confirmation that the filter actually applied (and on a
       slow network the drawer doesn't disappear before anything
       updates). Desktop never has an open drawer, so the close is
       a no-op there. */
    _fetchAndReplace(search, updateHistory, options) {
      if (updateHistory == null) updateHistory = true;
      options = options || {};
      const self = this;
      const sectionUrl = window.location.pathname + (search.startsWith("?") ? search : "?" + search);
      const fetchUrl =
        window.location.pathname + (search.startsWith("?") ? search + "&" : "?") + "section_id=" + this._sectionId;

      this.classList.add("valor-collection--loading");

      const updateEvent = this._startUpdateEvent(search);

      fetch(fetchUrl)
        .then(function (r) {
          if (!r.ok) throw new Error("Section fetch failed");
          return r.text();
        })
        .then(function (html) {
          const tmp = document.createElement("div");
          tmp.innerHTML = html;
          const fresh = tmp.querySelector("[" + SECTION_DATA_ATTR + "]");
          if (!fresh) {
            updateEvent.fail(new Error("Section markup missing from response"));
            // Fallback: full reload to the new URL
            window.location.href = sectionUrl;
            return;
          }

          // Counts for the event come from the freshly rendered host.
          const freshResultsCount = fresh.getAttribute("data-results-count");
          if (freshResultsCount != null) self.setAttribute("data-results-count", freshResultsCount);

          // Drawer state across the swap.
          //
          // The host element keeps its attributes through innerHTML
          // replacement (innerHTML only swaps the children). So if we
          // want the drawer closed afterwards, we MUST clear the
          // [data-drawer-open] attribute explicitly — leaving it on
          // the host means the freshly-rendered drawer markup mounts
          // in the open state and stays visible.
          //
          // We also clear it BEFORE the innerHTML swap so the new DOM
          // is never visible in the open state for even one frame.
          //
          // For auto-close (closeDrawerOnSuccess), an extra
          // [data-drawer-skip-transition] attribute is set during the
          // swap. CSS uses it to disable the slide / fade transitions
          // and force the closed transform / box-shadow / opacity
          // values, so the browser can never paint the drawer
          // mid-animation. We clear that attribute after two animation
          // frames — one frame for the new DOM to settle in the closed
          // state, the second to be sure transitions are re-enabled
          // only after that paint has happened. Manual close (X /
          // overlay / ESC) skips this and animates normally.
          //
          // Two cases when the drawer was open before the fetch:
          //   1. closeDrawerOnSuccess=false (price-range edits, etc.):
          //      keep the attribute through the swap so the drawer
          //      stays visible.
          //   2. closeDrawerOnSuccess=true (filter/sort/clear/pill):
          //      strip [data-drawer-open] and the body scroll-lock,
          //      add [data-drawer-skip-transition] up front.
          const wasDrawerOpen = self.hasAttribute("data-drawer-open");
          const shouldClose = options.closeDrawerOnSuccess === true && wasDrawerOpen;

          if (shouldClose) {
            self.setAttribute("data-drawer-skip-transition", "");
            self.removeAttribute("data-drawer-open");
            document.body.classList.remove("valor-collection-drawer-open");
          }

          self.innerHTML = fresh.innerHTML;

          if (wasDrawerOpen && !shouldClose) {
            // The attribute was already on the host, but be explicit
            // for readability and for the (rare) case where the host
            // gets normalised somehow.
            self.setAttribute("data-drawer-open", "");
          }

          if (shouldClose) {
            // Wait two animation frames before lifting skip-transition.
            // Frame 1: browser paints the closed state with no
            //   transition (the drawer is already off-screen via CSS).
            // Frame 2: ensures that paint has actually committed before
            //   transitions are re-enabled — so the next manual open
            //   animates from the closed position cleanly.
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                self.removeAttribute("data-drawer-skip-transition");
              });
            });
          }

          // Push the new URL into history (without ?section_id) — but
          // skip when called from popstate, otherwise we'd push the
          // popped state right back onto the stack.
          if (updateHistory) {
            window.history.pushState({}, "", sectionUrl);
          }

          // Update the document title from the fresh response
          const newTitle = tmp.querySelector("title");
          if (newTitle) document.title = newTitle.textContent;

          updateEvent.resolve(freshResultsCount);

          // Notify other components (e.g. analytics) that the page
          // has refreshed in place
          self.dispatchEvent(
            new CustomEvent("valor:collection:refreshed", {
              bubbles: true,
            }),
          );
        })
        .catch(function (err) {
          console.error("[Valor collection]", err);
          updateEvent.fail(err);
          window.location.href = sectionUrl;
        })
        .finally(function () {
          self.classList.remove("valor-collection--loading");
        });
    }

    /* Mobile filter drawer */
    _bindDrawer() {
      const self = this;
      this.addEventListener("click", function (e) {
        if (e.target.closest("[data-facets-open]")) {
          self._openDrawer();
        } else if (e.target.closest("[data-facets-close]") || e.target.matches(".valor-collection__overlay")) {
          self._closeDrawer();
        }
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && self.hasAttribute("data-drawer-open")) {
          self._closeDrawer();
        }
      });
    }

    _openDrawer() {
      this.setAttribute("data-drawer-open", "");
      document.body.classList.add("valor-collection-drawer-open");
    }

    /* Animated close used by the X button, overlay click and ESC.
       Auto-close after a successful filter/sort fetch is handled
       directly inside _fetchAndReplace by skipping the re-open of
       [data-drawer-open] — there's no need for an instant variant
       here. */
    _closeDrawer() {
      this.removeAttribute("data-drawer-open");
      document.body.classList.remove("valor-collection-drawer-open");
    }

    /* Horizontal filter bar (desktop) — click-down popovers using
       native <details>. Three behaviours wired up here:

       1. Form submit: the bar is a <form> so that _submitFacets can
          serialise it via FormData, but a real submit would navigate
          away from the page. Cancel the submit; filter changes are
          handled by _bindFilterChange already.

       2. One-at-a-time: opening a filter popover closes any other
          one that's open. This is what users expect from horizontal
          filter bars — Dawn, Studio, and most modern themes do this.

       3. Click outside: clicking anywhere outside the open popover
          closes it. ESC also closes. Both keep keyboard and mouse
          users in sync.

       4. Edge alignment: a popover that would overflow the viewport
          on the right gets a class flipping its anchor to the right
          edge of its summary. Set on toggle so resize / changing
          which one is open stays correct.

       Mobile keeps the drawer; this method is a no-op there because
       there is no .valor-facets-bar element rendered.
    */
    _bindFacetsBar() {
      const self = this;

      // Cancel native form submit so a stray Enter on a price input
      // doesn't navigate. _bindFilterChange already handles Enter
      // for those fields by calling _submitFacets directly.
      this.addEventListener("submit", function (e) {
        if (e.target.closest("[data-facets-bar]")) e.preventDefault();
      });

      // Toggle handler: when one <details> opens, close the others
      // and reposition the panel if it'd overflow.
      this.addEventListener(
        "toggle",
        function (e) {
          const group = e.target;
          if (!group.matches("[data-facets-bar-group]")) return;
          if (!group.open) {
            // Closed — reset alignment for next open
            group.classList.remove("valor-facets-bar__group--align-right");
            return;
          }

          // Close siblings
          const allGroups = self.querySelectorAll("[data-facets-bar-group][open]");
          allGroups.forEach(function (g) {
            if (g !== group) g.removeAttribute("open");
          });

          // Reposition: measure the panel; if it overflows the viewport
          // on the right, flip alignment so the panel anchors to the
          // right edge of its summary instead of the left.
          const panel = group.querySelector(".valor-facets-bar__panel");
          if (panel) {
            const rect = panel.getBoundingClientRect();
            const overflowRight = rect.right > document.documentElement.clientWidth - 8;
            if (overflowRight) {
              group.classList.add("valor-facets-bar__group--align-right");
            }
          }
        },
        true,
      );

      // Click outside / ESC to close any open popover
      this._closeBarPopoversOnOutside = function (e) {
        if (e.target.closest("[data-facets-bar-group]")) return;
        const open = self.querySelectorAll("[data-facets-bar-group][open]");
        open.forEach(function (g) {
          g.removeAttribute("open");
        });
      };
      document.addEventListener("click", this._closeBarPopoversOnOutside);

      this._closeBarPopoversOnEsc = function (e) {
        if (e.key !== "Escape") return;
        const open = self.querySelectorAll("[data-facets-bar-group][open]");
        open.forEach(function (g) {
          g.removeAttribute("open");
        });
      };
      document.addEventListener("keydown", this._closeBarPopoversOnEsc);
    }

    disconnectedCallback() {
      // Avoid leaving stale document listeners around if the host is
      // removed (e.g. theme editor section swap).
      if (this._closeBarPopoversOnOutside) {
        document.removeEventListener("click", this._closeBarPopoversOnOutside);
      }
      if (this._closeBarPopoversOnEsc) {
        document.removeEventListener("keydown", this._closeBarPopoversOnEsc);
      }
    }

    /* Back / forward — re-fetch to the new URL state. We pass
       updateHistory=false so the fetch doesn't push the popped state
       back onto the stack. */
    _bindPopState() {
      const self = this;
      window.addEventListener("popstate", function () {
        self._fetchAndReplace(window.location.search, false);
      });
    }
  }

  customElements.define("valor-collection", ValorCollection);
})();
