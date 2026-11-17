// Where tests/footer-2.2.2-metrics.json comes from, and a way to check it.
//
// Measures the footer of the RELEASED theme (2.2.2, commit 0675d10): that
// release's own stylesheet and script, read from git, around the markup it
// printed for the section's default settings, on the same page the footer
// tests use. tests/footer.test.cjs holds today's footer, with its default
// settings, to these numbers.
//
// Not a test file (npm test does not run it). It needs the repository's
// history.
//
//   node tests/footer-2.2.2-baseline.cjs            compares with the stored numbers
//   node tests/footer-2.2.2-baseline.cjs --print    prints what it measured
//   VALOR_BROWSER=webkit node tests/footer-2.2.2-baseline.cjs
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const F = require("./footer-fixture.cjs");

const RELEASE = "0675d10";
const released = execFileSync("git", ["show", `${RELEASE}:sections/footer.liquid`], {
  cwd: F.root,
  encoding: "utf8",
  maxBuffer: 1 << 24,
});
const releasedCss = [...released.matchAll(/{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/g)]
  .map((match) => match[1])
  .join("\n");

/* What 2.2.2 printed for the default settings: today's default markup with
   this branch's changes taken back (the root was a <footer>, the menu
   heading was a clickable <h3> without a button, the Subscribe button had
   only its own class). */
const releasedMarkup = () =>
  F.footerMarkup()
    .replace('<div class="color-scheme-1 valor-footer"', '<footer class="color-scheme-1 valor-footer"')
    .replace(/<\/div><\/div>$/, "</footer></div>")
    .replace(
      /<h3 class="valor-footer__heading"><span class="valor-footer__heading-text">([^<]*)<\/span><button[^>]*>.*?<\/button><\/h3>/,
      '<h3 class="valor-footer__heading" onclick="valorToggleFooterColumn(this)"><span>$1</span><span class="valor-footer__heading-toggle" aria-hidden="true"></span></h3>',
    )
    .replace(' valor-footer__block--foldable"', '"')
    .replace('class="valor-footer__menu valor-footer__panel"', 'class="valor-footer__menu"')
    .replace(
      'class="valor-button valor-button--primary valor-footer__newsletter-button"',
      'class="valor-footer__newsletter-button"',
    );

(async () => {
  const markup = releasedMarkup();
  assert.ok(
    markup.includes("<footer") && markup.includes("valorToggleFooterColumn(this)") && !markup.includes("valor-button "),
  );
  const css = F.themeCss().replace(F.stylesheetOf("sections/footer.liquid"), releasedCss);
  assert.ok(css.includes(releasedCss) && releasedCss.length > 5000, "the released stylesheet is the one on the page");

  const browser = await F.engine.launch({ headless: true });
  const measured = {};
  for (const [name, width, height] of [
    ["desktop", 1440, 900],
    ["tablet", 800, 900],
    ["phone", 390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>
      <main id="MainContent"><div class="shopify-section"><div class="color-scheme-1" style="height: 120px">Page</div></div></main>
      ${markup}
      ${F.footerScript(released)}
    </body></html>`);
    measured[name] = await F.footerMetrics(page);
    if (name === "phone") {
      await page.$eval(".valor-footer__heading", (heading) => heading.click());
      await page.waitForTimeout(700);
      measured.phoneOpen = await F.footerMetrics(page);
    }
    await page.close();
  }
  await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);

  if (process.argv.includes("--print")) {
    console.log(JSON.stringify(measured, null, 2));
    process.exit(0);
  }
  const stored = JSON.parse(F.read("tests", "footer-2.2.2-metrics.json"))[F.engine.name()];
  assert.deepEqual(measured, stored);
  console.log(`${F.engine.name()}: the stored numbers are what release ${RELEASE} draws`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
