const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// The EU legal guarantee notice pop-up (snippets/legal-guarantee-notice.liquid)
// with the theme's real stylesheet and script. The Commission guidelines
// require the notice to be "always legible at default display size", so it
// opens at a legible width (36rem) and narrow screens scroll it sideways;
// "Show the whole notice" is an overview on request.
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

// The official notice is portrait (the English SVG is 381 x 539); its size
// attributes are what image_tag prints for the uploaded file.
const notice = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="381" height="539" viewBox="0 0 381 539"><rect width="381" height="539" fill="#0e4f9e"/><rect x="20" y="20" width="341" height="499" fill="#fff"/></svg>',
)}`;

// Mirrors the Liquid markup (dialog mode); the script is left out when
// script is false, to check the pop-up without JavaScript.
function markup({ dir = "ltr", script = true, scale = 1 } = {}) {
  const css = fs.readFileSync(path.join(root, "assets", "critical.css"), "utf8");
  const js = script
    ? `<script>${fs.readFileSync(path.join(root, "assets", "legal-guarantee.js"), "utf8")}</script>`
    : "";
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>:root { --font-body-scale: ${scale}; }${css}</style></head><body>
    <button type="button" id="open-notice" popovertarget="ValorLegalGuaranteeNotice">Your legal guarantee rights</button>
    <div id="ValorLegalGuaranteeNotice" class="valor-legal-popover" popover role="dialog" aria-labelledby="NoticeTitle">
      <div class="valor-legal-popover__header">
        <h2 id="NoticeTitle" class="valor-legal-popover__title">Your legal guarantee rights</h2>
        <button type="button" class="valor-legal-popover__close" popovertarget="ValorLegalGuaranteeNotice" popovertargetaction="hide" aria-label="Close">x</button>
      </div>
      <div class="valor-legal-popover__body">
        <p class="valor-legal-popover__hint" data-legal-hint>Scroll sideways to read the whole notice.</p>
        <div class="valor-legal-popover__frame" data-legal-frame>
          <div id="ValorLegalGuaranteeArtwork" class="valor-legal-popover__artwork valor-legal-popover__artwork--notice"
            role="region" aria-label="Your legal guarantee rights" tabindex="0" data-legal-artwork>
            <img class="valor-legal-popover__image" src="${notice}" width="381" height="539" alt="EU notice">
          </div>
        </div>
        <button type="button" class="valor-legal-popover__fit" aria-controls="ValorLegalGuaranteeArtwork" data-legal-fit
          data-label-whole="Show the whole notice" data-label-readable="Show at readable size" hidden>Show the whole notice</button>
        <ul class="valor-legal-popover__links" role="list"><li><a href="#">Open the notice in full size</a></li></ul>
        <details class="valor-legal-popover__text-version"><summary>Read the notice as text</summary><p>Legal guarantee</p></details>
      </div>
    </div>
    ${js}
  </body></html>`;
}

async function open(t, width, options = {}) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  t.after(() => page.close());
  await page.setContent(markup(options));
  await page.click("#open-notice");
  await settle(page);
  return page;
}

// The pop-up's toggle event and scroll events arrive in a later task.
const settle = (page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50))));

function state(page) {
  return page.evaluate(() => {
    const artwork = document.getElementById("ValorLegalGuaranteeArtwork");
    const img = artwork.querySelector("img");
    const button = document.querySelector("[data-legal-fit]");
    const hint = document.querySelector("[data-legal-hint]");
    const frame = document.querySelector("[data-legal-frame]");
    const visible = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== "none";
    return {
      artworkWidth: Math.round(artwork.getBoundingClientRect().width),
      imageWidth: Math.round(img.getBoundingClientRect().width),
      scrolls: artwork.scrollWidth > artwork.clientWidth + 1,
      buttonVisible: visible(button),
      buttonText: button.textContent.trim(),
      hintVisible: visible(hint),
      shade: frame.hasAttribute("data-more"),
      pageScrolls: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

const LEGIBLE = 576; // 36rem

for (const width of [320, 390]) {
  test(`on a ${width}px phone the notice opens at a legible size and scrolls sideways`, async (t) => {
    const page = await open(t, width);
    const s = await state(page);
    assert.ok(s.imageWidth >= LEGIBLE, JSON.stringify(s));
    assert.equal(s.scrolls, true, JSON.stringify(s));
    assert.equal(s.pageScrolls, false, "only the notice scrolls, never the page");
    assert.equal(s.hintVisible, true, "says how to read the rest");
    assert.equal(s.shade, true, "the edge with more to read is shaded");
    assert.equal(s.buttonVisible, true);
    assert.equal(s.buttonText, "Show the whole notice");
  });
}

test("the edge shade goes away once the notice is scrolled to its end", async (t) => {
  const page = await open(t, 390);
  await page.$eval("#ValorLegalGuaranteeArtwork", (el) => (el.scrollLeft = el.scrollWidth));
  await settle(page);
  assert.equal((await state(page)).shade, false);
});

test("Show the whole notice fits it to the pop-up, Show at readable size goes back", async (t) => {
  const page = await open(t, 390);
  await page.click("[data-legal-fit]");
  await settle(page);
  let s = await state(page);
  assert.ok(s.imageWidth <= s.artworkWidth, JSON.stringify(s));
  assert.equal(s.scrolls, false);
  assert.equal(s.hintVisible, false);
  assert.equal(s.shade, false);
  assert.equal(s.buttonText, "Show at readable size");
  await page.click("[data-legal-fit]");
  await settle(page);
  s = await state(page);
  assert.ok(s.imageWidth >= LEGIBLE, JSON.stringify(s));
  assert.equal(s.scrolls, true);
  assert.equal(s.hintVisible, true);
  assert.equal(s.buttonText, "Show the whole notice");
});

test("tapping the notice switches between the readable size and the whole notice", async (t) => {
  const page = await open(t, 390);
  await page.click("#ValorLegalGuaranteeArtwork img", { position: { x: 20, y: 20 } });
  await settle(page);
  assert.equal((await state(page)).scrolls, false);
  await page.click("#ValorLegalGuaranteeArtwork img", { position: { x: 20, y: 20 } });
  await settle(page);
  assert.equal((await state(page)).scrolls, true);
});

test("the button works from the keyboard", async (t) => {
  const page = await open(t, 390);
  await page.focus("[data-legal-fit]");
  await page.keyboard.press("Enter");
  await settle(page);
  assert.equal((await state(page)).scrolls, false);
  await page.keyboard.press("Space");
  await settle(page);
  assert.equal((await state(page)).scrolls, true);
});

test("the pop-up always opens at the readable size", async (t) => {
  const page = await open(t, 390);
  await page.click("[data-legal-fit]");
  await settle(page);
  await page.click(".valor-legal-popover__close");
  await page.click("#open-notice");
  const s = await state(page);
  assert.ok(s.imageWidth >= LEGIBLE, JSON.stringify(s));
  assert.equal(s.buttonText, "Show the whole notice");
});

test("on a desktop the notice fits at a legible size with no hint or button", async (t) => {
  const page = await open(t, 1280);
  const s = await state(page);
  assert.ok(s.imageWidth >= LEGIBLE, JSON.stringify(s));
  assert.equal(s.scrolls, false, JSON.stringify(s));
  assert.equal(s.hintVisible, false);
  assert.equal(s.buttonVisible, false);
  assert.equal(s.shade, false);
});

test("without JavaScript the phone gets the legible notice and the hint, and no dead button", async (t) => {
  const page = await open(t, 390, { script: false });
  const s = await state(page);
  assert.ok(s.imageWidth >= LEGIBLE, JSON.stringify(s));
  assert.equal(s.scrolls, true);
  assert.equal(s.hintVisible, true);
  assert.equal(s.buttonVisible, false);
});

test("right-to-left: the notice starts at its right edge and the shade is on the left", async (t) => {
  const page = await open(t, 390, { dir: "rtl" });
  const r = await page.evaluate(() => {
    const artwork = document.getElementById("ValorLegalGuaranteeArtwork").getBoundingClientRect();
    const img = document.querySelector("#ValorLegalGuaranteeArtwork img").getBoundingClientRect();
    const frame = document.querySelector("[data-legal-frame]");
    const shade = getComputedStyle(frame, "::after");
    return {
      artworkRight: Math.round(artwork.right),
      imageRight: Math.round(img.right),
      shade: frame.hasAttribute("data-more"),
      shadeLeft: shade.left,
      shadeRight: shade.right,
    };
  });
  assert.equal(r.imageRight, r.artworkRight, JSON.stringify(r));
  assert.equal(r.shade, true, JSON.stringify(r));
  assert.equal(r.shadeLeft, "0px", JSON.stringify(r));
  await page.$eval("#ValorLegalGuaranteeArtwork", (el) => (el.scrollLeft = -el.scrollWidth));
  await settle(page);
  assert.equal((await state(page)).shade, false);
});

// --- Review fixes ------------------------------------------------------------

test("with the theme text scale at 130%, the hint and the overview follow the real overflow (768px)", async (t) => {
  const page = await open(t, 768, { scale: 1.3 });
  let s = await state(page);
  assert.equal(s.scrolls, true, JSON.stringify(s));
  assert.equal(s.hintVisible, true);
  assert.equal(s.buttonVisible, true);
  await page.click("#ValorLegalGuaranteeArtwork img", { position: { x: 20, y: 20 } });
  await settle(page);
  s = await state(page);
  assert.equal(s.scrolls, false, "a tap fits it here too");
});

test("where the notice fits at its legible size there is no hint or button (700px)", async (t) => {
  const page = await open(t, 700);
  const s = await state(page);
  assert.equal(s.scrolls, false, JSON.stringify(s));
  assert.equal(s.hintVisible, false);
  assert.equal(s.buttonVisible, false);
});

test("opening and closing the text version keeps the whole-notice view", async (t) => {
  const page = await open(t, 390);
  await page.click("[data-legal-fit]");
  await settle(page);
  await page.click(".valor-legal-popover__text-version summary");
  await settle(page);
  await page.click(".valor-legal-popover__text-version summary");
  await settle(page);
  const s = await state(page);
  assert.equal(s.scrolls, false, JSON.stringify(s));
  assert.equal(s.buttonText, "Show at readable size");
});
