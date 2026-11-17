const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// The header's search panel (snippets/header-search.liquid) with its results
// (sections/predictive-search.liquid), laid out by the header's real
// stylesheet and assets/component-predictive-search.css. The markup mirrors
// the Liquid; the first test holds the two together.
const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const headerCss = read("sections", "header.liquid").match(/{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/)[1];
const criticalCss = read("assets", "critical.css");
const predictiveCss = read("assets", "component-predictive-search.css");
const searchCss = read("assets", "search.css");

let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  // WebKit on Windows can stall in close() after every test has passed;
  // npm test runs with --test-force-exit, so a stalled close can't hold the run.
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16"/></svg>';
const TITLES = [
  "Valor Tank Top",
  "Valor T-shirt - Urban Panel",
  "Valor T-shirt - Halo Stamp",
  "Valor T-shirt - Underline Spray",
];
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

function results(titles) {
  const items = titles
    .map(
      (
        title,
        i,
      ) => `<li id="predictive-search-option-product-${i + 1}" class="valor-psearch__item-wrap" role="option" aria-selected="false">
        <a href="#" class="valor-psearch__item valor-psearch__item--product" tabindex="-1">
          <img class="valor-psearch__image" src="${PIXEL}" alt="" width="60" height="60">
          <span class="valor-psearch__product-info">
            <span class="valor-psearch__product-title">${title}</span>
            <span class="valor-psearch__product-price">$20.00</span>
          </span>
        </a>
      </li>`,
    )
    .join("");
  return `<div id="predictive-search-results" class="valor-psearch__results" role="listbox">
    <div class="valor-psearch__group">
      <h3 class="valor-psearch__heading">Products</h3>
      <ul class="valor-psearch__list" role="group">${items}</ul>
    </div>
    <div class="valor-psearch__group">
      <h3 class="valor-psearch__heading">Collections</h3>
      <ul class="valor-psearch__list" role="group">
        <li class="valor-psearch__item-wrap" role="option" aria-selected="false">
          <a href="#" class="valor-psearch__item valor-psearch__item--text" tabindex="-1"><span>Tops</span></a>
        </li>
      </ul>
    </div>
    <div class="valor-psearch__view-all-wrap">
      <button type="submit" id="predictive-search-option-search-keywords" class="valor-psearch__view-all" tabindex="-1" role="option" aria-selected="false">
        <span>View all results for <strong>top</strong></span>
        <span class="valor-psearch__view-all-arrow" aria-hidden="true">→</span>
      </button>
    </div>
  </div>`;
}

// predictive: the theme setting "Enable predictive search". open: results
// are showing. scale: the theme's body font scale. lineHeight: a body font
// whose lines are taller than the default.
function markup({ predictive = true, open = true, titles = TITLES, dir = "ltr", scale = 1, lineHeight = "" } = {}) {
  const field = `<div class="valor-search-modal__field">
      <label for="Search" class="visually-hidden">Search</label>
      <span class="valor-search-modal__search-icon" aria-hidden="true">${ICON}</span>
      <input class="valor-search-modal__input" id="Search" type="search" name="q" value="top" placeholder="Search">
      <input type="hidden" name="options[prefix]" value="last">
      <button type="reset" class="valor-search-modal__reset" aria-label="Clear search term">${ICON}</button>
    </div>`;
  const form = predictive
    ? `<valor-predictive-search class="valor-psearch"${open ? " open" : ""}>
        <form action="/search" method="get" role="search" class="valor-search-modal__form">
          ${field}
          <div class="valor-psearch__panel" data-predictive-search aria-live="polite">${open ? results(titles) : ""}</div>
        </form>
      </valor-predictive-search>`
    : `<form action="/search" method="get" role="search" class="valor-search-modal__form">${field}</form>`;
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8">
    <style>:root { --color-foreground: #333333; --color-background: #ffffff; --valor-border-default: rgb(229, 229, 229); --valor-border-strong: rgb(51, 51, 51); --page-width: 1200px; --page-margin: 40px; --font-body-scale: ${scale}; }
    ${criticalCss}${headerCss}${predictiveCss} body { margin: 0;${lineHeight ? ` line-height: ${lineHeight};` : ""} }</style></head><body>
    <div id="shopify-section-header" class="shopify-section valor-section-header">
      <header class="color-scheme-1 valor-header valor-header--logo-center">
        <div class="valor-header__title"><a href="#" class="valor-header__title-link"><span class="valor-header__logo-text">Valor Demo Store</span></a></div>
        <div class="valor-header__icons">
          <button type="button" class="valor-header__icon valor-header__search-toggle" data-search-modal-open>${ICON}</button>
          <dialog id="ValorSearchModal" class="valor-search-modal" aria-label="Search">
            <div class="valor-search-modal__inner">
              ${form}
              <button type="button" class="valor-search-modal__close" aria-label="Close" data-search-modal-close>${ICON}</button>
            </div>
          </dialog>
          <a href="#" class="valor-header__cart">${ICON}</a>
        </div>
      </header>
    </div>
  </body></html>`;
}

// Opens the panel the way the theme does (showModal) and measures it.
async function panel(t, width, options) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  t.after(() => page.close());
  await page.setContent(markup(options));
  await page.evaluate(() => document.getElementById("ValorSearchModal").showModal());
  return page.evaluate(() => {
    const round = (n) => Math.round(n * 10) / 10;
    const box = (target) => {
      const el = typeof target === "string" ? document.querySelector(target) : target;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: round(r.left),
        right: round(r.right),
        top: round(r.top),
        bottom: round(r.bottom),
        width: round(r.width),
        height: round(r.height),
        middle: round(r.top + r.height / 2),
        center: round(r.left + r.width / 2),
      };
    };
    const inner = document.querySelector(".valor-search-modal__inner");
    const innerStyle = getComputedStyle(inner);
    const innerBox = inner.getBoundingClientRect();
    const scroller = document.querySelector(".valor-psearch__panel");
    return {
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      viewport: innerWidth,
      // The room the panel gives its content, inside its side padding.
      content: {
        left: round(innerBox.left + parseFloat(innerStyle.paddingLeft)),
        right: round(innerBox.right - parseFloat(innerStyle.paddingRight)),
      },
      form: box(".valor-search-modal__form"),
      field: box(".valor-search-modal__field"),
      input: box(".valor-search-modal__input"),
      inputLine: getComputedStyle(document.querySelector(".valor-search-modal__input")).borderBottomWidth,
      searchIcon: box(".valor-search-modal__search-icon svg"),
      resetIcon: box(".valor-search-modal__reset svg"),
      close: box(".valor-search-modal__close"),
      closeIcon: box(".valor-search-modal__close svg"),
      panelLine: scroller ? getComputedStyle(scroller).borderTopWidth : null,
      sideways: scroller ? scroller.scrollWidth - scroller.clientWidth : null,
      // The heading's words, not its box: the box has side padding of its own.
      heading: (() => {
        const heading = document.querySelector(".valor-psearch__heading");
        if (!heading) return null;
        const words = document.createRange();
        words.selectNodeContents(heading);
        return box(words);
      })(),
      images: [...document.querySelectorAll(".valor-psearch__image")].map(box),
      titles: [...document.querySelectorAll(".valor-psearch__product-title")].map(box),
      rows: [...document.querySelectorAll(".valor-psearch__item")].map(box),
      textRow: box(".valor-psearch__item--text span"),
      viewAllLine: box(".valor-psearch__view-all-wrap"),
      viewAllText: box(".valor-psearch__view-all > span"),
      arrow: box(".valor-psearch__view-all-arrow"),
      cart: (() => {
        const style = getComputedStyle(document.querySelector(".valor-header__cart"));
        return { display: style.display, justify: style.justifyContent, align: style.alignItems };
      })(),
    };
  });
}

const near = (actual, expected, message, tolerance = 1) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} against ${expected}`);
const SIZES = [
  ["desktop", 1440],
  ["phone", 390],
];

test("the fixture's class names are the ones the Liquid prints", () => {
  const snippet = read("snippets", "header-search.liquid");
  const section = read("sections", "predictive-search.liquid");
  for (const name of [
    "valor-search-modal__inner",
    "valor-search-modal__form",
    "valor-search-modal__field",
    "valor-search-modal__search-icon",
    "valor-search-modal__input",
    "valor-search-modal__reset",
    "valor-search-modal__close",
    "valor-psearch__panel",
  ]) {
    assert.ok(snippet.includes(`class="${name}"`), `snippets/header-search.liquid prints ${name}`);
  }
  for (const name of [
    "valor-psearch__results",
    "valor-psearch__group",
    "valor-psearch__heading",
    "valor-psearch__list",
    "valor-psearch__item-wrap",
    "valor-psearch__image",
    "valor-psearch__product-title",
    "valor-psearch__view-all-wrap",
    "valor-psearch__view-all",
    "valor-psearch__view-all-arrow",
  ]) {
    assert.ok(section.includes(`class="${name}"`), `sections/predictive-search.liquid prints ${name}`);
  }
  assert.ok(section.includes('class="valor-psearch__item valor-psearch__item--product"'));
  assert.ok(section.includes('class="valor-psearch__item valor-psearch__item--text"'));
  // The dialog stands inside the header, so the header's rules reach it.
  assert.match(read("sections", "header.liquid"), /class="valor-header__icons">[\s\S]*?{%-?\s*render 'header-search'/);
});

for (const [name, width] of SIZES) {
  test(`${name}: every result starts on the same left edge`, async (t) => {
    const r = await panel(t, width);
    for (const image of r.images) near(image.left, r.images[0].left, "a product image's left edge");
    for (const title of r.titles) near(title.left, r.titles[0].left, "a product title's left edge");
  });

  test(`${name}: the results start under the field's own left edge`, async (t) => {
    const r = await panel(t, width);
    near(r.searchIcon.left, r.form.left, "the search icon");
    near(r.heading.left, r.form.left, "the group heading");
    near(r.images[0].left, r.form.left, "the first product image");
    near(r.textRow.left, r.form.left, "a text result");
    near(r.viewAllText.left, r.form.left, "the link to every result");
  });

  test(`${name}: one line stands between the field and the results`, async (t) => {
    const r = await panel(t, width);
    assert.equal(r.inputLine, "1px");
    assert.equal(r.panelLine, "0px");
  });

  test(`${name}: the close button stays on the field's row while results show`, async (t) => {
    const r = await panel(t, width);
    near(r.close.middle, r.input.middle, "the close button's middle");
    near(r.closeIcon.right, r.content.right, "the close icon's outer edge");
    assert.ok(
      r.field.right <= r.close.left + 0.5,
      `the field ends before the close button: ${r.field.right} against ${r.close.left}`,
    );
  });

  test(`${name}: the clear button and the arrow end on the column's edge`, async (t) => {
    const r = await panel(t, width);
    near(r.resetIcon.right, r.field.right, "the clear icon");
    near(r.arrow.right, r.form.right, "the arrow");
    near(r.viewAllLine.right, r.form.right, "the line above the link to every result");
    near(r.viewAllLine.left, r.form.left, "the line above the link to every result");
  });

  test(`${name}: a row's highlight reaches past the text without a sideways scroll`, async (t) => {
    const r = await panel(t, width);
    assert.ok(
      r.rows[0].left < r.images[0].left - 4,
      `the row begins before its image: ${r.rows[0].left} against ${r.images[0].left}`,
    );
    assert.ok(r.rows[0].left >= 0 && r.rows[0].right <= r.viewport, "the row stays on the screen");
    assert.equal(r.sideways, 0);
  });
}

test("desktop: the field and the results are a centred column as wide as the search page's field", async (t) => {
  const r = await panel(t, 1440);
  // assets/search.css: .valor-search__form { max-width: 36rem }
  assert.match(searchCss, /\.valor-search__form \{\s*max-width: 36rem;/);
  near(r.form.width, 36 * r.rem, "the column's width");
  near(r.form.center, r.viewport / 2, "the column's middle");
  near(r.field.width, r.form.width, "the field's width");
});

test("desktop: the column follows the theme's font scale, and the close button stays on its row", async (t) => {
  const r = await panel(t, 1440, { scale: 1.3 });
  near(r.rem, 20.8, "the root font size", 0.1);
  near(r.form.width, 36 * r.rem, "the column's width");
  near(r.close.middle, r.input.middle, "the close button's middle");
});

for (const width of [750, 800, 990]) {
  test(`${width}px: the column and its rows keep clear of the close button`, async (t) => {
    const r = await panel(t, width);
    near(r.form.center, r.viewport / 2, "the column's middle");
    for (const row of r.rows)
      assert.ok(
        row.right <= r.close.left + 0.5,
        `a row ends before the close button: ${row.right} against ${r.close.left}`,
      );
    near(r.close.middle, r.input.middle, "the close button's middle");
  });
}

for (const [name, width] of SIZES) {
  test(`${name}: a font with taller lines leaves the field and the close button on one row`, async (t) => {
    const r = await panel(t, width, { lineHeight: "2.4" });
    near(r.close.middle, r.input.middle, "the close button's middle");
    near(r.input.height, r.close.height, "the field's height");
  });
}

test("800px with the largest font scale: the column narrows to keep clear of the close button", async (t) => {
  const r = await panel(t, 800, { scale: 1.3 });
  assert.ok(r.form.width < 36 * r.rem - 1, `the column gives way: ${r.form.width} against ${36 * r.rem}`);
  near(r.form.center, r.viewport / 2, "the column's middle");
  for (const row of r.rows)
    assert.ok(
      row.right <= r.close.left + 0.5,
      `a row ends before the close button: ${row.right} against ${r.close.left}`,
    );
  assert.ok(
    r.field.right <= r.close.left + 0.5,
    `the field ends before the close button: ${r.field.right} against ${r.close.left}`,
  );
});

test("phone: the results have the whole width, under the field and the close button", async (t) => {
  const r = await panel(t, 390);
  near(r.form.left, r.content.left, "the form's left edge");
  near(r.form.right, r.content.right, "the form's right edge");
  near(r.viewAllLine.right, r.content.right, "the results' right edge");
  assert.ok(
    r.close.left >= r.field.right - 0.5 && r.close.right <= r.viewport,
    "the close button stands beside the field",
  );
  assert.ok(
    r.close.width >= 44 && r.close.height >= 44,
    `the close button is a full touch target: ${r.close.width}x${r.close.height}`,
  );
});

test("phone: long product names wrap inside the panel", async (t) => {
  const r = await panel(t, 320, {
    titles: ["Valor T-shirt - Underline Spray Limited Anniversary Edition", "Valor Tank Top"],
  });
  for (const title of r.titles)
    assert.ok(title.right <= r.content.right + 0.5, `a title stays inside: ${title.right} against ${r.content.right}`);
  near(r.images[1].left, r.images[0].left, "the second image's left edge");
  assert.equal(r.sideways, 0);
});

for (const [name, width] of SIZES) {
  test(`${name}, right to left: the layout is mirrored`, async (t) => {
    const r = await panel(t, width, { dir: "rtl" });
    near(r.closeIcon.left, r.content.left, "the close icon's outer edge");
    assert.ok(
      r.close.right <= r.field.left + 0.5,
      `the close button stands before the field: ${r.close.right} against ${r.field.left}`,
    );
    near(r.close.middle, r.input.middle, "the close button's middle");
    for (const image of r.images) near(image.right, r.form.right, "a product image's right edge");
    near(r.resetIcon.left, r.field.left, "the clear icon");
    assert.equal(r.sideways, 0);
  });

  test(`${name}: before any result the close button is on the field's row`, async (t) => {
    const r = await panel(t, width, { open: false });
    near(r.close.middle, r.input.middle, "the close button's middle");
    near(r.closeIcon.right, r.content.right, "the close icon's outer edge");
  });

  test(`${name}: without predictive search the field has the same place`, async (t) => {
    const withResults = await panel(t, width);
    const plain = await panel(t, width, { predictive: false });
    near(plain.field.left, withResults.field.left, "the field's left edge");
    near(plain.field.right, withResults.field.right, "the field's right edge");
    near(plain.close.middle, plain.input.middle, "the close button's middle");
    near(plain.close.left, withResults.close.left, "the close button's place");
  });
}

test("the header's own links keep their centred layout", async (t) => {
  const r = await panel(t, 1440);
  assert.deepEqual(r.cart, { display: "flex", justify: "center", align: "center" });
});
