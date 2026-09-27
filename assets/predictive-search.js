/* Valor Predictive Search
 *
 * Adapted nearly 1:1 from Shopify Dawn theme. Only the custom-element name and
 * a handful of selectors are renamed to fit Valor's naming convention. Behaviour,
 * fetch URL, DOM-extract selector and attribute toggling all match Dawn exactly.
 */

(function () {
  "use strict";

  if (window.ValorPredictiveSearchInitialized) return;
  window.ValorPredictiveSearchInitialized = true;

  function valorPredictiveDebounce(fn, wait) {
    let t;
    return function () {
      const ctx = this;
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(ctx, args);
      }, wait);
    };
  }

  class ValorPredictiveSearchEl extends HTMLElement {
    constructor() {
      super();
      this.input = this.querySelector('input[type="search"]');
      this.resetButton = this.querySelector('button[type="reset"]');
      this.cachedResults = {};
      this.predictiveSearchResults = this.querySelector("[data-predictive-search]");
      this.allPredictiveSearchInstances = document.querySelectorAll("valor-predictive-search");
      this.isOpen = false;
      this.abortController = new AbortController();
      this.searchTerm = "";

      if (!this.input || !this.input.form || !this.predictiveSearchResults) {
        console.warn("[Valor predictive search] Required search elements were not found.");
        return;
      }

      this.input.form.addEventListener("reset", this.onFormReset.bind(this));

      this.input.addEventListener(
        "input",
        valorPredictiveDebounce(function (event) {
          this.onChange(event);
        }, 300).bind(this),
      );

      this.setupEventListeners();
    }

    setupEventListeners() {
      this.input.form.addEventListener("submit", this.onFormSubmit.bind(this));
      this.input.addEventListener("focus", this.onFocus.bind(this));
      this.addEventListener("focusout", this.onFocusOut.bind(this));
      this.addEventListener("keyup", this.onKeyup.bind(this));
      this.addEventListener("keydown", this.onKeydown.bind(this));
    }

    connectedCallback() {
      // No-op — initialization happens in constructor.
    }

    /* From SearchForm — toggle reset button visibility */
    toggleResetButton() {
      if (!this.resetButton) return;
      const isHidden = this.resetButton.hasAttribute("hidden");
      if (this.input.value.length > 0 && isHidden) {
        this.resetButton.removeAttribute("hidden");
      } else if (this.input.value.length === 0 && !isHidden) {
        this.resetButton.setAttribute("hidden", "");
      }
    }

    shouldResetForm() {
      return !document.querySelector('[aria-selected="true"] a');
    }

    getQuery() {
      return this.input.value.trim();
    }

    onChange() {
      this.toggleResetButton();
      const newSearchTerm = this.getQuery();
      if (!this.searchTerm || !newSearchTerm.startsWith(this.searchTerm)) {
        const wrapper = this.querySelector("#predictive-search-results-groups-wrapper");
        if (wrapper) wrapper.remove();
      }

      this.updateSearchForTerm(this.searchTerm, newSearchTerm);
      this.searchTerm = newSearchTerm;

      if (!this.searchTerm.length) {
        this.close(true);
        return;
      }

      this.getSearchResults(this.searchTerm);
    }

    onFormSubmit(event) {
      if (!this.getQuery().length || this.querySelector('[aria-selected="true"] a')) {
        event.preventDefault();
      }
    }

    onFormReset(event) {
      event.preventDefault();
      if (this.shouldResetForm()) {
        this.input.value = "";
        this.input.focus();
        this.toggleResetButton();
        this.searchTerm = "";
        this.abortController.abort();
        this.abortController = new AbortController();
        this.closeResults(true);
      }
    }

    onFocus() {
      const currentSearchTerm = this.getQuery();
      if (!currentSearchTerm.length) return;
      if (this.searchTerm !== currentSearchTerm) {
        this.onChange();
      } else if (this.getAttribute("results") === "true") {
        this.open();
      } else {
        this.getSearchResults(this.searchTerm);
      }
    }

    onFocusOut() {
      setTimeout(() => {
        if (!this.contains(document.activeElement)) this.close();
      });
    }

    onKeyup(event) {
      if (!this.getQuery().length) this.close(true);
      event.preventDefault();
      switch (event.code) {
        case "ArrowUp":
          this.switchOption("up");
          break;
        case "ArrowDown":
          this.switchOption("down");
          break;
        case "Enter":
          this.selectOption();
          break;
      }
    }

    onKeydown(event) {
      if (event.code === "ArrowUp" || event.code === "ArrowDown") {
        event.preventDefault();
      }
    }

    updateSearchForTerm(previousTerm, newTerm) {
      const searchForTextElement = this.querySelector("[data-predictive-search-search-for-text]");
      const currentButtonText = searchForTextElement && searchForTextElement.innerText;
      if (currentButtonText) {
        const matches = currentButtonText.match(new RegExp(previousTerm, "g"));
        if (matches && matches.length > 1) return;
        const newButtonText = currentButtonText.replace(previousTerm, newTerm);
        searchForTextElement.innerText = newButtonText;
      }
    }

    switchOption(direction) {
      if (!this.getAttribute("open")) return;
      const moveUp = direction === "up";
      const selectedElement = this.querySelector('[aria-selected="true"]');
      const allVisibleElements = Array.from(this.querySelectorAll("li, button.valor-psearch__view-all")).filter(
        (element) => element.offsetParent !== null,
      );
      let activeElementIndex = 0;
      if (moveUp && !selectedElement) return;

      let selectedElementIndex = -1;
      let i = 0;
      while (selectedElementIndex === -1 && i <= allVisibleElements.length) {
        if (allVisibleElements[i] === selectedElement) selectedElementIndex = i;
        i++;
      }

      if (this.statusElement) this.statusElement.textContent = "";

      if (!moveUp && selectedElement) {
        activeElementIndex = selectedElementIndex === allVisibleElements.length - 1 ? 0 : selectedElementIndex + 1;
      } else if (moveUp) {
        activeElementIndex = selectedElementIndex === 0 ? allVisibleElements.length - 1 : selectedElementIndex - 1;
      }

      if (activeElementIndex === selectedElementIndex) return;
      const activeElement = allVisibleElements[activeElementIndex];
      activeElement.setAttribute("aria-selected", true);
      if (selectedElement) selectedElement.setAttribute("aria-selected", false);
      if (this.input) this.input.setAttribute("aria-activedescendant", activeElement.id || "");
    }

    selectOption() {
      const selectedOption = this.querySelector('[aria-selected="true"] a, button[aria-selected="true"]');
      if (selectedOption) selectedOption.click();
    }

    /* shopify:search:update (Shopify standard storefront event) for a
       predictive query, resolved with the number of suggestions shown. */
    startSearchEvent(searchTerm) {
      const ev = window.ValorEvents;
      if (!ev || typeof ev.searchUpdate !== "function") return null;
      return ev.searchUpdate(this, { query: searchTerm });
    }

    getTotalResultCount() {
      const results = this.predictiveSearchResults
        ? this.predictiveSearchResults.querySelector("[data-total-results]")
        : null;
      return results ? parseInt(results.getAttribute("data-total-results"), 10) || 0 : 0;
    }

    getSearchResults(searchTerm) {
      const queryKey = searchTerm.replace(" ", "-").toLowerCase();
      this.setLiveRegionLoadingState();

      const searchEvent = this.startSearchEvent(searchTerm);

      if (this.cachedResults[queryKey]) {
        this.renderSearchResults(this.cachedResults[queryKey]);
        if (searchEvent) searchEvent.resolve(this.getTotalResultCount());
        return;
      }

      const baseUrl = (window.routes && window.routes.predictive_search_url) || "/search/suggest";

      const params = new URLSearchParams({
        q: searchTerm,
        section_id: "predictive-search",
        "resources[type]": "product,collection,page,article,query",
        "resources[limit]": "4",
        "resources[options][unavailable_products]": "hide",
        "resources[options][fields]": "title,product_type,variants.title,vendor",
      });

      const url = `${baseUrl}?${params.toString()}`;

      fetch(url, { signal: this.abortController.signal })
        .then((response) => {
          if (!response.ok) {
            const error = new Error(response.status);
            this.close();
            if (searchEvent) searchEvent.fail(error);
            throw error;
          }
          return response.text();
        })
        .then((text) => {
          const parsed = new DOMParser().parseFromString(text, "text/html");
          const sectionEl = parsed.querySelector("#shopify-section-predictive-search");
          if (!sectionEl) {
            // Fallback: some themes use .shopify-section class wrapper instead of ID
            const fallback = parsed.querySelector(".shopify-section");
            if (fallback) {
              const resultsMarkup = fallback.innerHTML;
              this.allPredictiveSearchInstances.forEach((instance) => {
                instance.cachedResults[queryKey] = resultsMarkup;
              });
              this.renderSearchResults(resultsMarkup);
              if (searchEvent) searchEvent.resolve(this.getTotalResultCount());
              return;
            }
            this.close();
            if (searchEvent) searchEvent.fail(new Error("Predictive search markup missing"));
            return;
          }
          const resultsMarkup = sectionEl.innerHTML;
          // Sync cache across all instances (in case header has multiple)
          this.allPredictiveSearchInstances.forEach((instance) => {
            instance.cachedResults[queryKey] = resultsMarkup;
          });
          this.renderSearchResults(resultsMarkup);
          if (searchEvent) searchEvent.resolve(this.getTotalResultCount());
        })
        .catch((error) => {
          // An aborted request rejects its search event too (the contract
          // is "rejects if the request fails or is aborted"). fail() is a
          // no-op when the event was already settled above.
          if (searchEvent) searchEvent.fail(error);
          if (error && (error.code === 20 || error.name === "AbortError")) return;
          this.close();
          console.error("[Valor predictive search]", error);
        });
    }

    setLiveRegionLoadingState() {
      this.statusElement = this.statusElement || this.querySelector("[data-predictive-search-status]");
      this.loadingText = this.loadingText || this.getAttribute("data-loading-text") || "Loading...";
      this.setLiveRegionText(this.loadingText);
      this.setAttribute("loading", true);
    }

    setLiveRegionText(statusText) {
      if (!this.statusElement) return;
      this.statusElement.setAttribute("aria-hidden", "false");
      this.statusElement.textContent = statusText;
      setTimeout(() => {
        if (this.statusElement) this.statusElement.setAttribute("aria-hidden", "true");
      }, 1000);
    }

    renderSearchResults(resultsMarkup) {
      this.predictiveSearchResults.innerHTML = resultsMarkup;
      this.setAttribute("results", true);
      this.setLiveRegionResults();
      this.open();
    }

    setLiveRegionResults() {
      this.removeAttribute("loading");
      const lr = this.querySelector("[data-predictive-search-live-region-count-value]");
      if (lr) this.setLiveRegionText(lr.textContent);
    }

    open() {
      this.setAttribute("open", true);
      if (this.input) this.input.setAttribute("aria-expanded", true);
      this.isOpen = true;
    }

    close(clearSearchTerm = false) {
      this.closeResults(clearSearchTerm);
      this.isOpen = false;
    }

    closeResults(clearSearchTerm = false) {
      if (clearSearchTerm) {
        this.input.value = "";
        this.removeAttribute("results");
      }
      const selected = this.querySelector('[aria-selected="true"]');
      if (selected) selected.setAttribute("aria-selected", false);
      if (this.input) {
        this.input.setAttribute("aria-activedescendant", "");
        this.input.setAttribute("aria-expanded", false);
      }
      this.removeAttribute("loading");
      this.removeAttribute("open");
    }
  }

  if (!customElements.get("valor-predictive-search")) {
    customElements.define("valor-predictive-search", ValorPredictiveSearchEl);
  }
})();
