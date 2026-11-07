const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// Theme settings → Layout → Page width (config/settings_schema.json,
// max_page_width), printed as --page-width by snippets/css-variables.liquid
// and used by every section's content grid in critical.css.
const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "assets", "critical.css"), "utf8");
const schema = JSON.parse(fs.readFileSync(path.join(root, "config", "settings_schema.json"), "utf8"));
const locale = JSON.parse(fs.readFileSync(path.join(root, "locales", "en.default.schema.json"), "utf8"));

let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  // WebKit on Windows can stall in close() after every test has passed;
  // npm test runs with --test-force-exit, so a stalled close can't hold the run.
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

const setting = schema.flatMap((group) => group.settings || []).find((s) => s.id === "max_page_width");
const label = (key) =>
  key
    .replace(/^t:/, "")
    .split(".")
    .reduce((node, part) => node && node[part], locale);

test("Page width offers Compact, Standard, Wide and Full width; existing values are unchanged", () => {
  assert.deepEqual(
    setting.options.map((option) => [option.value, label(option.label)]),
    [
      ["75rem", "Compact"],
      ["90rem", "Standard"],
      ["110rem", "Wide"],
      ["100%", "Full width"],
    ],
  );
  assert.equal(setting.default, "75rem");
});

async function contentWidth(t, viewport, pageWidth) {
  const page = await browser.newPage({ viewport: { width: viewport, height: 600 } });
  t.after(() => page.close());
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    :root { --page-width: ${pageWidth}; --page-margin: 20px; } ${css} body { margin: 0; }
  </style></head><body><div class="shopify-section"><div class="probe">Content</div></div></body></html>`);
  return page.$eval(".probe", (el) => Math.round(el.getBoundingClientRect().width));
}

for (const [value, expected] of [
  ["75rem", 1160],
  ["90rem", 1400],
  ["110rem", 1720],
  ["100%", 2520],
]) {
  test(`page width ${value}: the content is ${expected}px wide on a 2560px screen`, async (t) => {
    assert.equal(await contentWidth(t, 2560, value), expected);
  });
}

test("Full width follows the screen, keeping the page margins (1440px and 1920px)", async (t) => {
  assert.equal(await contentWidth(t, 1440, "100%"), 1400);
  assert.equal(await contentWidth(t, 1920, "100%"), 1880);
});

// Section containers follow the setting: a fixed 75rem cap would keep them
// at 1200px whatever the merchant chose. (The video section's "Large" size is
// its own size option and stays.)
const containerFiles = [
  ...fs
    .readdirSync(path.join(root, "sections"))
    .filter((f) => f.endsWith(".liquid"))
    .map((f) => path.join("sections", f)),
  ...fs
    .readdirSync(path.join(root, "assets"))
    .filter((f) => f.endsWith(".css"))
    .map((f) => path.join("assets", f)),
];

test("no section container is capped at a fixed 75rem", () => {
  const fixed = containerFiles.filter((f) => /max-width:\s*75rem/.test(fs.readFileSync(path.join(root, f), "utf8")));
  assert.deepEqual(fixed, []);
});

const stylesheetOf = (file) =>
  [...fs.readFileSync(path.join(root, file), "utf8").matchAll(/{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/g)]
    .map((m) => m[1])
    .join("\n");

for (const [file, inner] of [
  ["sections/main-product.liquid", "valor-mp__inner"],
  ["sections/footer.liquid", "valor-footer__top"],
  ["sections/rich-text.liquid", "valor-rich-text__inner"],
]) {
  test(`${inner} grows with the page width and keeps 75rem for Compact (2560px screen)`, async (t) => {
    const page = await browser.newPage({ viewport: { width: 2560, height: 600 } });
    t.after(() => page.close());
    const widths = {};
    for (const value of ["75rem", "90rem", "100%"]) {
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
        :root { --page-width: ${value}; --page-margin: 20px; } ${css} ${stylesheetOf(file)} body { margin: 0; }
      </style></head><body><div class="shopify-section"><div><div class="${inner}">Content</div></div></div></body></html>`);
      widths[value] = await page.$eval(`.${inner}`, (el) => Math.round(el.getBoundingClientRect().width));
    }
    assert.equal(widths["75rem"], 1160, `Compact unchanged ${JSON.stringify(widths)}`);
    assert.equal(widths["90rem"], 1400, JSON.stringify(widths));
    assert.equal(widths["100%"], 2520, JSON.stringify(widths));
  });
}
