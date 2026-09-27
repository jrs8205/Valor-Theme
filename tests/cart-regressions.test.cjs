const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

// All storefront requests stay inside this fixture. No store credentials,
// customer data, checkout or Shopify mutation endpoints are used.
const root = path.resolve(__dirname, "..");
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function markup(cart, surface) {
  const rows = cart.items
    .map(
      (item, i) => `
    <li data-cart-item data-line="${i + 1}" data-key="${item.key}">
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
  return `<valor-cart-${surface} id="${surface === "drawer" ? "ValorCartDrawer" : "CartPage"}"
      data-section-id="main-cart" data-cart-item-count="${cart.item_count}">
    <valor-cart-items><ul>${rows}</ul></valor-cart-items>
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
    items: (options.items || ["A", "B", "C"]).map((key) => ({ key, id: 1, variant_id: 1, quantity: 1 })),
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
  await page.goto("http://valor.test/cart");
  if (!options.hook) await page.waitForLoadState("networkidle");
  return { page, state, snapshot };
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
