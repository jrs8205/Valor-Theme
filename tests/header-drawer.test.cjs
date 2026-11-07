const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// The menu drawer (sections/header.liquid): phones always, desktop with
// "Use drawer menu on desktop". Runs the section's real stylesheet and its
// real drawer script; the markup mirrors the Liquid.
const root = path.resolve(__dirname, "..");
const liquid = fs.readFileSync(path.join(root, "sections", "header.liquid"), "utf8");
const headerCss = liquid.match(/{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/)[1];
const criticalCss = fs.readFileSync(path.join(root, "assets", "critical.css"), "utf8");
const drawerScript = [...liquid.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .find((s) => s.includes("getElementById('MobileDrawer')"))
  .replace(/{{\s*"accessibility\.close_menu"\s*\|\s*t\s*}}/g, "Close menu")
  .replace(/{{\s*"accessibility\.open_menu"\s*\|\s*t\s*}}/g, "Open menu");

let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  // WebKit on Windows can stall in close() after every test has passed;
  // npm test runs with --test-force-exit, so a stalled close can't hold the run.
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

function markup({ dir = "ltr" } = {}) {
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8">
    <style>:root { --color-foreground: #333333; --color-background: #ffffff; --valor-border-default: rgb(229, 229, 229); --valor-border-strong: rgb(200, 200, 200); --page-width: 1200px; --page-margin: 40px; }
    ${criticalCss}${headerCss} body { margin: 0; }</style></head><body>
    <div id="shopify-section-header" class="shopify-section valor-section-header">
    <valor-sticky-header>
      <header class="color-scheme-1 valor-header valor-header--logo-center valor-header--desktop-menu-button">
        <button type="button" class="valor-header__menu-toggle" aria-controls="MobileDrawer" aria-expanded="false" aria-label="Open menu" data-drawer-toggle>
          <span class="valor-header__menu-toggle-icon valor-header__menu-toggle-icon--open" aria-hidden="true">=</span>
          <span class="valor-header__menu-toggle-icon valor-header__menu-toggle-icon--close" aria-hidden="true">x</span>
        </button>
        <div class="valor-header__title"><a href="#home" class="valor-header__title-link" id="HeaderLogo">Valor Demo Store</a></div>
        <nav class="valor-header__menu"><ul class="valor-header__menu-list"><li class="valor-header__menu-item"><a href="#shirts" class="valor-header__menu-link">Shirts</a></li></ul></nav>
        <div class="valor-header__icons">
          <button type="button" class="valor-header__search-toggle" id="HeaderSearch">S</button>
          <a href="#cart" class="valor-header__cart" id="HeaderCart">C</a>
        </div>
      </header>
    </valor-sticky-header>
    <div id="MobileDrawer" class="valor-mobile-drawer" role="dialog" aria-modal="true" aria-labelledby="MobileDrawerLabel" hidden>
      <h2 id="MobileDrawerLabel" class="visually-hidden">Open menu</h2>
      <div class="valor-mobile-drawer__header">
        <a href="#home" class="valor-mobile-drawer__logo">Valor Demo Store</a>
        <button type="button" class="valor-mobile-drawer__close" aria-label="Close menu" data-drawer-close>x</button>
      </div>
      <div class="valor-mobile-drawer__inner">
        <nav class="valor-mobile-drawer__nav">
          <details class="valor-mobile-drawer__group">
            <summary class="valor-mobile-drawer__summary"><span>Clothing</span></summary>
            <div class="valor-mobile-drawer__sublist">
              <a href="#shirts" id="Second">Shirts</a>
              <div class="valor-mobile-drawer__third">
                <a href="#t-shirts" id="Third">T-shirts</a>
                <a href="#polos">Polos</a>
              </div>
              <a href="#trousers">Trousers</a>
            </div>
          </details>
          <a href="#sale" id="DrawerLast">Sale</a>
        </nav>
        <div class="valor-mobile-drawer__footer"><a href="#account" class="valor-mobile-drawer__account">Account</a></div>
      </div>
    </div>
    </div>
    <main id="MainContent"><a href="#product" id="ProductLink">A product</a></main>
    <button type="button" class="valor-mobile-drawer-backdrop" data-drawer-backdrop hidden aria-label="Close menu" tabindex="-1"></button>
    <script>${drawerScript}</script>
  </body></html>`;
}

async function open(t, width, options) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  t.after(() => page.close());
  await page.setContent(markup(options));
  return page;
}

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const focusInfo = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return {
      inDrawer: !!el.closest("#MobileDrawer"),
      id: el.id,
      label: (el.getAttribute("aria-label") || el.textContent.trim()).slice(0, 40),
    };
  });

async function openWithKeyboard(page) {
  await page.focus("[data-drawer-toggle]");
  await page.keyboard.press("Enter");
  await settle(page);
  assert.equal(await page.getAttribute("#MobileDrawer", "data-open"), "", "the drawer opened");
}

// --- Focus (keyboard users) --------------------------------------------------

for (const width of [1280, 390]) {
  test(`opening the menu moves focus into the drawer (${width}px)`, async (t) => {
    const page = await open(t, width);
    await openWithKeyboard(page);
    const focus = await focusInfo(page);
    assert.equal(focus.inDrawer, true, `focus stayed on ${JSON.stringify(focus)}`);
    assert.equal(focus.label, "Close menu", "focus starts on the drawer's close button");
  });

  test(`Tab and Shift+Tab stay inside the open drawer (${width}px)`, async (t) => {
    const page = await open(t, width);
    await openWithKeyboard(page);
    const seen = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const focus = await focusInfo(page);
      seen.push(focus.label);
      assert.equal(focus.inDrawer, true, `Tab ${i + 1} left the drawer: ${JSON.stringify(seen)}`);
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Shift+Tab");
      const focus = await focusInfo(page);
      assert.equal(focus.inDrawer, true, `Shift+Tab ${i + 1} left the drawer at ${JSON.stringify(focus)}`);
    }
  });
}

for (const width of [1280, 390]) {
  test(`Tab skips the links of a closed submenu and moves on to the next shown item (${width}px)`, async (t) => {
    const page = await open(t, width);
    await openWithKeyboard(page);
    await page.focus(".valor-mobile-drawer__summary"); // "Clothing", its submenu closed
    await page.keyboard.press("Tab");
    assert.equal((await focusInfo(page)).label, "Sale");
    await page.keyboard.press("Shift+Tab");
    assert.equal((await focusInfo(page)).label, "Clothing");
  });
}

test("Tab goes through the drawer's links in order, also where the browser skips links (Safari)", async (t) => {
  const page = await open(t, 390);
  await openWithKeyboard(page);
  await page.click(".valor-mobile-drawer__summary"); // open the submenu
  await page.focus("[data-drawer-close]");
  const order = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    order.push((await focusInfo(page)).label);
  }
  assert.deepEqual(order, [
    "Clothing",
    "Shirts",
    "T-shirts",
    "Polos",
    "Trousers",
    "Sale",
    "Account",
    "Valor Demo Store",
  ]);
});

test("Tab from the last drawer link goes back to the first, not to the page", async (t) => {
  const page = await open(t, 1280);
  await openWithKeyboard(page);
  await page.focus("#DrawerLast");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focus = await focusInfo(page);
  assert.equal(focus.inDrawer, true, JSON.stringify(focus));
  assert.notEqual(focus.id, "ProductLink");
});

test("Escape closes the drawer and puts focus back on the menu button", async (t) => {
  const page = await open(t, 1280);
  await openWithKeyboard(page);
  await page.keyboard.press("Escape");
  await settle(page);
  assert.equal(await page.getAttribute("#MobileDrawer", "data-open"), null);
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute("data-drawer-toggle")), true);
  // Closed again, Tab moves on through the page as usual.
  await page.keyboard.press("Tab");
  assert.equal((await focusInfo(page)).inDrawer, false);
});

test("the close button puts focus back on the menu button", async (t) => {
  const page = await open(t, 390);
  await openWithKeyboard(page);
  await page.keyboard.press("Enter"); // focus is on the close button
  await settle(page);
  assert.equal(await page.getAttribute("#MobileDrawer", "data-open"), null);
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute("data-drawer-toggle")), true);
});

// --- Third menu level ----------------------------------------------------------

// The drawer replaces the desktop menu, so it renders every level the desktop
// mega menu renders: a child's own links (the third level) too.
test("the drawer's Liquid renders the third menu level (child.links)", () => {
  const drawerNav = liquid.match(/<nav class="valor-mobile-drawer__nav">([\s\S]*?)<\/nav>/)[1];
  const childLoop = drawerNav.match(
    /{%-?\s*for child in mega_menu_links\s*-?%}([\s\S]*?){%-?\s*endfor\s*-?%}\s*{%-?\s*endif/,
  )[1];
  assert.match(childLoop, /{%-?\s*for grandchild in child\.links\s*-?%}/);
  assert.match(childLoop, /href="{{ grandchild\.url }}"/);
  assert.match(childLoop, /{{ grandchild\.title }}/);
  assert.match(childLoop, /class="valor-mobile-drawer__third"/);
});

for (const dir of ["ltr", "rtl"]) {
  test(`third-level links show under their parent, indented one step further (${dir})`, async (t) => {
    const page = await open(t, 390, { dir });
    await openWithKeyboard(page);
    await page.click(".valor-mobile-drawer__summary");
    const r = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel).getBoundingClientRect();
      const second = box("#Second");
      const third = box("#Third");
      const textOf = (sel) => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector(sel));
        const b = range.getBoundingClientRect();
        return { left: b.left, right: b.right };
      };
      return { second, third, secondText: textOf("#Second"), thirdText: textOf("#Third"), visible: third.height > 0 };
    });
    assert.equal(r.visible, true);
    assert.ok(r.third.top >= r.second.bottom, "under its parent");
    if (dir === "ltr") assert.ok(r.thirdText.left >= r.secondText.left + 12, JSON.stringify(r));
    else assert.ok(r.thirdText.right <= r.secondText.right - 12, JSON.stringify(r));
  });
}
