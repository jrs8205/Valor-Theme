const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// The lines above and below the filter and sort bar on collection and search
// pages: thickness 0-6 px (0 removes them) and colour (empty = the colour
// scheme's border colour), like the header's bottom border. The section
// prints the two values as custom properties on its root; the real
// stylesheets draw the lines.
const root = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const css = ["critical.css", "collection.css", "facets-bar.css"].map((f) => read("assets", f)).join("\n");

let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  // WebKit on Windows can stall in close() after every test has passed;
  // npm test runs with --test-force-exit, so a stalled close can't hold the run.
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

const schemaOf = (file) => JSON.parse(read("sections", file).match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);

for (const file of ["collection.liquid", "search.liquid"]) {
  test(`${file}: the filter bar lines have a thickness (0-6 px, default 1) and a colour setting`, () => {
    const settings = schemaOf(file).settings;
    const width = settings.find((s) => s.id === "filter_bar_border_width");
    const colour = settings.find((s) => s.id === "filter_bar_border_color");
    assert.ok(width, "thickness setting");
    assert.deepEqual(
      [width.type, width.min, width.max, width.step, width.unit, width.default],
      ["range", 0, 6, 1, "px", 1],
    );
    assert.ok(colour, "colour setting");
    assert.equal(colour.type, "color");
    assert.equal(colour.default, undefined, "empty by default: the scheme's border colour");
    // Both sit with the other filtering and sorting settings.
    const ids = settings.map((s) => s.id || s.content);
    assert.ok(ids.indexOf("filter_bar_border_width") > ids.indexOf("enable_sorting"));
    assert.ok(ids.indexOf("filter_bar_border_width") < ids.indexOf("Section padding"));
  });

  test(`${file}: the section prints the line settings on its root`, () => {
    const liquid = read("sections", file);
    assert.match(liquid, /--valor-filter-bar-border-width: {{ section\.settings\.filter_bar_border_width }}px;/);
    assert.match(
      liquid,
      /{%-? if section\.settings\.filter_bar_border_color != blank -?%}\s*--valor-filter-bar-border-color: {{ section\.settings\.filter_bar_border_color }};\s*{%-? endif -?%}/,
    );
  });
}

function markup(style) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root, .color-scheme-1 { --color-background: #ffffff; --color-foreground: #333333; --valor-border-default: rgb(200, 200, 200); --valor-border-strong: #333333; }
    :root { --page-width: 1200px; --page-margin: 20px; }
    ${css} body { margin: 0; }
  </style></head><body>
    <div class="shopify-section">
      <div class="color-scheme-1 valor-collection" style="${style}">
        <div class="valor-collection__toolbar valor-collection__toolbar--mobile"><span class="valor-collection__count">1 product</span></div>
        <form class="valor-facets-bar">
          <div class="valor-facets-bar__inner">Filter</div>
          <div class="valor-facets-bar__active">Active</div>
        </form>
      </div>
    </div>
  </body></html>`;
}

async function lines(t, width, style = "") {
  const page = await browser.newPage({ viewport: { width, height: 600 } });
  t.after(() => page.close());
  await page.setContent(markup(style));
  return page.evaluate(() => {
    const read = (sel) => {
      const cs = getComputedStyle(document.querySelector(sel));
      return {
        top: `${cs.borderTopWidth} ${cs.borderTopColor}`,
        bottom: `${cs.borderBottomWidth} ${cs.borderBottomColor}`,
      };
    };
    return {
      toolbar: read(".valor-collection__toolbar"),
      bar: read(".valor-facets-bar"),
      active: read(".valor-facets-bar__active"),
    };
  });
}

test("by default the lines are unchanged: 1px in the scheme's border colour", async (t) => {
  const phone = await lines(t, 390);
  assert.deepEqual(phone.toolbar, { top: "1px rgb(200, 200, 200)", bottom: "1px rgb(200, 200, 200)" });
  const desktop = await lines(t, 1280);
  assert.deepEqual(desktop.bar, { top: "1px rgb(200, 200, 200)", bottom: "1px rgb(200, 200, 200)" });
  assert.equal(desktop.active.top, "1px rgb(200, 200, 200)");
});

test("thickness 0 removes the lines on phones and on desktop", async (t) => {
  const style = "--valor-filter-bar-border-width: 0px;";
  const phone = await lines(t, 390, style);
  assert.equal(phone.toolbar.top.split(" ")[0], "0px");
  assert.equal(phone.toolbar.bottom.split(" ")[0], "0px");
  const desktop = await lines(t, 1280, style);
  assert.equal(desktop.bar.top.split(" ")[0], "0px");
  assert.equal(desktop.bar.bottom.split(" ")[0], "0px");
  assert.equal(desktop.active.top.split(" ")[0], "0px");
});

test("thickness and colour can be set", async (t) => {
  const style = "--valor-filter-bar-border-width: 3px; --valor-filter-bar-border-color: #ff0000;";
  const phone = await lines(t, 390, style);
  assert.deepEqual(phone.toolbar, { top: "3px rgb(255, 0, 0)", bottom: "3px rgb(255, 0, 0)" });
  const desktop = await lines(t, 1280, style);
  assert.deepEqual(desktop.bar, { top: "3px rgb(255, 0, 0)", bottom: "3px rgb(255, 0, 0)" });
  assert.equal(desktop.active.top, "3px rgb(255, 0, 0)");
});
