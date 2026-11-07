const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// Right-to-left layout of the product gallery overlay controls, using the
// theme's real stylesheets.
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

async function gallery(t, dir) {
  const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
  t.after(() => page.close());
  const css = ["critical.css", "product-media-gallery.css"].map((f) => fs.readFileSync(path.join(root, "assets", f), "utf8")).join("\n");
  await page.setContent(`<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><style>${css}</style></head><body>
    <div style="position: relative; width: 500px; height: 500px; background: #ddd">
      <span class="valor-product-media__zoom-hint" aria-hidden="true"></span>
      <div class="valor-product-media__counter" data-gallery-counter>2 / 7</div>
    </div>
  </body></html>`);
  return page.evaluate(() => {
    const box = (el) => el.getBoundingClientRect().toJSON();
    const counter = document.querySelector(".valor-product-media__counter");
    const zoom = document.querySelector(".valor-product-media__zoom-hint");
    const range = document.createRange();
    const text = counter.firstChild;
    const charX = (i) => {
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      return range.getBoundingClientRect().x;
    };
    return { counter: box(counter), zoom: box(zoom), twoX: charX(0), sevenX: charX(4) };
  });
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const dir of ["ltr", "rtl"]) {
  test(`gallery counter and zoom hint sit on opposite corners (${dir})`, async (t) => {
    const r = await gallery(t, dir);
    assert.equal(overlaps(r.counter, r.zoom), false, JSON.stringify(r));
    if (dir === "rtl") assert.ok(r.counter.x > r.zoom.x, "RTL: counter on the right, zoom on the left");
    else assert.ok(r.counter.x < r.zoom.x, "LTR: counter on the left, zoom on the right");
  });

  test(`gallery counter keeps reading "2 / 7" (${dir})`, async (t) => {
    const r = await gallery(t, dir);
    assert.ok(r.twoX < r.sevenX, JSON.stringify(r));
  });
}

async function picker(t, dir) {
  const page = await browser.newPage({ viewport: { width: 600, height: 300 } });
  t.after(() => page.close());
  const css = ["critical.css", "product-info.css"].map((f) => fs.readFileSync(path.join(root, "assets", f), "utf8")).join("\n");
  await page.setContent(`<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><style>${css}</style></head><body>
    <select class="valor-mp__option-select" style="width: 300px"><option>שחור</option></select>
  </body></html>`);
  return page.evaluate(() => {
    const el = document.querySelector("select");
    const cs = getComputedStyle(el);
    return { posX: cs.backgroundPositionX, padLeft: parseFloat(cs.paddingLeft), padRight: parseFloat(cs.paddingRight) };
  });
}

for (const dir of ["ltr", "rtl"]) {
  test(`variant picker select arrow sits in its reserved padding (${dir})`, async (t) => {
    const r = await picker(t, dir);
    const arrowOnRight = r.posX.split(",").every((x) => x.includes("100%"));
    if (dir === "rtl") {
      assert.ok(r.padLeft > r.padRight, JSON.stringify(r));
      assert.equal(arrowOnRight, false, "RTL arrow must move to the left: " + JSON.stringify(r));
    } else {
      assert.ok(r.padRight > r.padLeft, JSON.stringify(r));
      assert.equal(arrowOnRight, true, JSON.stringify(r));
    }
  });
}
