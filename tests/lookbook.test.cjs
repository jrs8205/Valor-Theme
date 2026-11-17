const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// The Lookbook section (sections/lookbook.liquid) with the theme's real
// stylesheets and script. The markup below mirrors what the section and
// snippets/lookbook-card.liquid render.
//
// The row shows n images: 1.6 on phones, 3.6 from 750px, and 4, 5 or 6 from
// 990px when the merchant picks one of those layouts. An image is
// (row width - 12px * (n - 1)) / n wide, at a fixed 313:389 ratio.
const root = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");

let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  // WebKit on Windows can stall in close() after every test has passed;
  // npm test runs with --test-force-exit, so a stalled close can't hold the run.
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

const GAP = 12;
const RATIO = 389 / 313;
const slideWidth = (rowWidth, n) => (rowWidth - GAP * (n - 1)) / n;
const near = (actual, expected, tolerance = 0.6) => Math.abs(actual - expected) <= tolerance;

const photo = (n) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="626" height="778" viewBox="0 0 626 778"><rect width="626" height="778" fill="hsl(${(n * 47) % 360},45%,62%)"/><text x="313" y="440" font-size="220" text-anchor="middle" fill="#fff">${n}</text></svg>`,
  )}`;

// One look. product: false renders no card; button is "add" (a cart form),
// "link" (choose options) or "soldout".
function slide(prefix, n, look, cards) {
  const title = look.title || `Product ${n}`;
  // pending: the look's variant was not in the product's list (the first 250),
  // so the product's own card is printed and the variant's ID is on the slot.
  const pending = look.pending;
  const variant = pending ? "" : look.variant === undefined ? `Shade ${n} · 22"` : look.variant;
  const kind = pending ? "link" : look.button || "add";
  const href = pending ? `#product-${n}?variant=${pending.id}` : `#product-${n}`;
  let button;
  if (kind === "add") {
    button = `<form method="post" action="/cart/add" class="valor-lookbook__card-form">
        <input type="hidden" name="id" value="${1000 + n}">
        <button type="submit" name="add" class="valor-lookbook__card-button" aria-label="Add to cart: ${title}"><svg width="20" height="20"></svg></button>
        <div class="valor-lookbook__card-error" data-cart-error role="alert" hidden></div>
      </form>`;
  } else if (kind === "link") {
    button = `<a class="valor-lookbook__card-button valor-lookbook__card-button--link" href="${href}" aria-label="Choose options: ${title}"><svg width="20" height="20"></svg></a>`;
  } else {
    button = `<button type="button" class="valor-lookbook__card-button" disabled aria-label="Sold out"><svg width="20" height="20"></svg></button>`;
  }
  const card =
    look.product === false
      ? ""
      : `<div class="valor-lookbook__card">
          <a class="valor-lookbook__card-thumb" href="${href}" tabindex="-1" aria-hidden="true"><img src="${photo(n)}" width="64" height="64" alt=""></a>
          <div class="valor-lookbook__card-info">
            <a class="valor-lookbook__card-title" href="${href}">${title}</a>
            ${variant ? `<p class="valor-lookbook__card-variant">${variant}</p>` : ""}
            <div class="valor-lookbook__price">${
              look.sale
                ? `<span class="valor-lookbook__price-current valor-lookbook__price-current--sale"><span class="visually-hidden">Sale price</span>€${100 + n},00</span>
                   <span class="valor-lookbook__price-compare"><span class="visually-hidden">Regular price</span><s>€${150 + n},00</s></span>`
                : `<span class="valor-lookbook__price-current">€${100 + n},00</span>`
            }</div>
            <p class="valor-lookbook__unit-price" data-unit-price-wrapper hidden><span class="visually-hidden">Unit price</span><span data-unit-price></span></p>
            ${kind === "soldout" ? `<p class="valor-lookbook__card-status">Sold out</p>` : ""}
            ${pending && pending.note ? `<p class="valor-lookbook__card-note" data-lookbook-variant-note hidden>Variant not found. Check the variant ID.</p>` : ""}
          </div>
          ${button}
        </div>`;
  return `<li class="valor-lookbook__slide" data-look id="${prefix}look-${n}">
      <div class="valor-lookbook__media"><img class="valor-lookbook__image" src="${photo(n)}" width="626" height="778" alt="Look ${n}" draggable="false"></div>
      ${
        cards
          ? `<div class="valor-lookbook__card-slot"${
              pending ? ` data-lookbook-variant="${pending.id}" data-lookbook-product="${pending.product}"` : ""
            }>${card}</div>`
          : ""
      }
    </li>`;
}

function sectionMarkup({
  looks = 10,
  layout = "centered",
  cards = true,
  align = "center",
  prefix = "",
  rootUrl = "/",
} = {}) {
  const list = typeof looks === "number" ? Array.from({ length: looks }, () => ({})) : looks;
  return `<div class="shopify-section valor-section-lookbook">
    <section class="color-scheme-1 valor-lookbook valor-full-width valor-lookbook--align-${align}" style="--valor-section-padding-top: 56px; --valor-section-padding-bottom: 56px;">
      <div class="valor-lookbook__header">
        <p class="valor-lookbook__eyebrow">Ready to wear</p>
        <h2 class="valor-lookbook__heading valor-heading valor-heading--medium">Lookbook</h2>
        <div class="valor-lookbook__text rte"><p>Styled by our team.</p></div>
      </div>
      <valor-lookbook class="valor-lookbook__carousel" id="${prefix}lookbook" data-layout="${layout}" data-cards="${cards}" data-root-url="${rootUrl}">
        <ul class="valor-lookbook__track" role="list" tabindex="0" aria-label="Lookbook">
          ${list.map((look, index) => slide(prefix, index + 1, look, cards)).join("\n")}
        </ul>
        ${
          cards
            ? `<div class="valor-lookbook__nav">
          <button type="button" class="valor-lookbook__arrow valor-lookbook__arrow--prev" data-lookbook-prev aria-label="Previous look"><svg width="20" height="20"></svg></button>
          <button type="button" class="valor-lookbook__arrow valor-lookbook__arrow--next" data-lookbook-next aria-label="Next look"><svg width="20" height="20"></svg></button>
        </div>`
            : ""
        }
      </valor-lookbook>
    </section>
  </div>`;
}

// script: false leaves the script out; script: 2 includes it twice, as two
// sections on one page do.
function pageMarkup(options = {}) {
  const { dir = "ltr", script = true, sections = [options] } = options;
  const js = script ? `<script>${read("assets", "lookbook.js")}</script>`.repeat(script === true ? 1 : script) : "";
  return `<!doctype html><html dir="${dir}" lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      :root { --page-width: 75rem; --page-margin: 20px; --color-background: #fff; --color-foreground: #111;
        --color-button-bg: #111; --color-button-text: #fff; --valor-border-default: #bbb; --valor-border-subtle: #ddd;
        --valor-color-error: #b00020; --font-heading--family: sans-serif; --font-body--family: sans-serif; }
      body { margin: 0; font-family: sans-serif; }
      .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      ${read("assets", "critical.css")}
      ${read("assets", "lookbook.css")}
    </style></head><body>
    <script>
      // Stands in for the theme's cart script, which takes over every cart form.
      window.submits = 0;
      document.addEventListener("submit", function (event) { event.preventDefault(); window.submits += 1; });
      window.linkClicks = 0;
      document.addEventListener("click", function (event) { if (event.target.closest("a")) window.linkClicks += 1; });
    </script>
    <main>${sections.map((section) => sectionMarkup(section)).join("\n")}</main>
    ${js}
  </body></html>`;
}

async function lookbook(t, options = {}) {
  const { width = 1440, height = 900, reducedMotion } = options;
  const page = await browser.newPage({ viewport: { width, height } });
  t.after(() => page.close());
  // A control that is missing or hidden fails the test in seconds.
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.errors = errors;
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent(pageMarkup(options));
  await settle(page);
  return page;
}

// Waits until no row has moved for a moment, then long enough for the
// script's own "the scrolling has stopped" handling to have run.
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const tracks = [...document.querySelectorAll(".valor-lookbook__track")];
        const read = () => tracks.map((track) => track.scrollLeft).join(",");
        let last = read();
        let still = 0;
        const started = Date.now();
        const tick = () => {
          const now = read();
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 6 || Date.now() - started > 4000) return setTimeout(resolve, 200);
          setTimeout(tick, 40);
        };
        setTimeout(tick, 40);
      }),
  );

function geometry(page, selector = "valor-lookbook") {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const track = el.querySelector(".valor-lookbook__track");
    const box = (node) => {
      const r = node.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        centre: r.left + r.width / 2,
      };
    };
    const shown = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility === "visible" && node.getClientRects().length > 0;
    };
    const row = box(track);
    const slides = [...track.querySelectorAll("[data-look]")].map((node) => {
      const b = box(node);
      return {
        id: node.id,
        active: node.classList.contains("is-active"),
        ...b,
        inRow: b.right > row.left + 1 && b.left < row.right - 1,
        media: box(node.querySelector(".valor-lookbook__media")),
        card: shown(node.querySelector(".valor-lookbook__card")),
        cardBox: node.querySelector(".valor-lookbook__card") ? box(node.querySelector(".valor-lookbook__card")) : null,
      };
    });
    const prev = el.querySelector("[data-lookbook-prev]");
    const next = el.querySelector("[data-lookbook-next]");
    const active = slides.find((s) => s.active);
    return {
      row,
      slides,
      order: slides.map((s) => s.id),
      active: active ? active.id : null,
      activeCentre: active ? active.centre : null,
      rowCentre: row.left + row.width / 2,
      nav: shown(el.querySelector(".valor-lookbook__nav")),
      prev: prev ? { shown: shown(prev), disabled: prev.disabled, ...box(prev) } : null,
      next: next ? { shown: shown(next), disabled: next.disabled, ...box(next) } : null,
      loop: el.hasAttribute("data-loop"),
      still: el.hasAttribute("data-static"),
      enhanced: el.hasAttribute("data-enhanced"),
      scrollLeft: track.scrollLeft,
      scrolls: track.scrollWidth > track.clientWidth + 1,
      viewport: document.documentElement.clientWidth,
      pageScrolls: document.documentElement.scrollWidth > window.innerWidth,
    };
  }, selector);
}

// --- Layout (no script needed) -------------------------------------------------

test("desktop, centered: 3.6 images in the row, 12px apart, at 313:389", async (t) => {
  const page = await lookbook(t, { script: false });
  const g = await geometry(page);
  assert.equal(g.row.width, 1440, "the row is the whole screen wide");
  const expected = slideWidth(1440, 3.6); // 391.33
  assert.ok(near(g.slides[0].width, expected), `${g.slides[0].width} vs ${expected}`);
  assert.ok(near(g.slides[0].media.width, expected));
  assert.ok(
    Math.abs(g.slides[0].media.height / g.slides[0].media.width - RATIO) < 0.005,
    JSON.stringify(g.slides[0].media),
  );
  assert.ok(near(g.slides[1].left - g.slides[0].right, GAP, 0.1), "12px between images");
  assert.ok(near(g.slides[0].centre, 720, 1), "the first look starts in the middle");
  assert.equal(g.pageScrolls, false);
});

test("phone: 1.6 images in the row", async (t) => {
  const page = await lookbook(t, { width: 390, height: 844, script: false });
  const g = await geometry(page);
  assert.equal(g.row.width, 390);
  assert.ok(near(g.slides[0].width, slideWidth(390, 1.6)), String(g.slides[0].width)); // 239.25
  assert.ok(near(g.slides[0].centre, 195, 1));
  assert.ok(near(g.slides[1].left - g.slides[0].right, GAP, 0.1));
  assert.equal(g.pageScrolls, false);
});

// Seen on a store: the screen-reader label of a sale price is taken out of the
// flow, and without a positioned look around it it was placed against the
// carousel, outside the row's own scrolling, where it widened the whole page.
for (const script of [false, true]) {
  test(`a sale price far along the row does not widen the page (${script ? "with" : "without"} the script)`, async (t) => {
    const looks = Array.from({ length: 12 }, (_, i) => ({ sale: i === 0 || i === 9 }));
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      const page = await lookbook(t, { looks, script, width, height });
      const measured = await page.evaluate(() => {
        window.scrollTo(500, 0);
        const scrolledTo = window.scrollX;
        window.scrollTo(0, 0);
        return { page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth, scrolledTo };
      });
      assert.equal(measured.page, measured.screen, `the page is as wide as the ${width}px screen`);
      assert.equal(measured.scrolledTo, 0, "and cannot be scrolled sideways");
    }
  });
}

for (const [n, width] of [
  [4, 351],
  [5, 278.4],
  [6, 230],
]) {
  test(`layout ${n}: ${n} images fill a 1440px screen edge to edge, each with its card`, async (t) => {
    const page = await lookbook(t, { layout: String(n), script: false });
    const g = await geometry(page);
    assert.ok(near(g.slides[0].width, width), `${g.slides[0].width} vs ${width}`);
    assert.ok(near(g.slides[0].left, 0, 0.1), "the first image starts at the screen edge");
    assert.ok(near(g.slides[n - 1].right, 1440), `image ${n} ends at the other edge: ${g.slides[n - 1].right}`);
    assert.ok(near(g.slides[1].left - g.slides[0].right, GAP, 0.1));
    assert.ok(Math.abs(g.slides[0].media.height / g.slides[0].media.width - RATIO) < 0.005);
    assert.deepEqual(
      g.slides.slice(0, n).map((s) => s.card),
      Array(n).fill(true),
      "every image has its own card",
    );
    assert.equal(g.nav, false, "no arrows in this layout");
    assert.equal(g.pageScrolls, false);
  });
}

test("layout 6 on an 800px tablet falls back to the centered row", async (t) => {
  const page = await lookbook(t, { layout: "6", width: 800, script: false });
  const g = await geometry(page);
  assert.ok(near(g.slides[0].width, slideWidth(800, 3.6)), String(g.slides[0].width)); // 213.56
  assert.ok(near(g.slides[0].centre, 400, 1));
});

test("layouts 4–6 start at 990px", async (t) => {
  const below = await geometry(await lookbook(t, { layout: "4", width: 989, script: false }));
  assert.ok(near(below.slides[0].width, slideWidth(989, 3.6)), String(below.slides[0].width));
  const from = await geometry(await lookbook(t, { layout: "4", width: 990, script: false }));
  assert.ok(near(from.slides[0].width, slideWidth(990, 4)), String(from.slides[0].width));
});

test("the phone layout ends at 750px", async (t) => {
  const below = await geometry(await lookbook(t, { width: 749, script: false }));
  assert.ok(near(below.slides[0].width, slideWidth(749, 1.6)), String(below.slides[0].width));
  const from = await geometry(await lookbook(t, { width: 750, script: false }));
  assert.ok(near(from.slides[0].width, slideWidth(750, 3.6)), String(from.slides[0].width));
});

test("layout 6 leaves the thumbnail out of its narrow cards, layout 4 keeps it", async (t) => {
  const thumb = (page) =>
    page.$eval(
      ".valor-lookbook__card-thumb",
      (node) => getComputedStyle(node).display !== "none" && node.offsetWidth > 0,
    );
  assert.equal(await thumb(await lookbook(t, { layout: "6", script: false })), false);
  assert.equal(await thumb(await lookbook(t, { layout: "4", script: false })), true);
  // Below 990px layout 6 is the centred row, where only the card's own width
  // decides (see "a card too narrow for it leaves the thumbnail out").
  assert.equal(
    await thumb(await lookbook(t, { layout: "6", width: 900, script: false })),
    true,
    "not on a tablet's centered row that has the room (241px cards)",
  );
});

test("long names wrap inside the narrowest card without widening anything", async (t) => {
  const looks = Array.from({ length: 8 }, () => ({}));
  looks[0] = {
    title: "An extraordinarily long product title that keeps going Supercalifragilisticexpialidocious-Edition",
    variant: "Pearl Ivory by a very long designer name · Extra long one hundred and ten centimetres",
  };
  const page = await lookbook(t, { layout: "6", looks, script: false });
  const g = await geometry(page);
  assert.ok(near(g.slides[0].width, 230), `the image keeps its width: ${g.slides[0].width}`);
  const card = await page.$eval("#look-1 .valor-lookbook__card", (node) => ({
    overflow: node.scrollWidth - node.clientWidth,
    right: node.getBoundingClientRect().right,
    titleRight: node.querySelector(".valor-lookbook__card-title").getBoundingClientRect().right,
  }));
  assert.ok(card.overflow <= 1, JSON.stringify(card));
  assert.ok(card.right <= g.slides[0].right + 0.5, JSON.stringify(card));
  assert.ok(card.titleRight <= card.right + 0.5, JSON.stringify(card));
  assert.equal(g.pageScrolls, false);
});

// The maintainer's ruling: the cards of a section are always the same size,
// whatever each of them holds. They are as tall as the tallest one, so
// nothing in a card is cut off.
const MIXED_LOOKS = [
  { title: "A product with a very long name that needs several lines in a narrow card" },
  {},
  { variant: null },
  { button: "soldout" },
  { sale: true },
  { product: false },
  {},
  { variant: null, button: "link" },
];
const cardSizes = (page) =>
  page.$$eval(".valor-lookbook__card", (cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      const media = card.closest("[data-look]").querySelector(".valor-lookbook__media").getBoundingClientRect();
      return {
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
        below: Math.round((box.top - media.bottom) * 10) / 10,
        cut: card.scrollHeight - card.clientHeight,
      };
    }),
  );
const spread = (values) => Math.max(...values) - Math.min(...values);

for (const [name, options] of [
  ["the centred row", {}],
  ["the centred row without the script", { script: false }],
  ["layout 4", { layout: "4" }],
  ["layout 5", { layout: "5" }],
  ["layout 6", { layout: "6" }],
  ["a phone", { width: 390, height: 844 }],
  ["right-to-left", { dir: "rtl" }],
]) {
  test(`every card is the same size whatever it holds: ${name}`, async (t) => {
    const page = await lookbook(t, { looks: MIXED_LOOKS, ...options });
    const sizes = await cardSizes(page);
    assert.equal(sizes.length, 7, "seven looks have a product");
    const report = JSON.stringify(sizes);
    assert.ok(spread(sizes.map((s) => s.height)) <= 0.5, `one height: ${report}`);
    assert.ok(spread(sizes.map((s) => s.width)) <= 0.5, `one width: ${report}`);
    assert.ok(spread(sizes.map((s) => s.below)) <= 0.5, `the same distance under the image: ${report}`);
    assert.ok(
      sizes.every((s) => s.cut <= 1),
      `nothing in a card is cut off: ${report}`,
    );
    const g = await geometry(page);
    assert.equal(g.pageScrolls, false);
  });
}

test("a message in one card (a declined add) keeps the cards the same size", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: MIXED_LOOKS });
  const before = await cardSizes(page);
  // A message long enough to make its card the tallest of them all.
  const message = await page.$eval("#look-2 [data-cart-error]", (node) => {
    node.textContent = "The product 'Product 2 - Shade 2' is already sold out. ".repeat(4);
    node.hidden = false;
    const box = node.getBoundingClientRect();
    const card = node.closest(".valor-lookbook__card").getBoundingClientRect();
    return { height: box.height, inside: box.top >= card.top && box.bottom <= card.bottom + 0.5 };
  });
  assert.ok(message.height > 0 && message.inside, `the message shows inside its card: ${JSON.stringify(message)}`);
  const after = await cardSizes(page);
  assert.ok(after[0].height > before[0].height, "every card grew with it");
  assert.ok(spread(after.map((s) => s.height)) <= 0.5, JSON.stringify(after));
  assert.ok(after.every((s) => s.cut <= 1));
});

test("desktop: the arrows are level with the middle of the card, however tall the cards are", async (t) => {
  for (const looks of [4, MIXED_LOOKS]) {
    const page = await lookbook(t, { looks });
    const g = await geometry(page);
    const card = g.slides.find((s) => s.active).cardBox;
    const cardMiddle = card.top + card.height / 2;
    for (const arrow of [g.prev, g.next]) {
      assert.ok(near(arrow.top + arrow.height / 2, cardMiddle, 1), JSON.stringify([arrow, card]));
    }
  }
});

test("without JavaScript every look shows its card and there are no arrows", async (t) => {
  const page = await lookbook(t, { looks: 4, script: false });
  const g = await geometry(page);
  assert.equal(g.enhanced, false);
  assert.deepEqual(
    g.slides.map((s) => s.card),
    [true, true, true, true],
  );
  assert.equal(g.nav, false);
  assert.equal(g.scrolls, true, "the row still scrolls by itself");
});

test("cards off: images only, no cards and no arrows", async (t) => {
  const page = await lookbook(t, { cards: false, script: false });
  const g = await geometry(page);
  assert.equal(
    await page.locator(".valor-lookbook__card, .valor-lookbook__nav, .valor-lookbook__card-slot").count(),
    0,
  );
  assert.ok(near(g.slides[0].height, g.slides[0].media.height, 1), "a look is just its image");
});

test("a look without a product has no card and stays level with the others", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: [{}, { product: false }, {}, {}], script: false });
  const g = await geometry(page);
  assert.deepEqual(
    g.slides.map((s) => s.card),
    [true, false, true, true],
  );
  assert.ok(near(g.slides[1].media.top, g.slides[0].media.top, 0.5));
  assert.ok(near(g.slides[1].media.height, g.slides[0].media.height, 0.5));
});

test("the image fills its frame, cropped and never stretched", async (t) => {
  const page = await lookbook(t, { script: false });
  const r = await page.$eval("#look-1", (node) => {
    const media = node.querySelector(".valor-lookbook__media").getBoundingClientRect();
    const image = node.querySelector(".valor-lookbook__image");
    const box = image.getBoundingClientRect();
    return { fit: getComputedStyle(image).objectFit, dw: box.width - media.width, dh: box.height - media.height };
  });
  assert.equal(r.fit, "cover");
  assert.ok(Math.abs(r.dw) < 0.5 && Math.abs(r.dh) < 0.5, JSON.stringify(r));
});

for (const [align, expected] of [
  ["left", ["start", "left"]],
  ["center", ["center"]],
  ["right", ["end", "right"]],
]) {
  test(`the heading block follows the alignment setting: ${align}`, async (t) => {
    const page = await lookbook(t, { align, width: 2560, script: false });
    const r = await page.evaluate(() => {
      const header = document.querySelector(".valor-lookbook__header").getBoundingClientRect();
      const heading = document.querySelector(".valor-lookbook__heading");
      return {
        align: getComputedStyle(heading).textAlign,
        left: header.left,
        width: header.width,
        row: document.querySelector(".valor-lookbook__track").getBoundingClientRect().width,
      };
    });
    assert.ok(expected.includes(r.align), JSON.stringify(r));
    assert.equal(r.width, 1160, "the heading block keeps the page width and margins (75rem - 2 * 20px)");
    assert.equal(r.row, 2560, "the image row is the whole screen wide");
  });
}

test("the heading block keeps the page margins on a phone", async (t) => {
  const page = await lookbook(t, { width: 390, height: 844, script: false });
  const header = await page.$eval(".valor-lookbook__header", (node) => {
    const r = node.getBoundingClientRect();
    return { left: r.left, right: r.right };
  });
  assert.equal(header.left, 20);
  assert.equal(header.right, 370);
});

test("right-to-left: the first look is in the middle and the second is to its left", async (t) => {
  const page = await lookbook(t, { dir: "rtl", script: false });
  const g = await geometry(page);
  assert.ok(near(g.slides[0].centre, 720, 1), String(g.slides[0].centre));
  assert.ok(g.slides[1].right < g.slides[0].left, "the row runs right to left");
  const tiles = await geometry(await lookbook(t, { dir: "rtl", layout: "4", script: false }));
  assert.ok(near(tiles.slides[0].right, 1440), "layout 4 starts at the right edge");
  assert.ok(near(tiles.slides[3].left, 0, 0.6));
});

// --- The element: active look, cards, arrows, keyboard ---------------------------
// Four looks are too few to loop on any screen, so these are about the plain
// row: first look first, last look last.

async function press(page, selector, times = 1) {
  for (let i = 0; i < times; i += 1) {
    await page.click(selector);
    await settle(page);
  }
}
const cards = (g) => g.slides.map((s) => s.card);

test("centered: only the look in the middle shows its card", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  const g = await geometry(page);
  assert.equal(g.enhanced, true);
  assert.equal(g.active, "look-1");
  assert.deepEqual(cards(g), [true, false, false, false]);
  assert.equal(g.nav, true, "with its arrows");
});

test("the arrows move one look at a time and the card follows", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  await press(page, "[data-lookbook-next]");
  let g = await geometry(page);
  assert.equal(g.active, "look-2");
  assert.ok(near(g.activeCentre, 720, 1), `centred: ${g.activeCentre}`);
  assert.deepEqual(cards(g), [false, true, false, false]);
  await press(page, "[data-lookbook-prev]");
  g = await geometry(page);
  assert.equal(g.active, "look-1");
  assert.deepEqual(cards(g), [true, false, false, false]);
});

test("two quick presses of the arrow move two looks", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  await page.click("[data-lookbook-next]");
  await page.click("[data-lookbook-next]");
  await settle(page);
  assert.equal((await geometry(page)).active, "look-3");
});

test("without a loop the arrows stop at the first and the last look", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  let g = await geometry(page);
  assert.equal(g.loop, false);
  assert.equal(g.prev.disabled, true);
  assert.equal(g.next.disabled, false);
  await press(page, "[data-lookbook-next]", 3);
  g = await geometry(page);
  assert.equal(g.active, "look-4");
  assert.equal(g.next.disabled, true);
  assert.equal(g.prev.disabled, false);
});

test("every look can stand in the middle even when there are only two", async (t) => {
  const page = await lookbook(t, { looks: 2 });
  await press(page, "[data-lookbook-next]");
  const g = await geometry(page);
  assert.equal(g.active, "look-2");
  assert.ok(near(g.activeCentre, 720, 1), String(g.activeCentre));
});

test("desktop: the arrows sit on either side of the centred card", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  const g = await geometry(page);
  const card = g.slides[0].cardBox;
  assert.ok(g.prev.right <= card.left && card.left - g.prev.right < 24, JSON.stringify([g.prev, card]));
  assert.ok(g.next.left >= card.right && g.next.left - card.right < 24, JSON.stringify([g.next, card]));
  const middle = g.prev.top + g.prev.height / 2;
  assert.ok(middle > card.top && middle < card.bottom, "level with the card");
});

test("phone: the arrows sit above the card at the edges of the row", async (t) => {
  const page = await lookbook(t, { looks: 4, width: 390, height: 844 });
  const g = await geometry(page);
  const look = g.slides[0];
  assert.deepEqual(cards(g), [true, false, false, false]);
  assert.ok(g.prev.left >= 8 && g.prev.left <= 16, String(g.prev.left));
  assert.ok(g.next.right <= 382 && g.next.right >= 374, String(g.next.right));
  assert.ok(g.prev.top >= look.media.bottom, "below the image");
  assert.ok(g.prev.bottom <= look.cardBox.top, "above the card");
});

test("arrow keys on the row move between looks", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  await page.focus(".valor-lookbook__track");
  await page.keyboard.press("ArrowRight");
  await settle(page);
  assert.equal((await geometry(page)).active, "look-2");
  await page.keyboard.press("ArrowLeft");
  await settle(page);
  assert.equal((await geometry(page)).active, "look-1");
});

// Safari's engine leaves links out of the Tab order unless the user changed
// its settings, so there Tab goes straight to the buy button.
const TAB_STOPS_AT_LINKS = process.env.VALOR_BROWSER !== "webkit";

test("the cards of the other looks are not reachable with Tab", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  await page.focus(".valor-lookbook__track");
  const stops = [];
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Tab");
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        const look = el.closest("[data-look]");
        return { look: look ? look.id : null, card: !!el.closest(".valor-lookbook__card"), tag: el.tagName };
      }),
    );
  }
  const inCards = stops.filter((stop) => stop.card);
  assert.ok(inCards.length > 0, JSON.stringify(stops));
  assert.ok(
    inCards.every((stop) => stop.look === "look-1"),
    "only the centred look's card: " + JSON.stringify(stops),
  );
  assert.ok(
    inCards.some((stop) => stop.tag === "BUTTON"),
    "its buy button: " + JSON.stringify(stops),
  );
  if (TAB_STOPS_AT_LINKS) {
    assert.deepEqual(stops[0], { look: "look-1", card: true, tag: "A" }, "the product name first");
    assert.deepEqual(stops[1], { look: "look-1", card: true, tag: "BUTTON" }, "then the buy button");
  }
  // After the centred card the next stop is outside the cards (the arrows),
  // not another look's card. (Further presses leave the page and come round.)
  const first = stops.findIndex((stop) => stop.card);
  const after = stops.slice(first).find((stop) => !stop.card);
  assert.ok(after, "Tab leaves the cards after the centred one: " + JSON.stringify(stops));
});

test("clicking an image at the side brings it to the middle", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  await page.click("#look-2 .valor-lookbook__media");
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-2");
  assert.ok(near(g.activeCentre, 720, 1));
});

test("a look without a product keeps the arrows where they are and its card place empty", async (t) => {
  const page = await lookbook(t, { looks: [{}, { product: false }, {}, {}] });
  const before = await geometry(page);
  await press(page, "[data-lookbook-next]");
  const g = await geometry(page);
  assert.equal(g.active, "look-2");
  assert.deepEqual(cards(g), [false, false, false, false]);
  assert.equal(g.nav, true);
  assert.ok(near(g.prev.top, before.prev.top, 0.5) && near(g.next.top, before.next.top, 0.5), "nothing jumps");
  assert.ok(near(g.row.height, before.row.height, 0.5));
  await press(page, "[data-lookbook-next]");
  assert.equal((await geometry(page)).active, "look-3", "and the arrows still lead on");
});

test("layouts 4–6 with the script: every card shows and there are no arrows", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 4 });
  const g = await geometry(page);
  assert.equal(g.enhanced, true);
  assert.deepEqual(cards(g), [true, true, true, true]);
  assert.equal(g.nav, false);
});

test("fewer images than the row holds: the row is centred and does not scroll", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 3 });
  const g = await geometry(page);
  assert.equal(g.still, true);
  assert.equal(g.scrolls, false);
  const blank = (1440 - (3 * 351 + 2 * GAP)) / 2;
  assert.ok(near(g.slides[0].left, blank, 1), `${g.slides[0].left} vs ${blank}`);
  assert.ok(near(1440 - g.slides[2].right, blank, 1));
});

test("a row that scrolls is not marked as still", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 5 });
  const g = await geometry(page);
  assert.equal(g.still, false);
  assert.ok(near(g.slides[0].left, 0, 0.6));
});

test("reduced motion: the row moves at once, without sliding", async (t) => {
  const page = await lookbook(t, { looks: 4, reducedMotion: true });
  await page.click("[data-lookbook-next]");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const g = await geometry(page);
  assert.equal(g.active, "look-2");
  assert.ok(near(g.activeCentre, 720, 1), `already there: ${g.activeCentre}`);
});

test("without reduced motion the row slides to the next look", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  await page.click("[data-lookbook-next]");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const g = await geometry(page);
  const second = g.slides[1];
  assert.ok(second.centre - 720 > 20, `still on its way: ${second.centre}`);
});

test("resizing from desktop to phone keeps the same look in the middle", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  await press(page, "[data-lookbook-next]", 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-3");
  assert.ok(near(g.activeCentre, 195, 1), String(g.activeCentre));
  assert.deepEqual(cards(g), [false, false, true, false]);
});

test("resizing between the centered row and layout 4 switches cards and arrows", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 5, width: 800 });
  let g = await geometry(page);
  assert.deepEqual(cards(g), [true, false, false, false, false]);
  assert.equal(g.nav, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  g = await geometry(page);
  assert.deepEqual(cards(g), [true, true, true, true, true]);
  assert.equal(g.nav, false);
  assert.ok(near(g.slides[0].left, 0, 0.6), "and the row starts at the edge again");
});

test("selecting a block in the theme editor brings its look to the middle", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  await page.$eval("#look-3", (node) => node.dispatchEvent(new CustomEvent("shopify:block:select", { bubbles: true })));
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-3");
  assert.ok(near(g.activeCentre, 720, 1));
});

test("two lookbooks on one page work on their own, and the script may load twice", async (t) => {
  const page = await lookbook(t, {
    script: 2,
    height: 2000,
    sections: [
      { prefix: "a-", looks: 4 },
      { prefix: "b-", looks: 4 },
    ],
  });
  assert.deepEqual(page.errors, []);
  await press(page, "#a-lookbook [data-lookbook-next]");
  assert.equal((await geometry(page, "#a-lookbook")).active, "a-look-2");
  assert.equal((await geometry(page, "#b-lookbook")).active, "b-look-1");
  assert.deepEqual(page.errors, []);
});

test("cards off with the script: an image row with no arrows that the keys still move", async (t) => {
  const page = await lookbook(t, { looks: 4, cards: false });
  assert.equal(await page.locator(".valor-lookbook__nav, .valor-lookbook__card").count(), 0);
  await page.focus(".valor-lookbook__track");
  await page.keyboard.press("ArrowRight");
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-2");
  assert.ok(near(g.activeCentre, 720, 1));
});

test("a section re-rendered by the theme editor works again", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  await page.evaluate(() => {
    const section = document.querySelector(".shopify-section");
    const html = section.innerHTML;
    section.innerHTML = "";
    section.innerHTML = html;
  });
  await settle(page);
  await press(page, "[data-lookbook-next]");
  assert.equal((await geometry(page)).active, "look-2");
  assert.deepEqual(page.errors, []);
});

// --- The endless loop ---------------------------------------------------------------
// With at least two more looks than touch the row, the row goes round: real
// looks move from one end to the other, nothing is copied. Fewer: no loop.

// The looks in the row from left to right, with what the row shows of them.
function row(g) {
  const sorted = [...g.slides].sort((a, b) => a.left - b.left);
  const inRow = sorted.filter((s) => s.inRow);
  return {
    sorted: sorted.map((s) => s.id),
    inRow: inRow.map((s) => s.id),
    hiddenLeft: sorted.filter((s) => s.right <= g.row.left + 1).length,
    hiddenRight: sorted.filter((s) => s.left >= g.row.right - 1).length,
    coveredLeft: inRow.length > 0 && inRow[0].left <= g.row.left + 0.6,
    coveredRight: inRow.length > 0 && inRow[inRow.length - 1].right >= g.row.right - 0.6,
  };
}
const ids = (prefix, numbers) => numbers.map((n) => `${prefix}look-${n}`);

test("with enough looks the row loops: next from the last look shows the first", async (t) => {
  const page = await lookbook(t, { looks: 10, reducedMotion: true });
  assert.equal((await geometry(page)).loop, true);
  const seen = [];
  for (let i = 0; i < 10; i += 1) {
    await press(page, "[data-lookbook-next]");
    seen.push((await geometry(page)).active);
  }
  assert.deepEqual(seen, ids("", [2, 3, 4, 5, 6, 7, 8, 9, 10, 1]));
  await press(page, "[data-lookbook-prev]");
  assert.equal((await geometry(page)).active, "look-10", "and back round the other way");
});

test("a looping row never ends: both arrows work at the first look", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  const g = await geometry(page);
  assert.equal(g.prev.disabled, false);
  assert.equal(g.next.disabled, false);
  await press(page, "[data-lookbook-prev]");
  assert.equal((await geometry(page)).active, "look-10");
});

test("looping never copies a look or a card", async (t) => {
  const page = await lookbook(t, { looks: 10, reducedMotion: true });
  await press(page, "[data-lookbook-next]", 25);
  const counts = await page.evaluate(() => {
    const looks = [...document.querySelectorAll("[data-look]")].map((node) => node.id);
    return {
      looks: looks.length,
      unique: new Set(looks).size,
      cards: document.querySelectorAll(".valor-lookbook__card").length,
    };
  });
  assert.deepEqual(counts, { looks: 10, unique: 10, cards: 10 });
  assert.equal((await geometry(page)).active, "look-6", "25 steps on from the first of ten");
});

test("the active image stays in the middle when the row wraps, sliding", async (t) => {
  const page = await lookbook(t, { looks: 7 });
  for (let i = 0; i < 9; i += 1) {
    await press(page, "[data-lookbook-next]");
    const g = await geometry(page);
    assert.equal(g.active, `look-${((i + 1) % 7) + 1}`);
    assert.ok(near(g.activeCentre, 720, 1), `step ${i + 1}: ${g.activeCentre}`);
    const r = row(g);
    assert.ok(r.coveredLeft && r.coveredRight, `no blank edge at step ${i + 1}: ${JSON.stringify(r)}`);
  }
});

test("on load the looks before the first one are the last ones", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  const g = await geometry(page);
  const r = row(g);
  assert.equal(g.active, "look-1");
  assert.ok(near(g.activeCentre, 720, 1));
  assert.deepEqual(r.inRow, ids("", [9, 10, 1, 2, 3]), "the row runs round from the last looks into the first");
  assert.ok(r.coveredLeft && r.coveredRight, JSON.stringify(r));
  assert.ok(r.hiddenLeft >= 1 && r.hiddenRight >= 1, "with a look in hand on each side: " + JSON.stringify(r));
});

test("6 looks on a desktop do not loop, 7 do", async (t) => {
  assert.equal((await geometry(await lookbook(t, { looks: 6 }))).loop, false);
  const g = await geometry(await lookbook(t, { looks: 7 }));
  assert.equal(g.loop, true);
  const r = row(g);
  assert.ok(r.hiddenLeft === 1 && r.hiddenRight === 1, JSON.stringify(r));
});

test("4 looks on a phone do not loop, 5 do", async (t) => {
  assert.equal((await geometry(await lookbook(t, { looks: 4, width: 390, height: 844 }))).loop, false);
  const g = await geometry(await lookbook(t, { looks: 5, width: 390, height: 844 }));
  assert.equal(g.loop, true);
  assert.deepEqual(row(g).inRow, ids("", [5, 1, 2]));
});

test("layout 4 loops with 6 looks and not with 5", async (t) => {
  assert.equal((await geometry(await lookbook(t, { layout: "4", looks: 5 }))).loop, false);
  const g = await geometry(await lookbook(t, { layout: "4", looks: 6 }));
  assert.equal(g.loop, true);
  const r = row(g);
  assert.deepEqual(r.inRow, ids("", [1, 2, 3, 4]), "the first look still starts the row");
  assert.ok(near(g.slides.find((s) => s.id === "look-1").left, 0, 0.6));
  assert.ok(r.hiddenLeft === 1 && r.hiddenRight === 1, JSON.stringify(r));
});

test("a row without a loop keeps the looks in the merchant's order", async (t) => {
  const g = await geometry(await lookbook(t, { looks: 6 }));
  assert.deepEqual(g.order, ids("", [1, 2, 3, 4, 5, 6]));
});

test("scrolling to the very end and stopping there re-centres the row", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  await page.$eval(".valor-lookbook__track", (track) => track.scrollTo({ left: 1e6 }));
  await settle(page);
  let r = row(await geometry(page));
  assert.ok(r.coveredLeft && r.coveredRight, "no blank space left in the row: " + JSON.stringify(r));
  assert.ok(r.hiddenLeft >= 1 && r.hiddenRight >= 1, JSON.stringify(r));
  await page.$eval(".valor-lookbook__track", (track) => track.scrollTo({ left: -1e6 }));
  await settle(page);
  r = row(await geometry(page));
  assert.ok(r.coveredLeft && r.coveredRight, JSON.stringify(r));
  assert.ok(r.hiddenLeft >= 1 && r.hiddenRight >= 1, JSON.stringify(r));
});

// Seen on a store: swipes that follow each other without a rest between them
// never let the row "stop", so the far looks never came round and the row
// ran out (the preset's 8 looks on a phone: after 4 swipes). A finger landing
// on the row now brings them round at once.
for (const dir of ["ltr", "rtl"]) {
  test(`a finger landing on a row that has not rested brings the far looks round (${dir})`, async (t) => {
    const page = await lookbook(t, { looks: 8, width: 390, height: 844, dir });
    const result = await page.evaluate(() => {
      const el = document.querySelector("valor-lookbook");
      const track = el.querySelector(".valor-lookbook__track");
      const slides = () => [...track.querySelectorAll("[data-look]")];
      const ahead = () => slides().length - 1 - slides().indexOf(el.active);
      const start = { order: slides().map((s) => s.id), ahead: ahead() };
      // Three looks on, at once and with no rest: what quick swipes amount to.
      const pitch = slides()[1].getBoundingClientRect().left - slides()[0].getBoundingClientRect().left;
      track.scrollTo({ left: track.scrollLeft + 3 * pitch, behavior: "instant" });
      const active = el.active;
      const before = { id: active.id, ahead: ahead(), left: active.getBoundingClientRect().left };
      track.dispatchEvent(new Event("touchstart", { bubbles: true }));
      const after = {
        id: el.active.id,
        ahead: ahead(),
        left: active.getBoundingClientRect().left,
        ids: slides().map((s) => s.id),
        snapping: getComputedStyle(track).scrollSnapType,
      };
      track.dispatchEvent(new Event("touchend", { bubbles: true }));
      return { start, before, after };
    });
    assert.equal(result.before.id, "look-4", "three looks on from the first");
    assert.equal(result.before.ahead, result.start.ahead - 3, "the row had not brought anything round yet");
    assert.equal(result.after.id, "look-4", "the same look is still in the middle");
    assert.equal(result.after.ahead, result.start.ahead, "as many looks ahead again as at rest");
    assert.ok(near(result.after.left, result.before.left, 1), `nothing moved on screen: ${JSON.stringify(result)}`);
    assert.equal(new Set(result.after.ids).size, 8, "no look was copied or lost");
    assert.match(result.after.snapping, /mandatory/, "snapping is back on");
    const g = await geometry(page);
    assert.equal(g.pageScrolls, false);
  });
}

test("a finger on a row at rest moves nothing", async (t) => {
  const page = await lookbook(t, { looks: 8, width: 390, height: 844 });
  const result = await page.evaluate(() => {
    const track = document.querySelector(".valor-lookbook__track");
    const ids = () => [...track.querySelectorAll("[data-look]")].map((s) => s.id).join();
    const before = { ids: ids(), left: track.scrollLeft };
    let moves = 0;
    const observer = new MutationObserver((records) => (moves += records.length));
    observer.observe(track, { childList: true });
    track.dispatchEvent(new Event("touchstart", { bubbles: true }));
    const records = observer.takeRecords().length;
    observer.disconnect();
    return { same: ids() === before.ids && track.scrollLeft === before.left, moves: moves + records };
  });
  assert.deepEqual(result, { same: true, moves: 0 });
});

test("quick swipes one after another never run out of looks", async (t) => {
  if ((process.env.VALOR_BROWSER || "chromium") !== "chromium") {
    t.skip("real touch input is only available through Chromium's own protocol");
    return;
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  await page.setContent(pageMarkup({ looks: 8 }));
  await settle(page);
  const cdp = await context.newCDPSession(page);
  const y = await page.$eval(".valor-lookbook__track", (track) => Math.round(track.getBoundingClientRect().top + 100));
  // How much empty row shows at the end the swipes are heading for, every frame.
  await page.evaluate(() => {
    const track = document.querySelector(".valor-lookbook__track");
    window.blank = -Infinity;
    const tick = () => {
      const row = track.getBoundingClientRect();
      const rights = [...track.querySelectorAll("[data-look]")].map((s) => s.getBoundingClientRect().right);
      window.blank = Math.max(window.blank, row.right - Math.max(...rights));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const seen = new Set();
  for (let swipe = 0; swipe < 10; swipe++) {
    let x = 330;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 0; i < 10; i++) {
      x -= 25;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(x), y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    // No rest: the next finger lands before the row counts as stopped (120 ms).
    await page.waitForTimeout(40);
    seen.add(await page.evaluate(() => document.querySelector("valor-lookbook").active.id));
  }
  const blank = await page.evaluate(() => window.blank);
  assert.ok(blank <= 0.5, `the row never showed its end: ${blank}px of empty row`);
  assert.equal(seen.size, 8, `all eight looks came by: ${[...seen].join(" ")}`);
});

test("holding the arrow key goes round and round", async (t) => {
  const page = await lookbook(t, { looks: 7 });
  await page.focus(".valor-lookbook__track");
  for (let i = 0; i < 16; i += 1) await page.keyboard.press("ArrowRight");
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-3", "16 steps on from the first of seven");
  assert.ok(near(g.activeCentre, 720, 1));
  const r = row(g);
  assert.ok(r.coveredLeft && r.coveredRight, JSON.stringify(r));
});

test("right-to-left: the row loops and ArrowLeft goes to the next look", async (t) => {
  const page = await lookbook(t, { looks: 10, dir: "rtl", reducedMotion: true });
  let g = await geometry(page);
  assert.equal(g.loop, true);
  assert.deepEqual(row(g).inRow, ids("", [3, 2, 1, 10, 9]), "mirrored: the second look is to the left of the first");
  await page.focus(".valor-lookbook__track");
  const seen = [];
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("ArrowLeft");
    await settle(page);
    g = await geometry(page);
    seen.push(g.active);
    assert.ok(near(g.activeCentre, 720, 1), `step ${i + 1}: ${g.activeCentre}`);
  }
  assert.deepEqual(seen, ids("", [2, 3, 4, 5, 6, 7, 8, 9, 10, 1]));
  await page.keyboard.press("ArrowRight");
  await settle(page);
  assert.equal((await geometry(page)).active, "look-10");
});

test("layout 4 goes round as well, a whole image at a time", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 6, reducedMotion: true });
  await page.focus(".valor-lookbook__track");
  const seen = [];
  for (let i = 0; i < 7; i += 1) {
    await page.keyboard.press("ArrowRight");
    await settle(page);
    const g = await geometry(page);
    seen.push(g.active);
    const first = g.slides.find((s) => s.id === g.active);
    assert.ok(near(first.left, 0, 0.6), `step ${i + 1}: the row starts on a whole image (${first.left})`);
    const r = row(g);
    assert.equal(r.inRow.length, 4);
    assert.ok(r.coveredRight, JSON.stringify(r));
  }
  assert.deepEqual(seen, ids("", [2, 3, 4, 5, 6, 1, 2]));
});

test("focus in a visible card survives the looks moving round", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 10 });
  await page.focus("#look-2 .valor-lookbook__card-title");
  const before = await page.$eval(".valor-lookbook__track", (track) => track.firstElementChild.id);
  await page.$eval(".valor-lookbook__track", (track) => track.scrollBy({ left: 363 }));
  await settle(page);
  const after = await page.evaluate(() => ({
    first: document.querySelector(".valor-lookbook__track").firstElementChild.id,
    focused: document.activeElement.closest("[data-look]") ? document.activeElement.closest("[data-look]").id : null,
    tag: document.activeElement.tagName,
  }));
  assert.notEqual(after.first, before, "a look did move from one end to the other");
  assert.deepEqual([after.focused, after.tag], ["look-2", "A"]);
});

test("cards off: the image row loops too", async (t) => {
  const page = await lookbook(t, { looks: 7, cards: false, reducedMotion: true });
  await page.focus(".valor-lookbook__track");
  for (let i = 0; i < 7; i += 1) {
    await page.keyboard.press("ArrowRight");
    await settle(page);
  }
  const g = await geometry(page);
  assert.equal(g.active, "look-1");
  assert.ok(near(g.activeCentre, 720, 1));
});

test("the loop follows the screen: 6 looks loop on a phone, not on a desktop, in the merchant's order again", async (t) => {
  const page = await lookbook(t, { looks: 6, width: 390, height: 844, reducedMotion: true });
  assert.equal((await geometry(page)).loop, true);
  await press(page, "[data-lookbook-next]", 2);
  assert.equal((await geometry(page)).active, "look-3");
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  let g = await geometry(page);
  assert.equal(g.loop, false);
  assert.deepEqual(g.order, ids("", [1, 2, 3, 4, 5, 6]));
  assert.equal(g.active, "look-3", "the same look is still in the middle");
  assert.ok(near(g.activeCentre, 720, 1), String(g.activeCentre));
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  g = await geometry(page);
  assert.equal(g.loop, true);
  assert.equal(g.active, "look-3");
  assert.ok(near(g.activeCentre, 195, 1), String(g.activeCentre));
});

test("selecting any look's block in the theme editor works in a looping row", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  for (const n of [9, 4, 10, 1]) {
    await page.$eval(`#look-${n}`, (node) =>
      node.dispatchEvent(new CustomEvent("shopify:block:select", { bubbles: true })),
    );
    await settle(page);
    const g = await geometry(page);
    assert.equal(g.active, `look-${n}`);
    assert.ok(near(g.activeCentre, 720, 1), `look ${n}: ${g.activeCentre}`);
    const r = row(g);
    assert.ok(r.coveredLeft && r.coveredRight, JSON.stringify(r));
  }
});

// --- Dragging with the mouse -------------------------------------------------------
// The row follows the mouse while the button is down and comes to rest on a
// look when it is let go. A drag is not a click. Touch is the browser's own.

// Press at `from`, move `dx` sideways in steps, rest (so the release carries
// no speed, unless hold is 0) and let go.
async function drag(page, from, dx, { steps = 12, hold = 160, release = true, back = false } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(from.x + (dx * i) / steps, from.y);
  if (back) for (let i = steps - 1; i >= 0; i -= 1) await page.mouse.move(from.x + (dx * i) / steps, from.y);
  if (hold) await page.waitForTimeout(hold);
  if (release) await page.mouse.up();
}
const centreOf = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const dragging = (page) => page.$eval("valor-lookbook", (el) => el.hasAttribute("data-dragging"));

test("dragging the row with the mouse moves to another look", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  await drag(page, { x: 720, y: 400 }, -420);
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-2");
  assert.ok(near(g.activeCentre, 720, 1), String(g.activeCentre));
  assert.equal(await dragging(page), false);
});

test("while it is dragged the row follows the mouse", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  await drag(page, { x: 720, y: 400 }, -150, { release: false });
  const g = await geometry(page);
  const first = g.slides.find((s) => s.id === "look-1");
  assert.ok(near(first.centre, 720 - 150, 6), `moved with the mouse: ${first.centre}`);
  assert.equal(await dragging(page), true);
  assert.equal(await page.$eval(".valor-lookbook__track", (track) => getComputedStyle(track).cursor), "grabbing");
  await page.mouse.up();
  await settle(page);
  assert.equal((await geometry(page)).active, "look-1", "let go under half way: back to the same look");
});

test("dragging the other way goes to the look before", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  await drag(page, { x: 720, y: 400 }, 420);
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-10");
  assert.ok(near(g.activeCentre, 720, 1));
});

test("a quick short flick carries the row on to the next look", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  await drag(page, { x: 720, y: 400 }, -140, { steps: 4, hold: 0 });
  await settle(page);
  assert.equal((await geometry(page)).active, "look-2", "a third of a look, but let go at speed");
});

test("a drag does not open the product link", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  const link = await centreOf(page, "#look-1 .valor-lookbook__card-title");
  // Out and back, so the mouse is let go on the very link it went down on.
  await drag(page, link, -200, { back: true });
  await settle(page);
  assert.equal(await page.evaluate(() => window.linkClicks), 0);
  assert.equal(await page.evaluate(() => location.hash), "");
});

test("a drag does not press the buy button", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  const button = await centreOf(page, "#look-1 .valor-lookbook__card-button");
  await drag(page, button, -200, { back: true });
  await settle(page);
  assert.equal(await page.evaluate(() => window.submits), 0);
});

test("a click after a drag works again", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  await drag(page, { x: 720, y: 400 }, -420);
  await settle(page);
  await page.click("#look-2 .valor-lookbook__card-button");
  assert.equal(await page.evaluate(() => window.submits), 1);
  await page.click("#look-2 .valor-lookbook__card-title");
  assert.equal(await page.evaluate(() => window.linkClicks), 1);
});

test("a hand that moves a few pixels while clicking still clicks", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  const button = await centreOf(page, "#look-1 .valor-lookbook__card-button");
  await drag(page, button, 3, { steps: 2 });
  assert.equal(await page.evaluate(() => window.submits), 1, "the buy button");
  const side = await centreOf(page, "#look-2 .valor-lookbook__media");
  await drag(page, { x: side.x - 100, y: side.y }, -3, { steps: 2 });
  await settle(page);
  assert.equal((await geometry(page)).active, "look-2", "and the image at the side");
  assert.equal(await dragging(page), false);
});

test("one long drag goes on past the last look when the row loops", async (t) => {
  const page = await lookbook(t, { looks: 7 });
  await page.mouse.move(1400, 400);
  await page.mouse.down();
  for (let x = 1400; x >= 20; x -= 20) {
    await page.mouse.move(x, 400);
    if (x % 200 === 0) {
      const r = row(await geometry(page));
      assert.ok(r.coveredLeft && r.coveredRight, `no blank space at ${1400 - x}px: ${JSON.stringify(r)}`);
    }
  }
  await page.waitForTimeout(160);
  await page.mouse.up();
  await settle(page);
  const g = await geometry(page);
  assert.ok(["look-4", "look-5"].includes(g.active), `about three and a half looks on: ${g.active}`);
  assert.ok(near(g.activeCentre, 720, 1), String(g.activeCentre));
  const r = row(g);
  assert.ok(r.coveredLeft && r.coveredRight && r.hiddenLeft >= 1 && r.hiddenRight >= 1, JSON.stringify(r));
});

test("layouts 4–6 can be dragged and come to rest on whole images", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 10 });
  await drag(page, { x: 720, y: 300 }, -520);
  await settle(page);
  const g = await geometry(page);
  assert.notEqual(g.active, "look-1");
  const first = g.slides.find((s) => s.id === g.active);
  assert.ok(near(first.left, 0, 0.6), `a whole image at the edge: ${first.left}`);
});

test("a row that fits entirely cannot be dragged", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 3 });
  await drag(page, { x: 720, y: 300 }, -300, { release: false });
  assert.equal(await dragging(page), false);
  assert.equal((await geometry(page)).scrollLeft, 0);
  assert.notEqual(await page.$eval(".valor-lookbook__track", (track) => getComputedStyle(track).cursor), "grab");
  await page.mouse.up();
});

test("the row shows it can be grabbed", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  assert.equal(await page.$eval(".valor-lookbook__track", (track) => getComputedStyle(track).cursor), "grab");
  // A link keeps a link's cursor: "pointer", or "auto" in Safari's engine,
  // which shows the hand for it.
  const link = await page.$eval("#look-1 .valor-lookbook__card-title", (node) => getComputedStyle(node).cursor);
  assert.ok(["pointer", "auto"].includes(link), link);
  assert.equal(
    await page.$eval("#look-1 .valor-lookbook__card-button", (node) => getComputedStyle(node).cursor),
    "pointer",
  );
});

test("the right mouse button does not drag", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  await page.mouse.move(720, 400);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(500, 400, { steps: 6 });
  assert.equal(await dragging(page), false);
  assert.equal((await geometry(page)).active, "look-1");
  await page.mouse.up({ button: "right" });
});

test("touch and pen are left to the browser's own scrolling", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  const state = await page.evaluate(() => {
    const el = document.querySelector("valor-lookbook");
    const track = el.querySelector(".valor-lookbook__track");
    const before = track.scrollLeft;
    const fire = (type, x) =>
      track.dispatchEvent(
        new PointerEvent(type, {
          pointerType: "touch",
          pointerId: 7,
          button: 0,
          buttons: 1,
          clientX: x,
          clientY: 300,
          bubbles: true,
        }),
      );
    fire("pointerdown", 700);
    fire("pointermove", 600);
    fire("pointermove", 500);
    const result = { dragging: el.hasAttribute("data-dragging"), moved: track.scrollLeft - before };
    fire("pointerup", 500);
    return result;
  });
  assert.deepEqual(state, { dragging: false, moved: 0 });
});

test("right-to-left: dragging to the right brings the next look", async (t) => {
  const page = await lookbook(t, { looks: 10, dir: "rtl" });
  await drag(page, { x: 720, y: 400 }, 420);
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-2");
  assert.ok(near(g.activeCentre, 720, 1), String(g.activeCentre));
});

test("without a loop a drag stops at the first and the last look", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  await drag(page, { x: 720, y: 400 }, 500);
  await settle(page);
  let g = await geometry(page);
  assert.equal(g.active, "look-1");
  assert.ok(near(g.activeCentre, 720, 1));
  await drag(page, { x: 1300, y: 400 }, -1250, { steps: 30 });
  await settle(page);
  await drag(page, { x: 1300, y: 400 }, -1250, { steps: 30 });
  await settle(page);
  g = await geometry(page);
  assert.equal(g.active, "look-4");
  assert.ok(near(g.activeCentre, 720, 1));
});

test("cards off: the image row is dragged the same way", async (t) => {
  const page = await lookbook(t, { looks: 10, cards: false });
  await drag(page, { x: 720, y: 300 }, -420);
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-2");
  assert.ok(near(g.activeCentre, 720, 1));
});

// --- Found in the whole-branch review ------------------------------------------

// In a 4/5/6 row every card shows, the ones of the looks out of the row too.
// With the loop bringing looks round, Tab went from card to card for ever.
// The cards of the looks that are not in the row are now out of reach (inert)
// while the row loops; the arrow keys on the row bring other looks in.
const stopsOf = async (page, presses) => {
  const stops = [];
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press("Tab");
    await settle(page);
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        const look = el.closest ? el.closest("[data-look]") : null;
        if (!look) return el.id || el.tagName.toLowerCase();
        const row = look.parentNode.getBoundingClientRect();
        const box = look.getBoundingClientRect();
        return `${look.id}${box.left >= row.left - 1 && box.right <= row.right + 1 ? "" : " (out of the row)"}`;
      }),
    );
    if (stops[stops.length - 1] === "after") break;
  }
  return stops;
};
const addStopAfter = (page) =>
  page.evaluate(() => {
    const after = document.createElement("button");
    after.id = "after";
    after.textContent = "After the section";
    document.querySelector("main").after(after);
  });

for (const layout of ["4", "6"]) {
  test(`layout ${layout} that loops: Tab goes through the cards in the row and leaves the section`, async (t) => {
    const page = await lookbook(t, { layout, looks: 9 });
    assert.equal((await geometry(page)).loop, true);
    await addStopAfter(page);
    await page.focus(".valor-lookbook__track");
    // At most a link and a button for each look in the row, and one more.
    const stops = await stopsOf(page, Number(layout) * 2 + 3);
    assert.equal(stops[stops.length - 1], "after", `Tab left the section: ${stops.join(", ")}`);
    assert.ok(
      stops.every((stop) => !stop.includes("out of the row")),
      `only cards in the row were stops: ${stops.join(", ")}`,
    );
  });
}

test("a looping 4/5/6 row: the cards that are reachable follow the row", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 9 });
  const reachable = () =>
    page.$$eval("[data-look]", (looks) =>
      looks.filter((look) => !look.querySelector(".valor-lookbook__card-slot").inert).map((look) => look.id),
    );
  assert.deepEqual((await reachable()).sort(), ["look-1", "look-2", "look-3", "look-4"]);
  await page.focus(".valor-lookbook__track");
  await page.keyboard.press("ArrowRight");
  await settle(page);
  assert.deepEqual((await reachable()).sort(), ["look-2", "look-3", "look-4", "look-5"]);
});

test("a 4/5/6 row that does not loop keeps every card reachable: Tab brings it into the row", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 5 });
  assert.equal((await geometry(page)).loop, false);
  const inert = await page.$$eval(".valor-lookbook__card-slot", (slots) => slots.filter((slot) => slot.inert).length);
  assert.equal(inert, 0);
});

test("the centred row and a resize to it leave no card inert", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 9 });
  await page.setViewportSize({ width: 800, height: 900 });
  await settle(page);
  const inert = await page.$$eval(".valor-lookbook__card-slot", (slots) => slots.filter((slot) => slot.inert).length);
  assert.equal(inert, 0, "the centred row hides its other cards by itself");
});

// A press on the row that is let go somewhere else never reached the row as a
// release, and the next movement over the row, with no button held, dragged it.
test("a press that is let go outside the row leaves no drag behind", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  const before = await geometry(page);
  const y = before.slides.find((s) => s.active).media.top + 120;
  await page.mouse.move(720, y);
  await page.mouse.down();
  await page.mouse.move(721, 4, { steps: 5 }); // straight up and out of the row
  await page.mouse.up();
  await page.mouse.move(760, y);
  await page.mouse.move(520, y, { steps: 8 }); // across the row, no button held
  const state = await page.evaluate(() => {
    const el = document.querySelector("valor-lookbook");
    const track = el.querySelector(".valor-lookbook__track");
    return { dragging: el.hasAttribute("data-dragging"), free: track.hasAttribute("data-free") };
  });
  assert.deepEqual(state, { dragging: false, free: false });
  await settle(page);
  const after = await geometry(page);
  assert.equal(after.active, before.active, "the row stayed where it was");
  assert.ok(near(after.scrollLeft, before.scrollLeft, 1));
  // And the next click is a click.
  const side = after.slides.find((s) => s.id === "look-2").media;
  await page.mouse.click(side.left + side.width / 2, y);
  await settle(page);
  assert.equal((await geometry(page)).active, "look-2");
});

// At the end of a row that cannot scroll further the move was still counted
// as under way, and the next key press was measured from the wrong look.
test("layout 4 without a loop: a key press at the end of the row is not held against the next one", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 5 });
  await page.focus(".valor-lookbook__track");
  await page.keyboard.press("ArrowRight");
  await settle(page);
  assert.equal((await geometry(page)).active, "look-2", "the row's only step");
  await page.keyboard.press("ArrowRight"); // nothing further to show
  await page.keyboard.press("ArrowLeft");
  await settle(page);
  assert.equal((await geometry(page)).active, "look-1");
});

test("an arrow that reaches the end of the row hands the focus to the other arrow", async (t) => {
  const page = await lookbook(t, { looks: 3 });
  await page.focus("[data-lookbook-next]");
  await page.keyboard.press("Enter");
  await settle(page);
  await page.keyboard.press("Enter");
  await settle(page);
  let state = await page.evaluate(() => ({
    active: document.querySelector("valor-lookbook").active.id,
    nextDisabled: document.querySelector("[data-lookbook-next]").disabled,
    focus: document.activeElement.hasAttribute("data-lookbook-prev") ? "previous" : document.activeElement.tagName,
  }));
  assert.deepEqual(state, { active: "look-3", nextDisabled: true, focus: "previous" });
  await page.keyboard.press("Enter");
  await settle(page);
  await page.keyboard.press("Enter");
  await settle(page);
  state = await page.evaluate(() => ({
    active: document.querySelector("valor-lookbook").active.id,
    focus: document.activeElement.hasAttribute("data-lookbook-next") ? "next" : document.activeElement.tagName,
  }));
  assert.deepEqual(state, { active: "look-1", focus: "next" });
});

test("an arrow that is not focused does not take the focus when it is switched off", async (t) => {
  const page = await lookbook(t, { looks: 3 });
  await page.focus(".valor-lookbook__track");
  await page.keyboard.press("ArrowRight");
  await settle(page);
  await page.keyboard.press("ArrowRight");
  await settle(page);
  const focus = await page.evaluate(() => document.activeElement.className);
  assert.equal(focus, "valor-lookbook__track");
});

// The theme editor moves a section by moving its element: the row must not
// take the order the loop had it in for the merchant's order.
test("a section moved in the page keeps the merchant's order for when the loop stops", async (t) => {
  const page = await lookbook(t, { looks: 6, width: 390, height: 844 });
  assert.equal((await geometry(page)).loop, true);
  await press(page, "[data-lookbook-next]", 1);
  assert.notDeepEqual(
    (await geometry(page)).order,
    ids("", [1, 2, 3, 4, 5, 6]),
    "the loop has the looks in its own order",
  );
  await page.evaluate(() => {
    const section = document.querySelector(".shopify-section");
    section.parentNode.appendChild(section);
  });
  await settle(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.loop, false);
  assert.deepEqual(g.order, ids("", [1, 2, 3, 4, 5, 6]));
});

// A card of some 200px had 50px left for the name and the price beside the
// thumbnail and the button, and a price broke in the middle of the number.
for (const [name, options, thumbnail] of [
  ["the centred row on a small tablet (760px)", { width: 760, height: 900 }, false],
  ["layout 5 at 1000px", { width: 1000, height: 900, layout: "5" }, false],
  ["layout 4 at 1000px", { width: 1000, height: 900, layout: "4" }, true],
  ["a 390px phone", { width: 390, height: 844 }, true],
  ["a 360px phone", { width: 360, height: 780 }, false],
  ["the centred row on a desktop", {}, true],
]) {
  test(`a card too narrow for it leaves the thumbnail out: ${name}`, async (t) => {
    const looks = Array.from({ length: 8 }, () => ({ sale: true }));
    const page = await lookbook(t, { looks, ...options });
    const card = await page.$eval(
      "valor-lookbook .is-active .valor-lookbook__card, #look-1 .valor-lookbook__card",
      (node) => {
        const thumb = node.querySelector(".valor-lookbook__card-thumb");
        const info = node.querySelector(".valor-lookbook__card-info");
        const price = node.querySelector(".valor-lookbook__price-current");
        return {
          width: Math.round(node.getBoundingClientRect().width),
          thumbnail: getComputedStyle(thumb).display !== "none",
          room: Math.round(info.getBoundingClientRect().width),
          priceLines: price.getClientRects().length,
        };
      },
    );
    assert.equal(card.thumbnail, thumbnail, JSON.stringify(card));
    assert.ok(card.room >= 80, `room for the name and the price: ${JSON.stringify(card)}`);
    assert.equal(card.priceLines, 1, `the price is not broken: ${JSON.stringify(card)}`);
  });
}

test("the card's button follows the theme's button border and hover settings", async (t) => {
  const page = await lookbook(t, { looks: 4 });
  await page.addStyleTag({ content: ":root { --style-button-border-width: 3px; --button-hover-opacity: 0.5; }" });
  const button = page.locator("#look-1 .valor-lookbook__card-button");
  assert.equal(await button.evaluate((node) => getComputedStyle(node).borderTopWidth), "3px");
  await button.hover();
  await page.waitForTimeout(150);
  assert.equal(await button.evaluate((node) => getComputedStyle(node).opacity), "0.5");
  await page.addStyleTag({ content: ":root { --style-button-border-width: 0px; }" });
  assert.equal(await button.evaluate((node) => getComputedStyle(node).borderTopWidth), "0px");
});

// --- External review, round 1 ------------------------------------------------

// Key presses that reach the row one after another, with no time between them.
const keysAtOnce = (page, keys) =>
  page.$eval(
    ".valor-lookbook__track",
    (track, list) => {
      for (const key of list) {
        track.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      }
    },
    keys,
  );

// A 4/5/6 row that loops with only its two looks in hand: a second key press
// before the row had rested found the next look in the list, but the row was
// already at the end of what it can scroll, and the press was lost.
for (const [layout, looks] of [
  ["4", 6],
  ["5", 7],
  ["6", 8],
]) {
  for (const reducedMotion of [true, false]) {
    const motion = reducedMotion ? "reduced motion" : "sliding";
    test(`layout ${layout} with ${looks} looks: key presses quicker than the row rests all count (${motion})`, async (t) => {
      const page = await lookbook(t, { layout, looks, reducedMotion });
      assert.equal((await geometry(page)).loop, true);
      const check = async (expected, message) => {
        await settle(page);
        const g = await geometry(page);
        assert.equal(g.active, `look-${expected}`, message);
        const first = g.slides.find((s) => s.id === g.active);
        assert.ok(near(first.left, 0, 0.6), `${message}: the row starts on a whole image (${first.left})`);
        const r = row(g);
        assert.equal(r.inRow.length, Number(layout), message);
        assert.ok(r.coveredRight, `${message}: ${JSON.stringify(r)}`);
      };
      await keysAtOnce(page, ["ArrowRight", "ArrowRight"]);
      await check(3, "two presses on from the first look");
      await keysAtOnce(page, ["ArrowRight", "ArrowRight", "ArrowRight"]);
      await check(6, "three more");
      await keysAtOnce(page, ["ArrowLeft", "ArrowLeft"]);
      await check(4, "two back");
    });
  }
}

test("layout 4 with 6 looks: two presses of the real key, reduced motion, move two looks", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 6, reducedMotion: true });
  await page.focus(".valor-lookbook__track");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await settle(page);
  assert.equal((await geometry(page)).active, "look-3");
});

test("right-to-left, layout 4 with 6 looks: quick presses of ArrowLeft all count", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 6, dir: "rtl", reducedMotion: true });
  await keysAtOnce(page, ["ArrowLeft", "ArrowLeft"]);
  await settle(page);
  let g = await geometry(page);
  assert.equal(g.active, "look-3");
  assert.equal(row(g).inRow.length, 4);
  await keysAtOnce(page, ["ArrowLeft", "ArrowLeft", "ArrowLeft"]);
  await settle(page);
  g = await geometry(page);
  assert.equal(g.active, "look-6");
  assert.equal(row(g).inRow.length, 4);
});

// The same at the end of a row that does not loop: the press that had nowhere
// to go was kept as the move under way, and the press back counted from a
// look the row never reached.
test("layout 4 without a loop: a press past the end, quicker than the row rests, is not held against the way back", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 5 });
  await keysAtOnce(page, ["ArrowRight", "ArrowRight", "ArrowLeft"]);
  await settle(page);
  assert.equal((await geometry(page)).active, "look-1", "one step on, nothing, one step back");
});

// A press back while the row has only just set off: the row is still where it
// started, and the move that is under way has to be called off.
test("a press on and a press back at once leave the row where it was", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  await keysAtOnce(page, ["ArrowRight", "ArrowLeft"]);
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-1");
  assert.ok(near(g.activeCentre, 720, 1));
});
// Presses a moment apart, the row already sliding when the next one comes.
// The second press has to bring the far looks round under a slide that is in
// flight. A slide asked for straight after that never arrived in Chromium
// (the row stayed where the first slide had got to), and on a store in
// Safari's engine it was cut off when the page was busy. The row now goes
// straight to the look, without sliding, when a press finds it in flight and
// out of looks.
const keysApart = (page, keys, gap) =>
  page.$eval(
    ".valor-lookbook__track",
    (track, { keys, gap }) =>
      new Promise((resolve) => {
        const press = (index) => {
          track.dispatchEvent(new KeyboardEvent("keydown", { key: keys[index], bubbles: true, cancelable: true }));
          if (index + 1 < keys.length) setTimeout(() => press(index + 1), gap);
          else resolve();
        };
        press(0);
      }),
    { keys, gap },
  );

for (const gap of [45, 100]) {
  for (const [layout, looks] of [
    ["4", 6],
    ["6", 8],
    ["centered", 7],
  ]) {
    test(`presses ${gap} ms apart on a sliding row all count: layout ${layout} with ${looks} looks`, async (t) => {
      const page = await lookbook(t, { layout, looks });
      const expectActive = async (expected, message) => {
        await settle(page);
        const g = await geometry(page);
        assert.equal(g.active, `look-${expected}`, message);
        const r = row(g);
        assert.ok(r.coveredLeft && r.coveredRight, `${message}: the row is full ${JSON.stringify(r)}`);
      };
      await keysApart(page, ["ArrowRight", "ArrowRight"], gap);
      await expectActive(3, "two presses on");
      await keysApart(page, ["ArrowRight", "ArrowRight", "ArrowRight"], gap);
      await expectActive(6, "three more");
      await keysApart(page, ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft"], gap);
      await expectActive(2, "four back");
    });
  }
}

// "No scroll event for a moment" is how the row knows it has stopped. On a
// busy page that moment can pass while the row is still on its way: here the
// "it has stopped" call arrives right after the row was sent on. The row was
// then taken to have stopped where it was, and the next press counted from
// there instead of from the look the row was going to.
test("a row on its way is not taken to have stopped", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const el = document.querySelector("valor-lookbook");
        const track = el.querySelector(".valor-lookbook__track");
        const press = () =>
          track.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
        press();
        el.onSettle();
        setTimeout(() => {
          press();
          resolve();
        }, 40);
      }),
  );
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-3", "the second press counted from where the first was going");
  assert.ok(near(g.activeCentre, 720, 1));
});

test("a move starts the wait for the row to stop afresh", async (t) => {
  const page = await lookbook(t, { looks: 10 });
  const waits = await page.evaluate(() => {
    const el = document.querySelector("valor-lookbook");
    let count = 0;
    const scheduleSettle = el.scheduleSettle;
    el.scheduleSettle = function () {
      count += 1;
      return scheduleSettle.call(this);
    };
    el.next();
    return count;
  });
  assert.ok(waits >= 1, "asked for before any scroll event has come");
  await settle(page);
  assert.equal((await geometry(page)).active, "look-2");
});

// ---------------------------------------------------------------------------
// External review, round 2: the keyboard focus was left on nothing.
// ---------------------------------------------------------------------------

// Where the focus is: an arrow, the row, a look's card, or nothing (BODY).
const focusOf = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (el.hasAttribute("data-lookbook-prev")) return "previous";
    if (el.hasAttribute("data-lookbook-next")) return "next";
    if (el.classList.contains("valor-lookbook__track")) return "row";
    const look = el.closest("[data-look]");
    return look ? `${look.id} ${el.tagName}` : el.tagName;
  });

// With two looks every press goes from one end of the row to the other: the
// arrow in use is switched off while the other one is still off.
for (const reducedMotion of [false, true]) {
  test(`two looks: the arrow in use hands the focus over at each end (${reducedMotion ? "reduced motion" : "sliding"})`, async (t) => {
    const page = await lookbook(t, { looks: 2, reducedMotion });
    await page.focus("[data-lookbook-next]");
    await page.keyboard.press("Enter");
    await settle(page);
    assert.deepEqual([(await geometry(page)).active, await focusOf(page)], ["look-2", "previous"]);
    await page.keyboard.press("Enter");
    await settle(page);
    assert.deepEqual([(await geometry(page)).active, await focusOf(page)], ["look-1", "next"]);
    await page.keyboard.press("Enter");
    await settle(page);
    assert.deepEqual(
      [(await geometry(page)).active, await focusOf(page)],
      ["look-2", "previous"],
      "the row still answers",
    );
  });
}

test("layout 4 narrowed to the centred row: the card with the focus stays, its look in the middle", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 8 });
  await page.focus("#look-2 .valor-lookbook__card-button");
  await page.setViewportSize({ width: 800, height: 900 });
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.nav, true, "the centred row, with its arrows");
  assert.deepEqual([g.active, await focusOf(page)], ["look-2", "look-2 BUTTON"]);
  assert.ok(near(g.activeCentre, 400, 1), String(g.activeCentre));
});

test("layout 4 narrowed to a phone: the card with the focus stays", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 8 });
  await page.focus("#look-3 .valor-lookbook__card-title");
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page);
  assert.deepEqual([(await geometry(page)).active, await focusOf(page)], ["look-3", "look-3 A"]);
});

test("a row that stops looping puts the looks back around the card with the focus", async (t) => {
  const page = await lookbook(t, { looks: 6, width: 390, height: 844 });
  await page.focus("#look-1 .valor-lookbook__card-button");
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.loop, false);
  assert.deepEqual(g.order, ids("", [1, 2, 3, 4, 5, 6]), "the merchant's order");
  assert.deepEqual([g.active, await focusOf(page)], ["look-1", "look-1 BUTTON"]);
});

test("an arrow with the focus that a wider layout takes away hands it to the row", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 5, width: 800 });
  await page.focus("[data-lookbook-next]");
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  assert.equal((await geometry(page)).nav, false, "layout 4 has no arrows");
  assert.equal(await focusOf(page), "row");
});

test("a layout change does not bring the focus into a row that did not have it", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 8 });
  await page.focus("#look-2 .valor-lookbook__card-button");
  await page.evaluate(() => document.activeElement.blur());
  await page.setViewportSize({ width: 800, height: 900 });
  await settle(page);
  assert.deepEqual([(await geometry(page)).active, await focusOf(page)], ["look-1", "BODY"]);
});

// The same family, found while fixing the above: a card that scrolls out of a
// looping 4/5/6 row (mouse, wheel) can no longer be reached, and it took the
// focus with it.
test("a card with the focus that leaves a looping 4/5/6 row hands the focus to the row", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 10 });
  await page.focus("#look-1 .valor-lookbook__card-title");
  await page.$eval(".valor-lookbook__track", (track) => track.scrollBy({ left: 363 }));
  await settle(page);
  assert.equal((await geometry(page)).active, "look-2", "look 1 has left the row");
  assert.equal(await focusOf(page), "row");
});

// ---------------------------------------------------------------------------
// External review, round 3: the centred row hid a card that had the focus.
// ---------------------------------------------------------------------------

// One look further along the row, as a trackpad or a wheel moves it.
const scrollOneLook = (page) =>
  page.$eval(".valor-lookbook__track", (track) => {
    const looks = track.querySelectorAll("[data-look]");
    track.scrollBy({ left: looks[1].getBoundingClientRect().left - looks[0].getBoundingClientRect().left });
  });

/* In the centred row only the active look shows its card. A row scrolled on
   while a card had the focus hid that card with the focus still on it: the
   focus fell to the page, and the next change of width went back to the old
   look to give its card the focus again. */
for (const [name, width, height, wider] of [
  ["desktop", 1440, 900, 1400],
  ["phone", 390, 844, 430],
]) {
  test(`centred row (${name}): a card with the focus whose look is scrolled away hands the focus to the row`, async (t) => {
    const page = await lookbook(t, { looks: 8, width, height });
    await page.focus("#look-1 .valor-lookbook__card-button");
    await scrollOneLook(page);
    await settle(page);
    assert.deepEqual([(await geometry(page)).active, await focusOf(page)], ["look-2", "row"]);
    await page.setViewportSize({ width: wider, height });
    await settle(page);
    assert.deepEqual(
      [(await geometry(page)).active, await focusOf(page)],
      ["look-2", "row"],
      "another width leaves the row on the look it was on",
    );
  });
}

test("centred row: the arrows leave the focus on the arrow, and a card of the active look keeps it", async (t) => {
  const page = await lookbook(t, { looks: 8 });
  await page.focus("[data-lookbook-next]");
  await page.keyboard.press("Enter");
  await settle(page);
  assert.deepEqual([(await geometry(page)).active, await focusOf(page)], ["look-2", "next"]);
  await page.focus("#look-2 .valor-lookbook__card-button");
  await page.setViewportSize({ width: 1400, height: 900 });
  await settle(page);
  assert.deepEqual([(await geometry(page)).active, await focusOf(page)], ["look-2", "look-2 BUTTON"]);
});

// ---------------------------------------------------------------------------
// External review, round 4: a variant outside the first 250 of its product
// ---------------------------------------------------------------------------

/* Shopify hands a theme the first 250 variants of a product. A look whose
   variant is not among them is printed with the product's own card and the
   variant's ID on the card's slot, and the script asks for that variant's
   card by the ID: /variants/<id>/?section_id=lookbook-variant
   (sections/lookbook-variant.liquid). */

// What that address returns: the section with the one card.
const variantCard = ({ id, product = 77, variant = 'Shade 300 · 26"', price = "€312,00", soldOut = false }) =>
  `<div id="shopify-section-lookbook-variant" class="shopify-section"><div data-lookbook-variant-card data-product-id="${product}">
    <div class="valor-lookbook__card">
      <div class="valor-lookbook__card-info">
        <a class="valor-lookbook__card-title" href="/products/wig?variant=${id}">Product</a>
        <p class="valor-lookbook__card-variant">${variant}</p>
        <div class="valor-lookbook__price"><span class="valor-lookbook__price-current">${price}</span></div>
        ${soldOut ? '<p class="valor-lookbook__card-status">Sold out</p>' : ""}
      </div>
      ${
        soldOut
          ? '<button type="button" class="valor-lookbook__card-button" aria-label="Sold out" disabled><svg width="20" height="20"></svg></button>'
          : `<form method="post" action="/cart/add" class="valor-lookbook__card-form">
        <input type="hidden" name="id" value="${id}">
        <button type="submit" name="add" class="valor-lookbook__card-button" aria-label="Add to cart: Product"><svg width="20" height="20"></svg></button>
        <div class="valor-lookbook__card-error" data-cart-error role="alert" hidden></div>
      </form>`
      }
    </div>
  </div></div>`;

/* The lookbook page served from an address, so that the script's requests
   can be answered. `variants` maps a variant ID to what its address returns:
   the page's text, a status, or a function that takes the route. */
async function lookbookAt(t, options = {}, variants = {}) {
  const { width = 1440, height = 900 } = options;
  const page = await browser.newPage({ viewport: { width, height } });
  t.after(() => page.close());
  page.setDefaultTimeout(4000);
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(error.message));
  page.asked = [];
  // init: a function that runs in the page before anything of the page does.
  if (options.init) await page.addInitScript(options.init);
  await page.route("http://valor.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: pageMarkup(options) });
    page.asked.push(url.pathname + url.search);
    const match = url.pathname.match(/\/variants\/(\d+)\/$/);
    const answer = match ? variants[match[1]] : undefined;
    if (typeof answer === "function") return answer(route);
    if (typeof answer === "string") return route.fulfill({ contentType: "text/html", body: answer });
    return route.fulfill({
      status: answer || 404,
      contentType: "text/html",
      body: "<!doctype html><html><body>Not found</body></html>",
    });
  });
  await page.goto("http://valor.test/");
  await settle(page);
  return page;
}

// A look whose variant the product's list did not hold.
const pendingLooks = (n, pending) =>
  Array.from({ length: 8 }, (_, index) =>
    index + 1 === n ? { pending: { product: 77, note: true, ...pending } } : {},
  );
const slotState = (page, n, state) =>
  page.waitForSelector(`#look-${n} .valor-lookbook__card-slot[data-lookbook-variant-state="${state}"]`, {
    state: "attached",
  });
// What a look's card says and does.
const cardOf = (page, n) =>
  page.$eval(`#look-${n} .valor-lookbook__card-slot`, (slot) => {
    const text = (selector) => (slot.querySelector(selector) ? slot.querySelector(selector).textContent.trim() : null);
    const note = slot.querySelector("[data-lookbook-variant-note]");
    const button = slot.querySelector(".valor-lookbook__card-button");
    return {
      cards: slot.querySelectorAll(".valor-lookbook__card").length,
      variant: text(".valor-lookbook__card-variant"),
      price: text(".valor-lookbook__price-current"),
      link: slot.querySelector(".valor-lookbook__card-title").getAttribute("href"),
      adds: slot.querySelector('input[name="id"]') ? slot.querySelector('input[name="id"]').value : null,
      button: button.tagName === "A" ? "link" : button.disabled ? "sold out" : "add",
      note: note ? (note.hidden ? "hidden" : "shown") : "none",
    };
  });

test("a variant outside the product's first 250 is asked for by its ID, and its card takes the place of the product's", async (t) => {
  const page = await lookbookAt(t, { looks: pendingLooks(1, { id: 9001 }) }, { 9001: variantCard({ id: 9001 }) });
  await slotState(page, 1, "done");
  assert.deepEqual(page.asked, ["/variants/9001/?section_id=lookbook-variant"]);
  assert.deepEqual(await cardOf(page, 1), {
    cards: 1,
    variant: 'Shade 300 · 26"',
    price: "€312,00",
    link: "/products/wig?variant=9001",
    adds: "9001",
    button: "add",
    note: "none",
  });
  // The theme's cart script takes the form over like any other card's.
  await page.click("#look-1 .valor-lookbook__card-button");
  assert.equal(await page.evaluate(() => window.submits), 1);
  // The other looks keep the card they came with.
  assert.equal((await cardOf(page, 2)).adds, "1002");
  assert.deepEqual(page.errors, []);
});

test("before its card arrives, and without the script, such a look shows the product's card, linked to the variant", async (t) => {
  const page = await lookbookAt(t, { looks: pendingLooks(1, { id: 9001 }), script: false }, {});
  assert.deepEqual(page.asked, []);
  assert.deepEqual(await cardOf(page, 1), {
    cards: 1,
    variant: null,
    price: "€101,00",
    link: "#product-1?variant=9001",
    adds: null,
    button: "link",
    note: "hidden",
  });
});

test("the variant's card is asked for under the shop's root address (a locale in the address)", async (t) => {
  const page = await lookbookAt(
    t,
    { looks: pendingLooks(1, { id: 9001 }), rootUrl: "/fi" },
    { 9001: variantCard({ id: 9001 }) },
  );
  await slotState(page, 1, "done");
  assert.deepEqual(page.asked, ["/fi/variants/9001/?section_id=lookbook-variant"]);
});

test("an ID that is another product's variant leaves the product's card, and the theme editor's note shows", async (t) => {
  const page = await lookbookAt(
    t,
    { looks: pendingLooks(1, { id: 9001 }) },
    { 9001: variantCard({ id: 9001, product: 5 }) },
  );
  await slotState(page, 1, "missing");
  const card = await cardOf(page, 1);
  assert.deepEqual([card.variant, card.button, card.adds, card.note], [null, "link", null, "shown"]);
});

test("an ID that is no variant at all leaves the product's card, and the theme editor's note shows", async (t) => {
  const page = await lookbookAt(t, { looks: pendingLooks(1, { id: 9001 }) }, { 9001: 404 });
  await slotState(page, 1, "missing");
  const card = await cardOf(page, 1);
  assert.deepEqual([card.variant, card.button, card.note], [null, "link", "shown"]);
  assert.deepEqual(page.errors, []);
});

test("a request that fails leaves the product's card and says nothing", async (t) => {
  const page = await lookbookAt(t, { looks: pendingLooks(1, { id: 9001 }) }, { 9001: 500 });
  await slotState(page, 1, "failed");
  const card = await cardOf(page, 1);
  assert.deepEqual([card.variant, card.button, card.note], [null, "link", "hidden"]);
  const refused = await lookbookAt(
    t,
    { looks: pendingLooks(1, { id: 9002 }) },
    { 9002: (route) => route.abort("connectionrefused") },
  );
  await slotState(refused, 1, "failed");
  assert.deepEqual(refused.errors, []);
});

test("a page without such a look asks for nothing", async (t) => {
  const page = await lookbookAt(t, { looks: 8 }, {});
  assert.deepEqual(page.asked, []);
});

// The card can arrive while the keyboard focus is on the one it replaces.
for (const [control, soldOut, expected] of [
  ["title", false, "A valor-lookbook__card-title"],
  ["button", false, "BUTTON valor-lookbook__card-button"],
  ["button", true, "A valor-lookbook__card-title"],
]) {
  test(`the card that is replaced hands the focus to the new card (${control}${soldOut ? ", the variant sold out" : ""})`, async (t) => {
    let release;
    const held = new Promise((resolve) => (release = resolve));
    const page = await lookbookAt(
      t,
      { looks: pendingLooks(1, { id: 9001 }) },
      {
        9001: async (route) => {
          await held;
          return route.fulfill({ contentType: "text/html", body: variantCard({ id: 9001, soldOut }) });
        },
      },
    );
    await page.focus(`#look-1 .valor-lookbook__card-${control}`);
    release();
    await slotState(page, 1, "done");
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      const slot = el.closest(".valor-lookbook__card-slot");
      return `${el.tagName} ${el.className}${slot && slot.querySelector(".valor-lookbook__card-variant") ? "" : " (not in the new card)"}`;
    });
    assert.equal(focus, expected);
    assert.equal((await geometry(page)).active, "look-1");
  });
}

test("a card that arrives for a look without the focus leaves the focus where it is", async (t) => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const page = await lookbookAt(
    t,
    { looks: pendingLooks(1, { id: 9001 }) },
    {
      9001: async (route) => {
        await held;
        return route.fulfill({ contentType: "text/html", body: variantCard({ id: 9001 }) });
      },
    },
  );
  await page.focus("[data-lookbook-next]");
  release();
  await slotState(page, 1, "done");
  assert.equal(await focusOf(page), "next");
});

// ---------------------------------------------------------------------------
// External review, round 5: what the card that arrives later runs into
// ---------------------------------------------------------------------------

/* The fetched card can be taller than the one it replaces, and every card of
   the section grows with it. That changes the height of the lookbook and
   nothing else: the row keeps its width and its layout, and is left alone,
   whatever it is doing at that moment (in the visitor's hand, under a
   finger, sliding to another look). */

// A card that outgrows the others: a long variant name and one more line.
const tallCard = (id) =>
  variantCard({ id, soldOut: true, variant: "Shade 300 · 26 inches · lace front · glueless · pre-plucked hairline" });
const heightOf = (page) => page.$eval("valor-lookbook", (el) => el.getBoundingClientRect().height);
// Long enough for the page to have been told about a new size.
const frames = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30)))),
  );
// A card that grows by other means (a message from the cart, a late font).
// press: a control that is pressed first, in the same moment.
const growCard = (page, n, press) =>
  page.evaluate(
    ([look, control]) => {
      if (control) document.querySelector(control).click();
      const lines = document.createElement("p");
      lines.className = "valor-lookbook__card-status";
      lines.innerHTML = "One more line<br>and another<br>and another<br>and another";
      document.querySelector(`#look-${look} .valor-lookbook__card-info`).appendChild(lines);
    },
    [n, press || null],
  );
const leftOf = (page, n) => page.$eval(`#look-${n}`, (look) => look.getBoundingClientRect().left);

for (const [name, options, pressAt] of [
  ["the centred row on a phone", { width: 390, height: 844 }, 350],
  ["layout 6 on a desktop", { layout: "6" }, 1000],
]) {
  for (const cause of ["the variant's card arrives", "a card grows"]) {
    test(`a drag under way goes on when ${cause} and the cards get taller (${name})`, async (t) => {
      let release;
      const held = new Promise((resolve) => (release = resolve));
      const page =
        cause === "a card grows"
          ? await lookbook(t, { ...options, looks: 8 })
          : await lookbookAt(
              t,
              { ...options, looks: pendingLooks(3, { id: 9001 }) },
              {
                9001: async (route) => {
                  await held;
                  return route.fulfill({ contentType: "text/html", body: tallCard(9001) });
                },
              },
            );
      const from = { x: pressAt, y: (await centreOf(page, "#look-1 .valor-lookbook__media")).y };
      const start = await leftOf(page, 1);
      const height = await heightOf(page);
      // Under half a look: the first look is still the active one.
      await drag(page, from, -100, { release: false, hold: 0 });
      if (cause === "a card grows") {
        await growCard(page, 2);
      } else {
        release();
        await slotState(page, 3, "done");
      }
      await frames(page);
      assert.ok((await heightOf(page)) > height + 1, "the lookbook is taller now");
      for (let i = 1; i <= 10; i += 1) await page.mouse.move(from.x - 100 - 20 * i, from.y);
      assert.equal(await dragging(page), true, "the row is still in the hand");
      const moved = (await leftOf(page, 1)) - start;
      assert.ok(near(moved, -300, 6), `the row followed the mouse all the way: ${moved}`);
      await page.waitForTimeout(160);
      await page.mouse.up();
      await settle(page);
      assert.equal((await geometry(page)).active, "look-2", "and rests where it was let go");
      assert.equal(await dragging(page), false);
      assert.deepEqual(page.errors, []);
    });
  }
}

test("a row sliding to the next look arrives when a card grows on the way", async (t) => {
  const page = await lookbook(t, { looks: 8 });
  const height = await heightOf(page);
  await growCard(page, 5, "[data-lookbook-next]");
  await settle(page);
  assert.ok((await heightOf(page)) > height + 1, "the lookbook is taller now");
  const g = await geometry(page);
  assert.equal(g.active, "look-2");
  assert.ok(near(g.activeCentre, 720, 1), String(g.activeCentre));
});

test("a row under a finger stays under it when a card grows", async (t) => {
  if ((process.env.VALOR_BROWSER || "chromium") !== "chromium") {
    t.skip("real touch input is only available through Chromium's own protocol");
    return;
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  await page.setContent(pageMarkup({ looks: 8 }));
  await settle(page);
  const cdp = await context.newCDPSession(page);
  const y = await page.$eval(".valor-lookbook__track", (track) => Math.round(track.getBoundingClientRect().top + 100));
  const touch = (type, x) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const start = await leftOf(page, 1);
  const height = await heightOf(page);
  await touch("touchStart", 330);
  for (let x = 320; x >= 250; x -= 10) await touch("touchMove", x);
  await frames(page);
  const held = await leftOf(page, 1);
  assert.ok(held < start - 40, `the finger has taken the row along: ${held - start}`);
  await growCard(page, 2);
  await frames(page);
  assert.ok((await heightOf(page)) > height + 1, "the lookbook is taller now");
  const after = await leftOf(page, 1);
  assert.ok(near(after, held, 2), `the row is where the finger holds it: ${after - start}, was ${held - start}`);
  for (let x = 240; x >= 130; x -= 10) await touch("touchMove", x);
  await touch("touchEnd");
  await settle(page);
  assert.equal((await geometry(page)).active, "look-2", "the swipe ends on the next look");
});

/* The theme editor moves a section by taking its element out of the page and
   putting it back. A request that was out at that moment is cut off: the look
   is asked about again when the section is back, and nothing the old request
   says or fails with afterwards counts. */

const moveSection = (page) =>
  page.evaluate(() => {
    const section = document.querySelector(".shopify-section");
    section.parentNode.appendChild(section);
  });
const stateNow = (page, n) =>
  page.evaluate((look) => {
    const slot = (window.kept || document).querySelector(`#look-${look} .valor-lookbook__card-slot`);
    return slot.getAttribute("data-lookbook-variant-state");
  }, n);
const fetchedCard = { cards: 1, price: "€312,00", adds: "9001", button: "add", note: "none" };
const productCard = { cards: 1, price: "€101,00", adds: null, button: "link", note: "hidden" };
const shortCard = async (page, n) => {
  const { cards, price, adds, button, note } = await cardOf(page, n);
  return { cards, price, adds, button, note };
};

test("a variant request cut off by the section being moved is made again, and the card arrives", async (t) => {
  const routes = [];
  const page = await lookbookAt(
    t,
    { looks: pendingLooks(1, { id: 9001 }) },
    { 9001: (route) => void routes.push(route) },
  );
  await slotState(page, 1, "loading");
  assert.equal(routes.length, 1);
  await moveSection(page);
  await settle(page);
  assert.equal(page.asked.length, 2, "asked again when the section is back");
  assert.equal(await stateNow(page, 1), "loading", "the request that was cut off has not called the new one failed");
  assert.deepEqual(await shortCard(page, 1), productCard);
  await routes[1].fulfill({ contentType: "text/html", body: variantCard({ id: 9001 }) });
  await slotState(page, 1, "done");
  assert.deepEqual(await shortCard(page, 1), fetchedCard);
  // Whatever becomes of the first request now, the card stays.
  await routes[0]
    .fulfill({ contentType: "text/html", body: variantCard({ id: 9001, price: "€1,00" }) })
    .catch(() => {});
  await settle(page);
  assert.equal(await stateNow(page, 1), "done");
  assert.deepEqual(await shortCard(page, 1), fetchedCard);
  assert.deepEqual(page.errors, []);
});

test("moved twice before any answer: the look is asked about a third time, and that card arrives", async (t) => {
  const routes = [];
  const page = await lookbookAt(
    t,
    { looks: pendingLooks(1, { id: 9001 }) },
    { 9001: (route) => void routes.push(route) },
  );
  await slotState(page, 1, "loading");
  await moveSection(page);
  await moveSection(page);
  await settle(page);
  assert.equal(page.asked.length, 3);
  assert.equal(await stateNow(page, 1), "loading");
  await routes[2].fulfill({ contentType: "text/html", body: variantCard({ id: 9001 }) });
  await slotState(page, 1, "done");
  assert.deepEqual(await shortCard(page, 1), fetchedCard);
  assert.deepEqual(page.errors, []);
});

test("a section taken out of the page leaves no request behind, and asks again when it is put back", async (t) => {
  const routes = [];
  const page = await lookbookAt(
    t,
    { looks: pendingLooks(1, { id: 9001 }) },
    { 9001: (route) => void routes.push(route) },
  );
  await slotState(page, 1, "loading");
  await page.evaluate(() => {
    window.kept = document.querySelector(".shopify-section");
    window.kept.remove();
  });
  // Time for the request that was cut off to have failed.
  await page.waitForTimeout(300);
  assert.equal(await stateNow(page, 1), null, "out of the page, the look is not marked as asked, failed or missing");
  assert.equal(page.asked.length, 1);
  await page.evaluate(() => {
    document.querySelector("main").appendChild(window.kept);
    window.kept = null;
  });
  await settle(page);
  assert.equal(page.asked.length, 2, "asked again when the section is back");
  await routes[1].fulfill({ contentType: "text/html", body: variantCard({ id: 9001 }) });
  await slotState(page, 1, "done");
  assert.deepEqual(await shortCard(page, 1), fetchedCard);
  assert.deepEqual(page.errors, []);
});

/* An app that wraps the shop's fetch may not pass the cut-off on, and the
   first request is then answered after all, while the second one is out. */
test("a late answer to the request that was cut off changes nothing", async (t) => {
  const page = await lookbookAt(
    t,
    {
      looks: pendingLooks(1, { id: 9001 }),
      init: () => {
        // Stands in for the shop's fetch: never cut off, answered from the test.
        window.requests = [];
        window.fetch = (url) => new Promise((resolve) => window.requests.push({ url: String(url), resolve }));
        window.answer = (index, body) =>
          window.requests[index].resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/html" } }));
      },
    },
    {},
  );
  await slotState(page, 1, "loading");
  await moveSection(page);
  await settle(page);
  assert.equal(await page.evaluate(() => window.requests.length), 2, "asked again when the section is back");
  await page.evaluate((body) => window.answer(0, body), variantCard({ id: 9001, price: "€1,00" }));
  await frames(page);
  assert.equal(await stateNow(page, 1), "loading", "the second request is still the one that counts");
  assert.deepEqual(await shortCard(page, 1), productCard);
  await page.evaluate((body) => window.answer(1, body), variantCard({ id: 9001 }));
  await slotState(page, 1, "done");
  assert.deepEqual(await shortCard(page, 1), fetchedCard);
  assert.deepEqual(page.errors, []);
});

// Guards: what a move must not ask for again, and where a card may land.
test("a section moved after its card has arrived asks for nothing more and keeps the card", async (t) => {
  const page = await lookbookAt(
    t,
    { looks: [...pendingLooks(1, { id: 9001 }).slice(0, 7), { pending: { product: 77, note: true, id: 9002 } }] },
    { 9001: variantCard({ id: 9001 }), 9002: 404 },
  );
  await slotState(page, 1, "done");
  await slotState(page, 8, "missing");
  await moveSection(page);
  await settle(page);
  assert.equal(page.asked.length, 2, "one request for each of the two looks, and no more");
  assert.deepEqual(await shortCard(page, 1), fetchedCard);
  assert.equal(await stateNow(page, 8), "missing");
  assert.equal((await cardOf(page, 8)).note, "shown");
});

test("a card that arrives after the loop has moved its look round lands in that look, once", async (t) => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const page = await lookbookAt(
    t,
    { looks: pendingLooks(7, { id: 9001 }) },
    {
      9001: async (route) => {
        await held;
        return route.fulfill({ contentType: "text/html", body: variantCard({ id: 9001 }) });
      },
    },
  );
  const before = (await geometry(page)).order;
  await press(page, "[data-lookbook-next]", 3);
  await settle(page);
  assert.notDeepEqual((await geometry(page)).order, before, "the loop has moved looks round");
  release();
  await slotState(page, 7, "done");
  assert.deepEqual(await shortCard(page, 7), fetchedCard);
  const g = await geometry(page);
  assert.equal(new Set(g.order).size, 8, "no look was copied or lost");
  assert.equal(await page.locator(".valor-lookbook__card").count(), 8);
  assert.equal(g.active, "look-4");
});

test("a card that arrives for a look outside a looping 4/5/6 row is out of reach until its look is in the row", async (t) => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const page = await lookbookAt(
    t,
    { layout: "4", looks: pendingLooks(7, { id: 9001 }) },
    {
      9001: async (route) => {
        await held;
        return route.fulfill({ contentType: "text/html", body: variantCard({ id: 9001 }) });
      },
    },
  );
  const outOfReach = () => page.$eval("#look-7 .valor-lookbook__card-slot", (slot) => slot.inert);
  assert.equal(await outOfReach(), true, "the look is outside the row");
  release();
  await slotState(page, 7, "done");
  assert.deepEqual(await shortCard(page, 7), fetchedCard);
  assert.equal(await outOfReach(), true, "the new card is as far out of reach as the old one was");
  await page.focus(".valor-lookbook__track");
  for (let i = 0; i < 2; i += 1) {
    await page.keyboard.press("ArrowLeft");
    await settle(page);
  }
  assert.equal(await outOfReach(), false, "in the row, the card can be reached");
  await page.click("#look-7 .valor-lookbook__card-button");
  assert.equal(await page.evaluate(() => window.submits), 1);
});

// ---------------------------------------------------------------------------
// External review, round 6: the card arrives as the layout changes
// ---------------------------------------------------------------------------

/* A 4/5/6 row narrowed to the centred row hides every card but the active
   look's. The row puts that right when it is told of its new size (the card
   with the focus stays, its look in the middle), but the variant's card can
   arrive before that: the old card is then hidden, with the focus still on
   it or already dropped by the browser, and it is about to be taken away.

   The answer is let in at the moment the narrower layout applies, which is
   before the row is told of its size. A browser drops the focus of a hidden
   control at a moment of its own: by then Chromium has dropped it and WebKit
   has not. "dropped" makes sure it is gone in both. */
for (const [control, dropped, expected] of [
  ["title", false, "look-2 A"],
  ["title", true, "look-2 A"],
  ["button", true, "look-2 BUTTON"],
]) {
  test(`a card that arrives as layout 4 narrows to the centred row keeps the focus of the card it replaces (${control}, ${
    dropped ? "the focus already dropped" : "the focus as the browser has left it"
  })`, async (t) => {
    const page = await lookbookAt(
      t,
      {
        layout: "4",
        looks: pendingLooks(2, { id: 9001 }),
        init: () => {
          // Stands in for the shop's fetch: answered from the page, with no
          // wait of its own, so that the answer arrives at an exact moment.
          window.requests = [];
          window.fetch = (url) => new Promise((resolve) => window.requests.push({ url: String(url), resolve }));
          window.answer = (index, body) =>
            window.requests[index].resolve({ status: 200, ok: true, text: () => Promise.resolve(body) });
        },
      },
      {},
    );
    await slotState(page, 2, "loading");
    await page.focus(`#look-2 .valor-lookbook__card-${control}`);
    await page.evaluate(
      ([body, drop]) => {
        const held = document.activeElement;
        window.matchMedia("(max-width: 989px)").addEventListener(
          "change",
          () => {
            const el = document.querySelector("valor-lookbook");
            const hidden = getComputedStyle(held).visibility === "hidden";
            if (drop) held.blur();
            window.moment = {
              told: el.layout === el.laidOut,
              hidden,
              focus: document.activeElement === held ? "old card" : document.activeElement.tagName,
            };
            window.answer(0, body);
          },
          { once: true },
        );
      },
      [variantCard({ id: 9001 }), dropped],
    );
    await page.setViewportSize({ width: 800, height: 900 });
    await slotState(page, 2, "done");
    await settle(page);
    const moment = await page.evaluate(() => window.moment);
    assert.deepEqual(
      [moment.told, moment.hidden],
      [false, true],
      "the answer came before the row was told of its new size, with the old card hidden",
    );
    assert.match(moment.focus, dropped ? /^BODY$/ : /^(BODY|old card)$/, "where the focus was at that moment");
    const g = await geometry(page);
    assert.equal(g.nav, true, "the centred row, with its arrows");
    assert.deepEqual([g.active, await focusOf(page)], ["look-2", expected]);
    assert.ok(near(g.activeCentre, 400, 1), String(g.activeCentre));
    assert.deepEqual(await shortCard(page, 2), fetchedCard);
    assert.equal(
      await page.evaluate(() => document.activeElement.closest(".valor-lookbook__card").isConnected),
      true,
      "the focus is in the card that shows",
    );
    assert.deepEqual(page.errors, []);
  });
}

// ---------------------------------------------------------------------------
// External review, round 7: the same look after the window is widened and
// narrowed again
// ---------------------------------------------------------------------------

/* The centred row and a 4/5/6 row keep their looks in different orders when
   they loop (the active look stands in the middle of one and at the start of
   the other). A change of layout has to put the looks in the new order before
   it brings the look back to its place: in the old order a 4/5/6 row with
   only two looks in hand cannot scroll that far, and the row came to rest on
   the look before. */
const lookIn = (g, id) => g.slides.find((s) => s.id === id);
// How far a look is from the edge the row starts at.
const fromStart = (g, id, dir) => (dir === "rtl" ? g.row.right - lookIn(g, id).right : lookIn(g, id).left - g.row.left);
const shownCards = (g) => g.slides.filter((s) => s.card).map((s) => s.id);
const leaveFocus = (page) => page.evaluate(() => document.activeElement.blur());

for (const [layout, looks, start, dir, narrow] of [
  ["6", 8, 1, "ltr", 800],
  ["5", 7, 1, "ltr", 800],
  ["6", 9, 1, "ltr", 800],
  ["6", 8, 3, "ltr", 800],
  ["6", 8, 1, "rtl", 800],
  ["6", 8, 1, "ltr", 390],
  ["4", 6, 1, "ltr", 800],
  ["5", 8, 3, "ltr", 800],
  ["4", 7, 1, "rtl", 800],
]) {
  test(`layout ${layout} with ${looks} looks (${dir}, on look ${start}, ${narrow}px): widened and narrowed again, twice, the row is on the same look`, async (t) => {
    const page = await lookbook(t, { layout, looks, dir, width: narrow, height: 900 });
    if (start > 1) {
      await press(page, "[data-lookbook-next]", start - 1);
      await leaveFocus(page);
    }
    const id = `look-${start}`;
    assert.equal((await geometry(page)).active, id);
    for (const trip of [1, 2]) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await settle(page);
      let g = await geometry(page);
      assert.deepEqual([g.loop, g.active], [true, id], `wide, trip ${trip}`);
      assert.ok(near(fromStart(g, id, dir), 0, 0.6), `at the start of the row: ${fromStart(g, id, dir)}`);
      await page.setViewportSize({ width: narrow, height: 900 });
      await settle(page);
      g = await geometry(page);
      assert.equal(g.active, id, `narrow again, trip ${trip}`);
      assert.ok(near(g.activeCentre, narrow / 2, 1), String(g.activeCentre));
      assert.deepEqual(shownCards(g), [id], "and its card is the one that shows");
      assert.equal(new Set(g.order).size, looks, "no look was copied or lost");
    }
  });
}

/* A 4/5/6 row that does not loop cannot always rest on the look the centred
   row was on: it may show every look at once, or be at its end before that
   look has come to the front. The look is not forgotten for that: narrowed
   again, the row is back on it, unless the visitor has moved the row since
   or has the focus on another look's card. */
test("four looks in layout 4: the look the centred row was on comes back after the wide row has shown all four", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 4, width: 800, height: 900 });
  await press(page, "[data-lookbook-next]", 2);
  await leaveFocus(page);
  assert.equal((await geometry(page)).active, "look-3");
  for (const trip of [1, 2]) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await settle(page);
    let g = await geometry(page);
    assert.deepEqual([g.still, shownCards(g).length], [true, 4], "every look fits, each with its card");
    // A wider window still, without going back first.
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page);
    await page.setViewportSize({ width: 800, height: 900 });
    await settle(page);
    g = await geometry(page);
    assert.equal(g.active, "look-3", `narrow again, trip ${trip}`);
    assert.ok(near(g.activeCentre, 400, 1), String(g.activeCentre));
    assert.deepEqual(shownCards(g), ["look-3"]);
  }
});

test("layout 6 with 7 looks, on the last look: the wide row is at its end with the look in it, and narrowed again the row is back on it", async (t) => {
  const page = await lookbook(t, { layout: "6", looks: 7, width: 800, height: 900 });
  await press(page, "[data-lookbook-prev]", 1);
  await leaveFocus(page);
  assert.equal((await geometry(page)).active, "look-7");
  await page.setViewportSize({ width: 1280, height: 900 });
  await settle(page);
  let g = await geometry(page);
  assert.equal(g.loop, false, "six in the row and seven looks: no loop");
  assert.deepEqual(g.order, ids("", [1, 2, 3, 4, 5, 6, 7]), "the merchant's order");
  assert.equal(lookIn(g, "look-7").inRow, true, "the look is in the row");
  await page.setViewportSize({ width: 800, height: 900 });
  await settle(page);
  g = await geometry(page);
  assert.equal(g.active, "look-7");
  assert.ok(near(g.activeCentre, 400, 1), String(g.activeCentre));
  assert.deepEqual(shownCards(g), ["look-7"]);
});

test("a wide row that the visitor has moved comes back on the look it was moved to", async (t) => {
  const page = await lookbook(t, { layout: "6", looks: 7, width: 800, height: 900 });
  await press(page, "[data-lookbook-prev]", 1);
  await leaveFocus(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await settle(page);
  assert.equal((await geometry(page)).active, "look-2", "at its end, the row starts with look 2");
  await page.focus(".valor-lookbook__track");
  await page.keyboard.press("ArrowLeft");
  await settle(page);
  assert.equal((await geometry(page)).active, "look-1");
  await leaveFocus(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await settle(page);
  const g = await geometry(page);
  assert.equal(g.active, "look-1");
  assert.deepEqual(shownCards(g), ["look-1"]);
});

test("a card with the focus in the wide row counts for more than the look the centred row was on", async (t) => {
  const page = await lookbook(t, { layout: "4", looks: 4, width: 800, height: 900 });
  await press(page, "[data-lookbook-next]", 2);
  await leaveFocus(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await settle(page);
  await page.focus("#look-4 .valor-lookbook__card-button");
  await page.setViewportSize({ width: 800, height: 900 });
  await settle(page);
  assert.deepEqual([(await geometry(page)).active, await focusOf(page)], ["look-4", "look-4 BUTTON"]);
});
