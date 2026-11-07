const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// All storefront requests stay inside this fixture. No store credentials,
// customer data, checkout or Shopify mutation endpoints are used.
const root = path.resolve(__dirname, "..");
let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  // WebKit on Windows can stall in close() after every test has passed;
  // npm test runs with --test-force-exit, so a stalled close can't hold the run.
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// As Shopify renders `item.properties | json | escape` (checked on a live
// store): an array of [name, value] pairs whose strings Liquid has already
// HTML-escaped, then escaped again for the attribute.
const liquidProperties = (properties) =>
  escapeHtml(JSON.stringify(Object.entries(properties || {}).map(([name, value]) => [escapeHtml(name), escapeHtml(value)])));

function markup(cart, surface) {
  const rows = cart.items
    .map(
      (item, i) => `
    <li data-cart-item data-line="${i + 1}" data-key="${item.key}" data-variant-id="${item.variant_id}"
      data-selling-plan-id="" data-properties="${liquidProperties(item.properties)}">
      <input data-quantity-field data-qty-input data-line="${i + 1}" value="${item.quantity}">
      <button data-line-remove data-line="${i + 1}">Remove ${item.key}</button>
      <div data-line-error data-line="${i + 1}"><small></small></div>
    </li>`,
    )
    .join("");
  const codes = cart.discount_codes
    .filter((d) => d.applicable !== false)
    .map(
      (d) => `
    <li data-discount-code="${d.code}"><button data-discount-remove data-discount-code="${d.code}">Remove</button></li>`,
    )
    .join("");
  // Mirrors the real forms: the cart page wraps its lines in form#cart
  // (whose only submit is Check out), the drawer's checkout form sits
  // after the lines.
  const checkout = `<button type="submit" name="checkout" id="${surface}-checkout">Check out</button>`;
  const items = `<valor-cart-items><ul>${rows}</ul></valor-cart-items>`;
  const body =
    surface === "page"
      ? `<form id="cart" action="/cart" method="post">${items}${checkout}</form>`
      : `${items}<form id="ValorCartDrawerForm" action="/cart" method="post">${checkout}</form>`;
  const notice = surface === "page" ? "<div data-cart-notice><small></small></div>" : "";
  return `<valor-cart-${surface} id="${surface === "drawer" ? "ValorCartDrawer" : "CartPage"}"
      data-section-id="main-cart" data-cart-item-count="${cart.item_count}">
    ${notice}${body}
    <div data-discount-form><input id="ValorCartDiscountInput" data-discount-input>
      <button data-discount-apply>Apply</button><p data-discount-message></p></div>
    <ul data-active-discounts>${codes}</ul><p data-cart-live-region></p>
  </valor-cart-${surface}>`;
}

async function fixture(t, options = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = {
    // An item is a key (all lines share variant 1) or { key, variant, properties }.
    items: (options.items || ["A", "B", "C"]).map((item) => {
      const { key, variant = 1, properties = {} } = typeof item === "string" ? { key: item } : item;
      return { key, id: variant, variant_id: variant, properties, selling_plan_allocation: null, quantity: 1 };
    }),
    codes: options.codes || [],
    requests: [],
    missingSections: false,
    hook: null,
  };
  function snapshot() {
    return {
      items: structuredClone(state.items),
      item_count: state.items.reduce((sum, item) => sum + item.quantity, 0),
      currency: "EUR",
      total_price: 1000,
      items_subtotal_price: 1000,
      discount_codes: state.codes.map((code) => ({ code, applicable: code !== "INVALID" })),
    };
  }
  function withSections() {
    const cart = snapshot();
    if (!state.missingSections)
      cart.sections = { "cart-drawer": markup(cart, "drawer"), "main-cart": markup(cart, "page") };
    return cart;
  }
  await page.route("http://valor.test/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/standard-events.js" && process.env.VALOR_STANDARD_EVENTS) {
      return route.fulfill({
        contentType: "text/javascript",
        body: fs.readFileSync(process.env.VALOR_STANDARD_EVENTS, "utf8"),
      });
    }
    if (url.pathname.startsWith("/assets/")) {
      await route.fulfill({
        contentType: "text/javascript",
        body: fs.readFileSync(path.join(root, url.pathname), "utf8"),
      });
      return;
    }
    if (request.isNavigationRequest()) {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body>
        <a class="valor-header__cart"><span class="valor-cart-count">${snapshot().item_count}</span>
          <span data-cart-count-text data-template="Cart (%count%)"></span></a>
        <output id="in-cart"></output>
        ${options.drawer === false ? "" : markup(snapshot(), "drawer")}
        ${options.page === false ? "" : markup(snapshot(), "page")}
        <script>window.Shopify = { routes: { root: '/' } };
          window.submits = 0; document.addEventListener('submit', function(e) {
            if (!e.defaultPrevented) { window.submits++; e.preventDefault(); }
          });
          window.broadcasts = []; document.addEventListener('valor:cart:updated', function(e) {
            broadcasts.push(e.detail.item_count); document.querySelector('#in-cart').textContent = e.detail.item_count;
          });</script>
        ${process.env.VALOR_STANDARD_EVENTS ? '<script type="module">import * as SE from "/standard-events.js"; window.StandardEvents=SE;</script>' : ""}
        <script src="/assets/storefront-events.js" defer></script>
        ${options.drawerScript === false ? "" : '<script src="/assets/cart-drawer.js" defer></script>'}
        <script src="/assets/cart-page.js" defer></script>
      </body></html>`,
      });
      return;
    }
    const entry = { path: url.pathname, section: url.searchParams.get("section_id"), method: request.method() };
    state.requests.push(entry);
    let body;
    if (request.method() === "POST") {
      entry.body = request.postDataJSON();
      if (url.pathname === "/cart/change.js") {
        const item = entry.body.id
          ? state.items.find((item) => item.key === entry.body.id)
          : state.items[entry.body.line - 1];
        if (!item) {
          await route.fulfill({ status: 422, json: { message: "Unknown line" } });
          return;
        }
        item.quantity = entry.body.quantity;
        state.items = state.items.filter((item) => item.quantity > 0);
      }
      if (Object.hasOwn(entry.body, "discount")) state.codes = entry.body.discount.split(",").filter(Boolean);
      body = withSections();
    } else {
      body = entry.section ? markup(snapshot(), entry.section === "cart-drawer" ? "drawer" : "page") : snapshot();
    }
    const response = { status: 200, body };
    if (state.hook) await state.hook(entry, response);
    await route.fulfill(
      typeof response.body === "string"
        ? { status: response.status, contentType: "text/html", body: response.body }
        : { status: response.status, json: response.body },
    );
  });
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], "no unhandled browser errors");
  });
  if (options.hook) state.hook = options.hook;
  if (options.init) await page.addInitScript(options.init);
  await page.goto("http://valor.test/cart");
  if (!options.hook) await page.waitForLoadState("networkidle");
  return { page, state, snapshot, withSections };
}

for (const surface of ["drawer", "page"]) {
  test(
    `queued ${surface} removals keep A/B/C identity, including duplicate variants`,
    { timeout: 15000 },
    async (t) => {
      const held = gate();
      const f = await fixture(t, { hook: (entry) => (entry.path === "/cart.js" ? held.promise : undefined) });
      await f.page.evaluate((surface) => {
        const host = document.querySelector(`valor-cart-${surface}`);
        host.querySelector('[data-line-remove][data-line="1"]').click();
        host.querySelector('[data-line-remove][data-line="2"]').click();
      }, surface);
      held.release();
      await f.page.waitForFunction(() => document.querySelector(".valor-cart-count").textContent === "1");
      assert.deepEqual(
        f.state.items.map((item) => item.key),
        ["C"],
      );
      assert.deepEqual(
        f.state.requests.filter((r) => r.method === "POST").map((r) => r.body.id),
        ["A", "B"],
      );
    },
  );
}

for (const surfaces of [
  ["drawer", "drawer"],
  ["page", "page"],
  ["drawer", "page"],
  ["page", "drawer"],
]) {
  test(`queued discount removals preserve both intents: ${surfaces.join(" then ")}`, { timeout: 15000 }, async (t) => {
    const held = gate();
    const f = await fixture(t, {
      codes: ["SAVE10", "SAVE20"],
      hook: (entry) => (entry.path === "/cart.js" ? held.promise : undefined),
    });
    await f.page.evaluate((surfaces) => {
      window.operations = Promise.all(
        surfaces.map((surface, i) =>
          document.querySelector(`valor-cart-${surface}`).removeDiscount(i ? "SAVE20" : "SAVE10"),
        ),
      );
    }, surfaces);
    held.release();
    await f.page.evaluate(() => window.operations);
    assert.deepEqual(f.state.codes, []);
    assert.deepEqual(
      f.state.requests.filter((r) => r.method === "POST").map((r) => r.body.discount),
      ["SAVE20", ""],
    );
  });
}

test(
  "queued remove and apply preserve the intended set and release it after completion",
  { timeout: 15000 },
  async (t) => {
    const held = gate();
    const f = await fixture(t, {
      codes: ["SAVE10", "SAVE20"],
      hook: (entry) => (entry.path === "/cart.js" ? held.promise : undefined),
    });
    await f.page.evaluate(() => {
      const drawer = document.querySelector("valor-cart-drawer");
      const page = document.querySelector("valor-cart-page");
      const first = drawer.removeDiscount("SAVE10");
      window.operations = Promise.all([
        first,
        page.applyDiscount("SAVE30", page.querySelector("[data-discount-form]")),
      ]);
    });
    held.release();
    await f.page.evaluate(() => window.operations);
    assert.deepEqual(f.state.codes, ["SAVE20", "SAVE30"]);
    await f.page.evaluate(() => document.querySelector("valor-cart-page").removeDiscount("save30"));
    assert.deepEqual(f.state.codes, ["SAVE20"]);
  },
);

test("fallback preserves a synchronous section start generation", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { drawer: false, drawerScript: false, items: ["A"] });
  const held = gate();
  const started = gate();
  let sections = 0;
  f.state.missingSections = true;
  f.state.hook = (entry) => {
    if (entry.section && ++sections === 1) {
      started.release();
      return held.promise;
    }
  };
  await f.page.evaluate(() => {
    window.oldRefresh = document.querySelector("valor-cart-page").refreshSection({ strict: true });
  });
  await started.promise;
  await f.page.evaluate(() => {
    window.change = document.querySelector("valor-cart-page").changeLine(1, 2);
  });
  await f.page.waitForFunction(() => document.querySelector(".valor-cart-count").textContent === "2");
  held.release();
  await f.page.evaluate(() => Promise.all([window.oldRefresh, window.change]));
  assert.equal(sections, 2);
  assert.equal(await f.page.locator("[data-quantity-field]").inputValue(), "2");
});

test("quantity mutations and strict refresh share one queue", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { items: ["A"] });
  const held = gate();
  const started = gate();
  f.state.hook = (entry) => {
    if (entry.body?.quantity === 2) {
      started.release();
      return held.promise;
    }
  };
  await f.page.evaluate(() => {
    const drawer = document.querySelector("valor-cart-drawer");
    window.operations = Promise.all([
      drawer.changeLine(1, 2),
      drawer.changeLine(1, 3),
      ValorCartDrawer.refreshCartUI({ strict: true }),
    ]);
  });
  await started.promise;
  assert.equal(f.state.requests.filter((r) => r.method === "POST").length, 1);
  held.release();
  await f.page.evaluate(() => window.operations);
  for (const surface of ["drawer", "page"])
    assert.equal(await f.page.locator(`valor-cart-${surface} [data-quantity-field]`).inputValue(), "3");
  assert.equal(await f.page.locator(".valor-cart-count").textContent(), "3");
  assert.equal(await f.page.locator("#in-cart").textContent(), "3");
});

for (const failure of ["drawer-http", "drawer-markup", "page-http", "page-markup", "cart-http"]) {
  test(`strict refresh rejects ${failure}`, { timeout: 15000 }, async (t) => {
    const f = await fixture(t);
    f.state.hook = (entry, response) => {
      const target = failure.startsWith("drawer")
        ? entry.section === "cart-drawer"
        : failure.startsWith("page")
          ? entry.section === "main-cart"
          : entry.path === "/cart.js";
      if (target) {
        response.body = "<p>Service unavailable</p>";
        response.status = failure.endsWith("http") ? 500 : 200;
      }
    };
    assert.equal(
      await f.page.evaluate(() =>
        ValorCartDrawer.refreshCartUI({ strict: true }).then(
          () => "handled",
          () => "failed",
        ),
      ),
      "failed",
    );
  });
}

test("a note completing during a cart read still produces the current broadcast", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { items: ["A"], page: false });
  const held = gate();
  const started = gate();
  let reads = 0;
  f.state.hook = (entry) => {
    if (entry.path === "/cart.js" && ++reads === 1) {
      started.release();
      return held.promise;
    }
  };
  await f.page.evaluate(() => {
    window.published = document.querySelector("valor-cart-drawer")._broadcastCartState(undefined, true);
  });
  await started.promise;
  // Model a completed external note write: it invalidates the pending read
  // without publishing a snapshot of its own.
  f.state.items[0].quantity = 2;
  await f.page.evaluate(() => ValorEvents.cartMutated());
  held.release();
  await f.page.evaluate(() => window.published);
  assert.equal(reads, 2);
  assert.equal(await f.page.locator("#in-cart").textContent(), "2");
});

test("broadcasts never regress after more than four invalidated reads", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { items: ["A"], page: false });
  const holds = Array.from({ length: 5 }, () => ({ started: gate(), held: gate() }));
  let reads = 0;
  f.state.hook = (entry) => {
    if (entry.path === "/cart.js") {
      const hold = holds[reads++];
      if (hold) {
        hold.started.release();
        return hold.held.promise;
      }
    }
  };
  await f.page.evaluate(() => {
    window.published = document.querySelector("valor-cart-drawer")._broadcastCartState(undefined, true);
  });
  for (let i = 0; i < holds.length; i++) {
    await holds[i].started.promise;
    f.state.items[0].quantity = i + 2;
    await f.page.evaluate((cart) => ValorCartDrawer.publishCartState(cart, ValorEvents.cartMutated()), f.snapshot());
    holds[i].held.release();
  }
  await f.page.evaluate(() => window.published);
  const broadcasts = await f.page.evaluate(() => window.broadcasts);
  assert.deepEqual(
    broadcasts,
    [...broadcasts].sort((a, b) => a - b),
  );
  assert.equal(broadcasts.at(-1), 6);
  assert.equal(reads, 6);
});

for (const drawer of [true, false]) {
  test(
    `overlapping external refreshes finish with the newest cart, drawer=${drawer}`,
    { timeout: 15000 },
    async (t) => {
      const f = await fixture(t, { items: ["A"], drawer });
      const held = gate();
      const started = gate();
      let reads = 0;
      f.state.hook = (entry) => {
        if ((drawer ? entry.section === "cart-drawer" : entry.path === "/cart.js") && ++reads === 1) {
          started.release();
          return held.promise;
        }
      };
      await f.page.evaluate(() => {
        window.oldRefresh = ValorCartDrawer.refreshCartUI({ strict: true });
      });
      await started.promise;
      f.state.items[0].quantity = 3;
      await f.page.evaluate(() => {
        window.newRefresh = ValorCartDrawer.refreshCartUI({ strict: true });
      });
      held.release();
      await f.page.evaluate(() => Promise.all([window.oldRefresh, window.newRefresh]));
      for (const surface of drawer ? ["drawer", "page"] : ["page"]) {
        assert.equal(await f.page.locator(`valor-cart-${surface} [data-quantity-field]`).inputValue(), "3");
      }
      assert.equal(await f.page.locator(".valor-cart-count").textContent(), "3");
    },
  );
}

test(
  "an own page broadcast during refresh does not suppress the following drawer change",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, { items: ["A"] });
    const held = gate();
    const started = gate();
    let sections = 0;
    f.state.hook = (entry) => {
      if (entry.section === "main-cart" && ++sections === 1) {
        started.release();
        return held.promise;
      }
    };
    await f.page.evaluate(() => {
      window.refresh = document.querySelector("valor-cart-page").refreshSection({ strict: true });
    });
    await started.promise;
    await f.page.evaluate(() => {
      window.change = document.querySelector("valor-cart-page").changeLine(1, 2);
    });
    held.release();
    await f.page.evaluate(() => Promise.all([window.refresh, window.change]));
    await f.page.evaluate(() => document.querySelector("valor-cart-drawer").changeLine(1, 4));
    await f.page.waitForFunction(() => document.querySelector("valor-cart-page [data-quantity-field]").value === "4");
    assert.equal(await f.page.locator(".valor-cart-count").textContent(), "4");
  },
);

test("a failed discount request releases pending intent for the next action", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { codes: ["SAVE10", "SAVE20"] });
  let failed = false;
  f.state.hook = (entry, response) => {
    if (!failed && entry.method === "POST") {
      failed = true;
      f.state.codes = ["SAVE10", "SAVE20"];
      response.status = 500;
      response.body = { message: "Temporarily unavailable" };
    }
  };
  await f.page.evaluate(() => document.querySelector("valor-cart-drawer").removeDiscount("SAVE10"));
  await f.page.evaluate(() => document.querySelector("valor-cart-page").removeDiscount("SAVE20"));
  assert.deepEqual(f.state.codes, ["SAVE10"]);
});

for (const operation of ["discount", "note"]) {
  test(`a failed page ${operation} response must not be published as a cart`, { timeout: 15000 }, async (t) => {
    const f = await fixture(t, { codes: ["SAVE10"], items: ["A"] });
    f.state.hook = (entry, response) => {
      if (entry.method === "POST") {
        response.status = 500;
        response.body = { message: "Service unavailable" };
      }
    };
    await f.page.evaluate((operation) => {
      const host = document.querySelector("valor-cart-page");
      return operation === "discount" ? host.removeDiscount("SAVE10") : host.updateNote("Note");
    }, operation);
    await f.page.waitForLoadState("networkidle");
    assert.equal(await f.page.locator(".valor-cart-count").count(), 1);
    assert.equal(await f.page.locator(".valor-cart-count").textContent(), "1");
    assert.equal(await f.page.evaluate(() => broadcasts.every((count) => typeof count === "number")), true);
  });
}

test("Enter in a cart page quantity field saves the line and does not start checkout", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { drawer: false });
  const field = 'valor-cart-page [data-quantity-field][data-line="1"]';
  await f.page.fill(field, "3");
  await f.page.press(field, "Enter");
  await f.page.waitForFunction(() => document.querySelector(".valor-cart-count").textContent === "5");
  await f.page.waitForTimeout(300);
  assert.equal(await f.page.evaluate(() => window.submits), 0);
  assert.deepEqual(
    f.state.requests.filter((r) => r.method === "POST").map((r) => [r.body.id, r.body.quantity]),
    [["A", 3]],
  );
});

for (const surface of ["drawer", "page"]) {
  test(`${surface} checkout waits for a pending quantity save, then submits once`, { timeout: 15000 }, async (t) => {
    const held = gate();
    const f = await fixture(t, {
      [surface === "drawer" ? "page" : "drawer"]: false,
      hook: (entry) => (entry.path === "/cart/change.js" ? held.promise : undefined),
    });
    const field = `valor-cart-${surface} [data-quantity-field][data-line="1"]`;
    await f.page.fill(field, "2");
    await f.page.click(`#${surface}-checkout`);
    // A second tap while waiting must not post twice (the held button is aria-disabled).
    await f.page.click(`#${surface}-checkout`, { force: true });
    await f.page.waitForTimeout(700);
    assert.equal(await f.page.evaluate(() => window.submits), 0, "no checkout while the save is pending");
    held.release();
    await f.page.waitForFunction(() => window.submits === 1);
    await f.page.waitForTimeout(300);
    assert.equal(await f.page.evaluate(() => window.submits), 1, "exactly one checkout");
    assert.deepEqual(
      f.state.requests.filter((r) => r.method === "POST").map((r) => [r.body.id, r.body.quantity]),
      [["A", 2]],
    );
  });
}

test("a rejected quantity keeps the buyer on the cart page", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { drawer: false });
  f.state.hook = (entry, response) => {
    if (entry.path === "/cart/change.js") {
      response.status = 422;
      response.body = { status: 422, message: "You can only add 1 of this item to your cart." };
    }
  };
  const field = 'valor-cart-page [data-quantity-field][data-line="1"]';
  await f.page.fill(field, "9");
  await f.page.click("#page-checkout");
  await f.page.waitForLoadState("networkidle");
  await f.page.waitForTimeout(300);
  assert.equal(await f.page.evaluate(() => window.submits), 0);
  assert.equal(await f.page.locator("#page-checkout").getAttribute("aria-disabled"), null);
});

test("checkout goes through once after the wait cap when a quantity save never settles", { timeout: 40000 }, async (t) => {
  const never = new Promise(() => {});
  const f = await fixture(t, {
    drawer: false,
    hook: (entry) => (entry.path === "/cart/change.js" ? never : undefined),
  });
  const field = 'valor-cart-page [data-quantity-field][data-line="1"]';
  await f.page.fill(field, "2");
  await f.page.click("#page-checkout");
  await f.page.waitForTimeout(2000);
  assert.equal(await f.page.evaluate(() => window.submits), 0, "held while the save is pending");
  await f.page.waitForFunction(() => window.submits === 1, null, { timeout: 20000 });
  await f.page.waitForTimeout(500);
  assert.equal(await f.page.evaluate(() => window.submits), 1, "exactly one checkout after the cap");
  assert.equal(await f.page.locator("#page-checkout").getAttribute("aria-disabled"), null);
});

test("a rejection whose body arrives after the checkout tap keeps the buyer on the cart", { timeout: 20000 }, async (t) => {
  // Headers (422) arrive first; the JSON body is released only after Check out.
  const init = () => {
    const realFetch = window.fetch;
    window.fetch = function (url, options) {
      // Only the first save is delayed.
      if (!String(url).includes("/cart/change.js") || window.__gated) return realFetch(url, options);
      window.__gated = true;
      return realFetch(url, options).then(async (response) => {
        const text = await response.text();
        let release;
        const gateBody = new Promise((resolve) => (release = resolve));
        window.__releaseBody = release;
        window.__headersArrived = true;
        const stream = new ReadableStream({
          async start(controller) {
            await gateBody;
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
          },
        });
        return new Response(stream, { status: response.status, headers: { "Content-Type": "application/json" } });
      });
    };
  };
  const f = await fixture(t, { drawer: false, init });
  f.state.hook = (entry, response) => {
    if (entry.path === "/cart/change.js") {
      response.status = 422;
      response.body = { status: 422, message: "You can only add 1 of this item to your cart." };
    }
  };
  const field = 'valor-cart-page [data-quantity-field][data-line="1"]';
  await f.page.fill(field, "9");
  // Commit the edit with a blur (one save), so the later Check out tap does
  // not send a second save that would hide the race.
  await f.page.$eval(field, (el) => el.blur());
  await f.page.waitForFunction(() => window.__headersArrived === true);
  await f.page.click("#page-checkout");
  await f.page.waitForTimeout(200);
  await f.page.evaluate(() => window.__releaseBody());
  await f.page.waitForTimeout(800);
  assert.equal(await f.page.evaluate(() => window.submits), 0);
  assert.equal(await f.page.locator("#page-checkout").getAttribute("aria-disabled"), null);
});

test("drawer keeps a pending quantity edit when an earlier save re-renders the drawer", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { page: false });
  const field = (line) => `valor-cart-drawer [data-quantity-field][data-line="${line}"]`;
  await f.page.fill(field(1), "2"); // A, saved after the 500 ms debounce
  await f.page.waitForTimeout(200);
  await f.page.fill(field(2), "4"); // B, still debouncing when A's response re-renders the drawer
  await f.page.waitForFunction(() => document.querySelector(".valor-cart-count").textContent === "7", null, { timeout: 5000 });
  assert.deepEqual(
    f.state.requests.filter((r) => r.method === "POST").map((r) => [r.body.id, r.body.quantity]),
    [
      ["A", 2],
      ["B", 4],
    ],
  );
});

/* Shopify can give lines new keys when the cart changes (a discount that
   starts or stops applying re-keys the lines it touches). The first
   /cart/change.js renames lines as given before its response is built. */
function rekeyOnFirstChange(f, renames) {
  let done = false;
  return (entry, response) => {
    if (done || entry.path !== "/cart/change.js" || entry.method !== "POST" || response.status !== 200) return false;
    done = true;
    for (const [from, to] of Object.entries(renames)) f.state.items.find((item) => item.key === from).key = to;
    response.body = f.withSections();
    return true;
  };
}

const posts = (f) =>
  f.state.requests.filter((r) => r.method === "POST").map((r) => [r.body.id ?? `line ${r.body.line}`, r.body.quantity]);

test("a pending drawer edit follows its line to the new key after an earlier change re-keys it", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, {
    page: false,
    items: [
      { key: "A", variant: 1 },
      { key: "B", variant: 2 },
      { key: "C", variant: 3 },
    ],
  });
  f.state.hook = rekeyOnFirstChange(f, { B: "B2" });
  const field = (line) => `valor-cart-drawer [data-quantity-field][data-line="${line}"]`;
  await f.page.fill(field(1), "2"); // A, saved after the 500 ms debounce
  await f.page.waitForTimeout(200);
  await f.page.fill(field(2), "4"); // B, still debouncing when A's response re-keys it
  await f.page.waitForFunction(() => document.querySelector(".valor-cart-count").textContent === "7", null, { timeout: 5000 });
  assert.deepEqual(posts(f), [
    ["A", 2],
    ["B2", 4],
  ]);
});

test("a pending drawer edit tells re-keyed lines of one variant apart by their properties", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, {
    page: false,
    items: [
      { key: "A", variant: 1 },
      { key: "B", variant: 2, properties: { Engraving: `Left "A" & <B> 'C'` } },
      { key: "C", variant: 2, properties: { Engraving: `Right "A" & <B> 'C'` } },
    ],
  });
  f.state.hook = rekeyOnFirstChange(f, { B: "B2", C: "C2" });
  const field = (line) => `valor-cart-drawer [data-quantity-field][data-line="${line}"]`;
  await f.page.fill(field(1), "2");
  await f.page.waitForTimeout(200);
  await f.page.fill(field(2), "4");
  await f.page.waitForFunction(() => document.querySelector(".valor-cart-count").textContent === "7", null, { timeout: 5000 });
  assert.deepEqual(posts(f), [
    ["A", 2],
    ["B2", 4],
  ]);
});

test("a queued cart page change follows its line to the new key", { timeout: 15000 }, async (t) => {
  const held = gate();
  const f = await fixture(t, {
    drawer: false,
    items: [
      { key: "A", variant: 1 },
      { key: "B", variant: 2 },
      { key: "C", variant: 3 },
    ],
  });
  const rekey = rekeyOnFirstChange(f, { B: "B2" });
  f.state.hook = (entry, response) => (rekey(entry, response) ? held.promise : undefined);
  const field = (line) => `valor-cart-page [data-quantity-field][data-line="${line}"]`;
  await f.page.fill(field(1), "2");
  await f.page.$eval(field(1), (el) => el.blur());
  await f.page.waitForFunction(() => document.querySelector('valor-cart-page [data-line="1"]'));
  await f.page.fill(field(2), "4");
  await f.page.$eval(field(2), (el) => el.blur()); // queued behind A, which re-keys B
  held.release();
  await f.page.waitForFunction(() => document.querySelector(".valor-cart-count").textContent === "7", null, { timeout: 5000 });
  assert.deepEqual(posts(f), [
    ["A", 2],
    ["B2", 4],
  ]);
});

test("an edit whose line cannot be told apart after re-keying is not sent to a guessed line", { timeout: 15000 }, async (t) => {
  const held = gate();
  const f = await fixture(t, {
    drawer: false,
    items: [
      { key: "A", variant: 1 },
      { key: "B", variant: 2 },
      { key: "C", variant: 2 },
    ],
  });
  const rekey = rekeyOnFirstChange(f, { B: "B2", C: "C2" });
  f.state.hook = (entry, response) => (rekey(entry, response) ? held.promise : undefined);
  const field = (line) => `valor-cart-page [data-quantity-field][data-line="${line}"]`;
  await f.page.fill(field(1), "2");
  await f.page.$eval(field(1), (el) => el.blur());
  await f.page.fill(field(2), "4");
  await f.page.$eval(field(2), (el) => el.blur());
  held.release();
  // The page re-renders from the cart as it stands: B2 and C2 keep 1 each.
  await f.page.waitForFunction(
    () => document.querySelector('valor-cart-page [data-cart-item][data-line="2"]')?.getAttribute("data-key") === "B2",
    null,
    { timeout: 5000 },
  );
  await f.page.waitForLoadState("networkidle");
  assert.deepEqual(posts(f), [["A", 2]]);
  assert.equal(await f.page.locator(field(2)).inputValue(), "1");
  assert.deepEqual(
    f.state.items.map((item) => [item.key, item.quantity]),
    [
      ["A", 2],
      ["B2", 1],
      ["C2", 1],
    ],
  );
});

test("a pending drawer edit reads the cart when it changed outside the queue and re-keyed the line", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, {
    page: false,
    items: [
      { key: "A", variant: 1 },
      { key: "B", variant: 2 },
      { key: "C", variant: 3 },
    ],
  });
  await f.page.fill('valor-cart-drawer [data-quantity-field][data-line="2"]', "4");
  // A change that did not go through the theme's queue (e.g. an app writing
  // through the Storefront API) re-keys B before the debounce ends.
  f.state.items[1].key = "B2";
  await f.page.evaluate(() => ValorEvents.cartMutated());
  await f.page.waitForFunction(() => document.querySelector(".valor-cart-count").textContent === "6", null, { timeout: 5000 });
  assert.deepEqual(posts(f), [["B2", 4]]);
});

for (const surface of ["drawer", "page"]) {
  test(`a second ${surface} removal of a split line does not remove its identical twin`, { timeout: 15000 }, async (t) => {
    // A discount split one variant into the identical lines A and B. Remove
    // on A is activated twice before the first response arrives.
    const held = gate();
    let first = true;
    const f = await fixture(t, {
      [surface === "drawer" ? "page" : "drawer"]: false,
      items: [
        { key: "A", variant: 2 },
        { key: "B", variant: 2 },
        { key: "C", variant: 3 },
      ],
      hook: (entry) => {
        if (entry.path === "/cart/change.js" && first) {
          first = false;
          return held.promise;
        }
      },
    });
    await f.page.evaluate((surface) => {
      const remove = document.querySelector(`valor-cart-${surface} [data-line-remove][data-line="1"]`);
      remove.click();
      remove.click();
      window.idle = ValorCartDrawer.whenCartIdle();
    }, surface);
    held.release();
    const idle = await f.page.evaluate(() => window.idle);
    assert.deepEqual(posts(f), [["A", 0]]);
    assert.deepEqual(
      f.state.items.map((item) => item.key),
      ["B", "C"],
    );
    assert.equal(idle.failed, 0, "the line is gone as asked: nothing failed, checkout is not held back");
  });
}

test("a change aimed at a removed line is not applied to a line re-added with the same key", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, {
    page: false,
    items: [
      { key: "A", variant: 2 },
      { key: "C", variant: 3 },
    ],
  });
  // The target a second tap on A's Remove would carry, read before the removal.
  await f.page.evaluate(() => {
    window.staleTarget = ValorCartDrawer.lineTarget(document.querySelector('valor-cart-drawer [data-key="A"]'));
  });
  await f.page.evaluate(() => document.querySelector("valor-cart-drawer").changeLine(1, 0));
  // The same item is added again elsewhere (same properties → same key),
  // outside the theme's queue.
  f.state.items.unshift({ key: "A", id: 2, variant_id: 2, properties: {}, selling_plan_allocation: null, quantity: 1 });
  await f.page.evaluate(() => ValorEvents.cartMutated());
  await f.page.evaluate(() => document.querySelector("valor-cart-drawer").changeLine(1, 0, window.staleTarget));
  assert.deepEqual(posts(f), [["A", 0]]);
  assert.deepEqual(
    f.state.items.map((item) => item.key),
    ["A", "C"],
  );
});

test("a pending edit for a line removed elsewhere is not moved to its identical twin on screen", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, {
    page: false,
    items: [
      { key: "A", variant: 2 },
      { key: "B", variant: 2 },
      { key: "C", variant: 3 },
    ],
  });
  await f.page.fill('valor-cart-drawer [data-quantity-field][data-line="1"]', "4");
  // A is removed outside the theme's queue (another tab) during the debounce.
  f.state.items = f.state.items.filter((item) => item.key !== "A");
  await f.page.evaluate(() => ValorEvents.cartMutated());
  await f.page.waitForFunction(() => !document.querySelector('valor-cart-drawer [data-key="A"]'), null, { timeout: 5000 });
  await f.page.waitForTimeout(300);
  assert.deepEqual(posts(f), []);
  assert.deepEqual(
    f.state.items.map((item) => [item.key, item.quantity]),
    [
      ["B", 1],
      ["C", 1],
    ],
  );
});

for (const surface of ["drawer", "page"]) {
  test(`${surface}: a double removal after the line was re-keyed in the queue keeps its identical twin`, { timeout: 15000 }, async (t) => {
    // A and B are identical (split) lines. C's change re-keys A → A2 (and a
    // removal would re-key B → B2). Remove on A is pressed twice before any
    // response arrives. With an identical twin on screen a new key is never
    // guessed: nothing is removed (the change is not sent, the cart
    // re-renders and the cart page says so), and B is never touched.
    const held = gate();
    let changes = 0;
    const f = await fixture(t, {
      [surface === "drawer" ? "page" : "drawer"]: false,
      items: [
        { key: "A", variant: 2 },
        { key: "B", variant: 2 },
        { key: "C", variant: 3 },
      ],
    });
    f.state.hook = (entry, response) => {
      if (entry.path !== "/cart/change.js" || response.status !== 200) return;
      changes += 1;
      const rename = changes === 1 ? ["A", "A2"] : changes === 2 ? ["B", "B2"] : null;
      const item = rename && f.state.items.find((line) => line.key === rename[0]);
      if (item) item.key = rename[1];
      response.body = f.withSections();
      if (changes === 1) return held.promise;
    };
    await f.page.evaluate((surface) => {
      const host = document.querySelector(`valor-cart-${surface}`);
      const remove = host.querySelector('[data-line-remove][data-line="1"]');
      window.operations = Promise.all([host.changeLine(3, 2), (remove.click(), remove.click(), null)]);
      window.idle = ValorCartDrawer.whenCartIdle();
    }, surface);
    held.release();
    await f.page.evaluate(() => window.idle);
    assert.deepEqual(posts(f), [["C", 2]]);
    assert.deepEqual(
      f.state.items.map((item) => [item.key, item.quantity]),
      [
        ["A2", 1],
        ["B", 1],
        ["C", 2],
      ],
    );
  });
}

test("with an identical twin on screen, a re-keyed line's change is not sent to a guessed key", { timeout: 15000 }, async (t) => {
  // A and B are identical (split) lines. C's change re-keys A → A2 while
  // changes to A and B wait in the queue. Between identical lines Shopify's
  // new keys can't be told apart (the next response may re-key the twin),
  // so A's change is not sent; B still has its key and is sent.
  const held = gate();
  let changes = 0;
  const f = await fixture(t, {
    drawer: false,
    items: [
      { key: "A", variant: 2 },
      { key: "B", variant: 2 },
      { key: "C", variant: 3 },
    ],
  });
  f.state.hook = (entry, response) => {
    if (entry.path !== "/cart/change.js" || response.status !== 200) return;
    changes += 1;
    if (changes === 1) f.state.items.find((line) => line.key === "A").key = "A2";
    response.body = f.withSections();
    if (changes === 1) return held.promise;
  };
  await f.page.evaluate(() => {
    const host = document.querySelector("valor-cart-page");
    window.operations = Promise.all([host.changeLine(3, 2), host.changeLine(1, 3), host.changeLine(2, 4)]);
  });
  held.release();
  await f.page.evaluate(() => window.operations);
  assert.deepEqual(posts(f), [
    ["C", 2],
    ["B", 4],
  ]);
  assert.deepEqual(
    f.state.items.map((item) => [item.key, item.quantity]),
    [
      ["A2", 1],
      ["B", 4],
      ["C", 2],
    ],
  );
});

test("a double removal of a line re-keyed in the queue does not remove a new identical line", { timeout: 15000 }, async (t) => {
  // A has no twin. C's change re-keys A → A2; the removal of A2 brings in a
  // new identical line A3 (e.g. an app adds the same variant). Remove on A
  // is pressed twice before any response arrives: the second press must
  // know A is already removed and leave A3 alone.
  const held = gate();
  let changes = 0;
  const f = await fixture(t, {
    drawer: false,
    items: [
      { key: "A", variant: 2 },
      { key: "C", variant: 3 },
    ],
  });
  f.state.hook = (entry, response) => {
    if (entry.path !== "/cart/change.js" || response.status !== 200) return;
    changes += 1;
    if (changes === 1) f.state.items.find((line) => line.key === "A").key = "A2";
    if (changes === 2) f.state.items.unshift({ key: "A3", id: 2, variant_id: 2, properties: {}, selling_plan_allocation: null, quantity: 1 });
    response.body = f.withSections();
    if (changes === 1) return held.promise;
  };
  await f.page.evaluate(() => {
    const host = document.querySelector("valor-cart-page");
    const remove = host.querySelector('[data-line-remove][data-line="1"]');
    host.changeLine(2, 2);
    remove.click();
    remove.click();
    window.idle = ValorCartDrawer.whenCartIdle();
  });
  held.release();
  const idle = await f.page.evaluate(() => window.idle);
  assert.deepEqual(posts(f), [
    ["C", 2],
    ["A2", 0],
  ]);
  assert.deepEqual(
    f.state.items.map((item) => [item.key, item.quantity]),
    [
      ["A3", 1],
      ["C", 2],
    ],
  );
  assert.equal(idle.failed, 0);
});

// Error messages shown on the cart page: [key of the line it is on, or
// "cart" for one above the lines, text].
const shownErrors = (f) =>
  f.page.evaluate(() =>
    [...document.querySelectorAll('valor-cart-page [data-has-error="true"]')].map((el) => [
      el.closest("[data-cart-item]")?.getAttribute("data-key") ?? "cart",
      el.textContent.trim(),
    ]),
  );

// A and B are identical (split) lines; the first change re-keys A → A2 and
// is held until released.
async function splitLinesRekeyedByFirstChange(t) {
  const held = gate();
  let changes = 0;
  const f = await fixture(t, {
    drawer: false,
    items: [
      { key: "A", variant: 2 },
      { key: "B", variant: 2 },
      { key: "C", variant: 3 },
    ],
  });
  f.state.hook = (entry, response) => {
    if (entry.path !== "/cart/change.js" || response.status !== 200) return;
    changes += 1;
    if (changes === 1) f.state.items.find((line) => line.key === "A").key = "A2";
    response.body = f.withSections();
    if (changes === 1) return held.promise;
  };
  return { f, held };
}

test("cart page: a removal that is not sent keeps its message after the cart re-renders", { timeout: 15000 }, async (t) => {
  // C's change re-keys A → A2 while Remove on A waits. The removal is not
  // sent (A's new key can't be told from B's), and the re-render that
  // follows must not take away the message saying so.
  const { f, held } = await splitLinesRekeyedByFirstChange(t);
  const start = f.state.requests.length;
  await f.page.evaluate(() => {
    const host = document.querySelector("valor-cart-page");
    host.changeLine(3, 2);
    host.querySelector('[data-line-remove][data-line="1"]').click();
    window.idle = ValorCartDrawer.whenCartIdle();
  });
  held.release();
  await f.page.evaluate(() => window.idle);
  await f.page.waitForFunction(() => document.querySelector('valor-cart-page [data-key="A2"]'), null, { timeout: 5000 });
  await f.page.waitForLoadState("networkidle");
  await f.page.waitForTimeout(300);
  assert.deepEqual(posts(f), [["C", 2]]);
  assert.ok(
    f.state.requests.slice(start).some((r) => r.method === "GET" && r.section === "main-cart"),
    "the cart page re-rendered after the removal was not sent",
  );
  const errors = await shownErrors(f);
  assert.equal(errors.length, 1, `one message is shown, got ${JSON.stringify(errors)}`);
  assert.ok(errors[0][1].length > 0);
});

test("cart page: a later queued change keeps that message, and the buyer's next change clears it", { timeout: 15000 }, async (t) => {
  const { f, held } = await splitLinesRekeyedByFirstChange(t);
  await f.page.evaluate(() => {
    const host = document.querySelector("valor-cart-page");
    window.operations = Promise.all([host.changeLine(3, 2), host.changeLine(1, 3), host.changeLine(2, 4)]);
  });
  held.release();
  await f.page.evaluate(() => window.operations);
  await f.page.waitForLoadState("networkidle");
  await f.page.waitForTimeout(300);
  assert.deepEqual(posts(f), [
    ["C", 2],
    ["B", 4],
  ]);
  assert.equal((await shownErrors(f)).length, 1, "A's change was not made: B's render and the refresh keep saying so");
  await f.page.evaluate(() => document.querySelector("valor-cart-page").changeLine(3, 1));
  await f.page.waitForLoadState("networkidle");
  assert.deepEqual(await shownErrors(f), [], "the buyer's next change clears it");
});

test("a rejected cart page quantity keeps its error on its line after the cart re-renders", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, { drawer: false });
  f.state.hook = (entry, response) => {
    if (entry.path !== "/cart/change.js") return;
    f.state.items.find((line) => line.key === "A").quantity = 1; // rejected: unchanged
    response.status = 422;
    response.body = { status: 422, message: "Cart Error", description: "You can only add 1 of this item to your cart." };
  };
  const field = 'valor-cart-page [data-quantity-field][data-line="1"]';
  await f.page.fill(field, "9");
  await f.page.$eval(field, (el) => el.blur());
  await f.page.waitForFunction(() => document.querySelector('valor-cart-page [data-quantity-field][data-line="1"]').value === "1", null, {
    timeout: 5000,
  });
  await f.page.waitForLoadState("networkidle");
  await f.page.waitForTimeout(300);
  assert.deepEqual(await shownErrors(f), [["A", "You can only add 1 of this item to your cart."]]);
});

test("a rejected cart page change shows its error on its own line when an earlier removal shifts the lines", { timeout: 15000 }, async (t) => {
  const held = gate();
  const f = await fixture(t, { drawer: false });
  f.state.hook = (entry, response) => {
    if (entry.path !== "/cart/change.js") return;
    if (entry.body.id === "A") return held.promise;
    f.state.items.find((line) => line.key === "B").quantity = 1; // rejected: unchanged
    response.status = 422;
    response.body = { status: 422, message: "Cart Error", description: "You can only add 1 of this item to your cart." };
  };
  await f.page.evaluate(() => {
    const host = document.querySelector("valor-cart-page");
    window.operations = Promise.all([host.changeLine(1, 0), host.changeLine(2, 9)]);
  });
  held.release();
  await f.page.evaluate(() => window.operations);
  // A's removal moved B to line 1 and C to line 2.
  assert.deepEqual(await shownErrors(f), [["B", "You can only add 1 of this item to your cart."]]);
});

for (const body of ["json", "html"]) {
  test(`a failed cart page removal (${body} 500) shows its error on the line's new key after a queued re-key`, { timeout: 15000 }, async (t) => {
    // A has no twin. C's change re-keys A → A2 while Remove on A waits; the
    // removal is sent for A2 and fails. Its error belongs on A2's row.
    const held = gate();
    let changes = 0;
    let before;
    const f = await fixture(t, {
      drawer: false,
      items: [
        { key: "A", variant: 1 },
        { key: "B", variant: 2 },
        { key: "C", variant: 3 },
      ],
    });
    f.state.hook = (entry, response) => {
      if (entry.path !== "/cart/change.js" || entry.method !== "POST") return;
      changes += 1;
      if (changes === 1) {
        f.state.items.find((line) => line.key === "A").key = "A2";
        before = structuredClone(f.state.items);
        response.body = f.withSections();
        return held.promise;
      }
      f.state.items = before; // failed: unchanged
      response.status = 500;
      response.body = body === "json" ? { status: 500, message: "Cart Error", description: "Please try again later." } : "<h1>Server error</h1>";
    };
    await f.page.evaluate(() => {
      const host = document.querySelector("valor-cart-page");
      window.operations = Promise.all([host.changeLine(3, 2), host.changeLine(1, 0)]);
    });
    held.release();
    await f.page.evaluate(() => window.operations);
    await f.page.waitForLoadState("networkidle");
    assert.deepEqual(posts(f), [
      ["C", 2],
      ["A2", 0],
    ]);
    assert.deepEqual(await shownErrors(f), [["A2", body === "json" ? "Please try again later." : "Something went wrong. Please try again."]]);
  });
}

test("a cart page error whose line is re-keyed after it appeared is shown above the lines", { timeout: 15000 }, async (t) => {
  // A=9 is rejected; B=4, queued before the error appeared, re-keys A → A3.
  // The error can't be pointed at A any more but must stay visible.
  const f = await fixture(t, {
    drawer: false,
    items: [
      { key: "A", variant: 1 },
      { key: "B", variant: 2 },
      { key: "C", variant: 3 },
    ],
  });
  f.state.hook = (entry, response) => {
    if (entry.path !== "/cart/change.js" || entry.method !== "POST") return;
    if (entry.body.id === "A") {
      f.state.items.find((line) => line.key === "A").quantity = 1; // rejected: unchanged
      response.status = 422;
      response.body = { status: 422, message: "Cart Error", description: "You can only add 1 of this item to your cart." };
      return;
    }
    f.state.items.find((line) => line.key === "A").key = "A3";
    response.body = f.withSections();
  };
  await f.page.evaluate(() => {
    const host = document.querySelector("valor-cart-page");
    window.operations = Promise.all([host.changeLine(1, 9), host.changeLine(2, 4)]);
  });
  await f.page.evaluate(() => window.operations);
  await f.page.waitForLoadState("networkidle");
  assert.deepEqual(posts(f), [
    ["A", 9],
    ["B", 4],
  ]);
  assert.deepEqual(await shownErrors(f), [["cart", "You can only add 1 of this item to your cart."]]);
});
