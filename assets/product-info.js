/* <product-info> — custom element that drives the interactive parts of
   the product info column on a product page (and the featured-product
   section, which reuses this same element via data-prefix="valor-fp").

   Variant price / unit price / SKU / inventory / sticky price are NOT
   formatted in JavaScript. On a variant change this element fetches the
   section re-rendered for the new variant via the Section Rendering API
   ({product.url}?variant=ID&section_id=SID) and swaps the server-rendered
   fragments by their section-scoped id. Liquid is the single source of
   truth for money formatting — there is no client-side formatMoney.

   Hosts:
     - Variant resolution (pills + dropdown), client-side, no reload
     - Server-rendered fragment swap (price, unit price, SKU, inventory,
       sticky price) on variant change, via fetch + DOMParser
     - Client-side updates to gallery image, payment terms, pickup
       availability, URL, Add-to-cart button state, and the in-cart count
     - Quantity +/− buttons and the in-cart count next to the label
     - Sold-out marking on individual option pills
     - Share button (Web Share API with clipboard fallback)
     - Cart event sync via 'valor:cart:updated' (no extra /cart.js fetch)

   Reads from the DOM:
     dataset.sectionId    — the Shopify section id (used for the fetch URL
                            and the section-scoped fragment ids)
     dataset.productId    — used to total per-product cart quantity
     dataset.productUrl   — base URL for the variant fetch + URL state
     dataset.prefix       — class prefix for this skin ('valor-mp' default,
                            'valor-fp' for featured-product)
     <script data-product-info-i18n> — JSON map of translated strings
     <script data-section-variants>  — JSON array of variant objects

   Swapped fragments (by section-scoped id, prefix-independent):
     ProductPrice-SID, ProductUnitPrice-SID, ProductSku-SID,
     ProductInventory-SID, StickyPrice-SID. The sticky price lives in the
     section root (outside this element), so its swap destination is looked
     up in this.sectionRoot rather than within the element.

   The element is registered as <product-info> and wraps the info column
   in sections/main-product.liquid and sections/featured-product.liquid.
   The Shopify Theme Editor re-mounts the section on edits, which calls
   disconnectedCallback() and then a fresh connectedCallback(); document-
   level listeners and any in-flight fetch are cleaned up in
   disconnectedCallback() so they don't accumulate across reloads.

   Wrapped in an IIFE with a registration guard so the script can be safely
   loaded more than once on the same page — a product page that also contains a
   Featured product section loads product-info.js from both sections. The early
   return prevents both a double customElements.define() and the
   "Identifier 'ValorProductInfo' has already been declared" error that a
   second top-level class declaration would otherwise throw. */

(function () {
  if (typeof customElements === "undefined" || customElements.get("product-info")) return;

class ValorProductInfo extends HTMLElement {
  constructor() {
    super();
    this._handleChange = this.onChange.bind(this);
    this._handleCartEvent = this.onCartEvent.bind(this);
    this._handleStickyScroll = this._syncStickyAddToCartVisibility.bind(this);
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
    // NB: `prefix` is a read-only DOM property on Element, so this instance
    // field must NOT be named `this.prefix` — use `this.classPrefix`.
    this.classPrefix = this.dataset.prefix || "valor-mp";

    this.i18n = this._readJsonScript("[data-product-info-i18n]") || {};
    this.variants = this._readJsonScript("[data-section-variants]") || [];

    this.optionInputs = Array.prototype.slice.call(this.querySelectorAll("." + this.classPrefix + "__option-input"));
    this.optionSelects = Array.prototype.slice.call(this.querySelectorAll("." + this.classPrefix + "__option-select"));

    this.variantIdInput = this.querySelector("[data-variant-id-input]");
    this.addBtn = this.querySelector("[data-add-button]");
    this.addBtnText = this.querySelector("[data-add-button-text]");
    this.qtyInput = this.querySelector('input[name="quantity"]');
    this.cartQtyEl = this.querySelector("[data-mp-cart-qty]") || this.querySelector("[data-fp-cart-qty]");
    this.paymentTermsVariantInputs = Array.prototype.slice.call(
      this.querySelectorAll("[data-payment-terms-variant-id-input]"),
    );
    this.pickupAvailabilityEls = Array.prototype.slice.call(this.querySelectorAll("valor-pickup-availability"));
    this.sectionRoot = this.closest("." + this.classPrefix);
    this.stickyAtc = this.sectionRoot ? this.sectionRoot.querySelector("[data-sticky-atc]") : null;
    this.stickyAddBtn = this.stickyAtc ? this.stickyAtc.querySelector("[data-sticky-add-button]") : null;
    this.stickyAddBtnText = this.stickyAtc ? this.stickyAtc.querySelector("[data-sticky-add-button-text]") : null;
    this.stickyVariantTitleEl = this.stickyAtc ? this.stickyAtc.querySelector("[data-sticky-variant-title]") : null;
    this.stickyImageEl = this.stickyAtc ? this.stickyAtc.querySelector(".valor-mp__sticky-atc-image") : null;

    this.currentVariant = null;
    this._fetchAbort = null;

    this._bindQuantity();
    this._bindOptions();
    this._bindCartEvents();
    this._bindShare();
    this._bindPopups();
    this._bindStickyAddToCart();

    // Initial state
    if (this.optionInputs.length || this.optionSelects.length) {
      this.currentVariant = this.findVariant(this.getCurrentOptions());
      this.updateSoldOutPills(this.getCurrentOptions());
    }
    if (!this.currentVariant && this.variantIdInput && this.variants.length) {
      const initialVariantId = parseInt(this.variantIdInput.value, 10);
      this.currentVariant = this.variants.find((variant) => variant.id === initialVariantId) || null;
    }
    // No fetch on first load — the server already rendered the default
    // variant's price/SKU/inventory. We only sync the sticky button state.
    this.updateStickyAddToCart(this.currentVariant);
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

    if (this._fetchAbort) {
      this._fetchAbort.abort();
      this._fetchAbort = null;
    }

    document.removeEventListener("valor:cart:updated", this._handleCartEvent);
    window.removeEventListener("scroll", this._handleStickyScroll);
    window.removeEventListener("resize", this._handleStickyScroll);
    if (this._stickyBuyObserver) this._stickyBuyObserver.disconnect();
    if (this._stickyHideTimer) clearTimeout(this._stickyHideTimer);
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

  _bindStickyAddToCart() {
    if (!this.stickyAtc || !this.addBtn) return;

    this._stickyObservedTarget = this.addBtn.closest(".valor-mp__buy") || this.addBtn;
    window.addEventListener("scroll", this._handleStickyScroll, { passive: true });
    window.addEventListener("resize", this._handleStickyScroll);

    if (typeof IntersectionObserver !== "undefined") {
      this._stickyBuyObserver = new IntersectionObserver(() => {
        this._syncStickyAddToCartVisibility();
      });
      this._stickyBuyObserver.observe(this._stickyObservedTarget);
    }

    this._syncStickyAddToCartVisibility();
  }

  _syncStickyAddToCartVisibility() {
    if (!this.stickyAtc || !this._stickyObservedTarget) return;
    const rect = this._stickyObservedTarget.getBoundingClientRect();
    const shouldShow = rect.bottom <= 0;
    if (shouldShow) {
      this._showStickyAddToCart();
    } else {
      this._hideStickyAddToCart();
    }
  }

  _showStickyAddToCart() {
    if (!this.stickyAtc) return;
    if (this._stickyHideTimer) clearTimeout(this._stickyHideTimer);
    this.stickyAtc.hidden = false;
    window.requestAnimationFrame(() => {
      if (this.stickyAtc) this.stickyAtc.classList.add("is-visible");
    });
  }

  _hideStickyAddToCart() {
    if (!this.stickyAtc) return;
    this.stickyAtc.classList.remove("is-visible");
    if (this._stickyHideTimer) clearTimeout(this._stickyHideTimer);
    this._stickyHideTimer = setTimeout(() => {
      if (this.stickyAtc && !this.stickyAtc.classList.contains("is-visible")) {
        this.stickyAtc.hidden = true;
      }
    }, 260);
  }

  /* --- Variant resolution ---
     Read selected option values from either pills or dropdowns, then
     find the matching variant by comparing each option position with
     variant.options array. */
  getCurrentOptions() {
    // Collect every option's selected value keyed by its 1-based option
    // position, from BOTH radio inputs (pills / swatches / size styles) and
    // <select> dropdowns, then return them ordered by position. Keying by
    // position is essential when a product MIXES render styles across its
    // options — e.g. picker_style "dropdown" combined with a minimal/boxed
    // size, which renders the colour as a <select> (position 1) and the size
    // as radios (position 2). Concatenating inputs-then-selects would yield
    // [size, colour] and make findVariant() fail (no match → every option
    // marked sold out, gallery image stuck, add-to-cart disabled).
    const byPosition = {};
    this.optionInputs.forEach(function (i) {
      if (i.checked) {
        byPosition[parseInt(i.dataset.optionPosition, 10)] = i.value;
      }
    });
    this.optionSelects.forEach(function (s) {
      byPosition[parseInt(s.dataset.optionPosition, 10)] = s.value;
    });
    return Object.keys(byPosition)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      })
      .map(function (pos) {
        return byPosition[pos];
      });
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

  /* --- Variant render via Section Rendering API ---
     Fetch the section re-rendered for the chosen variant and swap the
     server-rendered fragments by their section-scoped id. This keeps
     money formatting entirely in Liquid (no client-side formatMoney).
     An AbortController cancels an in-flight request when the customer
     changes the variant again before the previous fetch resolves. */
  renderVariant(variant) {
    if (!variant || !this.productUrl || !this.sectionId) return;

    const separator = this.productUrl.indexOf("?") === -1 ? "?" : "&";
    const url =
      this.productUrl +
      separator +
      "variant=" +
      encodeURIComponent(variant.id) +
      "&section_id=" +
      encodeURIComponent(this.sectionId);

    if (this._fetchAbort) this._fetchAbort.abort();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    this._fetchAbort = controller;

    const self = this;
    fetch(url, controller ? { signal: controller.signal } : undefined)
      .then(function (response) {
        return response.text();
      })
      .then(function (text) {
        if (controller && controller.signal.aborted) return;
        const doc = new DOMParser().parseFromString(text, "text/html");
        self._swapFragments(doc);
        if (self._fetchAbort === controller) self._fetchAbort = null;
      })
      .catch(function () {
        /* AbortError on rapid change is expected and ignored; on a real
           network error we leave the current DOM in place rather than
           blanking the price. */
      });
  }

  _swapFragments(doc) {
    this.swapFragment(doc, "ProductPrice");
    this.swapFragment(doc, "ProductUnitPrice");
    this.swapFragment(doc, "ProductSku");
    this.swapFragment(doc, "ProductInventory");
    this.swapFragment(doc, "StickyPrice");
  }

  /* Replace a single fragment's innerHTML (and mirror its hidden state)
     from the fetched document. Source comes from the parsed response;
     destination is the live element. Most fragments live inside this
     element; the sticky price lives in the section root, so we fall back
     to searching there. Attribute selector avoids CSS.escape concerns
     with section ids. */
  swapFragment(doc, idBase) {
    const id = idBase + "-" + this.sectionId;
    const source = doc.getElementById(id);
    if (!source) return;
    let dest = this.querySelector('[id="' + id + '"]');
    if (!dest && this.sectionRoot) dest = this.sectionRoot.querySelector('[id="' + id + '"]');
    if (!dest) return;
    dest.innerHTML = source.innerHTML;
    dest.hidden = source.hidden;
  }

  /* No matching variant for the chosen option combination. There is
     nothing to fetch; disable purchasing (handled by updateAddButton(null)
     in onChange) and clear pickup availability. The last variant's
     price/SKU stay visible — matching the previous behaviour. */
  setUnavailable() {
    if (this._fetchAbort) {
      this._fetchAbort.abort();
      this._fetchAbort = null;
    }
    this.updatePickupAvailability(null);
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
    this.updateStickyAddToCart(variant);
  }

  /* Sticky Add-to-cart bar mirrors the button state, variant title, and
     image. The price is NOT formatted here — it is swapped from the
     server-rendered StickyPrice fragment by swapFragment(). */
  updateStickyAddToCart(variant) {
    if (!this.stickyAtc) return;

    const available = variant && variant.available;
    if (this.stickyAddBtn) {
      this.stickyAddBtn.disabled = !available;
    }
    if (this.stickyAddBtnText) {
      this.stickyAddBtnText.textContent = available
        ? this.i18n.addToCart || "Add to cart"
        : this.i18n.soldOut || "Sold out";
    }
    if (this.stickyVariantTitleEl) {
      const title = variant && variant.title && variant.title !== "Default Title" ? variant.title : "";
      this.stickyVariantTitleEl.textContent = title;
    }
    if (this.stickyImageEl && variant && variant.featured_media && variant.featured_media.preview_image) {
      this.stickyImageEl.src = variant.featured_media.preview_image.src;
      this.stickyImageEl.removeAttribute("srcset");
      this.stickyImageEl.alt = variant.featured_media.alt || "";
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
    // Gallery lives on the same section; reach it from the section root.
    const section = this.sectionRoot || this.closest("." + this.classPrefix);
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
    // on a product page. <product-info> is used in main-product.liquid
    // and featured-product.liquid; the latter can sit on the homepage or
    // any page. We don't want window.location rewritten to
    // '/some-page?variant=ID' — that URL has no meaning outside a product
    // context, and the variant parameter would also leak into nearby
    // in-page anchors. The variant id still travels with the add-to-cart
    // form, so cart behaviour is unaffected.
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

  /* --- onChange: re-resolve variant and update UI ---
     Price / unit price / SKU / inventory / sticky price are refreshed by
     renderVariant() (server fetch + fragment swap). Everything else
     (gallery, URL, cart qty, payment terms, pickup, button state, sold-out
     pills) stays client-side. */
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
      this.renderVariant(variant);
      this.updateGalleryMedia(variant);
      this.updateUrl(variant);
      this.updateCartQty(variant);
      this.updatePaymentTerms(variant);
      this.updatePickupAvailability(variant);
    } else {
      this.setUnavailable();
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
      // flex container with a visually centered inner card. A click that
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

customElements.define("product-info", ValorProductInfo);
})();
