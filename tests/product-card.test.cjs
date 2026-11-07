const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// Static fixture for <valor-product-card>: the per-swatch data attributes
// mirror what snippets/product-card.liquid renders.
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

const escapeAttr = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function swatch({ name, price, unitPrice, media }) {
  const attrs = [`href="/products/tee?variant=${name}"`, `data-swatch-swap`, `class="valor-card__swatch"`];
  if (price !== undefined) attrs.push(`data-price="${escapeAttr(price)}"`);
  if (unitPrice !== undefined) attrs.push(`data-unit-price="${escapeAttr(unitPrice)}"`);
  if (media) attrs.push(`data-media-src="${media}" data-media-srcset="${media} 600w" data-media-alt="${name} photo"`);
  return `<a ${attrs.join(" ")} id="swatch-${name}"><span class="visually-hidden">${name}</span></a>`;
}

async function fixture(t, swatches, { unitPrice = "€2.00/100 g" } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://valor.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/assets/")) {
      return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(root, url.pathname), "utf8") });
    }
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
        <valor-product-card>
          <article class="valor-card valor-card--swap-image">
            <a class="valor-card__media-link" href="/products/tee">
              <img class="valor-card__image--primary" src="/original.jpg" srcset="/original.jpg 600w" alt="Original" width="600" height="800">
            </a>
            <a class="valor-card__title-link" href="/products/tee">Tee</a>
            <div class="valor-card__price"><span class="valor-card__price-current">From €10.00</span></div>
            <p class="valor-card__unit-price" data-unit-price-wrapper ${unitPrice ? "" : "hidden"}>
              <span class="visually-hidden">Unit price</span><span data-unit-price>${unitPrice || ""}</span>
            </p>
            <div class="valor-card__swatches">${swatches.map(swatch).join("")}</div>
          </article>
        </valor-product-card>
        <script src="/assets/product-card.js"></script>
      </body></html>`,
    });
  });
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], "no unhandled browser errors");
  });
  await page.goto("http://valor.test/collections/all");
  return page;
}

const unitText = (page) => page.locator(".valor-card__unit-price [data-unit-price]").textContent();
const unitHidden = (page) => page.locator(".valor-card__unit-price").evaluate((el) => el.hidden);

test("a colour whose sizes differ in price shows its From price", async (t) => {
  const page = await fixture(t, [
    { name: "Black", price: '<span class="valor-card__price-current">From €12.00</span>', unitPrice: "" },
  ]);
  await page.click("#swatch-Black");
  assert.equal(await page.locator(".valor-card__price").textContent(), "From €12.00");
});

test("unit price swaps to the colour's value and clears when the colour has none", async (t) => {
  const page = await fixture(t, [
    { name: "Black", price: "<span>€12.00</span>", unitPrice: "€3.00/100 g" },
    { name: "White", price: "<span>€10.00</span>", unitPrice: "" },
  ]);
  await page.click("#swatch-Black");
  assert.equal(await unitText(page), "€3.00/100 g");
  assert.equal(await unitHidden(page), false);
  await page.click("#swatch-White");
  assert.equal(await unitText(page), "");
  assert.equal(await unitHidden(page), true);
  await page.click("#swatch-Black");
  assert.equal(await unitText(page), "€3.00/100 g");
  assert.equal(await unitHidden(page), false);
});

test("cards rendered before unit-price data existed keep their unit price", async (t) => {
  const page = await fixture(t, [{ name: "Black", price: "<span>€12.00</span>" }]);
  await page.click("#swatch-Black");
  assert.equal(await unitText(page), "€2.00/100 g");
  assert.equal(await unitHidden(page), false);
});

test("a colour without its own image restores the original image", async (t) => {
  const page = await fixture(t, [
    { name: "Black", price: "<span>€12.00</span>", media: "/black.jpg" },
    { name: "White", price: "<span>€10.00</span>" },
  ]);
  await page.click("#swatch-Black");
  assert.match(await page.locator(".valor-card__image--primary").getAttribute("src"), /black\.jpg$/);
  await page.click("#swatch-White");
  assert.equal(await page.locator(".valor-card__image--primary").getAttribute("src"), "/original.jpg");
  assert.equal(await page.locator(".valor-card").evaluate((el) => el.classList.contains("valor-card--swap-image")), true);
});
