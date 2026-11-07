const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// "Two columns" desktop gallery layout (snippets/product-media-gallery.liquid)
// with the real stylesheet: every image two per row, an odd last image centred
// at the same size, colour filtering respected, phones keep the swipe gallery.
const root = path.resolve(__dirname, "..");
const css = ["critical.css", "product-media-gallery.css"]
  .map((f) => fs.readFileSync(path.join(root, "assets", f), "utf8"))
  .join("\n");

let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  // WebKit on Windows can stall in close() after every test has passed;
  // npm test runs with --test-force-exit, so a stalled close can't hold the run.
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#ccc"/></svg>')}`;

// As the snippet renders it: the first item is the active one, the others are
// [hidden] for the carousel. colorHidden: indexes the colour filter hides.
function markup({ count, layout = "two_columns", colorHidden = [] }) {
  const items = Array.from({ length: count }, (_, i) => {
    const cls = `valor-product-media__main-item${i === 0 ? " is-active" : ""}${colorHidden.includes(i) ? " is-color-hidden" : ""}`;
    return `<button type="button" class="${cls}" data-media-index="${i}"${i === 0 ? "" : " hidden"}><img src="${image}" width="800" height="1000" alt=""></button>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css} body { margin: 0; }</style></head><body>
    <div style="width: 640px">
      <div class="valor-product-media valor-product-media--portrait valor-product-media--fit-cover valor-product-media--desktop-layout-${layout}" data-desktop-layout="${layout}">
        <div class="valor-product-media__main">${items}</div>
      </div>
    </div>
  </body></html>`;
}

async function boxes(t, width, options) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  t.after(() => page.close());
  await page.setContent(markup(options));
  return page.evaluate(() => {
    const main = document.querySelector(".valor-product-media__main").getBoundingClientRect();
    const items = [...document.querySelectorAll(".valor-product-media__main-item")]
      .filter((el) => getComputedStyle(el).display !== "none")
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          i: +el.dataset.mediaIndex,
          left: Math.round(r.left),
          top: Math.round(r.top),
          width: Math.round(r.width),
          center: Math.round(r.left + r.width / 2),
        };
      });
    return {
      mainLeft: Math.round(main.left),
      mainCenter: Math.round(main.left + main.width / 2),
      mainWidth: Math.round(main.width),
      items,
    };
  });
}

const rows = (items) => {
  const byTop = new Map();
  for (const item of items) byTop.set(item.top, [...(byTop.get(item.top) || []), item.i]);
  return [...byTop.values()];
};

test("desktop: every image shows, two per row, all the same width", async (t) => {
  const r = await boxes(t, 1280, { count: 4 });
  assert.deepEqual(rows(r.items), [
    [0, 1],
    [2, 3],
  ]);
  const widths = new Set(r.items.map((item) => item.width));
  assert.equal(widths.size, 1, JSON.stringify(r.items));
  assert.ok(r.items[0].width < r.mainWidth / 2 && r.items[0].width > r.mainWidth / 2 - 10, JSON.stringify(r));
});

test("desktop: with five images the fifth is centred under the others at the same size", async (t) => {
  const r = await boxes(t, 1280, { count: 5 });
  assert.deepEqual(rows(r.items), [[0, 1], [2, 3], [4]]);
  const last = r.items[4];
  assert.equal(last.width, r.items[0].width);
  assert.ok(Math.abs(last.center - r.mainCenter) <= 1, JSON.stringify({ last, mainCenter: r.mainCenter }));
});

test("desktop: images hidden by the colour filter leave no gaps, and an odd last one is centred", async (t) => {
  const r = await boxes(t, 1280, { count: 5, colorHidden: [1, 3] });
  assert.deepEqual(rows(r.items), [[0, 2], [4]]);
  assert.ok(Math.abs(r.items[2].center - r.mainCenter) <= 1, JSON.stringify(r));
});

test("phones keep the one-image swipe gallery", async (t) => {
  const r = await boxes(t, 390, { count: 5 });
  assert.deepEqual(
    r.items.map((item) => item.i),
    [0],
  );
});
