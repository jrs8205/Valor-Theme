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
// The same picture as files of several widths, the list image_tag prints
// (srcset). They are served to the page as files from a made-up address
// (open() answers the requests): from data: addresses Chromium always takes
// the largest, whatever the image's size.
const NOTICE_FILES = "https://notice.test/notice-";
const noticeFile = (width) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round((width * 539) / 381)}" viewBox="0 0 381 539"><rect width="381" height="539" fill="#0e4f9e"/></svg>`;
const WIDTHS = [600, 800, 1000, 1200, 1600, 2400, 3000];
const SIZES = "(min-width: 800px) 760px, 36rem";

function markup({ dir = "ltr", script = true, scale = 1, srcset = false } = {}) {
  const files = srcset
    ? ` srcset="${WIDTHS.map((width) => `${NOTICE_FILES}${width}.svg ${width}w`).join(", ")}" sizes="${SIZES}"`
    : "";
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
        <div class="valor-legal-popover__zoom" data-legal-zoom hidden>
          <button type="button" class="valor-legal-popover__zoom-button" data-legal-zoom-out aria-controls="ValorLegalGuaranteeArtwork" aria-label="Zoom out"><span aria-hidden="true">−</span></button>
          <button type="button" class="valor-legal-popover__zoom-button" data-legal-zoom-in aria-controls="ValorLegalGuaranteeArtwork" aria-label="Zoom in"><span aria-hidden="true">+</span></button>
          <button type="button" class="valor-legal-popover__fit" aria-controls="ValorLegalGuaranteeArtwork" data-legal-fit
            data-label-whole="Show the whole notice" data-label-readable="Show at readable size" hidden>Show the whole notice</button>
        </div>
        <p class="valor-legal-popover__hint" data-legal-hint>Scroll sideways to read the whole notice.</p>
        <div class="valor-legal-popover__frame" data-legal-frame>
          <div id="ValorLegalGuaranteeArtwork" class="valor-legal-popover__artwork valor-legal-popover__artwork--notice"
            role="region" aria-label="Your legal guarantee rights" tabindex="0" data-legal-artwork>
            <img class="valor-legal-popover__image" src="${notice}"${files} width="381" height="539" alt="EU notice">
          </div>
        </div>
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
  // A control that is missing or hidden fails the test in seconds, not after
  // Playwright's default half minute per action.
  page.setDefaultTimeout(4000);
  if (options.srcset) {
    await page.route(`${NOTICE_FILES}*`, (route) => {
      const width = Number(
        route
          .request()
          .url()
          .match(/notice-(\d+)\.svg/)[1],
      );
      return route.fulfill({ contentType: "image/svg+xml", body: noticeFile(width) });
    });
  }
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
      imageExact: img.getBoundingClientRect().width,
      zoomVisible: visible(document.querySelector("[data-legal-zoom]")),
      zoomInDisabled: document.querySelector("[data-legal-zoom-in]").disabled,
      zoomOutDisabled: document.querySelector("[data-legal-zoom-out]").disabled,
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

test("on a desktop the notice fits at a legible size with no hint or whole-notice button", async (t) => {
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

test("where the notice fits at its legible size there is no hint or whole-notice button (700px)", async (t) => {
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

// --- Zoom buttons (2.3.0) ----------------------------------------------------
// Minus, plus and the reset button sit above the notice on every screen. The
// steps are multiples of the size the notice opens at: 150%, 200%, 300%; one
// step below it is the whole notice, where the readable size does not fit.

const near = (actual, expected) => Math.abs(actual - expected) <= 1;

for (const width of [1280, 390]) {
  test(`the zoom buttons are there at ${width}px`, async (t) => {
    const page = await open(t, width);
    const s = await state(page);
    assert.equal(s.zoomVisible, true, JSON.stringify(s));
    assert.equal(s.zoomInDisabled, false);
  });

  test(`+ enlarges the notice in steps of 150%, 200% and 300% (${width}px)`, async (t) => {
    const page = await open(t, width);
    const base = (await state(page)).imageExact;
    for (const factor of [1.5, 2, 3]) {
      await page.click("[data-legal-zoom-in]");
      await settle(page);
      const s = await state(page);
      assert.ok(near(s.imageExact, base * factor), `${factor}: ${s.imageExact} vs ${base * factor}`);
      assert.equal(s.scrolls, true, "the enlarged notice scrolls inside its frame");
      assert.equal(s.pageScrolls, false, "never the page");
    }
    assert.equal((await state(page)).zoomInDisabled, true, "300% is the largest step");
  });
}

test("on a desktop − is disabled at the opening size", async (t) => {
  const page = await open(t, 1280);
  const s = await state(page);
  assert.equal(s.zoomVisible, true);
  assert.equal(s.zoomOutDisabled, true);
});

test("− steps back down to the opening size", async (t) => {
  const page = await open(t, 1280);
  const base = (await state(page)).imageExact;
  await page.click("[data-legal-zoom-in]");
  await page.click("[data-legal-zoom-in]");
  await page.click("[data-legal-zoom-out]");
  await settle(page);
  assert.ok(near((await state(page)).imageExact, base * 1.5));
  await page.click("[data-legal-zoom-out]");
  await settle(page);
  const s = await state(page);
  assert.ok(near(s.imageExact, base), JSON.stringify(s));
  assert.equal(s.zoomOutDisabled, true);
  assert.equal(s.zoomInDisabled, false);
});

test("on a phone − from the readable size shows the whole notice, + goes back", async (t) => {
  const page = await open(t, 390);
  assert.equal((await state(page)).zoomOutDisabled, false);
  await page.click("[data-legal-zoom-out]");
  await settle(page);
  let s = await state(page);
  assert.equal(s.scrolls, false, JSON.stringify(s));
  assert.ok(s.imageWidth <= s.artworkWidth, JSON.stringify(s));
  assert.equal(s.zoomOutDisabled, true, "the whole notice is the smallest step");
  assert.equal(s.buttonText, "Show at readable size");
  await page.click("[data-legal-zoom-in]");
  await settle(page);
  s = await state(page);
  assert.equal(s.imageWidth, LEGIBLE, JSON.stringify(s));
  assert.equal(s.buttonText, "Show the whole notice");
});

test("the reset button goes back to the readable size from any zoom", async (t) => {
  const page = await open(t, 1280);
  const base = (await state(page)).imageExact;
  await page.click("[data-legal-zoom-in]");
  await page.click("[data-legal-zoom-in]");
  await settle(page);
  let s = await state(page);
  assert.equal(s.buttonVisible, true, "the way back is offered once the notice is enlarged");
  assert.equal(s.buttonText, "Show at readable size");
  await page.click("[data-legal-fit]");
  await settle(page);
  s = await state(page);
  assert.ok(near(s.imageExact, base), JSON.stringify(s));
  assert.equal(s.buttonVisible, false, "nothing to reset at the opening size on a desktop");
});

test("the pop-up reopens at the readable size after zooming", async (t) => {
  const page = await open(t, 1280);
  const base = (await state(page)).imageExact;
  await page.click("[data-legal-zoom-in]");
  await page.click("[data-legal-zoom-in]");
  await settle(page);
  await page.click(".valor-legal-popover__close");
  await page.click("#open-notice");
  await settle(page);
  const s = await state(page);
  assert.ok(near(s.imageExact, base), JSON.stringify(s));
  assert.equal(s.zoomVisible, true);
  assert.equal(s.zoomOutDisabled, true);
  assert.equal(s.zoomInDisabled, false);
});

test("the zoom buttons stay in view while the enlarged notice scrolls", async (t) => {
  const page = await open(t, 390);
  await page.click("[data-legal-zoom-in]");
  await page.click("[data-legal-zoom-in]");
  await settle(page);
  const r = await page.evaluate(async () => {
    const popover = document.getElementById("ValorLegalGuaranteeNotice");
    popover.scrollTop = popover.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));
    const box = (el) => el.getBoundingClientRect();
    const zoom = box(document.querySelector("[data-legal-zoom]"));
    return {
      scrolled: popover.scrollTop,
      popoverBottom: box(popover).bottom,
      headerBottom: box(document.querySelector(".valor-legal-popover__header")).bottom,
      zoomTop: zoom.top,
      zoomBottom: zoom.bottom,
      zoomHeight: zoom.height,
    };
  });
  assert.ok(r.scrolled > 200, "the enlarged notice is taller than the pop-up: " + JSON.stringify(r));
  assert.ok(r.zoomHeight > 0, JSON.stringify(r));
  assert.ok(r.zoomTop >= r.headerBottom - 1, "below the title bar, not under it: " + JSON.stringify(r));
  assert.ok(r.zoomBottom <= r.popoverBottom, JSON.stringify(r));
  await page.click("[data-legal-zoom-out]");
  await settle(page);
  assert.ok(near((await state(page)).imageExact, LEGIBLE * 1.5), "and still clickable there");
});

test("the zoom buttons work from the keyboard", async (t) => {
  const page = await open(t, 1280);
  const base = (await state(page)).imageExact;
  await page.focus("[data-legal-zoom-in]");
  await page.keyboard.press("Enter");
  await settle(page);
  assert.ok(near((await state(page)).imageExact, base * 1.5));
  await page.focus("[data-legal-zoom-out]");
  await page.keyboard.press("Space");
  await settle(page);
  assert.ok(near((await state(page)).imageExact, base));
});

// Found in the whole-branch review: the browser chose the notice's file for
// the opening size once, and an enlarged notice was that small file drawn two
// or three times its size, the small print blurred. The image now says how
// wide it is drawn, so the browser picks again from the same list.
const pickedWidth = (page) =>
  page.$eval("#ValorLegalGuaranteeArtwork img", (img) => {
    const found = img.currentSrc.match(/notice-(\d+)\.svg/);
    return { file: found ? Number(found[1]) : 0, sizes: img.getAttribute("sizes") };
  });

test("an enlarged notice takes a file that is large enough for its size", async (t) => {
  const page = await open(t, 1280, { srcset: true });
  const drawn = async () => (await state(page)).imageExact;
  let picked = await pickedWidth(page);
  assert.equal(picked.sizes, SIZES);
  assert.ok(picked.file >= (await drawn()), `at the opening size: ${JSON.stringify(picked)}`);
  assert.ok(picked.file <= 1000, `and not a needlessly large one: ${JSON.stringify(picked)}`);
  for (let step = 0; step < 3; step += 1) {
    await page.click("[data-legal-zoom-in]");
    await settle(page);
    await page.waitForTimeout(150);
    picked = await pickedWidth(page);
    assert.ok(picked.file >= (await drawn()) - 1, `step ${step + 1}: ${JSON.stringify(picked)} for ${await drawn()}px`);
  }
  assert.equal(picked.file, 2400, "three times 734px is 2202px: the 2400px file");
  await page.click("[data-legal-fit]");
  await settle(page);
  assert.equal((await pickedWidth(page)).sizes, SIZES, "back at the readable size the image says what the theme said");
});

test("the notice's own sizes come back when the pop-up is closed while enlarged", async (t) => {
  const page = await open(t, 1280, { srcset: true });
  await page.click("[data-legal-zoom-in]");
  await settle(page);
  assert.notEqual((await pickedWidth(page)).sizes, SIZES);
  await page.click(".valor-legal-popover__close");
  await settle(page);
  assert.equal((await pickedWidth(page)).sizes, SIZES);
});

// From the external review: an enlarged notice told the browser its width
// once. When the window was then resized, the notice was drawn wider but
// still said the old width, and the browser kept a file that was too small.
test("an enlarged notice says its new width when the window is resized", async (t) => {
  const page = await open(t, 390, { srcset: true });
  await page.click("[data-legal-zoom-in]");
  await page.click("[data-legal-zoom-in]");
  await settle(page);
  let drawn = (await state(page)).imageExact;
  assert.ok(near(drawn, LEGIBLE * 2), `200% of the readable size on a phone: ${drawn}`);
  assert.equal((await pickedWidth(page)).sizes, `${Math.ceil(drawn)}px`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await settle(page);
  await page.waitForTimeout(150);
  drawn = (await state(page)).imageExact;
  assert.ok(drawn > LEGIBLE * 2 + 100, `the wider window draws the notice wider: ${drawn}`);
  let picked = await pickedWidth(page);
  assert.equal(picked.sizes, `${Math.ceil(drawn)}px`, "the image says how wide it is drawn now");
  assert.ok(picked.file >= drawn - 1, `and has a file for it: ${JSON.stringify(picked)} for ${drawn}px`);
  await page.setViewportSize({ width: 390, height: 800 });
  await settle(page);
  drawn = (await state(page)).imageExact;
  picked = await pickedWidth(page);
  assert.equal(picked.sizes, `${Math.ceil(drawn)}px`, "and again when the window is made narrow");
});

test("the notice's file list reaches the largest zoom", () => {
  const snippet = fs.readFileSync(path.join(root, "snippets", "legal-guarantee-notice.liquid"), "utf8");
  assert.match(snippet, /widths: '600, 800, 1000, 1200, 1600, 2400, 3000'/);
});

// Also from the review: a zoom button that reached its end was switched off
// while it had the keyboard focus, which left the focus on nothing.
test("a zoom button that reaches its end hands the focus to the other one", async (t) => {
  const page = await open(t, 1280);
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (el.hasAttribute("data-legal-zoom-in")) return "plus";
      if (el.hasAttribute("data-legal-zoom-out")) return "minus";
      return el.tagName;
    });
  await page.focus("[data-legal-zoom-in]");
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Enter");
    await settle(page);
  }
  assert.equal((await state(page)).zoomInDisabled, true);
  assert.equal(await focused(), "minus");
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Enter");
    await settle(page);
  }
  assert.equal((await state(page)).zoomOutDisabled, true);
  assert.equal(await focused(), "plus");
});

const focusedControl = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (el.hasAttribute("data-legal-zoom-in")) return "plus";
    if (el.hasAttribute("data-legal-zoom-out")) return "minus";
    if (el.hasAttribute("data-legal-fit")) return "third button";
    return el.tagName;
  });

test("a zoom button switched off without the focus on it leaves the focus alone", async (t) => {
  const page = await open(t, 390);
  await page.focus("[data-legal-fit]");
  await page.keyboard.press("Enter"); // the whole notice: minus goes off, the button in use stays
  await settle(page);
  const s = await state(page);
  assert.deepEqual([s.zoomOutDisabled, s.buttonVisible], [true, true]);
  assert.equal(await focusedControl(page), "third button");
});

// External review, round 2: where the notice fits its pop-up the third button
// is only there while the notice is enlarged, and it went away with the focus
// on it.
test("the button back to the readable size hands the focus on when it goes away", async (t) => {
  const page = await open(t, 1280);
  await page.focus("[data-legal-zoom-in]");
  await page.keyboard.press("Enter");
  await settle(page);
  await page.focus("[data-legal-fit]");
  await page.keyboard.press("Enter");
  await settle(page);
  const s = await state(page);
  assert.deepEqual([s.buttonVisible, s.zoomOutDisabled], [false, true], "back at the opening size");
  assert.equal(await focusedControl(page), "plus", "the zoom button that still answers");
});

test("the button for the whole notice hands the focus on when a wider window takes it away", async (t) => {
  const page = await open(t, 390);
  await page.focus("[data-legal-fit]");
  await page.setViewportSize({ width: 1280, height: 800 });
  await settle(page);
  assert.equal((await state(page)).buttonVisible, false, "the notice fits now");
  assert.equal(await focusedControl(page), "plus");
});

test("the zoom buttons are named from the locale file", () => {
  const snippet = fs.readFileSync(path.join(root, "snippets", "legal-guarantee-notice.liquid"), "utf8");
  const strings = JSON.parse(fs.readFileSync(path.join(root, "locales", "en.default.json"), "utf8")).general
    .legal_guarantee;
  assert.equal(strings.zoom_in, "Zoom in");
  assert.equal(strings.zoom_out, "Zoom out");
  // The opening tag of each button, whatever order its attributes are in.
  const tag = (marker) => snippet.match(new RegExp(`<button[^>]*${marker}[^>]*>`))?.[0] || "";
  assert.match(tag("data-legal-zoom-in\\b"), /aria-label="\{\{ 'general\.legal_guarantee\.zoom_in' \| t \}\}"/);
  assert.match(tag("data-legal-zoom-out\\b"), /aria-label="\{\{ 'general\.legal_guarantee\.zoom_out' \| t \}\}"/);
  assert.ok(
    snippet.indexOf("data-legal-zoom") > -1 && snippet.indexOf("data-legal-zoom") < snippet.indexOf("data-legal-frame"),
    "the buttons come before the notice",
  );
});

test("without JavaScript there are no zoom buttons", async (t) => {
  const page = await open(t, 390, { script: false });
  assert.equal((await state(page)).zoomVisible, false);
});

test("tapping the notice does nothing while it is enlarged", async (t) => {
  const page = await open(t, 390);
  await page.click("[data-legal-zoom-in]");
  await settle(page);
  await page.click("#ValorLegalGuaranteeArtwork img", { position: { x: 20, y: 20 } });
  await settle(page);
  assert.ok(near((await state(page)).imageExact, LEGIBLE * 1.5));
});

test("the whole-notice step goes away when the window grows and the notice fits", async (t) => {
  const page = await open(t, 390);
  await page.click("[data-legal-zoom-out]");
  await settle(page);
  assert.equal((await state(page)).scrolls, false);
  await page.setViewportSize({ width: 1280, height: 800 });
  await settle(page);
  const s = await state(page);
  assert.ok(s.imageWidth >= LEGIBLE, JSON.stringify(s));
  assert.equal(s.zoomOutDisabled, true, "the opening size is the smallest step again");
  assert.equal(s.buttonVisible, false);
});

test("an enlarged notice keeps its size when the window is resized", async (t) => {
  const page = await open(t, 1280);
  await page.click("[data-legal-zoom-in]");
  await settle(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await settle(page);
  const s = await state(page);
  assert.ok(near(s.imageExact, LEGIBLE * 1.5), JSON.stringify(s));
  assert.equal(s.zoomOutDisabled, false);
});

test("right-to-left: the enlarged notice starts at its right edge", async (t) => {
  const page = await open(t, 1280, { dir: "rtl" });
  await page.click("[data-legal-zoom-in]");
  await settle(page);
  const r = await page.evaluate(() => ({
    artworkRight: Math.round(document.getElementById("ValorLegalGuaranteeArtwork").getBoundingClientRect().right),
    imageRight: Math.round(document.querySelector("#ValorLegalGuaranteeArtwork img").getBoundingClientRect().right),
    imageWidth: document.querySelector("#ValorLegalGuaranteeArtwork img").getBoundingClientRect().width,
    artworkWidth: document.getElementById("ValorLegalGuaranteeArtwork").getBoundingClientRect().width,
    shade: document.querySelector("[data-legal-frame]").hasAttribute("data-more"),
  }));
  assert.ok(r.imageWidth > r.artworkWidth + 100, "enlarged: " + JSON.stringify(r));
  assert.equal(r.imageRight, r.artworkRight, JSON.stringify(r));
  assert.equal(r.shade, true, "more to read on the left");
});
