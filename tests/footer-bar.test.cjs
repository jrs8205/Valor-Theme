const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { engine, textItem, menuItem, barMarkup, open, boxes, near, pixel } = require("./footer-fixture.cjs");

// The Tab key, where it can be tested: the WebKit build that runs these tests
// moves focus to links neither with Tab nor with Option+Tab, so there the
// state Tab depends on (display, visibility) is what is asserted.
const TAB = engine.name() === "webkit" ? null : "Tab";

// The Footer bar section (sections/footer-bar.liquid, assets/footer-bar.css):
// up to three rows of a left, a centre and a right zone on a desktop, one
// centred stack in the editor's block order on a phone (below 750px).
let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

// At 1440px the page column is 1160px wide from 140px, and the bar's content
// has the footer's inset of 48px (clamp(1rem, 4vw, 3rem)).
const CONTENT_LEFT = 188;
const CONTENT_RIGHT = 1252;
const LINKS = ["Sitemap", "Legal & privacy", "Accessibility statement", "Cookies"];

test("desktop: left, centre and right items sit at the edges and in the exact middle", async (t) => {
  const page = await open(browser, t, {
    body: barMarkup({
      items: [
        textItem("left", "A much longer text on the left side of the bar", { position: "left" }),
        textItem("centre", "Centre", { position: "center" }),
        textItem("right", "R", { position: "right" }),
      ],
    }),
  });
  const b = await boxes(page, ["left", "centre", "right", "bar"]);
  assert.ok(near(b.left.left, CONTENT_LEFT), JSON.stringify(b.left));
  assert.ok(near(b.right.right, CONTENT_RIGHT), JSON.stringify(b.right));
  assert.ok(
    near(b.centre.centre, 720),
    `the centre item is in the middle whatever stands beside it: ${b.centre.centre}`,
  );
  assert.ok(near(b.left.top + b.left.height / 2, b.right.top + b.right.height / 2, 1), "one row");
});

test("two items in one zone sit side by side in editor order", async (t) => {
  const page = await open(browser, t, {
    body: barMarkup({
      items: [textItem("first", "First", { position: "right" }), textItem("second", "Second", { position: "right" })],
    }),
  });
  const b = await boxes(page, ["first", "second"]);
  assert.ok(b.first.right < b.second.left, JSON.stringify(b));
  assert.ok(near(b.second.right, CONTENT_RIGHT), "the last one ends at the content edge");
  assert.ok(near(b.first.top, b.second.top, 1));
});

test("rows stack in order and an empty row is not there", async (t) => {
  const page = await open(browser, t, {
    body: barMarkup({ items: [textItem("third", "Row three", { row: 3 }), textItem("first", "Row one", { row: 1 })] }),
  });
  const b = await boxes(page, ["first", "third"]);
  assert.ok(b.first.bottom <= b.third.top, JSON.stringify(b));
  assert.equal(await page.$$eval(".valor-footer-bar__row", (rows) => rows.length), 2);
  assert.ok(near(b.third.top - b.first.bottom, 12), "the row gap");
});

for (const width of [390, 749]) {
  test(`phone (${width}px): items stack centred in editor order, whatever their row and zone`, async (t) => {
    const page = await open(browser, t, {
      width,
      height: 844,
      body: barMarkup({
        items: [
          textItem("a", "Links come first", { position: "right", row: 1 }),
          textItem("b", "Ship to", { position: "left", row: 1 }),
          textItem("c", "Logo", { position: "center", row: 2 }),
        ],
      }),
    });
    const b = await boxes(page, ["a", "b", "c"]);
    assert.ok(b.a.bottom <= b.b.top && b.b.bottom <= b.c.top, JSON.stringify(b));
    for (const id of ["a", "b", "c"]) assert.ok(near(b[id].centre, width / 2, 1), `${id}: ${b[id].centre}`);
  });
}

test("750px is a desktop: zones side by side", async (t) => {
  const page = await open(browser, t, {
    width: 750,
    body: barMarkup({
      items: [textItem("l", "Left", { position: "left" }), textItem("r", "Right", { position: "right" })],
    }),
  });
  const b = await boxes(page, ["l", "r"]);
  assert.ok(near(b.l.top, b.r.top, 1) && b.l.right < b.r.left, JSON.stringify(b));
});

test("phone alignment left starts every item at the content edge", async (t) => {
  const page = await open(browser, t, {
    width: 390,
    height: 844,
    body: barMarkup({
      phone: "left",
      items: [textItem("a", "One"), textItem("b", "Second, longer", { position: "right" })],
    }),
  });
  const b = await boxes(page, ["a", "b"]);
  // Page margin 16px on a phone, and the footer's inset of 16px.
  assert.ok(near(b.a.left, 32) && near(b.b.left, 32), JSON.stringify(b));
});

test("desktop only and phone only items are gone on the other device, for focus too", async (t) => {
  const items = [
    { ...menuItem("desk", ["Desktop link"], { position: "left", visibility: "desktop" }) },
    { ...menuItem("phone", ["Phone link"], { position: "right", visibility: "phone" }) },
    { ...menuItem("both", ["Both link"], { position: "center" }) },
  ];
  const focusable = async (page) => {
    const seen = [];
    await page.focus("#before");
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press(TAB);
      const text = await page.evaluate(() => document.activeElement.textContent.trim());
      if (text === "After") break;
      seen.push(text);
    }
    return seen;
  };
  const desktop = await open(browser, t, { body: barMarkup({ items }) });
  let b = await boxes(desktop, ["desk", "phone"]);
  assert.deepEqual([b.desk.display !== "none", b.phone.display], [true, "none"]);
  const phone = await open(browser, t, { width: 390, height: 844, body: barMarkup({ items }) });
  b = await boxes(phone, ["desk", "phone"]);
  assert.deepEqual([b.desk.display, b.phone.display !== "none"], ["none", true]);
  // WebKit only stops Tab on links when asked to; Alt+Tab moves through them.
  // The markup is grouped by row and zone, so Tab goes left, centre, right:
  // what is seen on a desktop. On a phone the items are seen in the editor's
  // order (phone, both), which Tab does not follow.
  if (TAB) {
    assert.deepEqual(await focusable(desktop), ["Desktop link", "Both link"]);
    assert.deepEqual(await focusable(phone), ["Both link", "Phone link"]);
  }
});

test("a row whose items are all phone only takes no room on a desktop", async (t) => {
  const items = [textItem("one", "Row one"), textItem("two", "Phone only", { row: 2, visibility: "phone" })];
  const withRow = await open(browser, t, { body: barMarkup({ items }) });
  const without = await open(browser, t, { body: barMarkup({ items: [items[0]] }) });
  const heights = [(await boxes(withRow, ["bar"])).bar.height, (await boxes(without, ["bar"])).bar.height];
  assert.ok(near(heights[0], heights[1]), heights.join(" / "));
});

test("a bar with nothing for this device takes no room", async (t) => {
  const phoneOnly = barMarkup({ items: [textItem("logo", "Logo", { visibility: "phone" })] });
  const desktopOnly = barMarkup({ items: [textItem("logo", "Logo", { visibility: "desktop" })] });
  let page = await open(browser, t, { body: phoneOnly });
  assert.equal((await boxes(page, ["bar"])).bar.height, 0, "phone only, on a desktop");
  page = await open(browser, t, { width: 390, height: 844, body: phoneOnly });
  assert.ok((await boxes(page, ["bar"])).bar.height > 30, "and there on a phone");
  page = await open(browser, t, { width: 390, height: 844, body: desktopOnly });
  assert.equal((await boxes(page, ["bar"])).bar.height, 0, "desktop only, on a phone");
});

test("the lines above and below follow their settings and span the bar", async (t) => {
  const read = (page) =>
    page.$eval(".valor-footer-bar__inner", (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        top: cs.borderTopWidth,
        bottom: cs.borderBottomWidth,
        colour: cs.borderTopColor,
        left: r.left,
        right: r.right,
      };
    });
  let page = await open(browser, t, {
    body: barMarkup({ items: [textItem("a", "A")], lineAbove: true, lineBelow: true }),
  });
  let s = await read(page);
  assert.deepEqual(
    [s.top, s.bottom, s.colour],
    ["1px", "1px", "rgb(187, 187, 187)"],
    "the theme's default border colour",
  );
  assert.deepEqual([s.left, s.right], [140, 1300], "across the page column, like the footer's own top line");
  page = await open(browser, t, {
    body: barMarkup({ items: [textItem("a", "A")], lineAbove: false, lineBelow: false }),
  });
  s = await read(page);
  assert.deepEqual([s.top, s.bottom], ["0px", "0px"]);
});

test("page width lines up with the footer's columns; full width spans the screen and keeps the page margin", async (t) => {
  const footer = `<div class="shopify-section"><div class="color-scheme-1 valor-footer"><div class="valor-footer__top">
    <div class="valor-footer__blocks valor-footer__blocks--cols-2"><div class="valor-footer__block" id="column">Column</div><div class="valor-footer__block">Column</div></div>
  </div></div></div>`;
  const items = [textItem("l", "Left", { position: "left" }), textItem("r", "Right", { position: "right" })];
  for (const width of [1440, 390]) {
    // On a phone the items are centred unless the bar is set to start at the edge.
    const page = await open(browser, t, { width, body: footer + barMarkup({ items, phone: "left" }) });
    const b = await boxes(page, ["column", "l"]);
    assert.ok(near(b.l.left, b.column.left), `${width}px: ${b.l.left} / ${b.column.left}`);
  }
  const page = await open(browser, t, { body: barMarkup({ items, width: "full" }) });
  const b = await boxes(page, ["bar", "l", "r"]);
  assert.deepEqual([b.bar.left, b.bar.width], [0, 1440]);
  assert.ok(near(b.l.left, 20) && near(b.r.right, 1420), JSON.stringify(b));
});

test("twelve links and long text on a 320px screen wrap without widening the page", async (t) => {
  const many = Array.from({ length: 12 }, (_, i) => `Customer service link ${i + 1}`);
  const page = await open(browser, t, {
    width: 320,
    height: 700,
    body: barMarkup({
      items: [
        menuItem("menu", many, { position: "right" }),
        textItem("text", "© 2026 A shop with a remarkably long name that does not fit on one line of a small phone", {
          position: "left",
        }),
      ],
    }),
  });
  const s = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(s.scroll <= s.inner, JSON.stringify(s));
  const b = await boxes(page, ["menu", "text"]);
  assert.ok(b.menu.left >= 0 && b.menu.right <= 320 && b.text.right <= 320, JSON.stringify(b));
  const desktop = await open(browser, t, {
    width: 1000,
    body: barMarkup({
      items: [menuItem("menu", many, { position: "right" }), textItem("text", "© 2026 Shop", { position: "left" })],
    }),
  });
  const d = await desktop.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  assert.ok(d.scroll <= d.inner, `a desktop row wraps inside its zone: ${JSON.stringify(d)}`);
});

test("right-to-left: the left zone is on the right and the centre stays centred", async (t) => {
  const page = await open(browser, t, {
    dir: "rtl",
    body: barMarkup({
      items: [
        textItem("left", "The left zone, with more text in it", { position: "left" }),
        textItem("centre", "Centre", { position: "center" }),
        textItem("right", "R", { position: "right" }),
      ],
    }),
  });
  const b = await boxes(page, ["left", "centre", "right"]);
  assert.ok(near(b.left.right, CONTENT_RIGHT), JSON.stringify(b.left));
  assert.ok(near(b.right.left, CONTENT_LEFT), JSON.stringify(b.right));
  assert.ok(near(b.centre.centre, 720), String(b.centre.centre));
});

test("the colour scheme paints the row from edge to edge, and the text takes the scheme's colour", async (t) => {
  const page = await open(browser, t, { body: barMarkup({ scheme: "scheme-2", items: [textItem("a", "Dark bar")] }) });
  const b = await boxes(page, ["bar"]);
  const y = Math.round(b.bar.top + b.bar.height / 2);
  assert.equal(await pixel(page, 2, y), "rgb(20, 20, 20)", "left of the page column");
  assert.equal(await pixel(page, 1437, y), "rgb(20, 20, 20)", "right of it");
  const colour = await page.$eval("#a p", (el) => getComputedStyle(el).color);
  assert.match(colour, /245, 244, 242|oklab|color\(/, `the scheme's text colour, softened: ${colour}`);
});

test("the text size setting uses the theme's size tokens", async (t) => {
  const size = async (textSize) => {
    const page = await open(browser, t, {
      body: barMarkup({ textSize, items: [menuItem("m", LINKS), textItem("x", "Text")] }),
    });
    return page.evaluate(() => [
      getComputedStyle(document.querySelector("#m a")).fontSize,
      getComputedStyle(document.querySelector("#x p")).fontSize,
    ]);
  };
  assert.deepEqual(await size("small"), ["13px", "13px"]);
  assert.deepEqual(await size("normal"), ["15px", "15px"]);
});

test("padding and row gap come from the section's settings", async (t) => {
  const page = await open(browser, t, {
    body: barMarkup({
      paddingTop: 40,
      paddingBottom: 8,
      rowGap: 24,
      lineAbove: false,
      items: [textItem("a", "One"), textItem("b", "Two", { row: 2 })],
    }),
  });
  const b = await boxes(page, ["bar", "a", "b"]);
  assert.ok(near(b.a.top - b.bar.top, 40), `top ${b.a.top - b.bar.top}`);
  assert.ok(near(b.bar.bottom - b.b.bottom, 8), `bottom ${b.bar.bottom - b.b.bottom}`);
  assert.ok(near(b.b.top - b.a.bottom, 24), `gap ${b.b.top - b.a.bottom}`);
});

test("the bar follows the theme's page width setting like the other sections (2560px screen)", async (t) => {
  const widths = {};
  for (const value of ["75rem", "90rem", "100%"]) {
    const page = await open(browser, t, {
      width: 2560,
      height: 600,
      variables: `--page-width: ${value};`,
      body: barMarkup({ items: [textItem("a", "A")] }),
    });
    widths[value] = (await boxes(page, ["bar"])).bar.width;
  }
  assert.deepEqual(widths, { "75rem": 1160, "90rem": 1400, "100%": 2520 });
});

// ---------------------------------------------------------------------------
// Logo, social icons, legal guarantee link
// ---------------------------------------------------------------------------

const LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><rect width="600" height="200" fill="#0e4f9e"/></svg>',
)}`;
// Theme settings > Brand: logo height 36px, on phones 32px (the defaults).
const logoItem = (id, { size = "theme", width = 150, image = true, ...options } = {}) => ({
  id,
  type: "logo",
  html: image
    ? `<a href="/" class="valor-footer-bar__logo valor-footer-bar__logo--${size}" style="--fb-logo-height: 36px; --fb-logo-height-phone: 32px; --fb-logo-width: ${width}px;"><img class="valor-footer-bar__logo-image" src="${LOGO}" width="600" height="200" alt="Valor" loading="lazy"></a>`
    : `<a href="/" class="valor-footer-bar__logo valor-footer-bar__logo--text">Valor Demo Store</a>`,
  ...options,
});
const imageBox = (page) =>
  page.$eval(".valor-footer-bar__logo-image", (img) => {
    const r = img.getBoundingClientRect();
    return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
  });

test("the logo takes the theme's logo height: the desktop height from 990px, the phone height below, as in the header", async (t) => {
  for (const [width, expected] of [
    [1440, [108, 36]],
    [990, [108, 36]],
    [989, [96, 32]],
    [390, [96, 32]],
  ]) {
    const page = await open(browser, t, { width, body: barMarkup({ items: [logoItem("logo")] }) });
    assert.deepEqual(await imageBox(page), expected, `${width}px`);
  }
});

test("a custom logo width replaces the theme's height and never exceeds the bar", async (t) => {
  let page = await open(browser, t, { body: barMarkup({ items: [logoItem("logo", { size: "custom", width: 150 })] }) });
  assert.deepEqual(await imageBox(page), [150, 50]);
  page = await open(browser, t, {
    width: 320,
    height: 700,
    body: barMarkup({ items: [logoItem("logo", { size: "custom", width: 400 })] }),
  });
  const [width, height] = await imageBox(page);
  // 320px less the page margin (16px) and the footer's inset (16px) on each side.
  assert.ok(near(width, 256, 1), `as wide as the bar's content: ${width}`);
  assert.ok(near(height, width / 3, 1), `and still at its own ratio: ${height}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test("without a logo the shop name shows in the heading font at the heading scale", async (t) => {
  const read = (page) =>
    page.$eval(".valor-footer-bar__logo--text", (el) => {
      const cs = getComputedStyle(el);
      return [cs.fontFamily, cs.fontSize, cs.textDecorationLine];
    });
  let page = await open(browser, t, { body: barMarkup({ items: [logoItem("logo", { image: false })] }) });
  assert.deepEqual(await read(page), ["Georgia, serif", "18px", "none"]);
  page = await open(browser, t, {
    variables: "--font-heading-scale: 1.5;",
    body: barMarkup({ items: [logoItem("logo", { image: false })] }),
  });
  assert.equal((await read(page))[1], "27px");
});

const socialItem = (id, scale, options = {}) => ({
  id,
  type: "social",
  style: ` --valor-footer-social-size: ${scale};`,
  html: `<ul class="valor-social-icons valor-footer-bar__social" role="list">${["Instagram", "Facebook", "TikTok"]
    .map(
      (name) =>
        `<li class="valor-social-icons__item"><a href="#${name}" class="valor-social-icons__link"><span class="valor-social-icons__icon" aria-hidden="true"><svg viewBox="0 0 20 20"></svg></span><span class="visually-hidden">${name}</span></a></li>`,
    )
    .join("")}</ul>`,
  ...options,
});

test("the social icons follow the size setting and their zone", async (t) => {
  const linkWidth = (page) => page.$eval(".valor-social-icons__link", (el) => el.getBoundingClientRect().width);
  for (const [scale, expected] of [
    ["0.8", 32],
    ["1", 40],
    ["1.25", 50],
  ]) {
    const page = await open(browser, t, {
      body: barMarkup({ items: [socialItem("social", scale, { position: "right" })] }),
    });
    assert.ok(near(await linkWidth(page), expected), `${scale}: ${await linkWidth(page)}`);
    const last = await page.$eval(".valor-social-icons__item:last-child", (el) => el.getBoundingClientRect().right);
    assert.ok(near(last, CONTENT_RIGHT, 1), `the icons end at the content edge: ${last}`);
  }
  const page = await open(browser, t, {
    body: barMarkup({ items: [socialItem("social", "1", { position: "left" })] }),
  });
  const first = await page.$eval(".valor-social-icons__item", (el) => el.getBoundingClientRect().left);
  assert.ok(near(first, CONTENT_LEFT, 1), `and start at it on the left: ${first}`);
});

test("the legal guarantee link reads like the bar's other links", async (t) => {
  const page = await open(browser, t, {
    body: barMarkup({
      items: [
        menuItem("menu", ["Sitemap"]),
        {
          id: "legal",
          type: "legal_guarantee",
          html: '<button type="button" class="valor-legal-guarantee-trigger valor-footer-bar__legal" popovertarget="ValorLegalGuaranteeNotice">Your legal guarantee rights</button>',
        },
      ],
    }),
  });
  const styles = await page.evaluate(() => {
    const read = (el) => [getComputedStyle(el).fontSize, getComputedStyle(el).color, getComputedStyle(el).fontFamily];
    return [read(document.querySelector("#menu a")), read(document.querySelector("#legal button"))];
  });
  assert.deepEqual(styles[1], styles[0]);
});

// ---------------------------------------------------------------------------
// Country selector: the theme's own selector (snippets/country-localization.liquid
// and assets/localization-form.js) inside a bar
// ---------------------------------------------------------------------------

const { read: readFile } = require("./footer-fixture.cjs");

const FLAG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 4 3"><rect width="4" height="3" fill="#fff"/><rect x="1" width="1" height="3" fill="#003580"/><rect y="1" width="4" height="1" fill="#003580"/></svg>',
)}`;
const COUNTRIES = [
  ["FI", "Finland"],
  ["SE", "Sweden"],
  ["DE", "Germany"],
];
// What the country block renders: the selector's form, button and list.
const countryItem = (
  id,
  {
    label = "",
    flag = false,
    currency = true,
    arrow = true,
    position = "center",
    name = "Finland",
    money = "EUR €",
    ...options
  } = {},
) => ({
  id,
  type: "country",
  position,
  ...options,
  html: `<valor-localization-form class="valor-localization valor-localization--align-up valor-localization--sheet${position === "left" ? " valor-localization--align-left" : ""}">
    <form method="post" action="/localization" id="FooterBarCountry-${id}Form" class="valor-localization__form">
      <h2 class="visually-hidden" id="FooterBarCountry-${id}Label">Country/region</h2>
      <div class="valor-localization__disclosure">
        <button type="button" class="valor-localization__select" aria-expanded="false" aria-controls="FooterBarCountry-${id}-country-results" aria-describedby="FooterBarCountry-${id}Label">
          ${label ? `<span class="valor-localization__label">${label}</span>` : ""}
          ${flag ? `<img class="valor-localization__flag" src="${FLAG}" alt="" width="20" height="15" loading="lazy">` : ""}
          <span class="name">${name}${currency ? ` | ${money}` : ""}</span>
          ${arrow ? '<span class="valor-localization__chevron" aria-hidden="true"><svg viewBox="0 0 10 6" width="10" height="6"></svg></span>' : ""}
        </button>
        <div class="valor-localization__panel valor-localization__panel--country" hidden>
          <div class="valor-localization__list-wrapper" id="FooterBarCountry-${id}-country-results">
            <ul class="valor-localization__list valor-localization__list--countries">
              ${COUNTRIES.map(
                ([code, name]) =>
                  `<li class="valor-localization__item"><a class="valor-localization__link" href="#" data-value="${code}" id="FooterBarCountry-${id}-${code}"><span class="valor-localization__country-name">${name}</span></a></li>`,
              ).join("")}
            </ul>
          </div>
        </div>
      </div>
      <input type="hidden" name="country_code" value="FI">
    </form>
  </valor-localization-form>`,
});
// The theme's selector script; a form that would be sent is noted instead.
const selectorScripts = () => `<script>
    window.sent = [];
    HTMLFormElement.prototype.submit = function () { window.sent.push(this.id + ":" + this.querySelector("input[type=hidden]").value); };
  </script><script>${readFile("assets", "localization-form.js")}</script>`;
const selectorState = (page, id) =>
  page.evaluate((id) => {
    const item = document.getElementById(id);
    const button = item.querySelector(".valor-localization__select");
    const panel = item.querySelector(".valor-localization__panel");
    const r = panel.getBoundingClientRect();
    return {
      expanded: button.getAttribute("aria-expanded"),
      open: !panel.hidden && getComputedStyle(panel).display !== "none",
      focusOnButton: document.activeElement === button,
      panel: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, position: getComputedStyle(panel).position },
      buttonTop: button.getBoundingClientRect().top,
    };
  }, id);

test("the country selector opens with Enter, closes with Escape with the focus back on its button, and sends its own form", async (t) => {
  const page = await open(browser, t, { body: barMarkup({ items: [countryItem("c")] }), scripts: selectorScripts() });
  await page.focus("#c .valor-localization__select");
  await page.keyboard.press("Enter");
  let s = await selectorState(page, "c");
  assert.deepEqual([s.expanded, s.open], ["true", true]);
  await page.keyboard.press("Escape");
  s = await selectorState(page, "c");
  assert.deepEqual([s.expanded, s.open, s.focusOnButton], ["false", false, true]);
  await page.keyboard.press("Enter");
  await page.click("#FooterBarCountry-c-SE");
  assert.deepEqual(await page.evaluate(() => window.sent), ["FooterBarCountry-cForm:SE"]);
  assert.deepEqual(page.errors, []);
});

test("label, flag and no arrow: the button reads label, flag, country, at the bar's text size and colour", async (t) => {
  const page = await open(browser, t, {
    body: barMarkup({
      items: [
        menuItem("menu", ["Sitemap"]),
        countryItem("c", { label: "Ship to :", flag: true, currency: false, arrow: false }),
      ],
    }),
    scripts: selectorScripts(),
  });
  const s = await page.evaluate(() => {
    const button = document.querySelector("#c .valor-localization__select");
    const left = (selector) => button.querySelector(selector).getBoundingClientRect().left;
    const flag = button.querySelector(".valor-localization__flag").getBoundingClientRect();
    const link = document.querySelector("#menu a");
    return {
      order:
        left(".valor-localization__label") < left(".valor-localization__flag") &&
        left(".valor-localization__flag") < left(".name"),
      text: button.textContent.replace(/\s+/g, " ").trim(),
      flag: [Math.round(flag.width * 100) / 100, Math.round(flag.height * 100) / 100],
      arrow: !!button.querySelector(".valor-localization__chevron"),
      sameSize: getComputedStyle(button).fontSize === getComputedStyle(link).fontSize,
      sameColour: getComputedStyle(button).color === getComputedStyle(link).color,
      size: getComputedStyle(button).fontSize,
    };
  });
  assert.deepEqual(s, {
    order: true,
    text: "Ship to : Finland",
    flag: [16.25, 12.19],
    arrow: false,
    sameSize: true,
    sameColour: true,
    size: "13px",
  });
});

test("two bars, each with a country selector: no id is used twice and each opens its own list", async (t) => {
  const page = await open(browser, t, {
    body:
      barMarkup({ id: "bar-1", items: [countryItem("one")] }) + barMarkup({ id: "bar-2", items: [countryItem("two")] }),
    scripts: selectorScripts(),
  });
  const twice = await page.evaluate(() => {
    const seen = new Map();
    document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1));
    return [...seen].filter(([, count]) => count > 1).map(([id]) => id);
  });
  assert.deepEqual(twice, []);
  await page.click("#two .valor-localization__select");
  assert.deepEqual([(await selectorState(page, "one")).open, (await selectorState(page, "two")).open], [false, true]);
  // The open list of the lower bar lies over the bar above it: a click
  // elsewhere on the page closes it first.
  await page.click("#MainContent");
  assert.equal((await selectorState(page, "two")).open, false);
  await page.click("#one .valor-localization__select");
  assert.deepEqual([(await selectorState(page, "one")).open, (await selectorState(page, "two")).open], [true, false]);
});

for (const position of ["left", "center", "right"]) {
  test(`on a phone the open list is a sheet inside the screen (selector in the ${position} zone)`, async (t) => {
    const page = await open(browser, t, {
      width: 390,
      height: 844,
      body: barMarkup({ items: [countryItem("c", { position })] }),
      scripts: selectorScripts(),
    });
    await page.click("#c .valor-localization__select");
    const s = await selectorState(page, "c");
    assert.equal(s.panel.position, "fixed");
    assert.ok(
      s.panel.left >= 0 && s.panel.right <= 390 && s.panel.bottom <= 844 && s.panel.top >= 0,
      JSON.stringify(s.panel),
    );
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
}

for (const dir of ["ltr", "rtl"]) {
  test(`desktop, ${dir}: the list opens above its button and stays on the screen from every zone`, async (t) => {
    for (const position of ["left", "center", "right"]) {
      const page = await open(browser, t, {
        dir,
        body: barMarkup({ items: [countryItem("c", { position })] }),
        scripts: selectorScripts(),
      });
      await page.click("#c .valor-localization__select");
      const s = await selectorState(page, "c");
      assert.ok(s.open, position);
      assert.ok(s.panel.bottom <= s.buttonTop, `${position}: above the button ${JSON.stringify(s.panel)}`);
      assert.ok(s.panel.left >= 0 && s.panel.right <= 1440, `${position}: ${JSON.stringify(s.panel)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, position);
    }
  });
}

test("a bar without any item takes no room on any device", async (t) => {
  for (const width of [1440, 390]) {
    const page = await open(browser, t, { width, body: barMarkup({ items: [] }) });
    assert.equal((await boxes(page, ["bar"])).bar.height, 0, `${width}px`);
  }
});

// ---------------------------------------------------------------------------
// Whole-change review: what the first tests did not reach
// ---------------------------------------------------------------------------

const SIX = [
  "Privacy policy",
  "Refund policy",
  "Terms of service",
  "Shipping policy",
  "Contact information",
  "Legal notice",
];

test("a long centre zone leaves the sides their room, wraps, and stays in the middle", async (t) => {
  const page = await open(browser, t, {
    width: 800,
    body: barMarkup({
      items: [
        textItem("left", "© 2026 Valor Demo Store", { position: "left" }),
        menuItem("centre", SIX, { position: "center" }),
        textItem("right", "Free returns", { position: "right" }),
      ],
    }),
  });
  const b = await boxes(page, ["left", "centre", "right"]);
  assert.ok(
    b.left.width >= 100 && b.left.height <= 45,
    `the text on the left is not broken letter by letter: ${JSON.stringify(b.left)}`,
  );
  assert.ok(b.right.width >= 60, JSON.stringify(b.right));
  assert.ok(
    b.left.right <= b.centre.left + 0.6 && b.centre.right <= b.right.left + 0.6,
    `nothing overlaps: ${JSON.stringify(b)}`,
  );
  assert.ok(near(b.centre.centre, 400, 1), String(b.centre.centre));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test("a row with centre items only gives them the whole row", async (t) => {
  const page = await open(browser, t, { width: 1000, body: barMarkup({ items: [menuItem("centre", SIX)] }) });
  const b = await boxes(page, ["centre"]);
  assert.ok(b.centre.height <= 24, `six links fit on one line of a 1000px screen: ${JSON.stringify(b.centre)}`);
  assert.ok(near(b.centre.centre, 500, 1), String(b.centre.centre));
  // A phone-only item at the side does not take the room away on a desktop.
  const withPhoneOnly = await open(browser, t, {
    width: 1000,
    body: barMarkup({
      items: [menuItem("centre", SIX), textItem("side", "Phone only", { position: "left", visibility: "phone" })],
    }),
  });
  assert.ok((await boxes(withPhoneOnly, ["centre"])).centre.height <= 24);
});

test("phone: a text that wraps is centred whatever zone it is in, and starts at the edge with alignment left", async (t) => {
  const long = "A notice long enough to wrap onto a second line on a phone, whichever zone it was put in for desktops.";
  const align = async (phone) => {
    const page = await open(browser, t, {
      width: 390,
      height: 844,
      body: barMarkup({
        phone,
        items: [
          textItem("r", long, { position: "right" }),
          textItem("c", long),
          textItem("l", long, { position: "left" }),
        ],
      }),
    });
    return page.$$eval(".valor-footer-bar__text", (texts) => texts.map((text) => getComputedStyle(text).textAlign));
  };
  assert.deepEqual(await align("center"), ["center", "center", "center"]);
  for (const value of await align("left")) assert.match(value, /^(start|left)$/);
});

test("a long country name with a label and a flag wraps inside a 320px screen", async (t) => {
  const page = await open(browser, t, {
    width: 320,
    height: 700,
    body: barMarkup({
      items: [
        countryItem("c", { label: "Ship to :", flag: true, name: "Democratic Republic of the Congo", money: "CDF Fr" }),
      ],
    }),
    scripts: selectorScripts(),
  });
  const s = await page.evaluate(() => {
    const r = document.querySelector("#c .valor-localization__select").getBoundingClientRect();
    return { left: r.left, right: r.right, scroll: document.documentElement.scrollWidth, inner: innerWidth };
  });
  assert.ok(s.left >= 0 && s.right <= 320 && s.scroll <= s.inner, JSON.stringify(s));
});

test("links that wrap keep enough room between their lines to be tapped", async (t) => {
  const page = await open(browser, t, { width: 390, height: 844, body: barMarkup({ items: [menuItem("m", SIX)] }) });
  const tops = await page.$$eval("#m a", (links) => [
    ...new Set(links.map((link) => Math.round(link.getBoundingClientRect().top))),
  ]);
  assert.ok(tops.length >= 2, "the links wrap");
  assert.ok(tops[1] - tops[0] >= 24, `line to line: ${tops[1] - tops[0]}px`);
});

// ---------------------------------------------------------------------------
// External review, round 3: a bar on a page without the Footer section
// ---------------------------------------------------------------------------

// Everything a visitor sees of a bar: each element's box, text style and colours.
const drawn = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".valor-footer-bar *")].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const round = (n) => Math.round(n * 10) / 10;
      return [
        `${el.tagName} ${el.getAttribute("class") || ""}`.trim(),
        [round(r.left), round(r.top), round(r.width), round(r.height)].join(" "),
        [cs.display, cs.visibility, cs.listStyleType, cs.color, cs.fontSize, cs.borderRadius].join(" "),
      ].join(" | ");
    }),
  );

/* The Footer section's stylesheet is only on the page while that section is:
   a merchant who builds the footer from bars alone removes it or switches it
   off. The Social icons block was styled from there, and without it showed a
   bulleted list of unsized icons. */
for (const [device, width, height] of [
  ["desktop", 1440, 900],
  ["phone", 390, 844],
]) {
  test(`without the Footer section's styles the social icons are drawn the same (${device})`, async (t) => {
    const read = async (footerStyles) => {
      const page = await open(browser, t, {
        width,
        height,
        footerStyles,
        body: barMarkup({
          items: [socialItem("left", "1", { position: "left" }), socialItem("right", "1.25", { position: "right" })],
        }),
      });
      const all = await drawn(page);
      await page.hover("#left .valor-social-icons__link");
      await page.waitForTimeout(200);
      const hover = await page.$eval("#left .valor-social-icons__link", (el) => getComputedStyle(el).backgroundColor);
      return { all, hover };
    };
    const alone = await read(false);
    const link = alone.all.find((line) => line.startsWith("A valor-social-icons__link"));
    const size = width >= 750 ? "40 40" : "36 36";
    assert.match(link, new RegExp(` ${size} \| flex `), `the first icon is a ${size.split(" ")[0]}px circle: ${link}`);
    assert.deepEqual(alone, await read(true));
  });
}

test("without the Footer section's styles every kind of item is drawn the same", async (t) => {
  const items = [
    logoItem("logo", { position: "left" }),
    textItem("text", "&copy; 2026 Valor Demo Store", { position: "left" }),
    menuItem("menu", LINKS),
    socialItem("social", "1", { position: "right" }),
    countryItem("country", { label: "Ship to :", flag: true, position: "right" }),
    {
      id: "legal",
      type: "legal_guarantee",
      row: 2,
      html: '<button type="button" class="valor-legal-guarantee-trigger valor-footer-bar__legal" popovertarget="ValorLegalGuaranteeNotice">Your legal guarantee rights</button>',
    },
    {
      id: "payment",
      type: "payment",
      row: 2,
      position: "right",
      html: `<ul class="valor-footer-bar__payment" role="list">${'<li class="valor-footer-bar__payment-item"><svg viewBox="0 0 38 24" width="38" height="24"></svg></li>'.repeat(4)}</ul>`,
    },
  ];
  for (const width of [1440, 390]) {
    const read = async (footerStyles) => {
      const page = await open(browser, t, { width, height: 900, footerStyles, body: barMarkup({ items }) });
      // The logo and the flag are measured once they are there.
      await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
      return drawn(page);
    };
    assert.deepEqual(await read(false), await read(true), `${width}px`);
  }
});

// ---------------------------------------------------------------------------
// External review, round 4 (the same family, found while fixing it): an item
// for one device, hidden with the focus on it
// ---------------------------------------------------------------------------

const { barScript } = require("./footer-fixture.cjs");

// Where the focus is: "<item id> <link text>", or the element's id or tag.
const barFocus = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const item = el.closest(".valor-footer-bar__item");
    return item ? `${item.id} ${el.textContent.trim()}` : el.id || el.tagName;
  });
const toWidth = async (page, width) => {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(250);
};

/* "Desktop only" and "phone only" items, and a row or a bar that holds only
   such items, are not drawn on the other device. One that is hidden while a
   control in it has the focus hands the focus to the next control of the
   footer that shows (the next Tab stop), or to the one before it. */
test("a desktop only item with the focus hands it to the next control that shows when the screen narrows", async (t) => {
  const page = await open(browser, t, {
    scripts: barScript(),
    body: barMarkup({
      items: [
        menuItem("first", ["One", "Two"], { position: "left" }),
        menuItem("wide", ["Wide a", "Wide b"], { visibility: "desktop" }),
        menuItem("last", ["Three"], { position: "right" }),
      ],
    }),
  });
  await page.focus("#wide a");
  await toWidth(page, 390);
  assert.equal(await barFocus(page), "last Three");
  assert.deepEqual(page.errors, []);
});

test("the last control of the footer, hidden with the focus on it, hands it to the one before", async (t) => {
  const page = await open(browser, t, {
    scripts: barScript(),
    body: barMarkup({
      items: [
        menuItem("first", ["One", "Two"], { position: "left" }),
        menuItem("wide", ["Wide a", "Wide b"], { visibility: "desktop", position: "right" }),
      ],
    }),
  });
  await page.focus("#wide li:last-child a");
  await toWidth(page, 390);
  assert.equal(await barFocus(page), "first Two");
});

test("a phone only item with the focus hands it on when the screen widens", async (t) => {
  const page = await open(browser, t, {
    width: 390,
    height: 844,
    scripts: barScript(),
    body: barMarkup({
      items: [menuItem("small", ["Small a"], { visibility: "phone" }), menuItem("both", ["Both a", "Both b"])],
    }),
  });
  await page.focus("#small a");
  await toWidth(page, 1440);
  assert.equal(await barFocus(page), "both Both a");
});

test("a bar that is not there on a phone hands the focus of its item to the next bar", async (t) => {
  const page = await open(browser, t, {
    scripts: barScript() + barScript(),
    body:
      barMarkup({ id: "one", items: [menuItem("wide", ["Wide a"], { visibility: "desktop" })] }) +
      barMarkup({ id: "two", items: [menuItem("both", ["Both a"])] }),
  });
  await page.focus("#wide a");
  await toWidth(page, 390);
  assert.equal(await page.$eval("#one", (bar) => getComputedStyle(bar).display), "none");
  assert.equal(await barFocus(page), "both Both a");
});

test("a change of width moves no focus that a bar's hidden item did not have", async (t) => {
  const page = await open(browser, t, {
    scripts: barScript(),
    body: barMarkup({
      items: [menuItem("wide", ["Wide a"], { visibility: "desktop" }), menuItem("both", ["Both a", "Both b"])],
    }),
  });
  // A control that still shows keeps the focus.
  await page.focus("#both li:last-child a");
  await toWidth(page, 390);
  assert.equal(await barFocus(page), "both Both b");
  await toWidth(page, 1440);
  // The focus was taken away by the visitor: it is not brought back.
  await page.focus("#wide a");
  await page.evaluate(() => document.activeElement.blur());
  await toWidth(page, 390);
  assert.equal(await barFocus(page), "BODY");
  // The focus is somewhere else on the page.
  await toWidth(page, 1440);
  await page.focus("#before");
  await toWidth(page, 390);
  assert.equal(await barFocus(page), "before");
});
