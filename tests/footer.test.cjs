const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  engine,
  read,
  textItem,
  menuItem,
  barMarkup,
  footerMarkup,
  footerScript,
  footerMetrics,
  open,
  boxes,
  near,
} = require("./footer-fixture.cjs");

// The Footer section (sections/footer.liquid) after 2.3.0: new settings whose
// defaults draw the released footer, columns that fold on phones behind a
// real button, the Subscribe button in the theme's shared button style, and
// one footer landmark around the whole footer group (layout/theme.liquid).
// The Tab key, where it can be tested: the WebKit build that runs these tests
// moves focus to links neither with Tab nor with Option+Tab, so there the
// state Tab depends on (display, visibility) is what is asserted.
const TAB = engine.name() === "webkit" ? null : "Tab";

let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

const styleOf = (page, selector, properties) =>
  page.$eval(selector, (el, properties) => properties.map((property) => getComputedStyle(el)[property]), properties);
// The folding columns' transition is 0.46s.
const rested = (page) => page.waitForTimeout(650);

// ---------------------------------------------------------------------------
// An update changes nothing by itself
// ---------------------------------------------------------------------------

/* tests/footer-2.2.2-metrics.json holds where the released footer (2.2.2,
   commit 0675d10) drew its parts with the default settings: its own
   stylesheet and script around the markup it printed, measured on this same
   test page by tests/footer-2.2.2-baseline.cjs, which also checks them again. The footer of this branch, with its defaults, has to
   draw the same boxes at the same text sizes. The Subscribe button's width
   is not among them: its text style is the one intended change. */
// Text is a little wider or narrower from one browser engine to the next, so
// each engine is held to what it drew itself.
const RELEASED = JSON.parse(read("tests", "footer-2.2.2-metrics.json"))[engine.name()];

for (const [name, width, height] of [
  ["desktop", 1440, 900],
  ["tablet", 800, 900],
  ["phone", 390, 844],
]) {
  test(`default settings draw the released footer: ${name} (${width}px)`, async (t) => {
    const page = await open(browser, t, { width, height, body: footerMarkup(), scripts: footerScript() });
    assert.deepEqual(await footerMetrics(page), RELEASED[name]);
    assert.deepEqual(page.errors, []);
  });
}

test("default settings draw the released footer: phone, with the menu column opened", async (t) => {
  const page = await open(browser, t, { width: 390, height: 844, body: footerMarkup(), scripts: footerScript() });
  await page.click(".valor-footer__heading-button");
  await rested(page);
  assert.deepEqual(await footerMetrics(page), RELEASED.phoneOpen);
});

// ---------------------------------------------------------------------------
// The lower part: copyright line, and nothing at all
// ---------------------------------------------------------------------------

test("with every lower part off there is no line and no gap below the columns", async (t) => {
  const page = await open(browser, t, {
    body: footerMarkup({
      country: false,
      language: false,
      payment: false,
      copyright: false,
      policies: [],
      legal: false,
    }),
  });
  const s = await page.evaluate(() => {
    const footer = document.querySelector(".valor-footer").getBoundingClientRect();
    const top = document.querySelector(".valor-footer__top").getBoundingClientRect();
    return {
      bottoms: !!document.querySelector(".valor-footer__bottom"),
      below: Math.round((footer.bottom - top.bottom) * 10) / 10,
    };
  });
  assert.deepEqual(s, { bottoms: false, below: 36 }, "only the section's own bottom padding is left");
});

test("copyright off, policies on: the row holds the policies only, in the middle", async (t) => {
  const page = await open(browser, t, { body: footerMarkup({ copyright: false, legal: false }) });
  const s = await page.evaluate(() => {
    const row = document.querySelector(".valor-footer__copyright");
    const policies = document.querySelector(".valor-footer__policies").getBoundingClientRect();
    return {
      text: [...row.querySelectorAll("a, button, span")].map((el) => el.textContent.trim()),
      centre: policies.left + policies.width / 2,
    };
  });
  assert.deepEqual(s.text, ["Privacy policy", "Refund policy"]);
  assert.ok(near(s.centre, 720, 1), String(s.centre));
});

test("copyright off, with only the selectors and payment icons left: no empty row adds a gap", async (t) => {
  const page = await open(browser, t, { body: footerMarkup({ copyright: false, policies: [], legal: false }) });
  const s = await page.evaluate(() => {
    const bottom = document.querySelector(".valor-footer__bottom").getBoundingClientRect();
    const payment = document.querySelector(".valor-footer__payment").getBoundingClientRect();
    return {
      row: !!document.querySelector(".valor-footer__copyright"),
      below: Math.round((bottom.bottom - payment.bottom) * 10) / 10,
    };
  });
  assert.deepEqual(s, { row: false, below: 0 });
});

test("an own copyright text is drawn like the default line, and its link like the default's", async (t) => {
  const read = (page) =>
    page.evaluate(() => {
      const span = document.querySelector(".valor-footer__copyright-text");
      const link = span.querySelector("a");
      return [
        getComputedStyle(span).fontSize,
        getComputedStyle(span).color,
        getComputedStyle(link).color,
        getComputedStyle(link).textDecorationLine,
      ];
    });
  const standard = await open(browser, t, { body: footerMarkup() });
  const own = await open(browser, t, {
    body: footerMarkup({ copyrightHtml: '© 2026 Valor Demo Store. <a href="/pages/terms">All rights reserved</a>.' }),
  });
  assert.deepEqual(await read(own), await read(standard));
});

// ---------------------------------------------------------------------------
// Column heading style, and the Social icons column
// ---------------------------------------------------------------------------

const HEADINGS = [".valor-footer__heading", ".valor-footer__block-heading"];

test("small uppercase headings on a desktop: uppercase and small, still the heading font and the heading scale", async (t) => {
  let page = await open(browser, t, { body: footerMarkup({ headingStyle: "uppercase" }) });
  for (const selector of HEADINGS) {
    assert.deepEqual(
      await styleOf(page, selector, ["textTransform", "fontSize", "letterSpacing", "fontFamily"]),
      ["uppercase", "12px", "0.96px", "Georgia, serif"],
      selector,
    );
  }
  page = await open(browser, t, {
    variables: "--font-heading-scale: 1.5;",
    body: footerMarkup({ headingStyle: "uppercase" }),
  });
  assert.equal((await styleOf(page, HEADINGS[0], ["fontSize"]))[0], "18px");
  page = await open(browser, t, {
    variables: "--font-body-scale: 1.3;",
    body: footerMarkup({ headingStyle: "uppercase" }),
  });
  // 12px at a body scale of 1.3 (one engine prints 15.599999px).
  const scaled = parseFloat((await styleOf(page, HEADINGS[0], ["fontSize"]))[0]);
  assert.ok(near(scaled, 15.6, 0.01), `and the size token's own scale: ${scaled}`);
});

test("small uppercase headings are the column headings only: the email signup heading keeps the theme's style", async (t) => {
  const page = await open(browser, t, { body: footerMarkup({ headingStyle: "uppercase" }) });
  assert.deepEqual(
    await styleOf(page, ".valor-footer__newsletter-side .valor-footer__block-heading", ["textTransform", "fontSize"]),
    ["none", "15px"],
  );
});

test("small uppercase headings: on a phone the headings stay at their normal size", async (t) => {
  const page = await open(browser, t, { width: 390, height: 844, body: footerMarkup({ headingStyle: "uppercase" }) });
  assert.deepEqual(await styleOf(page, ".valor-footer__heading-button", ["textTransform", "fontSize"]), [
    "none",
    "15px",
  ]);
  assert.deepEqual(await styleOf(page, ".valor-footer__block-heading", ["textTransform", "fontSize"]), [
    "none",
    "15px",
  ]);
});

test("theme heading (the default) leaves the headings as they are", async (t) => {
  const page = await open(browser, t, { body: footerMarkup() });
  for (const selector of HEADINGS) {
    assert.deepEqual(
      await styleOf(page, selector, ["textTransform", "fontSize", "letterSpacing"]),
      ["none", "15px", "0.3px"],
      selector,
    );
  }
});

test("the Social icons column shows its heading, and its icons start at the column's edge", async (t) => {
  const page = await open(browser, t, {
    body: footerMarkup({
      columns: [
        { type: "link_list", heading: "Help", links: ["FAQ"] },
        { type: "social", heading: "Follow us" },
      ],
      social: false,
    }),
  });
  const s = await page.evaluate(() => {
    const column = document.getElementById("column-2");
    const heading = column.querySelector(".valor-footer__block-heading");
    const first = column.querySelector(".valor-social-icons__link").getBoundingClientRect();
    return {
      heading: heading.textContent,
      shift: Math.round((first.left - column.getBoundingClientRect().left) * 10) / 10,
      icons: column.querySelectorAll(".valor-social-icons__item").length,
    };
  });
  assert.deepEqual(s, { heading: "Follow us", shift: 0, icons: 3 });
});

// ---------------------------------------------------------------------------
// Columns on phones
// ---------------------------------------------------------------------------

const FOUR = [
  { type: "link_list", heading: "Help", links: ["FAQ", "Product care", "Stores"] },
  { type: "text", heading: "Services", text: "Repairs and personalization." },
  { type: "social", heading: "Connect" },
  { type: "text", heading: "", text: "A column without a heading." },
];
// What a column looks like to a visitor: folded, open, or not a folding column.
const columnStates = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".valor-footer__block")].map((block) => {
      const button = block.querySelector(".valor-footer__heading-button");
      const shown = button && getComputedStyle(button).display !== "none";
      const panel = block.querySelector(".valor-footer__panel");
      if (!shown) return "plain";
      const closed = panel.getBoundingClientRect().height < 1 && getComputedStyle(panel).visibility === "hidden";
      return `${closed ? "folded" : "open"}/${button.getAttribute("aria-expanded")}`;
    }),
  );
const phone = (t, options) => open(browser, t, { width: 390, height: 844, scripts: footerScript(), ...options });

test("columns on phones, fold menus (the default): menu columns fold, the others stay open", async (t) => {
  const page = await phone(t, { body: footerMarkup({ columns: FOUR }) });
  assert.deepEqual(await columnStates(page), ["folded/false", "plain", "plain", "plain"]);
});

test("columns on phones, fold all: text and social columns with a heading fold too, one without a heading stays open", async (t) => {
  const page = await phone(t, { body: footerMarkup({ columns: FOUR, mobileColumns: "all" }) });
  assert.deepEqual(await columnStates(page), ["folded/false", "folded/false", "folded/false", "plain"]);
  const lines = await page.$$eval(".valor-footer__block", (blocks) =>
    blocks.map((block) => getComputedStyle(block).borderBottomWidth),
  );
  assert.deepEqual(lines, ["1px", "1px", "1px", "0px"], "a line under every folding column");
  await page.click("#column-2 .valor-footer__heading-button");
  await page.click("#column-3 .valor-footer__heading-button");
  await rested(page);
  assert.deepEqual(await columnStates(page), ["folded/false", "open/true", "open/true", "plain"]);
  assert.equal(await page.$eval("#column-2 .valor-footer__text", (el) => el.getBoundingClientRect().height > 10), true);
  assert.equal(
    await page.$eval("#column-3 .valor-social-icons__link", (el) => el.getBoundingClientRect().height > 10),
    true,
  );
});

// The columns stand 2.5rem apart on a phone. In "fold all" the folding columns
// are one list of rows, as in the layout this mode is for.
test("columns on phones, fold all: folding columns follow each other without a gap, the others keep theirs", async (t) => {
  const gaps = (page) =>
    page.evaluate(() => {
      const blocks = [...document.querySelectorAll(".valor-footer__block")].map((block) =>
        block.getBoundingClientRect(),
      );
      return blocks.slice(1).map((box, i) => Math.round((box.top - blocks[i].bottom) * 10) / 10);
    });
  let page = await phone(t, { body: footerMarkup({ columns: FOUR, mobileColumns: "all" }) });
  assert.deepEqual(await gaps(page), [0, 0, 40], "three folding rows, then the column without a heading");
  // The default is as it was: two menu columns keep the gap between them.
  const menus = [
    { type: "link_list", heading: "Help", links: ["FAQ"] },
    { type: "link_list", heading: "Shop", links: ["New in"] },
    { type: "text", heading: "About", text: "Text." },
  ];
  page = await phone(t, { body: footerMarkup({ columns: menus }) });
  assert.deepEqual(await gaps(page), [40, 40]);
  // From 550px the columns stand two abreast, and the gap stays between the rows.
  page = await open(browser, t, {
    width: 600,
    height: 844,
    body: footerMarkup({ columns: FOUR, mobileColumns: "all" }),
  });
  const tops = await page.$$eval(".valor-footer__block", (blocks) =>
    blocks.map((block) => Math.round(block.getBoundingClientRect().top)),
  );
  assert.ok(tops[0] === tops[1] && tops[2] > tops[0] + 40, JSON.stringify(tops));
});

test("columns on phones, keep all open: nothing folds, there is no button, and a menu reads like a text column", async (t) => {
  const page = await phone(t, { body: footerMarkup({ columns: FOUR, mobileColumns: "none" }) });
  assert.deepEqual(await columnStates(page), ["plain", "plain", "plain", "plain"]);
  assert.equal(await page.$$eval(".valor-footer__heading-button", (buttons) => buttons.length), 0);
  const s = await page.evaluate(() => {
    const block = document.getElementById("column-1");
    const heading = block.querySelector(".valor-footer__heading");
    const text = document.querySelector("#column-2 .valor-footer__block-heading");
    const cs = getComputedStyle(heading);
    const other = getComputedStyle(text);
    return {
      linkShows: block.querySelector(".valor-footer__menu-link").getBoundingClientRect().height > 10,
      line: getComputedStyle(block).borderBottomWidth,
      sameHeading:
        [cs.fontSize, cs.marginBottom, cs.fontFamily].join() ===
        [other.fontSize, other.marginBottom, other.fontFamily].join(),
      headingHeight: heading.getBoundingClientRect().height === text.getBoundingClientRect().height,
    };
  });
  assert.deepEqual(s, { linkShows: true, line: "0px", sameHeading: true, headingHeight: true });
});

test("the heading button opens and closes its column with Enter and with Space, and says so", async (t) => {
  const page = await phone(t, { body: footerMarkup({ columns: FOUR }) });
  await page.focus("#column-1 .valor-footer__heading-button");
  await page.keyboard.press("Enter");
  await rested(page);
  assert.equal((await columnStates(page))[0], "open/true");
  await page.keyboard.press("Space");
  await rested(page);
  assert.equal((await columnStates(page))[0], "folded/false");
  assert.equal(
    await page.$eval("#column-1 .valor-footer__heading-button", (button) => document.activeElement === button),
    true,
  );
  assert.deepEqual(page.errors, []);
});

test("the links of a folded column cannot be reached; opened, they can", async (t) => {
  const page = await phone(t, { body: footerMarkup({ columns: FOUR }) });
  const link = "#column-1 .valor-footer__menu-link";
  assert.equal((await styleOf(page, link, ["visibility"]))[0], "hidden");
  // WebKit only stops Tab on links when asked to; the hidden state above covers it.
  if (TAB) {
    await page.focus("#column-1 .valor-footer__heading-button");
    await page.keyboard.press(TAB);
    assert.equal(
      await page.evaluate(() => document.activeElement.classList.contains("valor-footer__menu-link")),
      false,
      "Tab skips the folded links",
    );
  }
  await page.click("#column-1 .valor-footer__heading-button");
  await rested(page);
  assert.equal((await styleOf(page, link, ["visibility"]))[0], "visible");
  if (TAB) {
    await page.focus("#column-1 .valor-footer__heading-button");
    await page.keyboard.press(TAB);
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "FAQ");
  }
});

test("a menu column without a heading is named by its menu", async (t) => {
  const page = await phone(t, {
    body: footerMarkup({ columns: [{ type: "link_list", heading: "", links: ["FAQ"], menuTitle: "Customer care" }] }),
  });
  assert.equal(
    await page.$eval(".valor-footer__heading-button", (button) => button.getAttribute("aria-label")),
    "Customer care",
  );
  await page.click(".valor-footer__heading-button");
  await rested(page);
  assert.equal((await columnStates(page))[0], "open/true");
});

test("on a desktop no folding button is shown or can be focused, and every column is open", async (t) => {
  const page = await open(browser, t, {
    body: footerMarkup({ columns: FOUR, mobileColumns: "all" }),
    scripts: footerScript(),
  });
  const s = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll(".valor-footer__heading-button")].map(
      (button) => getComputedStyle(button).display,
    ),
    headings: [...document.querySelectorAll(".valor-footer__heading-text")].map(
      (text) => text.getBoundingClientRect().height > 5,
    ),
    panels: [...document.querySelectorAll(".valor-footer__panel")].map(
      (panel) => panel.getBoundingClientRect().height > 10 && getComputedStyle(panel).visibility === "visible",
    ),
  }));
  assert.deepEqual(s, { buttons: ["none", "none", "none"], headings: [true, true, true], panels: [true, true, true] });
  const tops = await boxes(page, ["column-1", "column-2", "column-3"]);
  assert.ok(
    near(tops["column-1"].top, tops["column-2"].top) && near(tops["column-2"].top, tops["column-3"].top),
    "side by side",
  );
});

test("the section's script loaded twice (the theme editor renders the section again) still answers once", async (t) => {
  const page = await phone(t, { body: footerMarkup({ columns: FOUR }), scripts: footerScript() + footerScript() });
  await page.click("#column-1 .valor-footer__heading-button");
  await rested(page);
  assert.equal((await columnStates(page))[0], "open/true");
});

// ---------------------------------------------------------------------------
// The Subscribe button, and the footer landmark
// ---------------------------------------------------------------------------

const REFERENCE = `<div class="shopify-section"><div class="color-scheme-1"><button type="button" class="valor-button valor-button--primary" id="reference">Reference</button></div></div>`;
const BUTTON_STYLE = [
  "fontSize",
  "fontWeight",
  "fontFamily",
  "letterSpacing",
  "textTransform",
  "lineHeight",
  "backgroundColor",
  "color",
  "borderTopWidth",
  "borderTopStyle",
  "borderTopColor",
  "borderTopLeftRadius",
  "cursor",
];

test("the Subscribe button has the shared button's type, colours, border and radius, and keeps its own compact padding", async (t) => {
  for (const scheme of ["scheme-1", "scheme-2"]) {
    const page = await open(browser, t, {
      body: REFERENCE.replace("color-scheme-1", `color-${scheme}`) + footerMarkup({ scheme }),
    });
    assert.deepEqual(
      await styleOf(page, ".valor-footer__newsletter-button", BUTTON_STYLE),
      await styleOf(page, "#reference", BUTTON_STYLE),
      scheme,
    );
    assert.deepEqual(
      await styleOf(page, ".valor-footer__newsletter-button", [
        "textTransform",
        "fontSize",
        "paddingLeft",
        "paddingTop",
      ]),
      ["none", "15px", "16px", "0px"],
    );
  }
});

test("the Subscribe button's hover is the shared button's hover", async (t) => {
  const page = await open(browser, t, {
    css: ".color-scheme-1 { --color-button-hover-bg: rgb(0, 100, 0); --color-button-hover-text: rgb(255, 255, 0); --color-button-hover-border: rgb(0, 0, 200); --button-hover-opacity: 1; }",
    body: footerMarkup(),
  });
  await page.hover(".valor-footer__newsletter-button");
  await page.waitForTimeout(300);
  assert.deepEqual(
    await styleOf(page, ".valor-footer__newsletter-button", ["backgroundColor", "color", "borderTopColor"]),
    ["rgb(0, 100, 0)", "rgb(255, 255, 0)", "rgb(0, 0, 200)"],
  );
});

// That the layout prints the landmark is pinned on the source (footer-liquid.test.cjs);
// here: the element around the group does not disturb the page.
test("the element around the footer group keeps the footer at the bottom of a short page, full width", async (t) => {
  const page = await open(browser, t, {
    height: 2000,
    body: footerMarkup() + barMarkup({ items: [textItem("x", "Bar")] }),
  });
  const s = await page.evaluate(() => {
    const group = document.querySelector("footer.valor-footer-group");
    return {
      landmarks: document.querySelectorAll("footer").length,
      inside:
        group.contains(document.querySelector(".valor-footer")) &&
        group.contains(document.querySelector(".valor-footer-bar")),
      mainGrew: document.getElementById("MainContent").getBoundingClientRect().height > 1000,
      width: group.getBoundingClientRect().width,
    };
  });
  assert.deepEqual(s, { landmarks: 1, inside: true, mainGrew: true, width: 1440 });
});

// ---------------------------------------------------------------------------
// Every theme setting reaches the Footer and the Footer bar
// ---------------------------------------------------------------------------

/* One page with a Footer and a bar. Each test changes what one theme setting
   changes (the variables snippets/css-variables.liquid prints) and reads the
   parts that have to follow. A fixed value in either stylesheet that
   overrides a setting fails here. */
const shopName = {
  id: "name",
  type: "logo",
  html: '<a href="/" class="valor-footer-bar__logo valor-footer-bar__logo--text">Valor Demo Store</a>',
  position: "left",
};
const both = () =>
  footerMarkup() +
  barMarkup({
    lineAbove: true,
    items: [
      shopName,
      textItem("text", "© 2026 Valor"),
      menuItem("menu", ["Sitemap", "Cookies"], { position: "right" }),
    ],
  });
const sizes = (page) =>
  page.evaluate(() => {
    const size = (selector) => getComputedStyle(document.querySelector(selector)).fontSize;
    return {
      footerHeading: size(".valor-footer__heading"),
      footerLink: size(".valor-footer__menu-link"),
      footerText: size(".valor-footer__text"),
      footerInput: size(".valor-footer__newsletter-input"),
      footerButton: size(".valor-footer__newsletter-button"),
      footerCopyright: size(".valor-footer__copyright"),
      barName: size("#name a"),
      barText: size("#text p"),
      barLink: size("#menu a"),
    };
  });

test("theme settings: text sizes at the defaults", async (t) => {
  const page = await open(browser, t, { body: both() });
  assert.deepEqual(await sizes(page), {
    footerHeading: "15px",
    footerLink: "15px",
    footerText: "15px",
    footerInput: "15px",
    footerButton: "15px",
    footerCopyright: "13px",
    barName: "18px",
    barText: "13px",
    barLink: "13px",
  });
});

test("theme settings: the body text scale enlarges every text of the footer and the bar", async (t) => {
  const page = await open(browser, t, { variables: "--font-body-scale: 1.3;", body: both() });
  assert.deepEqual(await sizes(page), {
    footerHeading: "19.5px",
    footerLink: "19.5px",
    footerText: "19.5px",
    footerInput: "19.5px",
    footerButton: "19.5px",
    footerCopyright: "16.9px",
    // The theme's own heading size token: clamp(1rem, 0.96rem + 0.22vw, 1.125rem), whose
    // viewport part does not grow with the text scale.
    barName: "23.136px",
    barText: "16.9px",
    barLink: "16.9px",
  });
});

test("theme settings: the heading scale enlarges the headings and the shop's name only", async (t) => {
  const page = await open(browser, t, { variables: "--font-heading-scale: 1.5;", body: both() });
  const s = await sizes(page);
  assert.deepEqual([s.footerHeading, s.barName], ["22.5px", "27px"]);
  assert.deepEqual(
    [s.footerLink, s.footerText, s.footerCopyright, s.barText, s.barLink],
    ["15px", "15px", "13px", "13px", "13px"],
  );
});

test("theme settings: the heading font and the body font", async (t) => {
  const page = await open(browser, t, {
    variables:
      '--font-heading--family: "Courier New", monospace; --font-heading--weight: 800; --font-body--family: Verdana, sans-serif;',
    body: REFERENCE + both(),
  });
  const family = (selector) => page.$eval(selector, (el) => getComputedStyle(el).fontFamily);
  for (const selector of [".valor-footer__heading", ".valor-footer__block-heading", "#name a"]) {
    assert.equal(await family(selector), '"Courier New", monospace', selector);
  }
  assert.equal((await styleOf(page, ".valor-footer__heading", ["fontWeight"]))[0], "800");
  for (const selector of [
    ".valor-footer__menu-link",
    ".valor-footer__text",
    ".valor-footer__copyright",
    ".valor-footer__newsletter-input",
    ".valor-footer__newsletter-button",
    "#text p",
    "#menu a",
    // The shared button itself, written as a button element: a browser gives
    // a button its own font unless the style says otherwise.
    "#reference",
  ]) {
    assert.equal(await family(selector), "Verdana, sans-serif", selector);
  }
});

test("theme settings: the page margin and the page width move the footer and the bar together", async (t) => {
  let page = await open(browser, t, { width: 1000, variables: "--page-margin: 60px;", body: both() });
  let b = await boxes(page, ["footer", "bar"]);
  assert.deepEqual([b.footer.left, b.footer.width, b.bar.left, b.bar.width], [60, 880, 60, 880]);
  page = await open(browser, t, { variables: "--page-width: 60rem;", body: both() });
  b = await boxes(page, ["footer", "bar"]);
  assert.deepEqual([b.footer.width, b.bar.width, b.footer.left, b.bar.left], [920, 920, 260, 260]);
  page = await open(browser, t, {
    width: 390,
    height: 844,
    css: "@media (max-width: 749px) { :root { --page-margin: 28px; } }",
    body: both(),
  });
  b = await boxes(page, ["footer", "bar"]);
  assert.deepEqual(
    [b.footer.left, b.bar.left, b.footer.width, b.bar.width],
    [28, 28, 334, 334],
    "the phone margin setting",
  );
});

test("theme settings: the colour scheme's colours and lines", async (t) => {
  const page = await open(browser, t, {
    css: ".color-scheme-1 { --color-foreground: rgb(10, 20, 200); --color-background: rgb(250, 240, 230); --valor-border-default: rgb(200, 0, 0); --valor-border-strong: rgb(0, 150, 0); }",
    body: both(),
  });
  const s = await page.evaluate(() => {
    const style = (selector, property) => getComputedStyle(document.querySelector(selector))[property];
    return {
      paint: [style(".valor-footer", "backgroundColor"), style(".valor-footer-bar", "backgroundColor")],
      text: [style(".valor-footer__heading", "color"), style("#name a", "color")],
      lines: [style(".valor-footer__bottom", "borderTopColor"), style(".valor-footer-bar__inner", "borderTopColor")],
      field: style(".valor-footer__newsletter-input", "borderTopColor"),
    };
  });
  assert.deepEqual(s, {
    paint: ["rgb(250, 240, 230)", "rgb(250, 240, 230)"],
    text: ["rgb(10, 20, 200)", "rgb(10, 20, 200)"],
    lines: ["rgb(200, 0, 0)", "rgb(200, 0, 0)"],
    field: "rgb(0, 150, 0)",
  });
});

test("theme settings: button colours, border width and radius, and the field radius", async (t) => {
  const page = await open(browser, t, {
    variables:
      "--style-button-border-width: 3px; --style-border-radius-buttons: 20px; --style-border-radius-inputs: 12px;",
    css: ".color-scheme-1 { --color-button-bg: rgb(0, 128, 0); --color-button-text: rgb(255, 255, 0); --color-button-border: rgb(0, 0, 255); }",
    body: both(),
  });
  assert.deepEqual(
    await styleOf(page, ".valor-footer__newsletter-button", [
      "backgroundColor",
      "color",
      "borderTopColor",
      "borderTopWidth",
      "borderTopLeftRadius",
    ]),
    ["rgb(0, 128, 0)", "rgb(255, 255, 0)", "rgb(0, 0, 255)", "3px", "20px"],
  );
  assert.equal((await styleOf(page, ".valor-footer__newsletter-input", ["borderTopLeftRadius"]))[0], "12px");
});

// ---------------------------------------------------------------------------
// External review, round 3: a change of layout dropped the keyboard focus
// ---------------------------------------------------------------------------

// Where the focus is in the footer, and whether a visitor can see that place.
const footerFocus = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const block = el.closest(".valor-footer__block");
    if (!block) return el.tagName;
    const part = el.classList.contains("valor-footer__heading-button")
      ? "button"
      : el.classList.contains("valor-footer__heading-text")
        ? "heading"
        : el.textContent.trim();
    const drawn = el.getClientRects().length > 0 && getComputedStyle(el).visibility === "visible";
    return `${block.id} ${part}${drawn ? "" : " (not shown)"}`;
  });
const tablet = (t, options) => open(browser, t, { width: 800, height: 900, scripts: footerScript(), ...options });
const resize = async (page, width) => {
  await page.setViewportSize({ width, height: 900 });
  await rested(page);
};

/* Below 750px a folded column hides its links. A link that had the focus when
   the screen narrowed (a window resized, a tablet turned) was hidden with it,
   and the focus fell to the page. Its column now opens instead. */
for (const reducedMotion of [false, true]) {
  test(`a menu link with the focus keeps it when the screen narrows: its column opens (${reducedMotion ? "reduced motion" : "sliding"})`, async (t) => {
    const page = await tablet(t, {
      body: footerMarkup({ columns: FOUR, mobileColumns: "all" }),
      media: reducedMotion ? { reducedMotion: "reduce" } : undefined,
    });
    await page.focus("#column-1 li:nth-child(2) .valor-footer__menu-link");
    await resize(page, 600);
    assert.equal(await footerFocus(page), "column-1 Product care");
    assert.deepEqual(await columnStates(page), ["open/true", "folded/false", "folded/false", "plain"]);
    assert.deepEqual(page.errors, []);
  });
}

test("a heading button with the focus hands it to its heading when the screen widens, and takes it back", async (t) => {
  const page = await open(browser, t, {
    width: 600,
    height: 900,
    scripts: footerScript(),
    body: footerMarkup({ columns: FOUR, mobileColumns: "all" }),
  });
  await page.focus("#column-2 .valor-footer__heading-button");
  await resize(page, 800);
  assert.equal(await footerFocus(page), "column-2 heading");
  await resize(page, 600);
  assert.equal(await footerFocus(page), "column-2 button");
  assert.deepEqual(await columnStates(page), ["folded/false", "folded/false", "folded/false", "plain"]);
  // From the heading Tab goes on into the columns, and the heading is no Tab stop afterwards.
  await resize(page, 800);
  assert.equal(await footerFocus(page), "column-2 heading");
  if (TAB) {
    await page.keyboard.press(TAB);
    assert.equal(await footerFocus(page), "column-3 Instagram");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await footerFocus(page), "column-1 Stores");
  } else {
    await page.evaluate(() => document.activeElement.blur());
  }
  assert.equal(await page.$eval("#column-2 .valor-footer__heading-text", (el) => el.hasAttribute("tabindex")), false);
  assert.deepEqual(page.errors, []);
});

test("the button of a menu column without a heading hands the focus to the column's first link", async (t) => {
  const page = await open(browser, t, {
    width: 600,
    height: 900,
    scripts: footerScript(),
    body: footerMarkup({ columns: [{ type: "link_list", heading: "", links: ["FAQ", "Stores"] }] }),
  });
  await page.focus("#column-1 .valor-footer__heading-button");
  await resize(page, 800);
  assert.equal(await footerFocus(page), "column-1 FAQ");
});

test("a link of an open column keeps the focus both ways, and the column stays open", async (t) => {
  const page = await open(browser, t, {
    width: 600,
    height: 900,
    scripts: footerScript(),
    body: footerMarkup({ columns: FOUR }),
  });
  await page.click("#column-1 .valor-footer__heading-button");
  await rested(page);
  await page.focus("#column-1 .valor-footer__menu-link");
  await resize(page, 800);
  assert.equal(await footerFocus(page), "column-1 FAQ");
  await resize(page, 600);
  assert.equal(await footerFocus(page), "column-1 FAQ");
  assert.equal((await columnStates(page))[0], "open/true");
});

test("a change of layout opens no column and moves no focus when the footer did not have it", async (t) => {
  const page = await tablet(t, { body: footerMarkup({ columns: FOUR, mobileColumns: "all" }) });
  await page.focus("#column-1 .valor-footer__menu-link");
  await page.evaluate(() => document.activeElement.blur());
  await resize(page, 600);
  assert.equal(await footerFocus(page), "BODY");
  assert.deepEqual(await columnStates(page), ["folded/false", "folded/false", "folded/false", "plain"]);
  await page.focus("#before");
  await resize(page, 800);
  assert.equal(await page.evaluate(() => document.activeElement.id), "before");
});

// ---------------------------------------------------------------------------
// External review, round 4: a link inside a heading
// ---------------------------------------------------------------------------

/* A column's heading is rich text and may hold a link. Below 750px the
   heading's text is hidden and its button shown: a link in it that had the
   focus is hidden too, and hands the focus to the button like the text does. */
test("a link in a column's heading hands the focus to the heading's button when the screen narrows", async (t) => {
  const columns = [
    {
      type: "link_list",
      heading: 'Help <a href="#help-centre" id="heading-link">centre</a>',
      links: ["FAQ", "Stores"],
    },
    { type: "text", heading: "Services", text: "Repairs." },
  ];
  const page = await tablet(t, { body: footerMarkup({ columns }) });
  await page.focus("#heading-link");
  assert.equal(await footerFocus(page), "column-1 centre");
  await resize(page, 600);
  assert.equal(await footerFocus(page), "column-1 button");
  assert.deepEqual((await columnStates(page))[0], "folded/false", "the column is not opened for it");
  await resize(page, 800);
  assert.equal(await footerFocus(page), "column-1 heading");
  assert.deepEqual(page.errors, []);
});
