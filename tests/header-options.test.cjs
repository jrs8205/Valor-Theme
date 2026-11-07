const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// Header options (sections/header.liquid): the desktop menu button and the
// bottom border, with the section's real stylesheet. The markup mirrors the
// Liquid: the modifier class and the border custom properties are what the
// section prints for its settings.
const root = path.resolve(__dirname, "..");
const headerCss = (() => {
  const liquid = fs.readFileSync(path.join(root, "sections", "header.liquid"), "utf8");
  return liquid.match(/{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/)[1];
})();
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

const DEFAULT_LINKS = ["Hoodie", "T-shirt", "Baggy Jeans"];
const LONG_MENU = [
  "New arrivals",
  "Collections",
  "Hoodies & sweats",
  "T-shirts",
  "Denim & jeans",
  "Outerwear",
  "Accessories",
  "Gift cards",
  "Sale",
];

// style: the border custom properties, which the section prints in its
// {% style %} block for its wrapper (#shopify-section-<id>). pinned: the
// transparent, always-pinned header over a homepage banner ("solid" once
// scrolled).
function markup({
  logo = "center",
  menuButton = false,
  style = "",
  dir = "ltr",
  links = DEFAULT_LINKS,
  pinned = null,
  localization = false,
  scale = 1,
  font = "",
} = {}) {
  const classes = `color-scheme-1 valor-header valor-header--logo-${logo}${menuButton ? " valor-header--desktop-menu-button" : ""}`;
  const wrapper = `shopify-section valor-section-header${pinned ? " valor-section-header--transparent-pinned" : ""}${pinned === "solid" ? " valor-section-header--transparent-solid" : ""}`;
  const items = links
    .map((label) => `<li class="valor-header__menu-item"><a href="#" class="valor-header__menu-link">${label}</a></li>`)
    .join("");
  return `<!doctype html><html dir="${dir}" class="valor-transparent-header-ready"><head><meta charset="utf-8">
    <style>:root { --color-foreground: #333333; --color-background: #ffffff; --valor-border-default: rgb(229, 229, 229); --page-width: 1200px; --page-margin: 40px; --font-body-scale: ${scale};${font ? ` --font-body--family: ${font}; --font-heading--family: ${font};` : ""} }
    body { font-family: var(--font-body--family, inherit); }
    ${criticalCss}${headerCss} body { margin: 0; }</style>
    <style>#shopify-section-header { ${style} }</style></head><body>
    <div id="shopify-section-header" class="${wrapper}">
    <valor-sticky-header>
      <header class="${classes}">
        <button type="button" class="valor-header__menu-toggle" aria-controls="MobileDrawer" aria-expanded="false" data-drawer-toggle>
          <span class="valor-header__menu-toggle-icon valor-header__menu-toggle-icon--open" aria-hidden="true">=</span>
          <span class="valor-header__menu-toggle-icon valor-header__menu-toggle-icon--close" aria-hidden="true">x</span>
        </button>
        <div class="valor-header__title"><a href="#" class="valor-header__title-link"><span class="valor-header__logo-text">Valor Demo Store</span></a></div>
        <nav class="valor-header__menu"><ul class="valor-header__menu-list">${items}</ul></nav>
        <div class="valor-header__icons">
          ${
            localization
              ? `<div class="valor-header__localization">
            <div class="valor-localization"><button type="button" style="white-space: nowrap">United States | USD $</button></div>
            <div class="valor-localization"><button type="button" style="white-space: nowrap">English</button></div>
          </div>`
              : ""
          }
          <button type="button" class="valor-header__search-toggle">S</button>
          <shopify-account>A</shopify-account>
          <a href="#" class="valor-header__cart">C</a>
        </div>
      </header>
    </valor-sticky-header>
    </div>
    ${pinned ? '<main id="MainContent"><div class="shopify-section"><div class="valor-transparent-header-trigger" style="height: 1500px"></div></div></main>' : ""}
    <div id="MobileDrawer" class="valor-mobile-drawer" data-open>
      <div class="valor-mobile-drawer__inner">
        <nav class="valor-mobile-drawer__nav"><a href="#">Hoodie</a></nav>
        <div class="valor-mobile-drawer__footer"><a href="#" class="valor-mobile-drawer__account">Account</a></div>
      </div>
    </div>
  </body></html>`;
}

async function layout(t, width, options) {
  const page = await browser.newPage({ viewport: { width, height: 700 } });
  t.after(() => page.close());
  await page.setContent(markup(options));
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const visible = getComputedStyle(el).display !== "none" && r.width > 0;
      return {
        visible,
        left: Math.round(r.left),
        right: Math.round(r.right),
        center: Math.round(r.left + r.width / 2),
      };
    };
    const header = document.querySelector(".valor-header");
    const style = getComputedStyle(header);
    const divider = getComputedStyle(document.getElementById("shopify-section-header"), "::after");
    const links = [...document.querySelectorAll(".valor-header__menu-link")].map((a) => a.getBoundingClientRect());
    return {
      linkRight: Math.round(Math.max(...links.map((r) => r.right))),
      linkLeft: Math.round(Math.min(...links.map((r) => r.left))),
      linkRows: new Set(links.map((r) => Math.round(r.top))).size,
      divider: {
        height: divider.height,
        color: divider.backgroundColor,
        opacity: divider.opacity,
        content: divider.content,
      },
      width: innerWidth,
      toggle: box(".valor-header__menu-toggle"),
      title: box(".valor-header__title"),
      menu: box(".valor-header__menu"),
      icons: box(".valor-header__icons"),
      drawerNav: box(".valor-mobile-drawer__nav"),
      drawerFooter: box(".valor-mobile-drawer__footer"),
      border: { width: style.borderBottomWidth, style: style.borderBottomStyle, color: style.borderBottomColor },
    };
  });
}

// --- Desktop menu button ---------------------------------------------------

test("by default the desktop header has no menu button", async (t) => {
  const r = await layout(t, 1280);
  assert.equal(r.toggle.visible, false);
  assert.equal(r.menu.visible, true);
});

for (const logo of ["center", "left"]) {
  test(`desktop menu button replaces the menu links at the left; the icons stay (logo ${logo})`, async (t) => {
    const before = await layout(t, 1280, { logo });
    const r = await layout(t, 1280, { logo, menuButton: true });
    assert.equal(r.toggle.visible, true, JSON.stringify(r));
    assert.equal(r.menu.visible, false, "the menu links leave the header: the button opens them");
    assert.ok(r.toggle.right <= r.title.left, `the button is the leftmost item ${JSON.stringify(r)}`);
    const start = logo === "center" ? before.menu.left : before.title.left;
    assert.equal(r.toggle.left, start, "the button starts where the header content starts");
    assert.equal(r.icons.right, before.icons.right, "account, cart and search stay where they were");
    assert.equal(r.icons.left, before.icons.left);
    if (logo === "center")
      assert.ok(Math.abs(r.title.center - r.width / 2) <= 1, `logo stays centred ${JSON.stringify(r.title)}`);
    else assert.ok(r.title.left - r.toggle.right <= 24, `the logo follows the button ${JSON.stringify(r)}`);
  });
}

test("right-to-left: the desktop menu button sits at the right and the menu links are hidden", async (t) => {
  const before = await layout(t, 1280, { dir: "rtl" });
  const r = await layout(t, 1280, { menuButton: true, dir: "rtl" });
  assert.equal(r.toggle.visible, true);
  assert.equal(r.menu.visible, false);
  assert.ok(r.toggle.left >= r.title.right, JSON.stringify(r));
  assert.equal(r.toggle.right, before.menu.right, "the button starts where the header content starts");
});

test("right-to-left with the logo on the left: the logo follows the button", async (t) => {
  const r = await layout(t, 1280, { menuButton: true, dir: "rtl", logo: "left" });
  assert.equal(r.menu.visible, false);
  assert.ok(r.toggle.left >= r.title.right, JSON.stringify(r));
  assert.ok(r.toggle.left - r.title.right <= 24, JSON.stringify(r));
});

test("a long menu is no longer in the header with the menu button", async (t) => {
  const r = await layout(t, 990, { menuButton: true, links: LONG_MENU, localization: true });
  assert.equal(r.menu.visible, false);
  assert.ok(r.toggle.right <= r.title.left, JSON.stringify(r));
  assert.ok(r.icons.left >= r.title.right, JSON.stringify(r));
});

test("the phone header is the same with or without the desktop menu button", async (t) => {
  const off = await layout(t, 390);
  const on = await layout(t, 390, { menuButton: true });
  assert.deepEqual(on.toggle, off.toggle);
  assert.deepEqual(on.title, off.title);
  assert.deepEqual(on.icons, off.icons);
});

test("on a desktop the side panel holds only the menu; on a phone it also has account and more", async (t) => {
  const desktop = await layout(t, 1280, { menuButton: true });
  assert.equal(desktop.drawerNav.visible, true);
  assert.equal(desktop.drawerFooter.visible, false);
  const phone = await layout(t, 390, { menuButton: true });
  assert.equal(phone.drawerFooter.visible, true);
});

// --- Bottom border ---------------------------------------------------------

test("the header keeps its 1px bottom border by default", async (t) => {
  const r = await layout(t, 1280);
  assert.equal(r.border.width, "1px");
  assert.equal(r.border.style, "solid");
});

test("border thickness 0 removes the header line", async (t) => {
  const r = await layout(t, 1280, { style: "--header-border-width: 0px;" });
  assert.equal(r.border.width, "0px");
});

test("border thickness and colour can be set", async (t) => {
  const r = await layout(t, 390, { style: "--header-border-width: 3px; --header-border-color: #ff0000;" });
  assert.equal(r.border.width, "3px");
  assert.equal(r.border.color, "rgb(255, 0, 0)");
});

// --- Review fixes ------------------------------------------------------------

test("pinned transparent header: the scrolled divider follows the border settings", async (t) => {
  const thick = await layout(t, 1280, {
    pinned: "solid",
    style: "--header-border-width: 3px; --header-border-color: #ff0000;",
  });
  assert.equal(thick.divider.height, "3px");
  assert.equal(thick.divider.color, "rgb(255, 0, 0)");
  assert.equal(thick.divider.opacity, "1");
  const none = await layout(t, 1280, { pinned: "solid", style: "--header-border-width: 0px;" });
  assert.equal(none.divider.height, "0px", "thickness 0 removes the scrolled divider too");
});

test("pinned transparent header: default divider unchanged, and no line over the banner", async (t) => {
  const solid = await layout(t, 1280, { pinned: "solid", style: "--header-border-width: 1px;" });
  assert.equal(solid.divider.height, "1px");
  assert.equal(solid.divider.opacity, "1");
  const top = await layout(t, 1280, {
    pinned: "top",
    style: "--header-border-width: 3px; --header-border-color: #ff0000;",
  });
  assert.equal(top.divider.opacity, "0", "the transparent top state stays clean");
  assert.equal(top.border.width, "0px");
});

for (const dir of ["ltr", "rtl"]) {
  test(`at 990px the country and language selectors never run into the centred logo (${dir})`, async (t) => {
    const options = { dir, localization: true, menuButton: true };
    for (const menuButton of [false, true]) {
      const r = await layout(t, 990, { ...options, menuButton });
      const gap = dir === "ltr" ? r.icons.left - r.title.right : r.title.left - r.icons.right;
      assert.ok(
        gap >= 0,
        `menu button ${menuButton ? "on" : "off"}: icons overlap the logo by ${-gap}px ${JSON.stringify({ title: r.title, icons: r.icons })}`,
      );
      if (menuButton) {
        assert.equal(r.menu.visible, false);
        const buttonGap = dir === "ltr" ? r.title.left - r.toggle.right : r.toggle.left - r.title.right;
        assert.ok(buttonGap >= 0, `the menu button overlaps the logo by ${-buttonGap}px`);
      } else {
        const menuGap = dir === "ltr" ? r.title.left - r.linkRight : r.linkLeft - r.title.right;
        assert.ok(menuGap >= 0, `menu overlaps the logo by ${-menuGap}px`);
      }
    }
  });
}

for (const dir of ["ltr", "rtl"]) {
  test(`at 990px with text scale 120% a single menu link never runs into the logo (${dir})`, async (t) => {
    const options = { dir, localization: true, scale: 1.2, font: "Arial, sans-serif", links: ["Accessories"] };
    for (const menuButton of [false, true]) {
      const r = await layout(t, 990, { ...options, menuButton });
      const iconGap = dir === "ltr" ? r.icons.left - r.title.right : r.title.left - r.icons.right;
      assert.ok(iconGap >= 0, `menu button ${menuButton ? "on" : "off"}: the icons overlap the logo by ${-iconGap}px`);
      if (menuButton) {
        assert.equal(r.menu.visible, false);
        const buttonGap = dir === "ltr" ? r.title.left - r.toggle.right : r.toggle.left - r.title.right;
        assert.ok(buttonGap >= 0, `the menu button overlaps the logo by ${-buttonGap}px`);
      } else {
        const menuGap = dir === "ltr" ? r.title.left - r.linkRight : r.linkLeft - r.title.right;
        assert.ok(menuGap >= 0, `the link overlaps the logo by ${-menuGap}px`);
      }
    }
  });
}
