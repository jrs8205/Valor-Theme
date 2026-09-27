const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const bootstrap = fs
  .readFileSync(path.join(root, "layout/theme.liquid"), "utf8")
  .match(/<script>\s*(window\.ValorBoot[\s\S]*?)<\/script>/)[1];
// The offline double preserves the library's derived-promise behavior. Set
// VALOR_STANDARD_EVENTS to a downloaded CDN module to run the same contract
// tests against Shopify's actual library, without mutating a Shopify cart.
const library = process.env.VALOR_STANDARD_EVENTS
  ? fs.readFileSync(process.env.VALOR_STANDARD_EVENTS, "utf8")
  : `
    function eventClass(name) {
      return class extends Event {
        static createPromise() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; }
        static createCartFromAjaxResponse(cart) { return cart; }
        constructor(data) { super(name, {bubbles:true}); Object.assign(this,data); if(data.promise)this.promise=data.promise.then(value=>value); }
      };
    }
    export const CartLinesUpdateEvent=eventClass('shopify:cart:lines-update');
    export const CartDiscountUpdateEvent=eventClass('shopify:cart:discount-update');
    export const CartNoteUpdateEvent=eventClass('shopify:cart:note-update');
    export const CartErrorEvent=eventClass('shopify:cart:error');
    export const PageViewEvent=eventClass('shopify:page:view');
    export const SearchUpdateEvent=eventClass('shopify:search:update');
    export function createViewEventElement() { return class extends HTMLElement {
      connectedCallback() { setTimeout(()=>this.dispatchEvent(new Event('shopify:product:view',{bubbles:true})),0); }
    }; }
  `;
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

async function fixture(t, { delayed = null } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  let reads = 0;
  let readHook;
  await page.route("http://events.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/library.js") return route.fulfill({ contentType: "text/javascript", body: library });
    if (url.pathname.startsWith("/assets/"))
      return route.fulfill({
        contentType: "text/javascript",
        body: fs.readFileSync(path.join(root, url.pathname), "utf8"),
      });
    if (url.pathname === "/app.js") {
      if (delayed) await delayed.promise;
      return route.fulfill({
        contentType: "text/javascript",
        body: `
        window.appEvents=[];
        for (const name of ['page:view','product:view','search:update']) document.addEventListener('shopify:'+name,e=>appEvents.push(name));
        Shopify.actions={updateCart:{configure(config){if(!window.actionConfig)window.actionConfig=config;}},openCart:{configure(){}}};
      `,
      });
    }
    if (url.pathname === "/cart.js") {
      reads++;
      const cart = {
        token: "test",
        item_count: reads,
        total_price: 1000,
        currency: "EUR",
        items: [],
        discount_codes: [],
      };
      if (readHook) await readHook(reads);
      return route.fulfill({ json: cart });
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head>
      <script>window.Shopify={routes:{root:'/'}};window.order=[];
        document.addEventListener('DOMContentLoaded',()=>order.push('DOMContentLoaded'));
        document.addEventListener('shopify:page:view',()=>order.push('page:view'));</script>
      <script>${bootstrap}</script>
      <script>document.addEventListener('DOMContentLoaded',()=>Shopify.actions.updateCart.configure({app:true}));</script>
      <script type="module">import * as SE from '/library.js'; window.StandardEvents=SE;</script>
      <script src="/assets/storefront-events.js" defer></script>
      <script src="/assets/collection.js" defer></script>
      <script src="/app.js" defer></script>
      </head><body><main data-template="search">
        <valor-view-event view-event-payload='{"product":{"id":"1","title":"Product","handle":"product"},"context":"page"}'></valor-view-event>
        <valor-collection data-collection-section-id="search" data-template="search" data-search-query="shirt" data-results-count="2"></valor-collection>
      </main></body></html>`,
    });
  });
  await page.goto("http://events.test/search?q=shirt", { waitUntil: delayed ? "commit" : "load" });
  return {
    page,
    get reads() {
      return reads;
    },
    set readHook(value) {
      readHook = value;
    },
  };
}

test(
  "initial views and search wait for slow deferred app scripts; theme configures first",
  { timeout: 15000 },
  async (t) => {
    const delayed = gate();
    const f = await fixture(t, { delayed });
    await f.page.waitForFunction(() => !!window.ValorEvents);
    // Cross multiple browser tasks while DOMContentLoaded is blocked.
    await f.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    assert.deepEqual(await f.page.evaluate(() => order), []);
    assert.equal(await f.page.evaluate(() => !!customElements.get("valor-view-event")), false);
    delayed.release();
    await f.page.waitForFunction(() => window.appEvents?.length === 3);
    const result = await f.page.evaluate(() => ({
      events: appEvents,
      order,
      configured: typeof actionConfig.handler === "function",
    }));
    assert.equal(result.events[0], "page:view");
    assert.deepEqual([...result.events].sort(), ["page:view", "product:view", "search:update"]);
    assert.deepEqual(result.order, ["DOMContentLoaded", "page:view"]);
    assert.equal(result.configured, true);
  },
);

for (const status of [200, 422, 429, 500]) {
  test(`cart event HTTP ${status} has the documented promise outcome`, { timeout: 15000 }, async (t) => {
    const f = await fixture(t);
    const result = await f.page.evaluate(async (status) => {
      let promise;
      let errors = 0;
      document.addEventListener("shopify:cart:error", () => errors++);
      document.addEventListener(
        "shopify:cart:lines-update",
        (event) => {
          promise = event.promise;
        },
        { once: true },
      );
      const operation = ValorEvents.cartLinesUpdate(document, {
        action: "update",
        context: "cart",
        lines: [{ id: "A", quantity: 2 }],
      });
      const observed = promise.then(
        (value) => ({ rejected: false, userErrors: !!value.userErrors?.length }),
        () => ({ rejected: true }),
      );
      operation.settle(status, {
        message: "Cart response",
        items: [],
        item_count: 2,
        total_price: 1000,
        token: "test",
        currency: "EUR",
      });
      return { ...(await observed), errors };
    }, status);
    assert.equal(result.rejected, status === 429 || status === 500);
    assert.equal(result.errors, status === 429 || status === 500 ? 1 : 0);
    if (!result.rejected) assert.equal(result.userErrors, status === 422);
  });
}

test("unobserved cart failure handles the library's derived promise", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  await f.page.evaluate(async () => {
    ValorEvents.cartLinesUpdate(document, {
      action: "update",
      context: "cart",
      lines: [{ id: "A", quantity: 2 }],
    }).fail(new Error("Network unavailable"));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

test("cart reads coalesce within a generation and separate after a mutation", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const held = gate();
  const started = gate();
  f.readHook = (read) => {
    if (read === 1) {
      started.release();
      return held.promise;
    }
  };
  await f.page.evaluate(() => {
    window.oldCart = ValorEvents.fetchCart();
    window.sharedCart = ValorEvents.fetchCart();
  });
  await started.promise;
  const newest = await f.page.evaluate(async () => {
    ValorEvents.cartMutated();
    return (await ValorEvents.fetchCart()).item_count;
  });
  assert.equal(newest, 2);
  held.release();
  assert.equal(await f.page.evaluate(() => oldCart === sharedCart), true);
  assert.equal(await f.page.evaluate(async () => (await oldCart).item_count), 1);
  assert.equal(f.reads, 2);
});

test("updateCart marks the action handled only after the strict UI refresh", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    window.finished = false;
    window.ValorCartDrawer = {
      refreshCartUI(options) {
        window.strict = options.strict;
        return new Promise((resolve) => {
          window.finishRefresh = resolve;
        });
      },
    };
    window.action = actionConfig
      .handler(() => Promise.resolve({ detail: { original: true } }))
      .then((result) => {
        finished = true;
        return result;
      });
  });
  assert.equal(await f.page.evaluate(() => finished), false);
  assert.equal(await f.page.evaluate(() => strict), true);
  const result = await f.page.evaluate(async () => {
    finishRefresh();
    return await action;
  });
  assert.deepEqual(result.detail, { original: true, handledBy: "valor" });
});

test("updateCart reloads when strict UI refresh fails", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const navigation = f.page.waitForEvent("framenavigated");
  await f.page.evaluate(() => {
    window.ValorCartDrawer = {
      refreshCartUI() {
        return Promise.reject(new Error("Section unavailable"));
      },
    };
    actionConfig.handler(() => Promise.resolve({}));
  });
  await navigation;
  await f.page.waitForLoadState("load");
});
