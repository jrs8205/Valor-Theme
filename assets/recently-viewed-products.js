class ValorRecentlyViewedProducts extends HTMLElement {
  constructor() {
    super();
    this.storageKey = "valor_recently_viewed_products";
    this.maxStoredProducts = 20;
  }

  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;

    this.section = this.closest("[data-recently-viewed-section]");
    this.grid = this.querySelector("[data-recently-viewed-grid]");
    this.content = this.querySelector("[data-recently-viewed-content]");
    this.emptyState = this.querySelector("[data-recently-viewed-empty]");
    this.sectionId = this.dataset.sectionId || "";
    this.currentProduct = {
      id: this.dataset.currentProductId || "",
      handle: this.dataset.currentProductHandle || "",
      url: this.dataset.currentProductUrl || "",
    };
    this.productsToShow = parseInt(this.dataset.productsToShow || "4", 10);

    this.render();
  }

  async render() {
    if (!this.section || !this.grid || !this.sectionId || !this.currentProduct.handle) {
      this.storeCurrentProduct();
      return;
    }

    const viewedProducts = this.getStoredProducts()
      .filter((item) => item.handle)
      .filter((item) => item.handle !== this.currentProduct.handle)
      .filter((item) => String(item.id || "") !== String(this.currentProduct.id || ""))
      .slice(0, this.productsToShow);

    if (!viewedProducts.length) {
      this.storeCurrentProduct();
      return;
    }

    const cards = [];
    const settled = await Promise.allSettled(viewedProducts.map((item) => this.fetchProductCard(item.handle)));
    settled.forEach((result) => {
      if (result.status === "fulfilled" && result.value) {
        cards.push(result.value);
      }
    });

    if (!cards.length) {
      this.storeCurrentProduct();
      return;
    }

    this.grid.replaceChildren(...cards);
    if (this.content) this.content.hidden = false;
    if (this.emptyState) this.emptyState.hidden = true;
    this.section.hidden = false;

    this.storeCurrentProduct();
  }

  async fetchProductCard(handle) {
    const root = this.getRoutesRoot();
    const url = `${root}products/${encodeURIComponent(handle)}?section_id=${encodeURIComponent(this.sectionId)}`;
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) return null;

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const template = doc.querySelector("template[data-recently-viewed-card-template]");
    if (!template) return null;

    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".valor-card");
    return card || null;
  }

  getRoutesRoot() {
    const root = window.Shopify && window.Shopify.routes && window.Shopify.routes.root;
    if (root) return root.replace(/\/?$/, "/");
    return "/";
  }

  getStoredProducts() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(this.storageKey) || "[]");
      if (!Array.isArray(stored)) return [];

      return stored
        .map((item) => {
          if (typeof item === "string") {
            return /^[0-9]+$/.test(item) ? null : { handle: item, id: "" };
          }
          if (!item || typeof item !== "object") return null;
          return {
            id: item.id ? String(item.id) : "",
            handle: item.handle ? String(item.handle) : "",
            url: item.url ? String(item.url) : "",
          };
        })
        .filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  storeCurrentProduct() {
    if (!this.currentProduct.handle) return;

    try {
      const nextProducts = this.getStoredProducts().filter((item) => item.handle !== this.currentProduct.handle);
      nextProducts.unshift(this.currentProduct);
      window.localStorage.setItem(this.storageKey, JSON.stringify(nextProducts.slice(0, this.maxStoredProducts)));
    } catch (error) {
      /* Storage can be unavailable in private browsing or strict privacy modes. */
    }
  }
}

if (typeof customElements !== "undefined" && !customElements.get("valor-recently-viewed-products")) {
  customElements.define("valor-recently-viewed-products", ValorRecentlyViewedProducts);
}
