const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// <product-info> with a combined listing: an option value that belongs to
// another product (Liquid writes data-product-url) must open that product
// with the chosen option value ids; normal values keep the section-rendering
// fetch on the current product.
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

function radio(position, name, value, id, { checked = false, productUrl } = {}) {
  return `<input type="radio" class="valor-mp__option-input" name="options[${name}]" id="opt-${value}"
    value="${value}" data-option-position="${position}" data-option-name="${name}"
    data-option-value-id="${id}" ${productUrl ? `data-product-url="${productUrl}"` : ""} ${checked ? "checked" : ""}>
    <label for="opt-${value}">${value}</label>`;
}

async function fixture(t) {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://valor.test/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ path: url.pathname, search: url.search, navigation: request.isNavigationRequest() });
    if (url.pathname.startsWith("/assets/")) {
      return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(root, url.pathname), "utf8") });
    }
    if (url.pathname !== "/products/tee" || url.searchParams.has("section_id")) {
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body>other</body></html>" });
    }
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
        <div class="valor-mp">
          <product-info data-section-id="s1" data-product-id="1" data-product-url="/products/tee">
            <script type="application/json" data-section-variants>
              [{"id": 11, "available": true, "options": ["Black", "S"]},
               {"id": 12, "available": true, "options": ["Black", "M"]}]
            </script>
            <fieldset>
              ${radio(1, "Color", "Black", 101, { checked: true })}
              ${radio(1, "Color", "Red", 102, { productUrl: "/products/tee-red" })}
            </fieldset>
            <fieldset>
              ${radio(2, "Size", "S", 201, { checked: true })}
              ${radio(2, "Size", "M", 202)}
            </fieldset>
            <input type="hidden" name="id" value="11" data-variant-id-input>
            <button data-add-button><span data-add-button-text>Add to cart</span></button>
          </product-info>
        </div>
        <script src="/assets/product-info.js"></script>
      </body></html>`,
    });
  });
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], "no unhandled browser errors");
  });
  await page.goto("http://valor.test/products/tee");
  return { page, requests };
}

test("a combined-listing sibling value opens that product with the chosen option values", async (t) => {
  const { page, requests } = await fixture(t);
  const navigation = page.waitForRequest((request) => new URL(request.url()).pathname === "/products/tee-red");
  await page.click('label[for="opt-Red"]');
  const request = await navigation;
  assert.equal(new URL(request.url()).search, "?option_values=102,201");
  assert.equal(requests.filter((r) => r.search.includes("section_id")).length, 0, "no section fetch for the old product");
});

test("a value of the current product keeps the section rendering update", async (t) => {
  const { page, requests } = await fixture(t);
  await page.click('label[for="opt-M"]');
  await page.waitForFunction(() => location.search === "?variant=12");
  await page.waitForTimeout(200);
  const sectionFetches = requests.filter((r) => r.search.includes("section_id=s1"));
  assert.equal(sectionFetches.length, 1);
  assert.match(sectionFetches[0].search, /variant=12/);
  assert.equal(requests.filter((r) => r.navigation && r.path !== "/products/tee").length, 0);
});
