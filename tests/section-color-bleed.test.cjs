const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// A section's colour scheme paints its whole row, edge to edge, as in Dawn
// and Horizon; the content stays in the page-width column with the page
// margins. Before 2.2.1 the scheme only coloured the content column, a box
// with the content touching its edges. Real critical.css; the markup is a
// section as Shopify renders it (.shopify-section > the section's root with
// its scheme class).
const root = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const criticalCss = fs.readFileSync(path.join(root, "assets", "critical.css"), "utf8");

let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  // WebKit on Windows can stall in close() after every test has passed;
  // npm test runs with --test-force-exit, so a stalled close can't hold the run.
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

// The colour of one screen pixel (a 1×1 screenshot: no PNG filter can
// change a lone pixel's bytes, so the inflated row is filter byte + RGB(A)).
async function pixel(page, x, y) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const chunks = [];
  let offset = 8;
  let colourType = 6;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") colourType = data[9];
    if (type === "IDAT") chunks.push(data);
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  assert.ok(colourType === 2 || colourType === 6, `colour type ${colourType}`);
  return `rgb(${raw[1]}, ${raw[2]}, ${raw[3]})`;
}

const DARK = "rgb(20, 20, 20)";
const WHITE = "rgb(255, 255, 255)";

function markup({ dir = "ltr", rootStyle = "", pageWidth = "1200px" } = {}) {
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><style>
    :root, .color-scheme-1 { --color-background: #ffffff; --color-foreground: #333333; }
    .color-scheme-3 { --color-background: #141414; --color-foreground: #f5f4f2; --valor-border-default: rgb(200, 0, 0); }
    :root { --page-width: ${pageWidth}; --page-margin: 20px; }
    ${criticalCss}
    body { margin: 0; background: #ffffff; }
    .demo { background-color: var(--color-background); color: var(--color-foreground); padding-block: 40px; ${rootStyle} }
  </style></head><body>
    <div class="shopify-section" id="before"><div class="color-scheme-1 demo">Above</div></div>
    <div class="shopify-section" id="dark"><div class="color-scheme-3 demo"><p id="content">Baggy Jeans</p></div></div>
    <div class="shopify-section" id="after"><div class="color-scheme-1 demo">Below</div></div>
  </body></html>`;
}

async function open(t, width, options) {
  const page = await browser.newPage({ viewport: { width, height: 700 } });
  t.after(() => page.close());
  await page.setContent(markup(options));
  const box = await page.$eval("#dark > div", (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  return { page, box };
}

for (const [width, label] of [
  [1440, "desktop"],
  [390, "phone"],
]) {
  test(`a dark section's background reaches both screen edges (${label}, ${width}px)`, async (t) => {
    const { page, box } = await open(t, width);
    const y = Math.round((box.top + box.bottom) / 2);
    assert.ok(box.left >= 16, "the section's content keeps the page margin");
    assert.equal(await pixel(page, 1, y), DARK, "left screen edge");
    assert.equal(await pixel(page, width - 2, y), DARK, "right screen edge");
    assert.equal(await pixel(page, Math.round(box.left) - 5, y), DARK, "the page margin beside the content");
  });
}

test("the content stays where it was: the paint moves nothing and adds no scrollbar", async (t) => {
  const { page } = await open(t, 1440);
  const r = await page.evaluate(() => ({
    content: Math.round(document.getElementById("content").getBoundingClientRect().left),
    root: Math.round(document.querySelector("#dark > div").getBoundingClientRect().left),
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  // 1440px screen, 1200px page width: the page-width column starts at 140px.
  assert.equal(r.root, 140, "the section stays in the page-width column");
  assert.equal(r.content, 140, "and its content with it");
  assert.equal(r.scroll, 0, "no horizontal scroll");
});

test("the paint stays in the section's own row: the sections above and below keep their colour", async (t) => {
  const { page, box } = await open(t, 1440);
  assert.equal(await pixel(page, 1, Math.round(box.top) - 3), WHITE, "just above");
  assert.equal(await pixel(page, 1, Math.round(box.bottom) + 3), WHITE, "just below");
  // A section's own outer margin (e.g. the footer's "margin above") is not painted.
  const spaced = await browser.newPage({ viewport: { width: 1440, height: 700 } });
  t.after(() => spaced.close());
  await spaced.setContent(markup({ rootStyle: "margin-top: 30px;" }));
  const top = await spaced.$eval("#dark > div", (el) => el.getBoundingClientRect().top);
  assert.equal(await pixel(spaced, 1, Math.round(top) - 10), WHITE);
});

test("the footer keeps its top line across the content width, and its row is painted", async (t) => {
  const footerCss = read("sections", "footer.liquid").match(/{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/)[1];
  const page = await browser.newPage({ viewport: { width: 1440, height: 600 } });
  t.after(() => page.close());
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    :root, .color-scheme-1 { --color-background: #ffffff; --color-foreground: #333333; }
    .color-scheme-3 { --color-background: #141414; --color-foreground: #f5f4f2; --valor-border-default: rgb(200, 0, 0); }
    :root { --page-width: 1200px; --page-margin: 20px; }
    ${criticalCss}${footerCss} body { margin: 0; background: #ffffff; }
  </style></head><body>
    <div class="shopify-section"><div class="color-scheme-1" style="height: 100px">Page</div></div>
    <div class="shopify-section"><footer class="color-scheme-3 valor-footer" style="--valor-footer-margin-top: 30px;"><p style="margin: 0; padding: 40px 0">Footer</p></footer></div>
  </body></html>`);
  const box = await page.$eval(".valor-footer", (el) => el.getBoundingClientRect());
  assert.equal(
    await page.$eval(".valor-footer", (el) => getComputedStyle(el).borderTopWidth),
    "1px",
    "the line keeps its 1px place",
  );
  assert.equal(
    await pixel(page, 700, Math.round(box.top)),
    "rgb(200, 0, 0)",
    "the line is drawn over the content width",
  );
  assert.equal(await pixel(page, Math.round(box.left) - 5, Math.round(box.top)), DARK, "not into the side margins");
  assert.equal(await pixel(page, 1, Math.round(box.top) + 20), DARK, "the row reaches the screen edge");
  assert.equal(await pixel(page, 1, Math.round(box.top) - 10), WHITE, "the margin above the footer is not painted");
});

test("a translucent scheme background has the same colour in the side margins as behind the content", async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 600 } });
  t.after(() => page.close());
  await page.setContent(markup().replace("--color-background: #141414;", "--color-background: rgba(0, 0, 0, 0.5);"));
  const box = await page.$eval("#dark > div", (el) => el.getBoundingClientRect());
  const y = Math.round((box.top + box.bottom) / 2);
  const inside = await pixel(page, Math.round(box.left) + 40, Math.round(box.top) + 5);
  assert.notEqual(inside, WHITE);
  for (const x of [1, Math.round(box.left) - 5, Math.round(box.right) + 5, 1438]) {
    assert.equal(await pixel(page, x, y), inside, `x=${x}`);
  }
});

test("no seam where the side paint meets the section (content edge on half a pixel)", async (t) => {
  // 1441px screen, 1200px page width: the content column starts at 140.5px.
  const page = await browser.newPage({ viewport: { width: 1441, height: 600 } });
  t.after(() => page.close());
  await page.setContent(markup());
  const box = await page.$eval("#dark > div", (el) => el.getBoundingClientRect());
  const y = Math.round(box.top) + 10; // in the section's padding, clear of its text
  for (const x of [
    Math.floor(box.left) - 1,
    Math.floor(box.left),
    Math.ceil(box.left),
    Math.floor(box.right),
    Math.ceil(box.right),
  ]) {
    assert.equal(await pixel(page, x, y), DARK, `x=${x} (content ${box.left}..${box.right})`);
  }
});

test("a full-width section (announcement bar) keeps its own separator line", async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 400 } });
  t.after(() => page.close());
  await page.setContent(
    markup({ rootStyle: "border-bottom: 3px solid var(--valor-border-default);" }).replace(
      'class="color-scheme-3 demo"',
      'class="color-scheme-3 demo valor-full-width"',
    ),
  );
  const box = await page.$eval("#dark > div", (el) => el.getBoundingClientRect());
  assert.equal(Math.round(box.left), 0, "spans the screen");
  assert.equal(await pixel(page, 700, Math.round(box.bottom) - 2), "rgb(200, 0, 0)");
});

test("right-to-left pages are painted the same", async (t) => {
  const { page, box } = await open(t, 1440, { dir: "rtl" });
  const y = Math.round((box.top + box.bottom) / 2);
  assert.equal(await pixel(page, 1, y), DARK);
  assert.equal(await pixel(page, 1438, y), DARK);
});

test("a section that paints its scheme the other way round (marquee) fills its row with its own colour", async (t) => {
  const liquid = fs.readFileSync(path.join(root, "sections", "marquee.liquid"), "utf8");
  const marqueeCss = liquid.match(/{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/)[1];
  const page = await browser.newPage({ viewport: { width: 1440, height: 500 } });
  t.after(() => page.close());
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    :root, .color-scheme-1 { --color-background: #ffffff; --color-foreground: #333333; }
    .color-scheme-3 { --color-background: #141414; --color-foreground: #f5f4f2; }
    :root { --page-width: 1200px; --page-margin: 20px; }
    ${criticalCss}${marqueeCss} body { margin: 0; background: #ffffff; }
  </style></head><body>
    <div class="shopify-section"><section class="color-scheme-3 valor-marquee"><div class="valor-marquee__viewport">Free shipping</div></section></div>
  </body></html>`);
  const box = await page.$eval(".valor-marquee", (el) => el.getBoundingClientRect());
  const y = Math.round((box.top + box.bottom) / 2);
  const inside = await pixel(page, Math.round(box.left) + 2, Math.round(box.top) + 2);
  assert.equal(inside, "rgb(245, 244, 242)", "the marquee's own background");
  assert.equal(await pixel(page, 1, y), inside, "left edge in the same colour");
  assert.equal(await pixel(page, 1438, y), inside, "right edge in the same colour");
});

// The narrowest content the settings allow on a wide screen: Compact (75rem)
// at the smallest text scale (85 %) = 1020px, with the widest page margins
// (100px) = 820px of content.
for (const width of [3840, 7680]) {
  test(`with the narrowest allowed content (820px) the row is painted without gaps (${width}px screen)`, async (t) => {
    const page = await browser.newPage({ viewport: { width, height: 400 } });
    t.after(() => page.close());
    await page.setContent(markup({ pageWidth: "1020px" }).replace("--page-margin: 20px;", "--page-margin: 100px;"));
    const box = await page.$eval("#dark > div", (el) => el.getBoundingClientRect());
    assert.equal(Math.round(box.width), 820);
    const y = Math.round((box.top + box.bottom) / 2);
    // Every 10px across the screen outside the content.
    const misses = [];
    for (let x = 1; x < width - 1; x += 10) {
      if (x > box.left - 2 && x < box.right + 2) continue;
      if ((await pixel(page, x, y)) !== DARK) misses.push(x);
      if (misses.length > 5) break;
    }
    assert.deepEqual(misses, []);
  });
}

test("on a very wide screen with a compact page width the edges are still painted", async (t) => {
  const page = await browser.newPage({ viewport: { width: 3840, height: 500 } });
  t.after(() => page.close());
  await page.setContent(markup());
  const box = await page.$eval("#dark > div", (el) => el.getBoundingClientRect());
  const y = Math.round((box.top + box.bottom) / 2);
  for (const x of [1, 600, Math.round(box.left) - 5, Math.round(box.right) + 5, 3300, 3838]) {
    assert.equal(await pixel(page, x, y), DARK, `x=${x}`);
  }
});

// --- The header -----------------------------------------------------------------

// The header's scheme class sits on <header> inside the section wrapper,
// but the wrapper paints the header's background (sticky and transparent
// header states). The scheme's colours apply to the whole header section
// (snippets/css-variables.liquid), so a dark header scheme gives a dark
// header, edge to edge, with its light text.
const cssVariables = read("snippets", "css-variables.liquid");
// Every rule the scheme loop prints, by its selector list: the rules that
// carry the scheme's declarations (written out, or captured once and
// printed in each rule).
const schemeLoop = cssVariables.match(
  /{%-?\s*for scheme in settings\.color_schemes\s*-?%}([\s\S]*?){%-?\s*endfor\s*-?%}/,
)[1];
const schemeRules = [
  ...schemeLoop.matchAll(
    /((?:[^{}%]|{{[^}]*}})+?)\s*\{\s*(?:{{\s*scheme_declarations\s*}}|--color-background: {{ scheme\.settings\.background }};)/g,
  ),
].map((m) =>
  m[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim(),
);
// The CSS the loop gives for these schemes. hasSupport: false stands for a
// browser without :has() (Safari before 15.4, Firefox before 121), where a
// selector list with :has() is invalid as a whole.
function schemeCss(schemes, { hasSupport = true } = {}) {
  return schemes
    .flatMap(([id, bg, fg], index) =>
      schemeRules.map((selector) => {
        let s = selector.replace(/{{ scheme\.id }}/g, id);
        // {% if forloop.first %}:root,{% endif %}: the first scheme is the page's.
        if (index === 0 && selector === ".color-{{ scheme.id }}") s = `:root, ${s}`;
        if (!hasSupport) s = s.replace(/:has\(/g, ":has-unsupported(");
        return `${s} { --color-background: ${bg}; --color-foreground: ${fg}; }`;
      }),
    )
    .join("\n");
}
const SCHEMES = [
  ["scheme-1", "#ffffff", "#333333"],
  ["scheme-3", "#141414", "#f5f4f2"],
];
const headerCss = read("sections", "header.liquid").match(/{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/)[1];

test("the scheme's colours also apply to the header section that holds a header with that scheme", () => {
  assert.ok(
    schemeRules.some((s) => /\.color-{{ scheme\.id }}/.test(s)),
    JSON.stringify(schemeRules),
  );
  assert.ok(
    schemeRules.some((s) => /\.valor-section-header:has\(> valor-sticky-header > \.color-{{ scheme\.id }}\)/.test(s)),
    JSON.stringify(schemeRules),
  );
});

test("the scheme classes never share a selector list with :has()", () => {
  for (const selector of schemeRules) {
    const members = selector.split(",").map((m) => m.trim());
    if (members.includes(".color-{{ scheme.id }}"))
      assert.doesNotMatch(selector, /:has\(/, `"${selector}" would be dropped as a whole where :has() is unknown`);
  }
});

test("without :has() support the colour schemes still apply everywhere (only the header extra is lost)", async (t) => {
  const page = await browser.newPage({ viewport: { width: 800, height: 300 } });
  t.after(() => page.close());
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    ${schemeCss(SCHEMES, { hasSupport: false })}
    body { margin: 0; } .probe { background: var(--color-background); color: var(--color-foreground); }
  </style></head><body><div class="color-scheme-3 probe" id="Section">Dark section</div><p class="probe" id="Page">Page</p></body></html>`);
  const r = await page.evaluate(() => ({
    section: getComputedStyle(document.getElementById("Section")).backgroundColor,
    text: getComputedStyle(document.getElementById("Section")).color,
    page: getComputedStyle(document.getElementById("Page")).backgroundColor,
  }));
  assert.deepEqual(r, { section: "rgb(20, 20, 20)", text: "rgb(245, 244, 242)", page: "rgb(255, 255, 255)" });
});

for (const sticky of [true, false]) {
  test(`a dark header scheme paints the header dark from edge to edge, with its light text (${sticky ? "sticky" : "not sticky"})`, async (t) => {
    const schemes = schemeCss(SCHEMES);
    const page = await browser.newPage({ viewport: { width: 1440, height: 500 } });
    t.after(() => page.close());
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      :root { --color-background: #ffffff; --color-foreground: #333333; --page-width: 1200px; --page-margin: 20px; }
      ${schemes}
      ${criticalCss}${headerCss} body { margin: 0; background: #ffffff; }
    </style></head><body>
      <div id="shopify-section-header" class="shopify-section valor-section-header${sticky ? " valor-section-header--sticky" : ""}">
        <valor-sticky-header>
          <header class="color-scheme-3 valor-header valor-header--logo-center">
            <div class="valor-header__title"><a href="#" class="valor-header__title-link" id="Logo">Valor Demo Store</a></div>
            <div class="valor-header__icons"><span id="Inherits">account</span></div>
          </header>
        </valor-sticky-header>
      </div>
      <main><p>Page</p></main>
    </body></html>`);
    const box = await page.$eval(".valor-header", (el) => el.getBoundingClientRect());
    const y = Math.round(box.top + 10);
    assert.equal(await pixel(page, 1, y), DARK, "left edge");
    assert.equal(await pixel(page, 1438, y), DARK, "right edge");
    assert.equal(await pixel(page, 720, y), DARK, "behind the logo");
    assert.equal(await page.$eval("#Logo", (el) => getComputedStyle(el).color), "rgb(245, 244, 242)");
    // What only inherits its colour (the account component) is light too.
    assert.equal(await page.$eval("#Inherits", (el) => getComputedStyle(el).color), "rgb(245, 244, 242)");
  });
}
