/* Valor Cart Drawer
 *
 * Native Shopify Cart API:
 *   POST /cart/add.js        — add an item (used by product forms)
 *   POST /cart/change.js     — change quantity by line item
 *   GET  /cart.js            — current cart state
 *   GET  /?section_id=cart-drawer  — re-render the drawer markup (fallback)
 *
 * Both the add-to-cart path and the per-line quantity-change path
 * use Shopify's "bundled section rendering" — the request includes a
 * sections=cart-drawer parameter, so the response carries the updated
 * drawer HTML in a single round trip. Renders are atomic; there's no
 * window in which the drawer markup, header bubble, and cart contents
 * can disagree.
 *
 * Cart-state broadcast: every mutation ends with one canonical
 * dispatch of the valor:cart:updated event whose detail is the full
 * cart object. Listeners (product-info in-cart label, etc.) read the
 * detail and don't fetch /cart.js themselves. /cart/change.js returns
 * the cart object inline, so the change path doesn't fetch /cart.js
 * at all; /cart/add.js doesn't, so the add path fetches /cart.js
 * exactly once on everyone's behalf.
 *
 * Discount codes use /discount/{CODE} which sets the Shopify discount
 * cookie silently (fetch with no-redirect), then we re-fetch the cart
 * section to show the updated totals. If the code is invalid, the
 * cart cookie is not set and the user sees an inline error.
 *
 * All cart endpoints are constructed with Shopify.routes.root via
 * cartUrl() so the theme works correctly across multilingual /
 * multi-market setups.
 *
 * Shopify standard storefront events (see storefront-events.js): every
 * cart change this file makes dispatches the matching shopify:cart:*
 * event through window.ValorEvents: lines-update for add / quantity /
 * remove, note-update, discount-update, and cart:view when the drawer
 * opens. refreshCartUI() is the single "the cart changed somewhere else"
 * entry point: Shopify.actions.updateCart and the back/forward-cache
 * restore both call it to re-render the drawer, the header count and
 * the cart page.
 *
 * Ordering: every cart request the theme makes (add, change, discount,
 * note, section refreshes and the /cart.js reads used for publishing, from
 * the drawer AND the cart page) goes through ONE serial queue,
 * cartRequest(). A request starts only after the previous one has
 * finished, so responses arrive in the order the server processed them and
 * a response can never be older than one that arrived before it. Each
 * queued request is tagged with a cart generation assigned inside the
 * queue (a mutation calls ValorEvents.cartMutated() when its response
 * arrives; a read takes the current generation when it starts), so
 * generation order equals server order.
 *
 * Freshness: every cart surface (header bubble, drawer markup, cart page
 * markup, the valor:cart:updated notification) remembers the generation it
 * shows and never moves back to an older one. With the queue this guards
 * against the remaining unordered sources: changes made outside the queue
 * (Shopify.actions.updateCart writes through the Storefront API, then
 * queues a refresh) and reads shared with the standard-events helper.
 * Reads for publishing go through one coalesced loop that reads again if
 * the generation moved during a read, so the latest state is always
 * published even when the newest change publishes nothing itself (a note).
 *
 * Line identity: a quantity change names its line by the AJAX key, and
 * Shopify can re-key lines when the cart changes (a discount that starts or
 * stops applying). The key is therefore settled when the request's turn in
 * the queue comes, against the newest cart state (changeLineRequest), never
 * by position; a key change is followed only for a line without an
 * identical twin on screen, and a removed line stays removed.
 */

(function () {
  if (window.ValorCartDrawer && window.ValorCartDrawer._initialized) return;

  var SECTION_ID = "cart-drawer";
  var CART_ICON_BUBBLE_SELECTOR = ".valor-header__cart";
  var CART_COUNT_SELECTOR = ".valor-cart-count";

  /* Locale-aware URL root. Falls back to '/' if Shopify global isn't
     loaded yet, which is fine for single-locale stores. */
  function routeRoot() {
    return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  }
  function cartUrl(path) {
    var root = routeRoot();
    if (root.charAt(root.length - 1) !== "/") root += "/";
    return root + path.replace(/^\//, "");
  }

  /* Standard-events helper (assets/storefront-events.js). Absent only if
     that script failed to load; every call site tolerates null. */
  function events() {
    return window.ValorEvents || null;
  }

  /* One /cart.js read shared with the standard-events helper, so a cart
     event resolving after an add and the drawer's own cart-state broadcast
     don't each fetch the cart. The helper scopes sharing to a cart
     "generation" (see cartMutated), so a read that started before a later
     mutation completed is never reused for it. */
  function fetchCartState() {
    var ev = events();
    if (ev && typeof ev.fetchCart === "function") return ev.fetchCart();
    return fetch(cartUrl("cart.js"), { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("Cart request failed (" + r.status + ")");
      return r.json();
    });
  }

  /* Record that a cart mutation has completed (new cart generation).
     Returns the new generation. */
  function cartMutated() {
    var ev = events();
    if (ev && typeof ev.cartMutated === "function") return ev.cartMutated();
    return 0;
  }

  function cartGeneration() {
    var ev = events();
    return ev && typeof ev.cartGeneration === "function" ? ev.cartGeneration() : 0;
  }

  /* ----- Line identity across re-keying -----
     Shopify can give a line a new key when the cart changes: a discount that
     starts or stops applying re-keys the lines it touches. A quantity change
     is aimed at the line the buyer saw, so the key read from its row is
     checked against the newest cart state right before the request is sent,
     inside the queue (changeLineRequest): the line still has that key, or it
     was re-keyed, i.e. exactly one line with the same variant, selling plan
     and properties is in the cart now. A key change is followed only for a
     line that had no identical twin on screen: between identical lines (a
     discount split one variant) the next response may re-key the twin too,
     and new keys can't be told apart, so such a change is not sent and
     fails visibly, as before. A line this page removed stays removed. Never
     a position, and never a guess. */

  // Newest full cart a queued request returned: { items, generation }.
  var latestCart = null;
  // Keys of lines removed through changeLineRequest (the key the buyer saw
  // and the key sent for it), with the generation of the response that
  // confirmed the removal.
  var removedLines = Object.create(null);

  function rememberCart(cart, generation) {
    if (!cart || !Array.isArray(cart.items) || typeof cart.item_count !== "number") return;
    if (latestCart && latestCart.generation > generation) return;
    latestCart = { items: cart.items, generation: generation };
  }

  var HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

  function decodeEntities(text) {
    if (typeof text !== "string" || text.indexOf("&") === -1) return text;
    return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (match, entity) {
      if (entity.charAt(0) !== "#") return HTML_ENTITIES[entity.toLowerCase()];
      var code = entity.charAt(1).toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
  }

  /* The row's line item properties as { name: value }, matching the AJAX
     cart, or null when they can't be read. Liquid renders
     `item.properties | json` as [[name, value], …] with names and values
     already HTML-escaped; the AJAX cart has an object of raw strings. */
  function readLineProperties(row) {
    var parsed;
    try {
      parsed = JSON.parse(row.getAttribute("data-properties") || "null");
    } catch (e) {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    var pairs = Array.isArray(parsed)
      ? parsed
      : Object.keys(parsed).map(function (name) {
          return [name, parsed[name]];
        });
    var properties = {};
    for (var i = 0; i < pairs.length; i++) {
      if (!Array.isArray(pairs[i]) || pairs[i].length !== 2) return null;
      properties[decodeEntities(String(pairs[i][0]))] = decodeEntities(pairs[i][1]);
    }
    return properties;
  }

  var IDENTITY_ATTRIBUTES = ["data-variant-id", "data-selling-plan-id", "data-properties"];

  /* Another row on the same cart surface shows a line identical to row's. */
  function hasIdenticalTwin(row) {
    var scope = row.closest("valor-cart-drawer, valor-cart-page") || row.parentNode;
    if (!scope) return false;
    var rows = scope.querySelectorAll("[data-key][data-variant-id]");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] === row || rows[i].getAttribute("data-key") === row.getAttribute("data-key")) continue;
      var identical = IDENTITY_ATTRIBUTES.every(function (name) {
        return rows[i].getAttribute(name) === row.getAttribute(name);
      });
      if (identical) return true;
    }
    return false;
  }

  /* What identifies the line a cart row shows (the Liquid row carries
     data-key, data-variant-id, data-selling-plan-id and data-properties),
     whether an identical line was on screen with it, and the cart
     generation the buyer saw it at. null without a key. */
  function lineTarget(row) {
    var key = row && row.getAttribute("data-key");
    if (!key) return null;
    return {
      key: key,
      variantId: row.getAttribute("data-variant-id") || "",
      sellingPlanId: row.getAttribute("data-selling-plan-id") || "",
      properties: readLineProperties(row),
      hasTwin: hasIdenticalTwin(row),
      generation: cartGeneration(),
    };
  }

  function propertyValue(value) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  function isSameLine(item, target) {
    if (String(item.variant_id) !== target.variantId) return false;
    var allocation = item.selling_plan_allocation;
    var plan = allocation && allocation.selling_plan ? String(allocation.selling_plan.id) : "";
    if (plan !== target.sellingPlanId) return false;
    // Without readable properties on the row, uniqueness alone decides.
    if (!target.properties) return true;
    var own = target.properties;
    var other = item.properties || {};
    var names = Object.keys(own);
    if (names.length !== Object.keys(other).length) return false;
    return names.every(function (name) {
      return (
        Object.prototype.hasOwnProperty.call(other, name) && propertyValue(own[name]) === propertyValue(other[name])
      );
    });
  }

  function hasLineKey(items, key) {
    return items.some(function (item) {
      return item.key === key;
    });
  }

  /* Where target's line is in items: { key } when found; { key: null,
     gone: true } when it no longer exists (removed by this page since the
     buyer saw it, or no line has its identity); { key: null, gone: false }
     when that can't be told (an identical twin was on screen, the row has no
     identity, or several lines match). */
  function findLine(items, target) {
    var removedAt = removedLines[target.key];
    if (removedAt !== undefined && removedAt > target.generation) return { key: null, gone: true };
    if (hasLineKey(items, target.key)) return { key: target.key, gone: false };
    if (!target.variantId || target.hasTwin) return { key: null, gone: false };
    var matches = items.filter(function (item) {
      return isSameLine(item, target);
    });
    if (matches.length === 1) return { key: matches[0].key, gone: false };
    return { key: null, gone: matches.length === 0 };
  }

  /* Resolves with findLine's answer for target against the newest cart.
     Call it inside a queued task (cartRequest's init function): every
     earlier change has then completed. Reads /cart.js only when the cart
     changed since the buyer saw the row and no newer full cart is known. */
  function resolveLine(target) {
    var now = cartGeneration();
    var known = latestCart && latestCart.generation === now ? latestCart.items : null;
    // The newest cart is known and either newer than the row or consistent with it.
    if (known && (target.generation < now || hasLineKey(known, target.key))) {
      return Promise.resolve(findLine(known, target));
    }
    // Nothing changed since the buyer saw the row.
    if (!known && target.generation === now) return Promise.resolve({ key: target.key, gone: false });
    return fetchCartState().then(function (cart) {
      rememberCart(cart, now);
      return findLine((cart && cart.items) || [], target);
    });
  }

  function isDeclineStatus(status) {
    var ev = events();
    if (ev && typeof ev.isDeclineStatus === "function") return ev.isDeclineStatus(status);
    status = Number(status) || 0;
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
  }

  // Settle the standard event, but never render an HTTP error body as a cart.
  // A business decline can still be awaiting its cart read; the catch path
  // must not turn that already-classified response into a service failure.
  function settleCartResponse(operation, response) {
    if (operation) operation.settle(response.status, response.body);
    if (!response.ok) {
      var body = response.body;
      var error = new Error(
        (body && (body.description || body.message)) || "Cart request failed (" + response.status + ")",
      );
      error.cartResponseHandled = true;
      throw error;
    }
    return response.body;
  }

  /* ----- Serial cart request queue (see "Ordering" above) -----
     enqueueCartRequest(task): task() runs after every previously queued
     task has settled; returns task()'s promise. A task must contain only
     the network request and its parsing, never await another queued
     request (that would deadlock); post-processing belongs in the caller's
     .then(). */
  var cartRequestTail = Promise.resolve();
  var inFlightCartRequests = 0;
  function enqueueCartRequest(task) {
    inFlightCartRequests += 1;
    var run = cartRequestTail.then(task, task);
    var settled = function () {
      inFlightCartRequests -= 1;
    };
    cartRequestTail = run.then(settled, settled);
    return run;
  }

  /* ----- Checkout waits for pending quantity saves -----
     A quantity edit saves through Ajax (immediately on the cart page, after
     a short debounce in the drawer). A checkout form post at the same time
     can cancel that save (iOS Safari), and a rejected quantity would then
     fail silently. So a Check out submit made while a cart request is
     queued or a debounced quantity edit is waiting is held: pending edits
     are flushed, the queue is awaited, and the submit is replayed only when
     every mutation in between succeeded. A rejected change keeps the buyer
     on the cart with its line error. */
  var failedCartMutations = 0;
  var pendingQuantityCommits = [];
  var IDLE_SETTLE_MS = 50;
  var IDLE_MAX_WAIT_MS = 15000;

  function addPendingQuantityCommit(commit) {
    if (pendingQuantityCommits.indexOf(commit) === -1) pendingQuantityCommits.push(commit);
  }

  function removePendingQuantityCommit(commit) {
    var index = pendingQuantityCommits.indexOf(commit);
    if (index !== -1) pendingQuantityCommits.splice(index, 1);
  }

  function flushPendingQuantityCommits() {
    var commits = pendingQuantityCommits.slice();
    pendingQuantityCommits.length = 0;
    commits.forEach(function (commit) {
      commit();
    });
  }

  function cartIsBusy() {
    return inFlightCartRequests > 0 || pendingQuantityCommits.length > 0;
  }

  /* Resolves with { failed, timedOut } once no cart request is queued and no
     quantity edit is waiting. failed counts mutations that did not succeed
     since the call. Post-processing may queue follow-up requests (a fallback
     section refresh), so idle must hold for IDLE_SETTLE_MS before resolving. */
  function whenCartIdle() {
    var startFailed = failedCartMutations;
    flushPendingQuantityCommits();
    return new Promise(function (resolve) {
      var done = false;
      var capTimer = null;
      var finish = function (timedOut) {
        if (done) return;
        done = true;
        clearTimeout(capTimer);
        resolve({ failed: failedCartMutations - startFailed, timedOut: timedOut });
      };
      // The cap runs on its own timer: a request that never settles must not
      // keep the buyer waiting, even though the queue below never resolves.
      capTimer = setTimeout(function () {
        finish(true);
      }, IDLE_MAX_WAIT_MS);
      (function check() {
        if (done) return;
        if (cartIsBusy()) {
          flushPendingQuantityCommits();
          cartRequestTail.then(function () {
            setTimeout(check, 0);
          });
          return;
        }
        setTimeout(function () {
          if (done) return;
          if (cartIsBusy()) {
            check();
            return;
          }
          finish(false);
        }, IDLE_SETTLE_MS);
      })();
    });
  }

  var checkoutWaiting = false;
  // Set for the one replayed submit, so it is not held again when the cart is
  // still busy (a save that never settled before the cap).
  var bypassCheckoutGate = false;
  function findCheckoutButton(form, submitter) {
    if (submitter && submitter.isConnected && submitter.form === form) return submitter;
    if (submitter && submitter.id) {
      var byId = document.getElementById(submitter.id);
      if (byId && byId.form === form) return byId;
    }
    var inside = form.querySelector('[type="submit"][name="checkout"]');
    if (inside) return inside;
    return form.id ? document.querySelector('[type="submit"][name="checkout"][form="' + form.id + '"]') : null;
  }

  document.addEventListener(
    "submit",
    function (event) {
      var submitter = event.submitter;
      if (event.defaultPrevented || !submitter || submitter.name !== "checkout") return;
      if (bypassCheckoutGate) {
        bypassCheckoutGate = false;
        return;
      }
      if (!checkoutWaiting && !cartIsBusy()) return;
      event.preventDefault();
      if (checkoutWaiting) return;
      checkoutWaiting = true;
      var form = event.target;
      var formId = form.id;
      submitter.setAttribute("aria-disabled", "true");
      whenCartIdle().then(function (result) {
        checkoutWaiting = false;
        submitter.removeAttribute("aria-disabled");
        if (result.failed > 0) return;
        // A save re-renders the cart, so the form and button may be new nodes.
        var liveForm = form.isConnected ? form : formId ? document.getElementById(formId) : null;
        if (!liveForm) return;
        var button = findCheckoutButton(liveForm, submitter);
        if (!button) return;
        bypassCheckoutGate = true;
        try {
          if (typeof liveForm.requestSubmit === "function") liveForm.requestSubmit(button);
          else button.click();
        } finally {
          // requestSubmit dispatches submit synchronously; never let the
          // bypass outlive this replay (e.g. when validation stops it).
          bypassCheckoutGate = false;
        }
      });
    },
    true,
  );

  /* Keep the buyer's intended code set while discount changes are queued.
     Both cart surfaces share this state: a second click must build on the
     first click, even when its response has not rendered yet. Once every
     pending change settles, the next action starts from the rendered cart. */
  var pendingDiscountChanges = 0;
  var intendedDiscountCodes = [];
  function beginDiscountChange(existing, code, remove) {
    if (!pendingDiscountChanges) intendedDiscountCodes = existing.slice();
    var needle = String(code).toLowerCase();
    var seen = Object.create(null);
    intendedDiscountCodes = intendedDiscountCodes.filter(function (value) {
      var key = String(value).toLowerCase();
      if (key === needle || seen[key]) return false;
      seen[key] = true;
      return true;
    });
    if (!remove) intendedDiscountCodes.push(code);
    pendingDiscountChanges += 1;
    var finished = false;
    return {
      codes: intendedDiscountCodes.slice(),
      finish: function () {
        if (finished) return;
        finished = true;
        pendingDiscountChanges -= 1;
        if (!pendingDiscountChanges) intendedDiscountCodes = [];
      },
    };
  }

  /* A JSON cart request through the queue. Resolves with
     { ok, status, body, generation }. options.mutation: the request changes
     the cart, so a 2xx or a decline (a 422 may still have changed it, e.g. a
     partial add) starts a new generation when the response arrives, inside
     the queue; otherwise the generation current at the start is used.
     init may be a function, called when the request's turn comes, that
     returns the init (or a promise of it). It may instead give null (the
     change can't be sent: a mutation counts as failed) or NOTHING_TO_SEND
     (the change already holds); then nothing is sent and the result is
     { ok: false, skipped: true, failed }. options.onResponse(result), if
     given, runs inside the queue as soon as a response is parsed. Rejects
     on a network error or a non-JSON body. */
  var NOTHING_TO_SEND = {};

  function cartRequest(url, init, options) {
    var mutation = !!(options && options.mutation);
    return enqueueCartRequest(function () {
      var startGeneration = cartGeneration();
      // A failed mutation is counted only once the whole response is in (or
      // the request/body read failed), so a Check out tap that lands between
      // the headers and the body still sees the failure (whenCartIdle).
      var countFailure = function (error) {
        if (mutation) failedCartMutations += 1;
        throw error;
      };
      var send = function (requestInit) {
        if (!requestInit || requestInit === NOTHING_TO_SEND) {
          var failed = requestInit !== NOTHING_TO_SEND;
          if (mutation && failed) failedCartMutations += 1;
          return { ok: false, status: 0, body: null, skipped: true, failed: failed, generation: startGeneration };
        }
        return fetch(url, requestInit).then(function (r) {
          return r.json().then(function (body) {
            if (mutation && !r.ok) failedCartMutations += 1;
            var changed = mutation && (r.ok || isDeclineStatus(r.status));
            var generation = changed ? cartMutated() : startGeneration;
            if (r.ok) rememberCart(body, generation);
            var result = { ok: r.ok, status: r.status, body: body, generation: generation };
            if (options && typeof options.onResponse === "function") options.onResponse(result);
            return result;
          }, countFailure);
        }, countFailure);
      };
      if (typeof init !== "function") return send(init);
      return Promise.resolve().then(init).then(send, countFailure);
    });
  }

  /* POST /cart/change.js setting target's line (lineTarget) to quantity,
     with the key settled when the request's turn in the queue comes
     (resolveLine). Resolves like cartRequest; when nothing was sent,
     result.skipped is set and result.failed says whether the change was
     lost (false for a removal whose line is already gone). result.key (or
     error.lineKey on a rejection) is the key the request was sent with,
     which differs from target.key when the line was re-keyed. sections: the
     section ids to render into the response. */
  function changeLineRequest(target, quantity, sections) {
    var sentKey = null;
    var request = cartRequest(
      cartUrl("cart/change.js"),
      function () {
        return resolveLine(target).then(function (line) {
          if (!line.key) return quantity === 0 && line.gone ? NOTHING_TO_SEND : null;
          sentKey = line.key;
          return {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              id: line.key,
              quantity: quantity,
              sections: sections,
              sections_url: window.location.pathname,
            }),
          };
        });
      },
      {
        mutation: true,
        // Recorded inside the queue, so the next request already knows,
        // under the key the buyer saw as well as the key that was sent.
        onResponse: function (result) {
          if (!result.ok || quantity !== 0 || !sentKey) return;
          removedLines[target.key] = result.generation;
          removedLines[sentKey] = result.generation;
        },
      },
    );
    return request.then(
      function (result) {
        result.key = sentKey;
        return result;
      },
      function (error) {
        if (error && typeof error === "object") error.lineKey = sentKey;
        throw error;
      },
    );
  }

  /* A section-rendering request through the queue. Resolves with
     { ok, status, html, generation } (generation = the one current when the
     request started, i.e. after every earlier queued change). onStart, if
     given, is called with that generation the moment the request starts. */
  function cartSectionRequest(url, onStart) {
    return enqueueCartRequest(function () {
      var startGeneration = cartGeneration();
      if (typeof onStart === "function") onStart(startGeneration);
      return fetch(url).then(function (r) {
        return r.text().then(function (html) {
          return { ok: r.ok, status: r.status, html: html, generation: startGeneration };
        });
      });
    });
  }

  /* Highest cart generation each surface currently shows. */
  var shownGeneration = { bubble: -1, published: -1 };

  function generationOf(generation) {
    return typeof generation === "number" ? generation : cartGeneration();
  }

  /* Header cart icon bubble + screen-reader label. Module-level so the
     drawer, the cart page, the no-drawer refresh path and the bfcache
     restore share it. Ignores data older than what the bubble shows. */
  function updateCartBubble(cart, generation) {
    if (!cart) return false;
    var gen = generationOf(generation);
    if (gen < shownGeneration.bubble) return false;
    shownGeneration.bubble = gen;
    var cartLink = document.querySelector(CART_ICON_BUBBLE_SELECTOR);
    if (!cartLink) return true;
    var bubble = cartLink.querySelector(CART_COUNT_SELECTOR);
    var hiddenText = cartLink.querySelector("[data-cart-count-text]");
    var count = cart.item_count;

    if (count > 0) {
      if (!bubble) {
        bubble = document.createElement("span");
        bubble.className = "valor-cart-count";
        bubble.setAttribute("aria-hidden", "true");
        if (hiddenText) {
          cartLink.insertBefore(bubble, hiddenText);
        } else {
          cartLink.appendChild(bubble);
        }
      }
      bubble.textContent = count < 100 ? String(count) : "";
    } else if (bubble) {
      bubble.remove();
    }

    // Keep the screen-reader cart label ("Cart (N)") in sync with the
    // visible bubble after drawer mutations.
    if (hiddenText) {
      var template = hiddenText.dataset.template;
      if (template) {
        hiddenText.textContent = template.replace("%count%", count);
      }
    }
    return true;
  }

  /* The single place valor:cart:updated is dispatched (the cart page
     publishes through it too). Drops a cart older than the last published
     one, so listeners (product-info, the cart page) never see the cart go
     backwards. `source` is attached to the event as event.valorSource so a
     component can recognise, and skip, its own notification. */
  function publishCartState(cart, generation, source) {
    if (!cart) return false;
    var gen = generationOf(generation);
    if (gen < shownGeneration.published) return false;
    shownGeneration.published = gen;
    updateCartBubble(cart, gen);
    var event = new CustomEvent("valor:cart:updated", { detail: cart });
    if (source) event.valorSource = source;
    document.dispatchEvent(event);
    return true;
  }

  /* Read /cart.js and publish it, coalesced: concurrent callers share one
     loop. Each pass records the generation before its read and publishes
     the snapshot under it (so it is dropped if something newer was already
     published); if a mutation completed during the read, the snapshot may
     not include it and that mutation may publish nothing itself, so the
     loop reads again. It ends once a read saw no newer mutation, i.e. it
     only continues while mutations keep completing. Resolves with the last
     snapshot; rejects if a read fails. */
  var serverPublish = null;
  function publishFromServer() {
    if (serverPublish) return serverPublish;
    var pass = function () {
      var gen;
      return enqueueCartRequest(function () {
        gen = cartGeneration();
        return fetchCartState();
      }).then(function (cart) {
        publishCartState(cart, gen);
        if (gen !== cartGeneration()) return pass();
        return cart;
      });
    };
    var run = pass();
    serverPublish = run;
    var clear = function () {
      if (serverPublish === run) serverPublish = null;
    };
    run.then(clear, clear);
    return run;
  }

  /* Re-sync every cart surface after a change that happened outside the
     theme's own request/response (Shopify.actions.updateCart, a partially
     applied add, a back/forward-cache restore). Starts a new cart
     generation, then: with the drawer on the page, its refresh() re-renders
     the drawer, updates the bubble and broadcasts valor:cart:updated (which
     the cart page and product-info react to); without the drawer, it reads
     the cart and does the bubble + broadcast directly.
     options.strict: reject when any part of the refresh fails, instead of
     tolerating a failed cart-state read (used by the updateCart action so
     it can fall back to a reload rather than report a stale UI). */
  function refreshCartUI(options) {
    var strict = !!(options && options.strict);
    cartMutated();

    // On /cart the visible cart-page section is refreshed and AWAITED here.
    // Its own valor:cart:updated listener may already have started a
    // refresh for this generation; refreshSection() coalesces onto it, and
    // every render is generation-guarded, so overlapping refreshes can't
    // leave older markup on screen.
    var page = document.querySelector("valor-cart-page");
    var hasPage = !!(page && typeof page.refreshSection === "function");

    var drawer = document.querySelector("valor-cart-drawer");
    var surfaces =
      drawer && typeof drawer.refresh === "function" ? drawer.refresh({ strict: strict }) : publishFromServer();

    return surfaces
      .then(
        function (cart) {
          return { cart: cart };
        },
        function (error) {
          // Strict: stop and report. Otherwise still bring the page up to date.
          if (strict) throw error;
          return { error: error };
        },
      )
      .then(function (state) {
        if (!hasPage) return state;
        return page.refreshSection({ strict: strict }).then(function () {
          return state;
        });
      })
      .then(function (state) {
        if (state.error) throw state.error;
        return state.cart;
      });
  }

  /* Collect customer-applied discount code titles for the active-codes
     list. Three sources mirror the Liquid logic at the top of
     cart-drawer.liquid (and main-cart.liquid):

       1. cart.cart_level_discount_applications  (subtotal codes)
       2. cart.items[].line_level_discount_allocations  (per-product codes)
       3. cart.discount_codes  (shipping codes that don't change subtotal)

     1+2 catch codes whose effect is visible immediately as money in
     the totals. 3 catches shipping-only codes (e.g. FREESHIP) whose
     effect is deferred to checkout. Adding all three (de-duped) means
     _cartHasCode() recognises a freshly-applied code regardless of
     which type it is. Automatic discounts and product compare-at sale
     prices are excluded — they don't have type 'discount_code'. */
  function getApplicableDiscountCodes(cart) {
    if (!cart) return [];
    var seen = Object.create(null);
    var codes = [];

    function add(title) {
      if (!title) return;
      var t = String(title).trim();
      if (!t) return;
      var key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      codes.push(t);
    }

    if (Array.isArray(cart.cart_level_discount_applications)) {
      cart.cart_level_discount_applications.forEach(function (app) {
        if (app && app.type === "discount_code") add(app.title);
      });
    }

    if (Array.isArray(cart.items)) {
      cart.items.forEach(function (item) {
        if (!item || !Array.isArray(item.line_level_discount_allocations)) return;
        item.line_level_discount_allocations.forEach(function (alloc) {
          if (alloc && alloc.discount_application && alloc.discount_application.type === "discount_code") {
            add(alloc.discount_application.title);
          }
        });
      });
    }

    // Shopify keeps a code the cart rejected in cart.discount_codes with
    // applicable: false. Only accepted codes count as applied.
    if (Array.isArray(cart.discount_codes)) {
      cart.discount_codes.forEach(function (entry) {
        if (entry && entry.code && entry.applicable !== false) add(entry.code);
      });
    }

    return codes;
  }

  /* Codes that exist in cart.discount_codes but NOT in either
     cart_level_discount_applications or line_level_discount_allocations.
     Typically shipping discounts whose effect is deferred to checkout.
     Liquid can't render their pills server-side because cart.discount_codes
     is unreliable for manual codes; we render with JS instead. */
  function getShippingDiscountCodes(cart) {
    if (!cart || !Array.isArray(cart.discount_codes)) return [];

    var visibleSet = Object.create(null);
    if (Array.isArray(cart.cart_level_discount_applications)) {
      cart.cart_level_discount_applications.forEach(function (app) {
        if (app && app.type === "discount_code" && app.title) {
          visibleSet[String(app.title).toLowerCase()] = true;
        }
      });
    }
    if (Array.isArray(cart.items)) {
      cart.items.forEach(function (item) {
        if (!item || !Array.isArray(item.line_level_discount_allocations)) return;
        item.line_level_discount_allocations.forEach(function (alloc) {
          if (alloc && alloc.discount_application && alloc.discount_application.type === "discount_code") {
            visibleSet[String(alloc.discount_application.title).toLowerCase()] = true;
          }
        });
      });
    }

    var shippingCodes = [];
    var seen = Object.create(null);
    cart.discount_codes.forEach(function (entry) {
      // Rejected codes (applicable: false) are not shipping discounts.
      if (!entry || !entry.code || entry.applicable === false) return;
      var code = String(entry.code).trim();
      if (!code) return;
      var key = code.toLowerCase();
      if (visibleSet[key] || seen[key]) return;
      seen[key] = true;
      shippingCodes.push(code);
    });
    return shippingCodes;
  }

  function syncShippingPills(host, cart) {
    if (!host || !cart) return;
    var list = host.querySelector("[data-active-discounts]");
    if (!list) return;

    var base = "valor-cart-drawer";
    var shippingCodes = getShippingDiscountCodes(cart);
    var shippingSet = Object.create(null);
    shippingCodes.forEach(function (c) {
      shippingSet[c.toLowerCase()] = c;
    });

    list.querySelectorAll("[data-shipping-pill]").forEach(function (pill) {
      var code = pill.getAttribute("data-discount-code") || "";
      if (!shippingSet[code.toLowerCase()]) pill.parentNode && pill.parentNode.removeChild(pill);
    });

    shippingCodes.forEach(function (code) {
      var existing = list.querySelector('[data-discount-code="' + cssEscape(code) + '"]');
      if (existing) return;
      list.appendChild(buildShippingPill(host, list, code, base));
    });

    if (list.querySelector("[data-discount-code]")) {
      list.removeAttribute("hidden");
    } else {
      list.setAttribute("hidden", "");
    }

    var notice = list.parentNode ? list.parentNode.querySelector("[data-shipping-discount-notice]") : null;
    if (shippingCodes.length > 0) {
      if (!notice) {
        notice = document.createElement("p");
        notice.className = base + "__shipping-discount-notice";
        notice.setAttribute("data-shipping-discount-notice", "");
        notice.textContent = host.dataset.stringsShippingNotice || "Shipping discount will be applied at checkout.";
        if (list.nextSibling) {
          list.parentNode.insertBefore(notice, list.nextSibling);
        } else {
          list.parentNode.appendChild(notice);
        }
      }
    } else if (notice) {
      notice.parentNode.removeChild(notice);
    }
  }

  function buildShippingPill(host, list, code, base) {
    var li = document.createElement("li");
    li.className = base + "__active-discount";
    li.setAttribute("data-discount-code", code);
    li.setAttribute("data-shipping-pill", "");

    var label = document.createElement("span");
    label.className = base + "__discount-label";

    var icon = document.createElement("span");
    icon.className = base + "__discount-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "\u2212";

    var title = document.createElement("span");
    title.className = base + "__discount-title";
    title.textContent = code;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = base + "__discount-remove";
    btn.setAttribute("data-discount-remove", "");
    btn.setAttribute("data-discount-code", code);
    var removeLabel = host.dataset.stringsRemoveDiscount || list.dataset.removeLabel || "Remove discount";
    btn.setAttribute("aria-label", removeLabel + ": " + code);
    btn.innerHTML = '<span aria-hidden="true">\u00d7</span>';
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (typeof host.removeDiscount === "function") host.removeDiscount(code);
    });

    label.appendChild(icon);
    label.appendChild(title);
    li.appendChild(label);
    li.appendChild(btn);
    return li;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return "\\" + c.charCodeAt(0).toString(16) + " ";
    });
  }

  /* ----- <valor-cart-drawer> custom element ----- */
  if (!customElements.get("valor-cart-drawer")) {
    customElements.define(
      "valor-cart-drawer",
      class ValorCartDrawer extends HTMLElement {
        connectedCallback() {
          // Two-tier binding:
          //   - Global events (cart icon click, ESC keyup, document
          //     valor:cart:added listener) live on long-lived hosts
          //     that don't change when the drawer's innerHTML is
          //     replaced. Bind them once, guarded by _globalBound,
          //     so re-renders don't pile up duplicate handlers.
          //   - Drawer-internal events (close buttons, discount input,
          //     quantity controls) are inside our own innerHTML and
          //     get destroyed on every re-render — they need to be
          //     re-bound after each renderFromSections() / refresh().
          if (!this._globalBound) {
            this._bindGlobalEvents();
            this._globalBound = true;
          }
          this._bindDrawerControls();

          // Page-load shipping pill sync: GET /cart.js to find any
          // shipping codes that Liquid couldn't render server-side
          // (cart.discount_codes is unreliable for manual codes).
          if (!this._shippingSynced) {
            this._shippingSynced = true;
            var self = this;
            // Through the serial cart queue, so this snapshot can't land
            // after (and undo) a newer cart render.
            cartRequest(cartUrl("cart.js"), { credentials: "same-origin" })
              .then(function (res) {
                if (res.ok) syncShippingPills(self, res.body);
              })
              .catch(function () {});
          }
        }

        _bindGlobalEvents() {
          var self = this;

          // Esc key — bound on the host element, survives innerHTML swaps
          this.addEventListener("keyup", function (e) {
            if (e.code === "Escape") self.close();
          });

          // Cart icon lives in the header section, outside our element
          this.bindCartIcon();

          // Listen for "cart-updated" events from product forms.
          // If the event detail carries pre-rendered section HTML
          // (the bundled-section-rendering path), apply it atomically;
          // otherwise fall back to re-fetching the section. After the
          // markup is in place we trigger a single canonical cart-state
          // broadcast so product-info and other listeners get the new
          // cart without each one fetching /cart.js independently.
          // /cart/add.js doesn't include the full cart object in its
          // response, so _broadcastCartState() with no argument fetches
          // /cart.js once on everyone's behalf. refresh() handles its
          // own broadcast internally.
          document.addEventListener("valor:cart:added", function (e) {
            var detail = e && e.detail;
            if (detail && detail.sections && detail.sections[SECTION_ID]) {
              var ok = self.renderFromSections(detail.sections, cartGeneration());
              if (ok) {
                self.open();
                self._broadcastCartState();
                return;
              }
            }
            self
              .refresh()
              .then(function () {
                self.open();
              })
              .catch(function (err) {
                console.error("[Valor cart] drawer refresh failed:", err);
              });
          });
        }

        _bindDrawerControls() {
          var self = this;

          // Close handlers — but DON'T preventDefault on links, so they navigate
          this.querySelectorAll("[data-cart-drawer-close]").forEach(function (el) {
            el.addEventListener("click", function (e) {
              // If this is a link or submit button, let it do its job
              // (close button is <button type="button"> so no default to suppress)
              var isNav = el.tagName === "A" || (el.tagName === "BUTTON" && el.type === "submit");
              if (!isNav) e.preventDefault();
              self.close();
            });
          });

          // Discount apply
          var applyBtn = this.querySelector("[data-discount-apply]");
          if (applyBtn) {
            applyBtn.addEventListener("click", function () {
              self.applyDiscount();
            });
          }
          var discountInput = this.querySelector("#ValorCartDiscountInput");
          if (discountInput) {
            discountInput.addEventListener("keydown", function (e) {
              if (e.code === "Enter") {
                e.preventDefault();
                self.applyDiscount();
              }
            });
          }

          this.querySelectorAll("[data-discount-remove]").forEach(function (button) {
            button.addEventListener("click", function (event) {
              event.preventDefault();
              var code = button.getAttribute("data-discount-code");
              if (code) self.removeDiscount(code);
            });
          });

          // Cart note — persist on change (fires on blur after edit) so a note
          // typed in the drawer is saved even if the customer closes the drawer
          // or navigates away instead of clicking Checkout.
          var noteInput = this.querySelector("[data-cart-note]");
          if (noteInput) {
            noteInput.addEventListener("change", function () {
              self.updateNote(noteInput.value);
            });
          }

          // Quantity controls inside the items list
          this.bindQuantityControls();
        }

        bindCartIcon() {
          var cartIcon = document.querySelector(CART_ICON_BUBBLE_SELECTOR);
          if (!cartIcon) return;
          var self = this;
          cartIcon.setAttribute("role", "button");
          cartIcon.setAttribute("aria-haspopup", "dialog");
          cartIcon.setAttribute("aria-controls", this.id);
          cartIcon.addEventListener("click", function (e) {
            e.preventDefault();
            self.open();
          });
        }

        open() {
          // Close the mobile drawer if it's open (avoid stacked drawers)
          var mobileDrawer = document.getElementById("MobileDrawer");
          if (mobileDrawer && mobileDrawer.hasAttribute("data-open")) {
            var toggleBtn = document.querySelector("[data-drawer-toggle]");
            if (toggleBtn) toggleBtn.click();
          }

          var wasOpen = this.hasAttribute("data-open");
          this.removeAttribute("hidden");
          // Force reflow so the slide-in transition runs from initial state
          // eslint-disable-next-line no-unused-expressions
          this.offsetWidth;
          this.setAttribute("data-open", "");
          document.body.classList.add("valor-cart-drawer-open");

          // shopify:cart:view (context "dialog"). The drawer isn't a native
          // <dialog>, so its view-event element uses the manual trigger and
          // fires here: once per opening, from the markup that was just
          // rendered, so the payload always reflects the current cart.
          if (!wasOpen) {
            var viewEvent = this.querySelector("valor-view-event[data-cart-view]");
            if (viewEvent && typeof viewEvent.dispatchViewEvent === "function") {
              try {
                viewEvent.dispatchViewEvent();
              } catch (e) {
                /* informational event; never block opening the drawer */
              }
            }
          }
        }

        close() {
          this.removeAttribute("data-open");
          document.body.classList.remove("valor-cart-drawer-open");
          var self = this;
          setTimeout(function () {
            if (!self.hasAttribute("data-open")) self.setAttribute("hidden", "");
          }, 250);
        }

        /* Clamp a desired quantity to the line's quantity rule (min / max /
           increment), read from data-min/data-max/data-step on the input.
           A desired value of 0 (or less) means "remove" and is preserved so
           the customer can always empty a line. Mirrors the enforcement the
           cart page already does via quantity-input.js, so case-pack /
           wholesale products (e.g. min 6, step 6) behave the same in the
           drawer as on the cart page. */
        clampQuantity(input, desired) {
          if (!desired || desired <= 0) return 0;
          var min = parseInt(input.dataset.min, 10);
          if (isNaN(min) || min < 1) min = 1;
          var step = parseInt(input.dataset.step, 10);
          if (isNaN(step) || step < 1) step = 1;
          var max = parseInt(input.dataset.max, 10);
          var hasMax = !isNaN(max) && max > 0;
          if (desired < min) desired = min;
          var steps = Math.round((desired - min) / step);
          desired = min + steps * step;
          if (desired < min) desired = min;
          if (hasMax && desired > max) {
            desired = min + Math.floor((max - min) / step) * step;
          }
          return desired;
        }

        bindQuantityControls() {
          var self = this;

          // +/- buttons — step by the variant's increment and respect min/max.
          this.querySelectorAll("[data-qty-change]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var line = parseInt(btn.dataset.line, 10);
              var direction = parseInt(btn.dataset.direction, 10);
              var input = self.querySelector('[data-qty-input][data-line="' + line + '"]');
              if (!input) return;
              var step = parseInt(input.dataset.step, 10);
              if (isNaN(step) || step < 1) step = 1;
              var min = parseInt(input.dataset.min, 10);
              if (isNaN(min) || min < 1) min = 1;
              var raw = parseInt(input.value, 10);
              if (isNaN(raw)) raw = 0;
              var desired = raw + direction * step;
              // Stepping below the rule minimum removes the line.
              if (direction < 0 && desired < min) desired = 0;
              self.changeLine(line, self.clampQuantity(input, desired));
            });
          });

          // Direct input change (debounced) — snap to the nearest valid value.
          // A waiting edit is registered so Check out can flush it, and
          // Enter commits it at once. The edit remembers its line (lineTarget):
          // an earlier save can re-render the drawer (detaching this input)
          // before the debounce ends, and the buyer's value must still be sent
          // for the same line, even when that save gave it a new key.
          this.querySelectorAll("[data-qty-input]").forEach(function (input) {
            var timer = null;
            var target = null;
            var commit = function () {
              if (timer === null) return;
              clearTimeout(timer);
              timer = null;
              removePendingQuantityCommit(commit);
              var line = parseInt(input.dataset.line, 10);
              var raw = parseInt(input.value, 10);
              if (isNaN(raw)) raw = 0;
              self.changeLine(line, self.clampQuantity(input, raw), target);
            };
            input.addEventListener("input", function () {
              target = lineTarget(input.closest("[data-key]"));
              clearTimeout(timer);
              timer = setTimeout(commit, 500);
              addPendingQuantityCommit(commit);
            });
            input.addEventListener("keydown", function (event) {
              if (event.key !== "Enter") return;
              event.preventDefault();
              commit();
            });
          });

          // Remove button
          this.querySelectorAll("[data-line-remove]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var line = parseInt(btn.dataset.line, 10);
              self.changeLine(line, 0);
            });
          });
        }

        setBusy(isBusy) {
          var items = this.querySelector("valor-cart-items");
          if (items) items.setAttribute("aria-busy", isBusy ? "true" : "false");
        }

        /* Per-line quantity change. Uses bundled section rendering:
           one POST to /cart/change.js with sections=cart-drawer returns
           the cart object inline AND the freshly rendered drawer HTML
           in a single round trip. The three-fetch refresh()
           path remains the fallback when the response doesn't carry usable
           section HTML. */
        changeLine(line, quantity, knownTarget) {
          var self = this;

          // shopify:cart:lines-update. The line is identified by its AJAX
          // key, which the Liquid row carries as data-key, and by what still
          // identifies it when that key changes (lineTarget). A debounced
          // edit passes the target it was made on (its row may have been
          // re-rendered since).
          var target = knownTarget || lineTarget(this.querySelector('[data-line="' + line + '"][data-key]'));
          // Never retain a position across the queue: removing an earlier
          // row shifts every following line. A missing key requires a refresh.
          if (!target) return this.refresh();
          this.setBusy(true);
          var ev = events();
          var linesOp = ev
            ? ev.cartLinesUpdate(this, {
                action: quantity === 0 ? "remove" : "update",
                context: "dialog",
                lines: [{ id: target.key, quantity: quantity }],
              })
            : null;

          // The key is settled on the request's turn: an earlier change may
          // have re-keyed or removed this line.
          return changeLineRequest(target, quantity, SECTION_ID)
            .then(function (res) {
              var cart = res.body;
              var gen = res.generation;
              if (res.skipped && !res.failed) {
                // A removal whose line is already gone: nothing to do.
                if (linesOp) linesOp.resolveFromServer();
                self.setBusy(false);
                return;
              }
              if (res.skipped) {
                // The line is gone, or can't be told apart from another line
                // any more: nothing was sent. Show the cart as it stands.
                if (linesOp) linesOp.decline("The cart line changed before the update was sent.");
                return self.refresh();
              }
              if (linesOp) linesOp.settle(res.status, cart);
              // /cart/change.js returns the cart object directly. With
              // the sections parameter it also includes a sections key.
              if (res.ok && cart && cart.sections && cart.sections[SECTION_ID]) {
                var ok = self.renderFromSections(cart.sections, gen);
                if (ok) {
                  syncShippingPills(self, cart);
                  self.updateCartCount(cart, gen);
                  self._broadcastCartState(cart, false, gen);
                  self.setBusy(false);
                  return;
                }
              }
              // Fallback: section markup is missing, so re-render the drawer.
              return self.refresh();
            })
            .catch(function (err) {
              console.error("[Valor cart] change failed:", err);
              if (linesOp) linesOp.fail(err);
              self.setBusy(false);
            });
        }

        /* Read currently-applied discount code titles from the rendered
           DOM. Each active-discount <li> carries the title in its
           data-discount-code attribute. */
        getExistingDiscountsFromDom() {
          var nodes = this.querySelectorAll("[data-active-discounts] [data-discount-code]");
          var codes = [];
          for (var i = 0; i < nodes.length; i++) {
            var c = nodes[i].getAttribute("data-discount-code");
            if (c) codes.push(c);
          }
          return codes;
        }

        applyDiscount() {
          var input = this.querySelector("#ValorCartDiscountInput");
          var msg = this.querySelector("[data-discount-message]");
          if (!input || !input.value.trim()) return;

          var code = input.value.trim();
          var self = this;
          var strAppliedTpl = this.dataset.stringsDiscountApplied || "Discount applied";
          var strInvalid = this.dataset.stringsDiscountInvalid || "This discount code can’t be applied to your cart.";
          msg.textContent = "";
          msg.removeAttribute("data-state");
          this.setBusy(true);

          // Send the existing codes plus the new one as a comma-
          // separated list. Shopify's discount parameter replaces the
          // entire set, so we must include everything we want kept.
          var intent = beginDiscountChange(this.getExistingDiscountsFromDom(), code, false);
          var combined = intent.codes;

          var ev = events();
          var discountOp = ev ? ev.cartDiscountUpdate(this, { codes: combined }) : null;
          var gen = cartGeneration();

          return cartRequest(
            cartUrl("cart/update.js"),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                discount: combined.join(","),
                sections: SECTION_ID,
                sections_url: window.location.pathname,
              }),
            },
            { mutation: true },
          )
            .then(function (res) {
              gen = res.generation;
              return settleCartResponse(discountOp, res);
            })
            .then(function (cart) {
              if (cart && cart.sections && cart.sections[SECTION_ID]) {
                self.renderFromSections(cart.sections, gen);
              }

              syncShippingPills(self, cart);

              if (self._cartHasCode(cart, code) && !self._cartRejectedCode(cart, code)) {
                // For shipping codes the pill + checkout-notice already
                // confirm the apply; skip the inline success message to
                // avoid three near-identical confirmations stacked
                // together. Visible codes still get the message because
                // they have no companion notice.
                var shippingCodes = getShippingDiscountCodes(cart);
                var lcCode = code.toLowerCase();
                var isShippingCode = shippingCodes.some(function (c) {
                  return String(c).toLowerCase() === lcCode;
                });

                if (!isShippingCode) {
                  msg = self.querySelector("[data-discount-message]") || msg;
                  if (msg) {
                    msg.textContent = strAppliedTpl.replace("{{ code }}", code);
                    msg.setAttribute("data-state", "success");
                  }
                }

                input = self.querySelector("#ValorCartDiscountInput") || input;
                if (input) input.value = "";
                self.updateCartCount(cart, gen);
                self._broadcastCartState(cart, false, gen);
              } else {
                msg = self.querySelector("[data-discount-message]") || msg;
                if (msg) {
                  msg.textContent = strInvalid;
                  msg.setAttribute("data-state", "error");
                }
              }
              self.setBusy(false);
            })
            .catch(function (err) {
              console.error("[Valor cart] discount failed:", err);
              if (discountOp && !err.cartResponseHandled) discountOp.fail(err);
              if (msg) {
                msg.textContent = strInvalid;
                msg.setAttribute("data-state", "error");
              }
              self.setBusy(false);
            })
            .then(intent.finish, intent.finish);
        }

        /* Remove a single applied discount code. Sends all the OTHER
           codes as a comma-separated list because Shopify's discount
           parameter replaces the entire set. */
        removeDiscount(codeToRemove) {
          var self = this;
          if (!codeToRemove) return;

          var intent = beginDiscountChange(this.getExistingDiscountsFromDom(), codeToRemove, true);
          var remaining = intent.codes;

          this.setBusy(true);

          var ev = events();
          var discountOp = ev ? ev.cartDiscountUpdate(this, { codes: remaining }) : null;
          var gen = cartGeneration();

          return cartRequest(
            cartUrl("cart/update.js"),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                discount: remaining.join(","),
                sections: SECTION_ID,
                sections_url: window.location.pathname,
              }),
            },
            { mutation: true },
          )
            .then(function (res) {
              gen = res.generation;
              return settleCartResponse(discountOp, res);
            })
            .then(function (cart) {
              if (cart && cart.sections && cart.sections[SECTION_ID]) {
                var ok = self.renderFromSections(cart.sections, gen);
                if (ok) {
                  syncShippingPills(self, cart);
                  self.updateCartCount(cart, gen);
                  self._broadcastCartState(cart, false, gen);
                  self.setBusy(false);
                  return;
                }
              }
              return self.refresh();
            })
            .catch(function (err) {
              console.error("[Valor cart] discount remove failed:", err);
              if (discountOp && !err.cartResponseHandled) discountOp.fail(err);
              self.setBusy(false);
            })
            .then(intent.finish, intent.finish);
        }

        /* Apply pre-rendered section HTML returned by Shopify's bundled
           section rendering (when /cart/add.js is called with a sections
           parameter). Atomic, single-pass update — no extra fetches.

           Returns true if the drawer was successfully replaced, false
           if the response didn't contain usable HTML for our section.
           Callers should fall back to refresh() on false.

           generation: the cart generation the markup belongs to. Markup
           older than what the drawer already shows is not applied (returns
           true: there is nothing to fall back for, the drawer is newer). */
        renderFromSections(sections, generation) {
          if (!sections || typeof sections[SECTION_ID] !== "string") return false;

          var doc = new DOMParser().parseFromString(sections[SECTION_ID], "text/html");
          var newDrawer = doc.querySelector("#" + this.id);
          if (!newDrawer) return false;

          var gen = generationOf(generation);
          if (typeof this._renderedGeneration === "number" && gen < this._renderedGeneration) return true;
          this._renderedGeneration = gen;

          var wasOpen = this.hasAttribute("data-open");
          this.innerHTML = newDrawer.innerHTML;
          // Re-bind drawer-internal controls only — global events (cart
          // icon click, ESC keyup, document-level cart event listener)
          // are still attached to long-lived hosts and don't need to
          // be re-created.
          this._bindDrawerControls();
          if (wasOpen) {
            this.setAttribute("data-open", "");
            this.removeAttribute("hidden");
            document.body.classList.add("valor-cart-drawer-open");
          }
          if (newDrawer.classList.contains("valor-cart-drawer--empty")) {
            this.classList.add("valor-cart-drawer--empty");
          } else {
            this.classList.remove("valor-cart-drawer--empty");
          }

          // Update the cart-item-count attribute on the host element
          // and the header cart count bubble from the freshly rendered
          // drawer. This is atomic — the count value comes from the
          // same response that produced the new HTML, so it can never
          // get out of sync with the drawer contents.
          var newCount = newDrawer.getAttribute("data-cart-item-count");
          if (newCount != null) {
            this.setAttribute("data-cart-item-count", newCount);
            this.updateCartCount({ item_count: parseInt(newCount, 10) || 0 }, gen);
          }

          // The caller is responsible for broadcasting cart state.
          // - valor:cart:added handler doesn't have the cart object yet,
          //   so it triggers _broadcastCartState() (which fetches /cart.js).
          // - changeLine() already has the cart object in hand from
          //   /cart/change.js, so it passes it directly — no extra fetch.
          return true;
        }

        /* Single canonical cart-state broadcast point.

           When a fresh cart object is already in hand — e.g. /cart/change.js
           returns the cart inline — pass it directly and we just dispatch.
           When it isn't (the /cart/add.js response only carries the added
           item), call this with no argument and we fetch /cart.js once
           on behalf of every listener.

           The result reaches product-info, featured-product, etc. via
           the valor:cart:updated event detail, so individual components
           don't need their own /cart.js fetch after a cart mutation. */
        _broadcastCartState(cart, strict, generation) {
          if (cart) {
            publishCartState(cart, generation);
            return Promise.resolve(cart);
          }
          // No cart in hand: read and publish through the coalesced,
          // generation-guarded loop (see publishFromServer).
          var read = publishFromServer();
          if (strict) return read;
          return read.catch(function () {
            /* fail silently; listeners can fetch on next event */
          });
        }

        /* Re-fetch the cart section and replace the drawer's inner markup.
           Also updates the header cart count bubble.

           Used as a fallback by the add-to-cart path (when bundled section
           rendering response is missing) and by the discount-apply flow.
           Per-line quantity changes use the leaner /cart/change.js +
           bundled section rendering path in changeLine(). */
        refresh(options) {
          var self = this;
          var strict = !!(options && options.strict);
          // Queued behind every earlier cart request; tagged with the
          // generation current when it starts. A response older than the
          // markup already shown is not applied.
          var gen;
          return cartSectionRequest(cartUrl("?section_id=" + SECTION_ID))
            .then(function (res) {
              if (!res.ok) throw new Error("Cart drawer section request failed (" + res.status + ")");
              gen = res.generation;
              return res.html;
            })
            .then(function (html) {
              var doc = new DOMParser().parseFromString(html, "text/html");
              var newDrawer = doc.querySelector("#" + self.id);
              if (!newDrawer) throw new Error("Cart drawer markup missing from section response");
              var isStale = typeof self._renderedGeneration === "number" && gen < self._renderedGeneration;
              if (!isStale) {
                self._renderedGeneration = gen;
                // Preserve open state
                var wasOpen = self.hasAttribute("data-open");
                self.innerHTML = newDrawer.innerHTML;
                // Re-bind drawer-internal controls only — global events
                // (cart icon, ESC, valor:cart:added) stay bound on
                // long-lived hosts across re-renders.
                self._bindDrawerControls();
                if (wasOpen) {
                  self.setAttribute("data-open", "");
                  self.removeAttribute("hidden");
                  document.body.classList.add("valor-cart-drawer-open");
                }
                // Toggle empty class
                if (newDrawer.classList.contains("valor-cart-drawer--empty")) {
                  self.classList.add("valor-cart-drawer--empty");
                } else {
                  self.classList.remove("valor-cart-drawer--empty");
                }
                // Keep the host's item count in step with the new markup,
                // as renderFromSections() does.
                var refreshedCount = newDrawer.getAttribute("data-cart-item-count");
                if (refreshedCount != null) self.setAttribute("data-cart-item-count", refreshedCount);
              }
              // Read and publish the cart through the canonical publisher,
              // which also updates the bubble (generation-guarded).
              return self._broadcastCartState(undefined, strict);
            })
            .then(function (cart) {
              self.setBusy(false);
              return cart;
            })
            .catch(function (err) {
              // Never leave the items list flagged busy; callers (the
              // updateCart action, the bfcache restore) handle the error.
              self.setBusy(false);
              throw err;
            });
        }

        /* Check if the cart contains the given code as an applicable
           customer-applied discount. Uses the same union (cart-level
           + line-level) as getApplicableDiscountCodes() so codes
           targeting specific products are recognized. */
        /* True when the cart kept the code but reports it as not
           applicable (unknown, expired, or its conditions aren't met). */
        _cartRejectedCode(cart, code) {
          if (!cart || !code || !Array.isArray(cart.discount_codes)) return false;
          var needle = String(code).trim().toLowerCase();
          return cart.discount_codes.some(function (entry) {
            return entry && entry.applicable === false && String(entry.code).trim().toLowerCase() === needle;
          });
        }

        _cartHasCode(cart, code) {
          if (!cart || !code) return false;
          var needle = String(code).trim().toLowerCase();
          if (!needle) return false;
          var titles = getApplicableDiscountCodes(cart);
          for (var i = 0; i < titles.length; i++) {
            if (String(titles[i]).toLowerCase() === needle) return true;
          }
          return false;
        }

        /* Persist the cart note. Fire-and-forget — no section render or
           broadcast needed because no visible totals or counts depend on the
           note value. Mirrors the cart page, which also saves the note on
           change rather than only on checkout. */
        updateNote(note) {
          var ev = events();
          var noteOp = ev ? ev.cartNoteUpdate(this, { context: "dialog", note: note }) : null;
          cartRequest(
            cartUrl("cart/update.js"),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ note: note }),
            },
            { mutation: true },
          )
            .then(function (res) {
              settleCartResponse(noteOp, res);
            })
            .catch(function (err) {
              console.error("[Valor cart] note update failed:", err);
              if (noteOp && !err.cartResponseHandled) noteOp.fail(err);
            });
        }

        updateCartCount(cart, generation) {
          updateCartBubble(cart, generation);
        }
      },
    );
  }

  /* ----- Product form interception -----
     Catch any submit on a form whose action posts to /cart/add and
     route it through the AJAX cart-add endpoint with bundled section
     rendering. Shopify returns the freshly rendered drawer HTML in
     the same response, which the cart drawer applies atomically.

     For known errors (out of stock, sold out, etc.) we show the
     server-supplied message inline below the buy button rather than
     falling back to the native form submit — that would dump the
     customer on the error page and lose context. Network errors
     still fall back, since the AJAX path can't reach the server. */
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form.matches || !form.matches('form[action*="/cart/add"]')) return;
    if (form.hasAttribute("data-no-ajax")) return;

    event.preventDefault();

    var submitBtn = event.submitter || form.querySelector('[type="submit"]');
    var stickyAtc = submitBtn && submitBtn.closest ? submitBtn.closest("[data-sticky-atc]") : null;
    var stickyErrorEl = stickyAtc ? stickyAtc.querySelector("[data-sticky-cart-error]") : null;

    // Clear any previous error from a prior submit
    var errorEl = form.querySelector("[data-cart-error]");
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.hidden = true;
    }
    if (stickyErrorEl) {
      stickyErrorEl.textContent = "";
      stickyErrorEl.hidden = true;
    }

    var formData = new FormData(form);

    // shopify:cart:lines-update (action "add"), dispatched from the form so
    // it bubbles through the product element the buyer is using.
    var ev = events();
    var addVariantId = formData.get("id");
    var addQuantity = parseInt(formData.get("quantity"), 10);
    var linesOp = ev
      ? ev.cartLinesUpdate(form, {
          action: "add",
          context: "product",
          lines: addVariantId
            ? [{ merchandiseId: String(addVariantId), quantity: addQuantity > 0 ? addQuantity : 1 }]
            : [],
        })
      : null;

    // Bundled section rendering: ask Shopify to include the rendered
    // cart-drawer HTML in the response so we don't need a follow-up fetch.
    formData.append("sections", SECTION_ID);
    formData.append("sections_url", window.location.pathname);

    if (submitBtn) submitBtn.setAttribute("aria-busy", "true");

    cartRequest(
      cartUrl("cart/add.js"),
      {
        method: "POST",
        headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: formData,
      },
      { mutation: true },
    )
      .then(function (res) {
        if (submitBtn) submitBtn.removeAttribute("aria-busy");
        if (!res.ok) {
          // Shopify returns { status, message, description } on error.
          var msg = (res.body && (res.body.description || res.body.message)) || "Could not add to cart";
          var declined = isDeclineStatus(res.status);
          if (declined) {
            // The cart declined the add (sold out, quantity rule, …). It
            // may still have changed: "Only 50 items were added to your
            // cart due to availability" is a 422 after a PARTIAL add. Start
            // a new cart generation (refreshCartUI does) and re-sync the
            // drawer, the header count and product-info without opening
            // the drawer.
            refreshCartUI().catch(function (err) {
              console.error("[Valor cart] refresh after declined add failed:", err);
            });
          }
          // Declined → resolve the event with userErrors (not a
          // shopify:cart:error); server/throttling failure → reject + error.
          if (linesOp) linesOp.settle(res.status, res.body);
          document.dispatchEvent(
            new CustomEvent("valor:product-form:error", {
              detail: { form: form, body: res.body },
            }),
          );
          if (errorEl) {
            errorEl.textContent = msg;
            errorEl.hidden = false;
          }
          if (stickyErrorEl) {
            stickyErrorEl.textContent = msg;
            stickyErrorEl.hidden = false;
          }
          if (!errorEl && !stickyErrorEl) {
            // No inline target — log only. The customer stays on the
            // page with no visible change, which is unfortunate but
            // better than reloading into Shopify's default error page.
            console.error("[Valor cart] add failed:", msg);
          }
          return;
        }
        // (The new cart generation was started inside the queue when the
        // response arrived; see cartRequest.)
        document.dispatchEvent(new CustomEvent("valor:cart:added", { detail: res.body }));
        // /cart/add.js returns the added item, not the cart; resolve from
        // /cart.js (shared with the drawer's cart-state broadcast above,
        // which belongs to the same cart generation).
        if (linesOp) linesOp.resolveFromServer();
        document.dispatchEvent(
          new CustomEvent("valor:product-form:success", {
            detail: { form: form, body: res.body },
          }),
        );

        // If the cart drawer isn't on the page (merchant turned off "Enable
        // cart drawer"), there's no panel to slide open — navigate to the cart
        // page after the AJAX add, the same way Dawn/Horizon behave in "page"
        // cart mode. The AJAX add already ran, so inline sold-out errors and
        // the cart-count update still work; only the post-add destination
        // differs. When the drawer IS present its valor:cart:added listener
        // opens it and this branch is skipped.
        if (!document.querySelector("valor-cart-drawer")) {
          window.location = cartUrl("cart");
        }
      })
      .catch(function (err) {
        if (submitBtn) submitBtn.removeAttribute("aria-busy");
        console.error("[Valor cart] add network error:", err);
        if (linesOp) linesOp.fail(err);
        // Network failures degrade gracefully to a normal form submit
        // so the customer can still complete the purchase even if the
        // AJAX path is broken (proxy issue, lost connection, etc.).
        form.setAttribute("data-no-ajax", "");
        form.submit();
      });
  });

  /* ----- Back / forward cache restore -----
     A page restored with the Back button replays a frozen DOM, so the
     drawer, the header count and the cart page would keep showing the
     cart as it was before the buyer navigated away. Two channels, as in
     Horizon 4.2:
       - event.persisted: a true bfcache restore (Safari, Firefox, Chrome
         when the page is eligible);
       - navigation type "back_forward": Chrome rebuilt the document from
         the HTTP disk cache instead (persisted is false, markup is stale).
     Ordinary page views match neither, so no extra request is made. */
  window.addEventListener("pageshow", function (event) {
    var navigationType;
    try {
      var entry =
        window.performance && typeof window.performance.getEntriesByType === "function"
          ? window.performance.getEntriesByType("navigation")[0]
          : null;
      navigationType = entry && entry.type;
    } catch (e) {
      navigationType = undefined;
    }
    if (!event.persisted && navigationType !== "back_forward") return;
    refreshCartUI().catch(function (err) {
      console.error("[Valor cart] back/forward refresh failed:", err);
    });
  });

  window.ValorCartDrawer = {
    _initialized: true,
    refreshCartUI: refreshCartUI,
    updateCartBubble: updateCartBubble,
    publishCartState: publishCartState,
    cartRequest: cartRequest,
    lineTarget: lineTarget,
    changeLineRequest: changeLineRequest,
    beginDiscountChange: beginDiscountChange,
    cartSectionRequest: cartSectionRequest,
    whenCartIdle: whenCartIdle,
  };
})();
