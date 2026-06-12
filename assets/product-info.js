/* <product-info> — custom element that drives the interactive parts of
   the product info column on a product page.

   Hosts:
     - Variant resolution (pills + dropdown), client-side, no reload
     - Live updates to price, unit price, SKU, inventory, gallery image,
       payment terms, pickup availability, URL, and Add-to-cart button state
       when the variant changes
     - Quantity +/− buttons and the in-cart count next to the label
     - Sold-out marking on individual option pills
     - Share button (Web Share API with clipboard fallback)
     - Cart event sync via 'valor:cart:updated' (no extra /cart.js fetch)

   Reads from the DOM:
     dataset.sectionId    — the Shopify section id (for logging only)
     dataset.productUrl   — used by URL state updates
     dataset.moneyFormat  — money template (e.g. "€{{amount_with_comma_separator}}")
     <script data-product-info-i18n> — JSON map of translated strings
     <script data-section-variants>  — JSON array of variant objects

   The element is registered as <product-info> and is always wrapped
   around the info column in sections/main-product.liquid. The Shopify
   Theme Editor re-mounts the section on edits, which calls
   disconnectedCallback() and then a fresh connectedCallback(); document-
   level listeners are cleaned up in disconnectedCallback() so they
   don't accumulate across reloads.

   Product interactions are self-contained so the section can be reloaded
   safely in the Theme Editor. */

class ValorProductInfo extends HTMLElement {
  constructor() {
    super();
    this._handleChange = this.onChange.bind(this);
    this._handleCartEvent = this.onCartEvent.bind(this);
  }

  connectedCallback() {
    /* When product-info.js is loaded before the <product-info> markup is
       fully parsed, connectedCallback() can run before its child blocks
       exist. Defer setup by one animation frame so variant inputs,
       popup triggers, share buttons, etc. are present before we bind
       listeners. This also plays nicely with Shopify Theme Editor
       section re-renders. */
    if (this._initialized || this._initScheduled) return;

    const self = this;
    const run = function () {
      self._initScheduled = false;
      self._initHandle = null;
      if (!self.isConnected) return;
      self._initialize();
    };

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      this._initScheduled = "raf";
      this._initHandle = window.requestAnimationFrame(run);
    } else {
      this._initScheduled = "timeout";
      this._initHandle = setTimeout(run, 0);
    }
  }

  _initialize() {
    if (this._initialized) return;
    this._initialized = true;

    this.sectionId = this.dataset.sectionId || "";
    this.productId = parseInt(this.dataset.productId, 10) || 0;
    this.productUrl = this.dataset.productUrl || "";
    this.moneyFormat = this.dataset.moneyFormat || "{{amount}}";

    this.i18n = this._readJsonScript("[data-product-info-i18n]") || {};
    this.variants = this._readJsonScript("[data-section-variants]") || [];

    this.optionInputs = Array.prototype.slice.call(this.querySelectorAll(".valor-mp__option-input"));
    this.optionSelects = Array.prototype.slice.call(this.querySelectorAll(".valor-mp__option-select"));

    this.variantIdInput = this.querySelector("[data-variant-id-input]");
    this.addBtn = this.querySelector("[data-add-button]");
    this.addBtnText = this.querySelector("[data-add-button-text]");
    this.priceEl = this.querySelector(".valor-mp__price");
    this.unitPriceWrapper = this.querySelector(".valor-mp__unit-price[data-unit-price-wrapper]");
    this.unitPriceEl = this.unitPriceWrapper ? this.unitPriceWrapper.querySelector("[data-unit-price]") : null;
    this.skuEl = this.querySelector(".valor-mp__sku");
    this.inventoryEl = this.querySelector(".valor-mp__inventory");
    this.qtyInput = this.querySelector(".valor-mp__quantity-input");
    this.cartQtyEl = this.querySelector("[data-mp-cart-qty]");
    this.paymentTermsVariantInputs = Array.prototype.slice.call(
      this.querySelectorAll("[data-payment-terms-variant-id-input]"),
    );
    this.pickupAvailabilityEls = Array.prototype.slice.call(this.querySelectorAll("valor-pickup-availability"));

    this.currentVariant = null;

    this._bindQuantity();
    this._bindOptions();
    this._bindCartEvents();
    this._bindShare();
    this._bindPopups();

    // Initial state
    if (this.optionInputs.length || this.optionSelects.length) {
      this.currentVariant = this.findVariant(this.getCurrentOptions());
      this.updateSoldOutPills(this.getCurrentOptions());
    }
  }

  disconnectedCallback() {
    if (this._initScheduled) {
      if (this._initScheduled === "raf" && typeof window !== "undefined" && this._initHandle != null) {
        window.cancelAnimationFrame(this._initHandle);
      } else if (this._initScheduled === "timeout" && this._initHandle != null) {
        clearTimeout(this._initHandle);
      }
      this._initScheduled = false;
      this._initHandle = null;
    }

    document.removeEventListener("valor:cart:updated", this._handleCartEvent);
    this._unbindPopups();
    this._initialized = false;
    // Other listeners are on elements within the custom element itself
    // and disappear automatically when those elements are removed.
  }

  _readJsonScript(selector) {
    const el = this.querySelector(selector);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || "");
    } catch (e) {
      return null;
    }
  }

  /* --- Quantity buttons --- */
  _bindQuantity() {
    const self = this;
    this.querySelectorAll("[data-qty-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!self.qtyInput) return;
        const current = parseInt(self.qtyInput.value, 10) || 1;
        if (btn.dataset.qtyAction === "increase") {
          self.qtyInput.value = current + 1;
        } else if (current > 1) {
          self.qtyInput.value = current - 1;
        }
        self.qtyInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }

  /* --- Option change listeners --- */
  _bindOptions() {
    this.optionInputs.forEach((i) => i.addEventListener("change", this._handleChange));
    this.optionSelects.forEach((s) => s.addEventListener("change", this._handleChange));
  }

  /* --- Cart event listener (cleaned up in disconnectedCallback) ---
     We listen ONLY for valor:cart:updated. cart-drawer.js dispatches
     this event with the full cart object in detail after every cart
     mutation (add, change, refresh). The detail.items array lets us
     compute the in-cart count for the current variant locally — no
     /cart.js fetch needed. Listening for valor:cart:added too would
     just duplicate the work, since cart-drawer always follows added
     with updated once it has the fresh cart state. */
  _bindCartEvents() {
    document.addEventListener("valor:cart:updated", this._handleCartEvent);
  }

  /* --- Variant resolution ---
     Read selected option values from either pills or dropdowns, then
     find the matching variant by comparing each option position with
     variant.options array. */
  getCurrentOptions() {
    const opts = [];
    if (this.optionInputs.length) {
      const checked = {};
      this.optionInputs.forEach(function (i) {
        if (i.checked) {
          const pos = parseInt(i.dataset.optionPosition, 10);
          checked[pos] = i.value;
        }
      });
      Object.keys(checked)
        .sort()
        .forEach(function (pos) {
          opts.push(checked[pos]);
        });
    }
    if (this.optionSelects.length) {
      this.optionSelects
        .slice()
        .sort(function (a, b) {
          return parseInt(a.dataset.optionPosition, 10) - parseInt(b.dataset.optionPosition, 10);
        })
        .forEach(function (s) {
          opts.push(s.value);
        });
    }
    return opts;
  }

  findVariant(opts) {
    for (let i = 0; i < this.variants.length; i++) {
      const v = this.variants[i];
      let match = true;
      for (let j = 0; j < opts.length; j++) {
        if (v.options[j] !== opts[j]) {
          match = false;
          break;
        }
      }
      if (match) return v;
    }
    return null;
  }

  /* --- Money formatting (handles {{amount}}, {{amount_no_decimals}},
     {{amount_with_comma_separator}}, etc.). Falls back to plain number
     for unknown placeholders. --- */
  formatMoney(cents) {
    if (cents == null) return "";
    const value = cents / 100;
    return this.moneyFormat.replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, key) {
      switch (key) {
        case "amount":
          return value.toFixed(2);
        case "amount_no_decimals":
          return Math.round(value).toString();
        case "amount_with_comma_separator":
          return value.toFixed(2).replace(".", ",");
        case "amount_no_decimals_with_comma_separator":
          return Math.round(value).toString();
        case "amount_with_space_separator":
          return value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        default:
          return value.toFixed(2);
      }
    });
  }

  /* --- Updaters: price, SKU, inventory, image, URL, add-to-cart --- */
  updatePrice(variant) {
    if (!this.priceEl) return;
    let current = this.priceEl.querySelector(".valor-mp__price-current");
    let compare = this.priceEl.querySelector(".valor-mp__price-compare");
    let badge = this.priceEl.querySelector(".valor-mp__price-badge");
    if (!variant) return;

    const onSale = variant.compare_at_price && variant.compare_at_price > variant.price;
    if (current) {
      current.textContent = this.formatMoney(variant.price);
      current.classList.toggle("valor-mp__price-current--sale", onSale);
    }
    if (onSale) {
      if (!compare) {
        compare = document.createElement("s");
        compare.className = "valor-mp__price-compare";
        current.insertAdjacentElement("afterend", compare);
      }
      compare.textContent = this.formatMoney(variant.compare_at_price);
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "valor-mp__price-badge";
        badge.textContent = this.i18n.sale || "";
        (compare || current).insertAdjacentElement("afterend", badge);
      }
    } else {
      if (compare) compare.remove();
      if (badge) badge.remove();
    }
    this.updateUnitPrice(variant);
  }

  updateUnitPrice(variant) {
    if (!this.unitPriceWrapper || !this.unitPriceEl) return;
    if (!variant || !variant.unit_price_measurement) {
      this.unitPriceWrapper.hidden = true;
      this.unitPriceEl.textContent = "";
      return;
    }

    this.unitPriceEl.textContent = this.formatUnitPrice(variant);
    this.unitPriceWrapper.hidden = false;
  }

  formatUnitPrice(variant) {
    const measurement = variant && variant.unit_price_measurement;
    if (!measurement) return "";
    const value =
      measurement.reference_value && measurement.reference_value !== 1 ? String(measurement.reference_value) : "";
    return this.formatMoney(variant.unit_price) + " / " + value + measurement.reference_unit;
  }

  updateSku(variant) {
    if (!this.skuEl || !variant) return;
    if (variant.sku) {
      this.skuEl.textContent = (this.i18n.sku || "SKU") + ": " + variant.sku;
      this.skuEl.hidden = false;
    } else {
      this.skuEl.hidden = true;
    }
  }

  updateInventory(variant) {
    if (!this.inventoryEl || !variant) return;
    const threshold = parseInt(this.inventoryEl.dataset.threshold || "10", 10);
    const showQty = this.inventoryEl.dataset.showQty === "true";
    if (variant.inventory_management !== "shopify" || variant.inventory_policy !== "deny") {
      this.inventoryEl.hidden = true;
      return;
    }
    this.inventoryEl.hidden = false;
    const qty = variant.inventory_quantity;
    let labelText;
    this.inventoryEl.classList.remove(
      "valor-mp__inventory--in",
      "valor-mp__inventory--low",
      "valor-mp__inventory--out",
    );
    if (qty <= 0) {
      this.inventoryEl.classList.add("valor-mp__inventory--out");
      labelText = this.i18n.outOfStock || "Out of stock";
    } else if (qty <= threshold) {
      this.inventoryEl.classList.add("valor-mp__inventory--low");
      labelText = showQty
        ? (this.i18n.lowStockCount || "{{ count }} left in stock").replace("{{ count }}", qty)
        : this.i18n.lowStock || "Low stock";
    } else {
      this.inventoryEl.classList.add("valor-mp__inventory--in");
      labelText = this.i18n.inStock || "In stock";
    }
    // Re-write text without breaking the dot element
    this.inventoryEl.innerHTML = "";
    const newDot = document.createElement("span");
    newDot.className = "valor-mp__inventory-dot";
    newDot.setAttribute("aria-hidden", "true");
    this.inventoryEl.appendChild(newDot);
    this.inventoryEl.appendChild(document.createTextNode(" " + labelText));
  }

  updateAddButton(variant) {
    if (!this.addBtn) return;
    const available = variant && variant.available;
    this.addBtn.disabled = !available;
    if (this.addBtnText) {
      this.addBtnText.textContent = available ? this.i18n.addToCart || "Add to cart" : this.i18n.soldOut || "Sold out";
    }
    if (this.variantIdInput) {
      this.variantIdInput.value = variant ? variant.id : "";
      this.variantIdInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  updatePaymentTerms(variant) {
    if (!variant || !this.paymentTermsVariantInputs.length) return;
    this.paymentTermsVariantInputs.forEach(function (input) {
      input.value = variant.id;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  updatePickupAvailability(variant) {
    if (!this.pickupAvailabilityEls.length) return;
    this.pickupAvailabilityEls.forEach(function (el) {
      if (typeof el.update === "function") el.update(variant);
    });
  }

  updateGalleryMedia(variant) {
    // Dispatch the same custom event that featured-product uses, so the
    // gallery's setActiveMedia() runs without firing the thumbnail's own
    // click handler (which would open the lightbox).
    if (!variant || !variant.featured_media || !variant.featured_media.id) return;
    // Gallery lives on the same section; reach it from the section root
    const section = this.closest(".valor-mp");
    if (!section) return;
    const gallery = section.querySelector(".valor-product-media");
    if (!gallery) return;
    gallery.dispatchEvent(
      new CustomEvent("valor:gallery:set-media", {
        detail: { mediaId: variant.featured_media.id },
      }),
    );
  }

  updateUrl(variant) {
    if (!variant) return;
    // Defensive guard: only rewrite the browser URL when we're actually
    // on a product page. <valor-product-info> is currently only used in
    // sections/main-product.liquid, but if a merchant ever embeds it
    // elsewhere (a custom page template, for example), we don't want
    // window.location to be rewritten to '/some-page?variant=ID' — that
    // URL has no meaning outside a product context, and the variant
    // parameter would also leak into nearby in-page anchors. The variant
    // id still travels with the add-to-cart form, so cart behaviour is
    // unaffected.
    if (window.location.pathname.indexOf("/products/") === -1) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("variant", variant.id);
      window.history.replaceState({}, "", url.toString());
    } catch (err) {
      /* older browsers */
    }
  }

  /* Render the in-cart count for `variant`. If a cart object is
     provided (from a valor:cart:updated event), use its items array
     directly — no fetch needed, no race with the cart drawer. If
     not, fall back to fetching /cart.js once, e.g. on initial page
     load when no cart event has fired yet. */
  updateCartQty(variant, cart) {
    if (!this.cartQtyEl || !variant) return;
    // Hide while we resolve; we don't want to flash the previous
    // variant's count for a moment after a change.
    this.cartQtyEl.hidden = true;
    this.cartQtyEl.textContent = "";

    if (cart && Array.isArray(cart.items)) {
      this._renderCartQty(variant, cart);
      return;
    }

    const self = this;
    const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    fetch(root.replace(/\/?$/, "/") + "cart.js", { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (c) {
        self._renderCartQty(variant, c);
      })
      .catch(function () {
        /* fail silently */
      });
  }

  _renderCartQty(variant, cart) {
    if (!this.cartQtyEl || !variant || !cart) return;
    const productId = this.productId;
    let selected = 0;
    let total = 0;
    (cart.items || []).forEach(function (item) {
      if (item.variant_id === variant.id) selected += item.quantity;
      if (productId && item.product_id === productId) total += item.quantity;
    });
    const text = this._formatCartText(selected, total);
    if (text) {
      this.cartQtyEl.textContent = " (" + text + ")";
      this.cartQtyEl.hidden = false;
    }
  }

  /* Pick the right localised cart-summary string for the customer's
     current state. Three cases:
       - Selected variant only          → "2 in cart"
       - Selected variant + others      → "1 of 3 in cart"
       - Other variants only (no select)→ "2 total in cart"
       - Nothing in cart                → '' (caller hides the element)
     Each string template comes from the JSON i18n block as the raw
     locale value with placeholders intact (e.g. "{{ count }} in cart").
     We substitute at runtime here. The placeholder syntax is kept as
     "{{ key }}" with spaces — that's how the locale file writes them,
     and JS replace() matches the exact substring. */
  _formatCartText(selected, total) {
    if (selected > 0 && total > selected) {
      return (this.i18n.inCartOf || "{{ selected }} of {{ total }} in cart")
        .replace("{{ selected }}", selected)
        .replace("{{ total }}", total);
    }
    if (selected > 0) {
      return (this.i18n.inCartCount || "{{ count }} in cart").replace("{{ count }}", selected);
    }
    if (total > 0) {
      return (this.i18n.totalInCart || "{{ total }} total in cart").replace("{{ total }}", total);
    }
    return "";
  }

  updateSoldOutPills(opts) {
    if (!this.optionInputs.length) return;
    const self = this;
    this.optionInputs.forEach(function (input) {
      const pos = parseInt(input.dataset.optionPosition, 10);
      const pill = input.nextElementSibling;
      if (!pill) return;
      const candidate = opts.slice();
      candidate[pos - 1] = input.value;
      const match = self.findVariant(candidate);
      if (match && match.available) {
        pill.removeAttribute("data-disabled");
      } else {
        pill.setAttribute("data-disabled", "true");
      }
    });
  }

  /* --- onChange: re-resolve variant and update UI --- */
  onChange(e) {
    // For pill style: also update the "selected: X" legend label
    if (e && e.target && e.target.dataset.optionDisplay) {
      const displayId = e.target.dataset.optionDisplay;
      const displaySpan = this.querySelector('[data-selected-for="' + displayId + '"]');
      if (displaySpan) displaySpan.textContent = e.target.value;
    }

    const opts = this.getCurrentOptions();
    const variant = this.findVariant(opts);
    this.currentVariant = variant;

    if (variant) {
      this.updatePrice(variant);
      this.updateSku(variant);
      this.updateInventory(variant);
      this.updateGalleryMedia(variant);
      this.updateUrl(variant);
      this.updateCartQty(variant);
      this.updatePaymentTerms(variant);
      this.updatePickupAvailability(variant);
    } else {
      this.updateUnitPrice(null);
      this.updatePickupAvailability(null);
    }
    this.updateAddButton(variant);
    this.updateSoldOutPills(opts);
  }

  /* --- Cart event sync ---
     cart-drawer.js dispatches valor:cart:updated with the full cart
     object in detail after every cart mutation. We use detail.items
     to compute the in-cart count locally, so no extra fetch is
     needed. updateCartQty falls back to its own fetch on initial
     page load (when no cart event has fired yet) or if a future
     dispatcher omits the cart object — e.g. an external integration
     dispatching the event with a different shape.

     On products without variants (variant picker doesn't render),
     this.currentVariant is null. We still want the count to update,
     so we fall back to the variant id stored in the hidden form
     input — that is always the active variant. updateCartQty only
     reads `variant.id`, so a minimal { id } object is enough. */
  onCartEvent(e) {
    // detail is the cart object when dispatched by cart-drawer.js;
    // null/undefined / non-cart shapes trigger updateCartQty's
    // /cart.js fallback inside.
    const cart = e && e.detail && Array.isArray(e.detail.items) ? e.detail : null;
    if (this.currentVariant) {
      this.updateCartQty(this.currentVariant, cart);
    } else if (this.variantIdInput && this.variantIdInput.value) {
      this.updateCartQty({ id: parseInt(this.variantIdInput.value, 10) }, cart);
    }
  }

  /* --- Share button: Web Share API with clipboard fallback --- */
  _bindShare() {
    const shareWrapper = this.querySelector("[data-share]");
    if (!shareWrapper) return;
    const shareBtn = shareWrapper.querySelector("[data-share-button]");
    const shareMessage = shareWrapper.querySelector("[data-share-message]");
    let clearTimer = null;
    const i18n = this.i18n;

    function showMessage(text) {
      if (!shareMessage) return;
      shareMessage.hidden = false;
      shareMessage.textContent = text;
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(function () {
        shareMessage.hidden = true;
      }, 2500);
    }

    if (shareBtn) {
      shareBtn.addEventListener("click", function () {
        const shareData = {
          title: document.title,
          url: window.location.href,
        };
        if (navigator.share) {
          navigator.share(shareData).catch(function () {
            /* user cancelled */
          });
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(shareData.url)
            .then(function () {
              showMessage(i18n.shareLinkCopied || "Link copied");
            })
            .catch(function () {
              /* clipboard blocked */
            });
        }
      });
    }
  }

  /* --- Pop-up dialogs ---
     Each popup block renders a trigger button + a native <dialog>.
     Open via showModal(), close via dialog.close() (which fires when
     user clicks X, presses ESC, or clicks the backdrop). Body scroll
     is locked while any dialog is open, and focus is returned to the
     trigger button once the dialog closes. Accessible by default —
     the native dialog handles focus trap and aria roles. */
  _bindPopups() {
    this._popupHandlers = [];
    const triggers = this.querySelectorAll("[data-popup-trigger]");
    const closes = this.querySelectorAll("[data-popup-close]");
    const self = this;

    triggers.forEach(function (trigger) {
      const id = trigger.dataset.popupTrigger;
      const dialog = document.getElementById(id);
      if (!dialog) return;

      const onTrigger = function () {
        self._openPopup(dialog, trigger);
      };
      trigger.addEventListener("click", onTrigger);
      self._popupHandlers.push([trigger, "click", onTrigger]);

      // Backdrop click: the dialog element itself is now a full-viewport
      // flex container with a visually centred inner card. A click that
      // bubbles up to the dialog (e.target === dialog) means the user
      // clicked outside the inner card — i.e. the backdrop area. Clicks
      // on the inner card or its children stop short of the dialog
      // because of normal event flow, so they don't trigger close.
      const onBackdrop = function (e) {
        if (e.target === dialog) self._closePopup(dialog);
      };
      dialog.addEventListener("click", onBackdrop);
      self._popupHandlers.push([dialog, "click", onBackdrop]);

      // 'close' fires for every close path (X, ESC, backdrop, .close()).
      // We unify cleanup here.
      const onClose = function () {
        self._unlockBodyScroll();
        try {
          trigger.focus();
        } catch (e) {
          /* trigger may be detached */
        }
      };
      dialog.addEventListener("close", onClose);
      self._popupHandlers.push([dialog, "close", onClose]);
    });

    closes.forEach(function (close) {
      const onClose = function () {
        const dialog = close.closest("dialog");
        if (dialog) self._closePopup(dialog);
      };
      close.addEventListener("click", onClose);
      self._popupHandlers.push([close, "click", onClose]);
    });
  }

  _openPopup(dialog, trigger) {
    this._lockBodyScroll();
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      // Fallback for very old browsers: just toggle [open]. No focus
      // trap or backdrop in this state, but the modal at least appears.
      dialog.setAttribute("open", "");
    }
  }

  _closePopup(dialog) {
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
      this._unlockBodyScroll();
    }
  }

  /* Body scroll lock — prevents background scrolling while a modal is
     open. Saves the current scroll position to a data attribute and
     restores it on unlock. position:fixed is more reliable than
     overflow:hidden because some browsers still allow touch-scroll
     through overflow:hidden on body. */
  _lockBodyScroll() {
    if (document.body.dataset.valorScrollLock === "true") return;
    const scrollY = window.scrollY;
    document.body.dataset.valorScrollLock = "true";
    document.body.dataset.valorScrollY = scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = "-" + scrollY + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
  }

  _unlockBodyScroll() {
    if (document.body.dataset.valorScrollLock !== "true") return;
    const scrollY = parseInt(document.body.dataset.valorScrollY, 10) || 0;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    delete document.body.dataset.valorScrollLock;
    delete document.body.dataset.valorScrollY;
    window.scrollTo(0, scrollY);
  }

  _unbindPopups() {
    if (!this._popupHandlers) return;
    this._popupHandlers.forEach(function (entry) {
      entry[0].removeEventListener(entry[1], entry[2]);
    });
    this._popupHandlers = [];
    // Make sure scroll is unlocked if the element is removed mid-modal
    this._unlockBodyScroll();
  }
}

if (typeof customElements !== "undefined" && !customElements.get("product-info")) {
  customElements.define("product-info", ValorProductInfo);
}
