const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// Variant section rendering for the Product safety block: the server always
// renders the block shell (hidden when the variant has nothing to show), and
// <product-info> must mirror both the identifiers and the shell's visibility
// in both directions.
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

const variants = { 11: { option: "S", sku: "TEE-S" }, 12: { option: "M", sku: "" } };

function safety(variantId) {
  const sku = variants[variantId].sku;
  const hidden = sku ? "" : " hidden";
  return `<details class="valor-product-safety" id="ProductSafety-s1"${hidden} open>
      <summary>Product safety</summary>
      <div id="ProductSafetyIds-s1"${hidden}><dl>${sku ? `<div><dt>SKU</dt><dd>${sku}</dd></div>` : ""}</dl></div>
    </details>`;
}

function radio(value, id, checked) {
  return `<input type="radio" class="valor-mp__option-input" name="options[Size]" id="opt-${value}" value="${value}"
    data-option-position="1" data-option-name="Size" data-option-value-id="${id}" ${checked ? "checked" : ""}>
    <label for="opt-${value}">${value}</label>`;
}

async function fixture(t) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://valor.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/assets/")) {
      return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(root, url.pathname), "utf8") });
    }
    if (url.searchParams.has("section_id")) {
      const id = Number(url.searchParams.get("variant"));
      return route.fulfill({ contentType: "text/html", body: `<div>${safety(id)}</div>` });
    }
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
        <div class="valor-mp">
          <product-info data-section-id="s1" data-product-id="1" data-product-url="/products/tee">
            <script type="application/json" data-section-variants>
              [{"id": 11, "available": true, "options": ["S"]}, {"id": 12, "available": true, "options": ["M"]}]
            </script>
            ${radio("S", 201, true)}${radio("M", 202, false)}
            <input type="hidden" name="id" value="11" data-variant-id-input>
            <button data-add-button><span data-add-button-text>Add to cart</span></button>
            ${safety(11)}
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
  return page;
}

const state = (page) =>
  page.evaluate(() => ({
    shellHidden: document.getElementById("ProductSafety-s1").hidden,
    idsHidden: document.getElementById("ProductSafetyIds-s1").hidden,
    text: [...document.querySelectorAll("#ProductSafetyIds-s1 dt, #ProductSafetyIds-s1 dd")].map((n) => n.textContent.trim()).join(" "),
  }));

test("product safety block follows the variant into and out of the empty state", async (t) => {
  const page = await fixture(t);
  assert.deepEqual(await state(page), { shellHidden: false, idsHidden: false, text: "SKU TEE-S" });

  await page.click('label[for="opt-M"]');
  await page.waitForFunction(() => location.search === "?variant=12");
  await page.waitForFunction(() => document.getElementById("ProductSafety-s1").hidden === true);
  assert.deepEqual(await state(page), { shellHidden: true, idsHidden: true, text: "" });

  await page.click('label[for="opt-S"]');
  await page.waitForFunction(() => document.getElementById("ProductSafety-s1").hidden === false);
  assert.deepEqual(await state(page), { shellHidden: false, idsHidden: false, text: "SKU TEE-S" });
  assert.equal(await page.evaluate(() => document.getElementById("ProductSafety-s1").open), true, "keeps the open state");
});
