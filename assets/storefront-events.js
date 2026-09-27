/* Valor — Shopify standard storefront events & actions
 *
 * Shopify's "standard storefront events and actions" give apps and AI
 * agents one shared vocabulary for every Liquid storefront:
 *
 *   Events  — DOM events with a `shopify:` prefix (shopify:page:view,
 *             shopify:cart:lines-update, shopify:product:select, …) that
 *             the theme dispatches when a buyer does something.
 *   Actions — window.Shopify.actions.{updateCart, openCart, getCart} that
 *             apps call to change or show the cart. Each has a default
 *             implementation; a theme configures them so the call refreshes
 *             the theme's own UI instead of reloading the page.
 *
 * Docs: https://shopify.dev/docs/api/storefront-events-and-actions
 *
 * Load order (layout/theme.liquid, all in <head> above content_for_header):
 *   1. An inline <script type="module"> imports the Shopify-hosted library
 *      (https://cdn.shopify.com/storefront/standard-events.js) and exposes it
 *      as window.StandardEvents.
 *   2. This file (a classic deferred script). Module scripts and deferred
 *      scripts share one in-order execution list, so the library is in place
 *      before this file runs, and this file runs before every body script
 *      (cart-drawer.js, product-info.js, collection.js, …) that uses it.
 *   3. A small synchronous inline bootstrap (window.ValorBoot) that
 *      registers the theme's DOMContentLoaded listener while the <head> is
 *      still being parsed, i.e. before any script in content_for_header can
 *      register one. Work this file queues on ValorBoot (configuring
 *      Shopify.actions, dispatching shopify:page:view) therefore runs in the
 *      FIRST DOMContentLoaded listener, which is what makes the theme's
 *      action configuration win (only the first configure() call counts).
 *
 * Everything degrades to a no-op when the library is unavailable (blocked
 * by an extension, offline, very old browser): window.ValorEvents still
 * exists and its helpers return inert "operation" objects, so callers never
 * need to null-check more than `window.ValorEvents`.
 *
 * Cart operation contract (per Shopify's dispatch guide):
 *   - dispatch the event as the operation STARTS, carrying a promise;
 *   - a successful change resolves with { cart };
 *   - a change the cart DECLINES (a 4xx business answer such as 422 sold out
 *     / max quantity) resolves with { cart, userErrors } and does NOT fire
 *     shopify:cart:error;
 *   - a request that FAILS (network error, 5xx, 429 throttling, timeout)
 *     rejects the promise and dispatches shopify:cart:error from the same
 *     element. Failures are classified by HTTP status, never by the mere
 *     presence of an error message in the body.
 *   Every path settles the promise exactly once, so listeners never spin.
 *
 * Initial events are ordered: shopify:page:view is dispatched first, inside
 * a DOMContentLoaded listener (so every deferred script, however slow, has
 * run and subscribed). Only then is <valor-view-event> registered (its
 * connect-triggered product / collection / cart view events follow) and are
 * the callbacks queued with ValorEvents.afterPageView() run (e.g. the search
 * results page's initial shopify:search:update).
 *
 * Changes made through Shopify.actions.updateCart emit their own cart events
 * (Shopify does that inside the action), so the theme only dispatches cart
 * events for changes it makes itself — never after an action.
 */

(function () {
  if (window.ValorEvents) return;

  function lib() {
    return window.StandardEvents || null;
  }

  function routeRoot() {
    return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  }
  function cartUrl(path) {
    var root = routeRoot();
    if (root.charAt(root.length - 1) !== "/") root += "/";
    return root + String(path).replace(/^\//, "");
  }

  function noop() {}

  function warn(message, error) {
    if (window.console && console.warn) console.warn("[Valor events] " + message, error || "");
  }

  /* ---------------------------------------------------------------
     Shared /cart.js read, scoped to a cart "generation".

     Every cart mutation the theme observes completing calls cartMutated(),
     which starts a new generation. fetchCart() only shares a pending read
     with callers of the SAME generation (for example the drawer's cart-state
     broadcast and the lines-update event of one add), so a read that began
     before a later mutation finished is never handed out as that later
     mutation's result.
     --------------------------------------------------------------- */
  var cartGeneration = 0;
  var pendingCart = null;
  var pendingCartGeneration = -1;

  function cartMutated() {
    cartGeneration += 1;
    return cartGeneration;
  }

  function getCartGeneration() {
    return cartGeneration;
  }

  function fetchCart() {
    if (pendingCart && pendingCartGeneration === cartGeneration) return pendingCart;
    var request = fetch(cartUrl("cart.js"), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(function (response) {
      if (!response.ok) throw new Error("Cart request failed (" + response.status + ")");
      return response.json();
    });
    pendingCart = request;
    pendingCartGeneration = cartGeneration;
    var clear = function () {
      if (pendingCart === request) {
        pendingCart = null;
        pendingCartGeneration = -1;
      }
    };
    request.then(clear, clear);
    return request;
  }

  /* HTTP status classification for cart endpoints. A 4xx answer is the cart
     declining the change (sold out, quantity rule, invalid line, bad input),
     except 408 / 429, which, like every 5xx and network error, are failures. */
  function isDeclineStatus(status) {
    status = Number(status) || 0;
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
  }

  /* An AJAX cart object as returned by /cart.js, /cart/change.js and
     /cart/update.js. /cart/add.js returns the added item(s) instead. */
  function isAjaxCart(value) {
    return !!(value && Array.isArray(value.items) && typeof value.item_count === "number" && value.currency);
  }

  /* Decimal amount string for a money value in minor units ("2999" → "29.99"),
     honouring currencies without minor units (JPY → "2999"). Liquid JSON and
     the AJAX API both express money in the presentment currency's cents. */
  function moneyAmount(cents, currencyCode) {
    var digits = 2;
    try {
      digits = new Intl.NumberFormat("en", { style: "currency", currency: currencyCode }).resolvedOptions()
        .maximumFractionDigits;
    } catch (e) {
      digits = 2;
    }
    return (Number(cents || 0) / 100).toFixed(digits);
  }

  function activeCurrency() {
    return (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || "";
  }

  var INERT_CART_OPERATION = {
    dispatched: false,
    resolveCart: function () {},
    resolveFromServer: function () {},
    decline: function () {},
    settle: function () {},
    fail: function () {},
  };

  var INERT_COUNT_OPERATION = {
    dispatched: false,
    resolve: function () {},
    fail: function () {},
  };

  /* Create the event's promise, dispatch the event and return the deferred.
     Returns null when the library or the event class is missing, or when the
     library rejects the payload (the dev runtime throws on unknown events). */
  function dispatchWithPromise(className, target, payload) {
    var SE = lib();
    var EventClass = SE && SE[className];
    if (!EventClass || !target || typeof target.dispatchEvent !== "function") return null;
    try {
      var deferred = EventClass.createPromise();
      payload.promise = deferred.promise;
      var event = new EventClass(payload);
      // A rejection is part of the contract (failed request). The library's
      // cart and select events expose a DERIVED promise (a .then() that
      // normalises the payload), so the no-op handler goes on both the
      // source promise and the one listeners see. It only keeps an
      // unobserved rejection from surfacing as "Uncaught (in promise)";
      // listeners that chain their own handlers still receive it.
      deferred.promise.catch(noop);
      if (event.promise && event.promise !== deferred.promise && typeof event.promise.catch === "function") {
        event.promise.catch(noop);
      }
      target.dispatchEvent(event);
      return { EventClass: EventClass, deferred: deferred };
    } catch (error) {
      warn("Could not dispatch " + className, error);
      return null;
    }
  }

  function dispatchCartError(target, message, code) {
    var SE = lib();
    if (!SE || !SE.CartErrorEvent || !target) return;
    try {
      target.dispatchEvent(
        new SE.CartErrorEvent({
          error: String(message || "Cart request failed"),
          code: code || "SERVICE_UNAVAILABLE",
        }),
      );
    } catch (error) {
      warn("Could not dispatch CartErrorEvent", error);
    }
  }

  /* Wrap a dispatched cart event in the settle-once operation object the
     theme's cart code calls into. */
  function cartOperation(className, target, payload) {
    var started = dispatchWithPromise(className, target, payload);
    if (!started) return INERT_CART_OPERATION;

    var EventClass = started.EventClass;
    var deferred = started.deferred;
    var settled = false;

    function toCart(ajaxCart) {
      return isAjaxCart(ajaxCart) ? EventClass.createCartFromAjaxResponse(ajaxCart) : null;
    }

    var operation = {
      dispatched: true,

      /* Success with a full AJAX cart object in hand. */
      resolveCart: function (ajaxCart) {
        if (settled) return;
        settled = true;
        try {
          deferred.resolve({ cart: toCart(ajaxCart) });
        } catch (error) {
          warn("Could not resolve " + className, error);
        }
      },

      /* Success where the response does not carry the cart (/cart/add.js).
         Reads /cart.js (shared with the drawer's own read) to resolve. */
      resolveFromServer: function () {
        if (settled) return;
        fetchCart().then(operation.resolveCart, function (error) {
          // The change itself succeeded; only the follow-up read failed.
          // Resolve without a cart rather than reporting a cart error.
          if (settled) return;
          settled = true;
          try {
            deferred.resolve({ cart: null });
          } catch (e) {
            warn("Could not resolve " + className, e || error);
          }
        });
      },

      /* The cart declined the change (HTTP 422). Resolve with userErrors and
         the cart as it stands; this is not a shopify:cart:error. */
      decline: function (message) {
        if (settled) return;
        var finish = function (ajaxCart) {
          if (settled) return;
          settled = true;
          try {
            deferred.resolve({
              cart: toCart(ajaxCart),
              userErrors: [{ code: "INVALID", field: [], message: String(message || "The cart could not be updated.") }],
            });
          } catch (error) {
            warn("Could not resolve " + className, error);
          }
        };
        fetchCart().then(finish, function () {
          finish(null);
        });
      },

      /* Route a response to the right outcome by its HTTP status.
         status: the numeric HTTP status; body: the parsed JSON (or null). */
      settle: function (status, body) {
        if (settled) return;
        status = Number(status) || 0;
        var message = body && (body.description || body.message);
        if (status >= 200 && status < 300) {
          if (isAjaxCart(body)) {
            operation.resolveCart(body);
          } else {
            operation.resolveFromServer();
          }
        } else if (isDeclineStatus(status)) {
          operation.decline(message || "The cart could not be updated.");
        } else {
          operation.fail(new Error(message || "Cart request failed (" + (status || "network") + ")"));
        }
      },

      /* The request itself failed: reject + shopify:cart:error. */
      fail: function (error) {
        if (settled) return;
        settled = true;
        dispatchCartError(target, (error && error.message) || "Cart request failed", "SERVICE_UNAVAILABLE");
        try {
          deferred.reject(error instanceof Error ? error : new Error(String(error || "Cart request failed")));
        } catch (e) {
          warn("Could not reject " + className, e);
        }
      },
    };

    return operation;
  }

  function countOperation(className, target, payload, resultKey) {
    var started = dispatchWithPromise(className, target, payload);
    if (!started) return INERT_COUNT_OPERATION;
    var deferred = started.deferred;
    var settled = false;
    return {
      dispatched: true,
      resolve: function (count) {
        if (settled) return;
        settled = true;
        var result = {};
        result[resultKey] = Math.max(0, parseInt(count, 10) || 0);
        try {
          deferred.resolve(result);
        } catch (error) {
          warn("Could not resolve " + className, error);
        }
      },
      fail: function (error) {
        if (settled) return;
        settled = true;
        try {
          deferred.reject(error instanceof Error ? error : new Error(String(error || "Request failed")));
        } catch (e) {
          warn("Could not reject " + className, e);
        }
      },
    };
  }

  function toSearchParams(params) {
    if (params instanceof URLSearchParams) return params;
    var text = String(params || "");
    return new URLSearchParams(text.charAt(0) === "?" ? text.slice(1) : text);
  }

  /* Filters / sort parsed by the library from Shopify's URL filter params
     (filter.v.price.gte, filter.p.vendor, sort_by, …). Optional fields are
     omitted when empty, as the event schemas require. */
  function applyFiltersAndSort(EventClass, target, params) {
    try {
      var filters = EventClass.parseProductFilters(params);
      if (filters && filters.length) target.productFilters = filters;
    } catch (error) {
      warn("Could not parse product filters", error);
    }
    try {
      var sortKey = EventClass.getSortKey(params);
      if (sortKey) target.sortKey = sortKey;
    } catch (error) {
      warn("Could not parse sort key", error);
    }
  }

  var ValorEvents = {
    fetchCart: fetchCart,
    cartMutated: cartMutated,
    cartGeneration: getCartGeneration,
    isDeclineStatus: isDeclineStatus,
    moneyAmount: moneyAmount,
    isAjaxCart: isAjaxCart,

    /* shopify:cart:lines-update
       options.action  'add' | 'update' | 'remove'
       options.context 'product' | 'cart' | 'dialog'
       options.lines   add → [{ merchandiseId, quantity }]; update/remove →
                       [{ id: <AJAX line key>, quantity }] */
    cartLinesUpdate: function (target, options) {
      options = options || {};
      var lines = (options.lines || []).filter(function (line) {
        if (!line) return false;
        return options.action === "add" ? !!line.merchandiseId : !!line.id;
      });
      if (!lines.length) return INERT_CART_OPERATION;
      return cartOperation("CartLinesUpdateEvent", target, {
        action: options.action,
        context: options.context,
        lines: lines,
      });
    },

    /* shopify:cart:note-update */
    cartNoteUpdate: function (target, options) {
      options = options || {};
      return cartOperation("CartNoteUpdateEvent", target, {
        context: options.context,
        note: String(options.note == null ? "" : options.note),
      });
    },

    /* shopify:cart:discount-update — codes is the COMPLETE set the cart
       should end up with (Shopify replaces the set on every update). */
    cartDiscountUpdate: function (target, options) {
      options = options || {};
      var codes = (options.codes || [])
        .map(function (code) {
          return String(code || "").trim();
        })
        .filter(Boolean)
        .map(function (code) {
          return { code: code };
        });
      return cartOperation("CartDiscountUpdateEvent", target, { discountCodes: codes });
    },

    /* shopify:product:select — dispatched synchronously, resolved with the
       variant the options map to (or null when no variant matches). */
    productSelect: function (target, options) {
      options = options || {};
      var selected = options.selectedOptions || [];
      if (!selected.length || !options.product) {
        return { dispatched: false, resolve: function () {}, fail: function () {} };
      }
      var started = dispatchWithPromise("ProductSelectEvent", target, {
        product: options.product,
        selectedOptions: selected,
      });
      if (!started) return { dispatched: false, resolve: function () {}, fail: function () {} };
      var deferred = started.deferred;
      var settled = false;
      return {
        dispatched: true,
        /* variant: a Liquid `product.variants | json` entry, or null. */
        resolve: function (variant) {
          if (settled) return;
          settled = true;
          var payload = { variant: null };
          if (variant) {
            var currency = activeCurrency();
            payload.variant = {
              id: String(variant.id),
              title: String(variant.title || ""),
              availableForSale: !!variant.available,
              price: { amount: moneyAmount(variant.price, currency), currencyCode: currency },
              selectedOptions: selected,
            };
          }
          try {
            deferred.resolve(payload);
          } catch (error) {
            warn("Could not resolve ProductSelectEvent", error);
          }
        },
        fail: function (error) {
          if (settled) return;
          settled = true;
          try {
            deferred.reject(error instanceof Error ? error : new Error("Variant lookup failed"));
          } catch (e) {
            warn("Could not reject ProductSelectEvent", e);
          }
        },
      };
    },

    /* shopify:collection:update — filters/sort changed on a collection.
       options.collection { id, handle, productsCount }; options.params is the
       new query string (or URLSearchParams). Resolve with the matched count. */
    collectionUpdate: function (target, options) {
      options = options || {};
      var SE = lib();
      if (!SE || !SE.CollectionUpdateEvent) return INERT_COUNT_OPERATION;
      var collection = options.collection || {};
      var payload = {
        collection: {
          id: collection.id ? String(collection.id) : null,
          handle: String(collection.handle || ""),
          productsCount: Math.max(0, parseInt(collection.productsCount, 10) || 0),
        },
      };
      applyFiltersAndSort(SE.CollectionUpdateEvent, payload, toSearchParams(options.params));
      return countOperation("CollectionUpdateEvent", target, payload, "productsCount");
    },

    /* shopify:search:update — a search ran, or its filters/sort changed.
       Resolve with the total result count. */
    searchUpdate: function (target, options) {
      options = options || {};
      var SE = lib();
      if (!SE || !SE.SearchUpdateEvent) return INERT_COUNT_OPERATION;
      var params = toSearchParams(options.params);
      var search = { query: String(options.query != null ? options.query : params.get("q") || "") };
      if (options.params != null) applyFiltersAndSort(SE.SearchUpdateEvent, search, params);
      return countOperation("SearchUpdateEvent", target, { search: search }, "totalCount");
    },
  };

  window.ValorEvents = ValorEvents;

  /* ---------------------------------------------------------------
     Run `fn` once the document is ready, in the theme's own (first)
     DOMContentLoaded listener registered by the inline ValorBoot
     bootstrap in layout/theme.liquid. Without the bootstrap (e.g. a layout
     that doesn't include it) fall back to DOMContentLoaded / load.
     readyState is NOT used to decide: a deferred script already sees
     "interactive" before DOMContentLoaded has fired.
     --------------------------------------------------------------- */
  function whenDocumentReady(fn) {
    var ran = false;
    var run = function () {
      if (ran) return;
      ran = true;
      try {
        fn();
      } catch (error) {
        warn("Ready callback failed", error);
      }
    };
    var boot = window.ValorBoot;
    if (boot && Array.isArray(boot.queue)) {
      if (boot.ready) {
        run();
      } else {
        boot.queue.push(run);
      }
      return;
    }
    if (document.readyState === "complete") {
      run();
      return;
    }
    document.addEventListener("DOMContentLoaded", run, { once: true });
    window.addEventListener("load", run, { once: true });
  }

  /* ---------------------------------------------------------------
     shopify:page:view — once per page load, inside a DOMContentLoaded
     listener (Shopify's dispatch guide; same pattern as Dawn). The
     listener is registered while this deferred script executes, so every
     deferred script before and after it (theme and apps) has run and
     attached its listeners before the event fires, and it still fires
     before the connect-triggered view events. "Has DOMContentLoaded
     already fired?" comes from the ValorBoot flag set in the theme's
     first DOMContentLoaded listener, never from document.readyState: a
     deferred script already sees "interactive" before the event fires.
     The Liquid template name is rendered onto <main data-template>.
     --------------------------------------------------------------- */
  function dispatchPageView() {
    var SE = lib();
    if (!SE || !SE.PageViewEvent) return;
    var main = document.querySelector("main[data-template]");
    try {
      document.dispatchEvent(
        new SE.PageViewEvent({
          page: {
            template: (main && main.getAttribute("data-template")) || "",
            title: document.title,
            url: window.location.href,
          },
        }),
      );
    } catch (error) {
      warn("Could not dispatch PageViewEvent", error);
    }
  }

  /* <valor-view-event>: the library's view-event element. Registered only
     after page:view (see header), so connect-triggered view events can
     never precede it or reach apps before their deferred scripts ran. */
  function defineViewEventElement() {
    var SE = lib();
    if (!SE || typeof SE.createViewEventElement !== "function") return;
    if (!window.customElements || customElements.get("valor-view-event")) return;
    try {
      customElements.define("valor-view-event", SE.createViewEventElement());
    } catch (error) {
      warn("Could not register <valor-view-event>", error);
    }
  }

  var pageViewSent = false;
  var afterPageViewQueue = [];

  /* Run fn once shopify:page:view has been dispatched: synchronously right
     after it (still inside the DOMContentLoaded listener), or in a new task
     when the page view has already happened. */
  function afterPageView(fn) {
    if (typeof fn !== "function") return;
    if (pageViewSent) {
      setTimeout(fn, 0);
    } else {
      afterPageViewQueue.push(fn);
    }
  }
  ValorEvents.afterPageView = afterPageView;

  (function schedulePageView() {
    var sent = false;
    var send = function () {
      if (sent) return;
      sent = true;
      dispatchPageView();
      pageViewSent = true;
      defineViewEventElement();
      var queue = afterPageViewQueue.splice(0);
      for (var i = 0; i < queue.length; i++) {
        try {
          queue[i]();
        } catch (error) {
          warn("afterPageView callback failed", error);
        }
      }
    };
    var boot = window.ValorBoot;
    if ((boot && boot.ready) || document.readyState === "complete") {
      send();
      return;
    }
    document.addEventListener("DOMContentLoaded", send, { once: true });
    // Without the bootstrap, a script that runs after DOMContentLoaded
    // cannot tell it already fired; "load" is the safety net.
    if (!boot) window.addEventListener("load", send, { once: true });
  })();

  /* ---------------------------------------------------------------
     Standard actions — make Shopify.actions refresh Valor's own cart UI.

     Valor is neither Horizon- nor Dawn-shaped, so without this the
     default updateCart falls back to a full page reload and openCart to
     navigating to /cart. Only the first configure() call on an action
     takes effect, which is why this file loads above content_for_header.
     --------------------------------------------------------------- */
  function cartEventTarget() {
    return document.querySelector("valor-cart-drawer") || document.querySelector("valor-cart-page") || null;
  }

  /* Re-render the theme's cart UI after an action changed the cart. The
     promise rejects when any part of the refresh fails (non-2xx section or
     cart response, missing drawer markup), so the handler can fall back to
     a reload instead of reporting a stale UI as handled. */
  function refreshThemeCart() {
    var api = window.ValorCartDrawer;
    if (api && typeof api.refreshCartUI === "function") {
      try {
        return Promise.resolve(api.refreshCartUI({ strict: true }));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return Promise.reject(new Error("Valor cart UI is not available"));
  }

  function configureActions() {
    var actions = window.Shopify && window.Shopify.actions;
    if (!actions) return;

    if (actions.updateCart && typeof actions.updateCart.configure === "function") {
      actions.updateCart.configure({
        // Adds dispatch from the product element the buyer is looking at;
        // everything else from the cart surface on the page.
        eventTarget: function (meta) {
          if (meta && meta.type === "shopify:cart:lines-update" && meta.action === "add") {
            return document.querySelector("product-info") || cartEventTarget();
          }
          return cartEventTarget();
        },
        handler: function (defaultHandler) {
          return defaultHandler().then(function (result) {
            var withDetail = function () {
              var detail = Object.assign({}, (result && result.detail) || {}, { handledBy: "valor" });
              return Object.assign({}, result || {}, { detail: detail });
            };
            return refreshThemeCart().then(withDetail, function (error) {
              // The cart write succeeded; if the in-place refresh cannot run,
              // reload so the buyer never looks at a stale cart.
              warn("Cart refresh after updateCart failed; reloading.", error);
              window.location.reload();
              return withDetail();
            });
          });
        },
      });
    }

    if (actions.openCart && typeof actions.openCart.configure === "function") {
      actions.openCart.configure({
        handler: function () {
          var drawer = document.querySelector("valor-cart-drawer");
          if (drawer && typeof drawer.open === "function") {
            drawer.open();
            return Promise.resolve();
          }
          window.location.href = cartUrl("cart");
          return Promise.resolve();
        },
      });
    }
  }

  // Configure in the theme's first DOMContentLoaded listener (see
  // whenDocumentReady), after every module / deferred script, including
  // Shopify's actions bundle, has executed. If the bundle attaches later
  // than that, try once more on load.
  var actionsConfigured = false;
  function configureActionsOnce() {
    if (actionsConfigured) return;
    if (!(window.Shopify && window.Shopify.actions)) return;
    actionsConfigured = true;
    configureActions();
  }
  whenDocumentReady(function () {
    configureActionsOnce();
    if (!actionsConfigured) {
      if (document.readyState === "complete") {
        setTimeout(configureActionsOnce, 0);
      } else {
        window.addEventListener("load", configureActionsOnce, { once: true });
      }
    }
  });
})();
