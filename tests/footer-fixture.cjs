// Shared by tests/footer-bar.test.cjs and tests/footer.test.cjs: the theme's
// real stylesheets around markup that mirrors sections/footer-bar.liquid and
// sections/footer.liquid. Not a test file itself.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];
const root = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const stylesheetOf = (file) =>
  [...read(file).matchAll(/{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/g)].map((m) => m[1]).join("\n");

// Stands in for snippets/css-variables.liquid, with the theme's defaults.
const THEME_VARIABLES = `
  :root {
    --font-body--family: Arial, sans-serif; --font-body--style: normal; --font-body--weight: 400; --font-body--weight-bold: 700;
    --font-heading--family: Georgia, serif; --font-heading--style: normal; --font-heading--weight: 600;
    --font-body-scale: 1; --font-heading-scale: 1;
    --font-size-heading-xs: calc(var(--font-heading-scale, 1) * clamp(0.875rem, 0.84rem + 0.18vw, 1rem));
    --font-size-heading-sm: calc(var(--font-heading-scale, 1) * clamp(1rem, 0.96rem + 0.22vw, 1.125rem));
    --font-size-body-2xs: 0.75rem; --font-size-body-xs: 0.8125rem; --font-size-body-sm: 0.875rem;
    --font-size-body-md: 0.9375rem; --font-size-body-base: 1rem; --font-size-body-lg: 1.125rem;
    --page-width: 75rem; --page-margin: 20px;
    --style-button-border-width: 1.5px; --style-border-radius-buttons: 4px; --style-border-radius-inputs: 4px;
    --valor-color-error: #b00020; --valor-color-success: #0a7a2f;
  }
  :root, .color-scheme-1 {
    --color-background: #ffffff; --color-foreground: #111111;
    --color-button-bg: #111111; --color-button-text: #ffffff; --color-button-border: #111111;
    --valor-border-subtle: #dddddd; --valor-border-default: #bbbbbb; --valor-border-strong: #888888;
  }
  .color-scheme-2 {
    --color-background: #141414; --color-foreground: #f5f4f2;
    --color-button-bg: #f5f4f2; --color-button-text: #141414; --color-button-border: #f5f4f2;
    --valor-border-subtle: #333333; --valor-border-default: #555555; --valor-border-strong: #777777;
  }
  @media (max-width: 749px) { :root { --page-margin: 16px; } }
  body { margin: 0; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;

// `footerStyles: false` is a page whose Footer section has been removed or
// switched off: its stylesheet is not there, and a bar has to do without it.
const themeCss = ({ footerStyles = true } = {}) =>
  [
    THEME_VARIABLES,
    read("assets", "critical.css"),
    stylesheetOf("sections/header.liquid"),
    footerStyles ? stylesheetOf("sections/footer.liquid") : "",
    read("assets", "footer-bar.css"),
  ].join("\n");

const ROWS = [1, 2, 3];
const ZONES = ["left", "center", "right"];

// One item of a bar. `html` is what the block renders inside its wrapper.
const textItem = (id, text, options = {}) => ({
  id,
  type: "text",
  html: `<p class="valor-footer-bar__text">${text}</p>`,
  ...options,
});
const menuItem = (id, links, options = {}) => ({
  id,
  type: "menu",
  html: `<nav class="valor-footer-bar__menu" aria-label="Footer menu"><ul class="valor-footer-bar__links" role="list">${links
    .map((link) => `<li><a href="#${link.toLowerCase().replace(/\W+/g, "-")}">${link}</a></li>`)
    .join("")}</ul></nav>`,
  ...options,
});

/* Mirrors sections/footer-bar.liquid: rows 1 to 3, each with a left, centre
   and right zone; a row is only there when it holds an item; the device
   classes come from the items' visibility. */
function barMarkup({
  items = [],
  scheme = "scheme-1",
  width = "page",
  lineAbove = true,
  lineBelow = false,
  textSize = "small",
  phone = "center",
  paddingTop = 20,
  paddingBottom = 20,
  rowGap = 12,
  id = "bar",
} = {}) {
  let desktop = false;
  let onPhone = false;
  const rows = ROWS.map((row) => {
    const inRow = items.filter((item) => (item.row || 1) === row);
    if (!inRow.length) return "";
    const rowDesktop = inRow.some((item) => item.visibility !== "phone");
    const rowSides = inRow.some((item) => (item.position || "center") !== "center" && item.visibility !== "phone");
    if (rowDesktop) desktop = true;
    if (inRow.some((item) => item.visibility !== "desktop")) onPhone = true;
    const zones = ZONES.map((zone) => {
      const inZone = inRow.filter((item) => (item.position || "center") === zone);
      return `<div class="valor-footer-bar__zone valor-footer-bar__zone--${zone}">${inZone
        .map((item) => {
          const device =
            item.visibility === "desktop"
              ? " valor-footer-bar__item--desktop-only"
              : item.visibility === "phone"
                ? " valor-footer-bar__item--phone-only"
                : "";
          return `<div class="valor-footer-bar__item valor-footer-bar__item--${item.type}${device}" id="${item.id}" style="--fb-order: ${items.indexOf(item) + 1};${item.style || ""}">${item.html}</div>`;
        })
        .join("")}</div>`;
    }).join("");
    return `<div class="valor-footer-bar__row${rowDesktop ? "" : " valor-footer-bar__row--no-desktop"}${
      rowSides ? "" : " valor-footer-bar__row--center-only"
    }">${zones}</div>`;
  }).join("");
  const classes = [
    `color-${scheme}`,
    "valor-footer-bar",
    `valor-footer-bar--text-${textSize}`,
    `valor-footer-bar--phone-${phone}`,
    width === "full" ? "valor-full-width" : "",
    lineAbove ? "valor-footer-bar--line-above" : "",
    lineBelow ? "valor-footer-bar--line-below" : "",
    desktop ? "" : "valor-footer-bar--no-desktop",
    onPhone ? "" : "valor-footer-bar--no-phone",
  ]
    .filter(Boolean)
    .join(" ");
  return `<div class="shopify-section shopify-section-group-footer-group"><div class="${classes}" id="${id}" style="--fb-padding-top: ${paddingTop}px; --fb-padding-bottom: ${paddingBottom}px; --fb-row-gap: ${rowGap}px;"><div class="valor-footer-bar__inner">${rows}</div></div></div>`;
}

/* A page with the theme's styles. `body` is what stands inside the layout's
   <footer class="valor-footer-group">; `variables` are extra declarations
   for :root (a changed theme setting) and `css` whole rules (a colour scheme's
   variables are set on its class). */
async function open(
  browser,
  t,
  {
    body,
    width = 1440,
    height = 900,
    dir = "ltr",
    variables = "",
    scripts = "",
    css = "",
    media,
    footerStyles = true,
  } = {},
) {
  const page = await browser.newPage({ viewport: { width, height } });
  t.after(() => page.close());
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.errors = errors;
  if (media) await page.emulateMedia(media);
  await page.setContent(`<!doctype html><html dir="${dir}" lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${themeCss({ footerStyles })} :root { ${variables} } ${css}</style></head><body>
    <a href="#top" id="before">Before</a>
    <main id="MainContent"><div class="shopify-section"><div class="color-scheme-1" style="height: 120px">Page</div></div></main>
    <footer class="valor-footer-group">${body}</footer>
    <a href="#end" id="after-all">After</a>
    ${scripts}
  </body></html>`);
  return page;
}

// Boxes of elements by id, rounded to a tenth of a pixel.
const boxes = (page, ids) =>
  page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      const round = (n) => Math.round(n * 10) / 10;
      out[id] = {
        left: round(r.left),
        right: round(r.right),
        top: round(r.top),
        bottom: round(r.bottom),
        width: round(r.width),
        height: round(r.height),
        centre: round(r.left + r.width / 2),
        display: getComputedStyle(el).display,
      };
    }
    return out;
  }, ids);

const near = (actual, expected, tolerance = 0.6) => Math.abs(actual - expected) <= tolerance;

// The colour of one screen pixel (a 1×1 screenshot: no PNG filter can change
// a lone pixel's bytes, so the inflated row is filter byte + RGB(A)).
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

// The schema of a section file, parsed.
const schemaOf = (file) => JSON.parse(read(file).match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);

// ---------------------------------------------------------------------------
// The Footer section (sections/footer.liquid)
// ---------------------------------------------------------------------------

const slug = (text) => text.toLowerCase().replace(/\W+/g, "-");
const socialList = (extra = "") =>
  `<ul class="valor-social-icons valor-footer__social${extra}" role="list">${["Instagram", "Facebook", "TikTok"]
    .map(
      (name) =>
        `<li class="valor-social-icons__item"><a href="#${name}" class="valor-social-icons__link"><span class="valor-social-icons__icon" aria-hidden="true"><svg viewBox="0 0 20 20"></svg></span><span class="visually-hidden">${name}</span></a></li>`,
    )
    .join("")}</ul>`;
const footerSelector = (text) =>
  `<valor-localization-form class="valor-localization valor-localization--align-left valor-localization--align-up"><form class="valor-localization__form"><div class="valor-localization__disclosure"><button type="button" class="valor-localization__select" aria-expanded="false"><span>${text}</span><span class="valor-localization__chevron" aria-hidden="true"><svg viewBox="0 0 10 6" width="10" height="6"></svg></span></button><div class="valor-localization__panel" hidden></div></div></form></valor-localization-form>`;

const DEFAULT_COLUMNS = [
  { type: "link_list", heading: "Quick links", links: ["Search", "Contact", "Shipping"] },
  {
    type: "text",
    heading: "About us",
    text: "Share contact information, store details, and brand content with your customers.",
  },
];

/* One column. Whether it folds on a phone is what the section works out
   from "Columns on phones": menus (the default) folds menu columns, all
   folds every column that has a heading too, none folds nothing. */
function footerColumn(column, index, mode) {
  const { type, heading = "", links = [], text = "", menuTitle = "Footer menu" } = column;
  const id = `FooterColumn-b${index + 1}`;
  const fold = mode === "none" ? false : type === "link_list" ? true : mode === "all" && !!heading;
  // The heading is rich text: its plain form goes in the button (strip_html).
  const foldingHeading = `<h3 class="valor-footer__heading">${
    heading ? `<span class="valor-footer__heading-text">${heading}</span>` : ""
  }<button type="button" class="valor-footer__heading-button" aria-expanded="false" aria-controls="${id}"${
    !heading && type === "link_list" ? ` aria-label="${menuTitle}"` : ""
  }>${heading ? `<span>${heading.replace(/<[^>]*>/g, "")}</span>` : ""}<span class="valor-footer__heading-toggle" aria-hidden="true"></span></button></h3>`;
  const plainHeading = heading ? `<h3 class="valor-footer__block-heading">${heading}</h3>` : "";
  let inner = "";
  if (type === "link_list") {
    const list = `<ul class="valor-footer__menu${fold ? " valor-footer__panel" : ""}" id="${id}" role="list">${links
      .map((link) => `<li><a href="#${slug(link)}" class="valor-footer__menu-link">${link}</a></li>`)
      .join("")}</ul>`;
    const menuHeading = `<h3 class="valor-footer__heading">${
      heading ? `<span class="valor-footer__heading-text">${heading}</span>` : ""
    }</h3>`;
    inner = (fold ? foldingHeading : menuHeading) + list;
  } else {
    const body =
      type === "social"
        ? socialList(" valor-footer__social--column")
        : `<div class="valor-footer__text rte"><p>${text}</p></div>`;
    inner = fold ? `${foldingHeading}<div class="valor-footer__panel" id="${id}">${body}</div>` : plainHeading + body;
  }
  return `<div class="valor-footer__block valor-footer__block--${type}${
    fold ? " valor-footer__block--foldable" : ""
  }" id="column-${index + 1}">${inner}</div>`;
}

// Mirrors sections/footer.liquid with the given settings (defaults = the section's defaults).
function footerMarkup({
  columns = DEFAULT_COLUMNS,
  mobileColumns = "menus",
  headingStyle = "theme",
  newsletter = true,
  social = true,
  country = true,
  language = true,
  payment = true,
  copyright = true,
  copyrightHtml = "",
  policies = ["Privacy policy", "Refund policy"],
  showPolicy = true,
  legal = true,
  scheme = "scheme-1",
} = {}) {
  const top =
    columns.length || newsletter || social
      ? `<div class="valor-footer__top">${
          columns.length
            ? `<div class="valor-footer__blocks valor-footer__blocks--cols-${Math.min(columns.length, 4)}">${columns
                .map((column, index) => footerColumn(column, index, mobileColumns))
                .join("")}</div>`
            : ""
        }${
          newsletter || social
            ? `<div class="valor-footer__newsletter-side">${
                newsletter
                  ? `<h3 class="valor-footer__block-heading">Subscribe to our emails</h3>
            <form class="valor-footer__newsletter-form"><div class="valor-footer__newsletter-field">
              <label for="NewsletterForm" class="visually-hidden">Email</label>
              <input id="NewsletterForm" type="email" class="valor-footer__newsletter-input" placeholder="Email">
              <button type="submit" class="valor-button valor-button--primary valor-footer__newsletter-button">Subscribe</button>
            </div></form>`
                  : ""
              }${social ? `<div class="valor-footer__social-group">${socialList()}</div>` : ""}</div>`
            : ""
        }</div>`
      : "";
  const copyrightRow = copyright || (showPolicy && policies.length) || legal;
  const bottom =
    copyrightRow || country || language || payment
      ? `<div class="valor-footer__bottom"><div class="valor-footer__bottom-row"><div class="valor-footer__localization">${
          country ? footerSelector("Finland | EUR €") : ""
        }${language ? footerSelector("English") : ""}</div>${
          payment
            ? `<ul class="valor-footer__payment" role="list">${'<li class="valor-footer__payment-item"><svg class="valor-footer__payment-icon" viewBox="0 0 38 24" width="38" height="24"></svg></li>'.repeat(4)}</ul>`
            : ""
        }</div>${
          copyrightRow
            ? `<div class="valor-footer__copyright">${
                copyright
                  ? `<span class="valor-footer__copyright-text">${
                      copyrightHtml || '&copy; 2026, <a href="/" title="">Valor Demo Store</a>'
                    }</span>`
                  : ""
              }${
                showPolicy
                  ? `<ul class="valor-footer__policies" role="list">${policies
                      .map((policy) => `<li><a href="#${slug(policy)}">${policy}</a></li>`)
                      .join("")}</ul>`
                  : ""
              }${
                legal
                  ? '<button type="button" class="valor-legal-guarantee-trigger valor-footer__legal-guarantee">Your legal guarantee rights</button>'
                  : ""
              }</div>`
            : ""
        }</div>`
      : "";
  return `<div class="shopify-section shopify-section-group-footer-group"><div class="color-${scheme} valor-footer${
    headingStyle === "uppercase" ? " valor-footer--headings-uppercase" : ""
  }${mobileColumns === "all" ? " valor-footer--fold-all" : ""}" id="footer" style="--valor-footer-padding-top: 36px; --valor-footer-padding-bottom: 36px; --valor-footer-margin-top: 0px; --valor-footer-social-size: 1;">${top}${bottom}</div></div>`;
}

// The Footer bar section's inline script (the focus of an item that one device hides).
const barScript = () => {
  const match = read("sections", "footer-bar.liquid").match(/<script>([\s\S]*?)<\/script>/);
  return `<script>${match ? match[1] : ""}</script>`;
};

// The section's own inline script (the folding columns on phones).
const footerScript = (source = read("sections", "footer.liquid")) => {
  const match = source.match(/<script>([\s\S]*?)<\/script>/);
  return `<script>${match ? match[1] : ""}</script>`;
};

/* Where the footer's parts are, measured from the footer's own top left
   corner. Used to hold the section to what the released footer draws. */
const footerMetrics = (page) =>
  page.evaluate(() => {
    const footer = document.querySelector(".valor-footer");
    const origin = footer.getBoundingClientRect();
    const round = (n) => Math.round(n * 10) / 10;
    const box = (selector, index = 0) => {
      const el = document.querySelectorAll(selector)[index];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [round(r.left - origin.left), round(r.top - origin.top), round(r.width), round(r.height)];
    };
    const size = (selector) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el).fontSize : null;
    };
    return {
      footer: [round(origin.width), round(origin.height)],
      column1: box(".valor-footer__block", 0),
      column2: box(".valor-footer__block", 1),
      menuHeading: box(".valor-footer__heading"),
      menu: box(".valor-footer__menu"),
      firstLink: box(".valor-footer__menu-link"),
      textHeading: box(".valor-footer__block-heading"),
      text: box(".valor-footer__text"),
      newsletter: box(".valor-footer__newsletter-side"),
      // The button's width follows its text style, and the field beside it takes the rest.
      field: box(".valor-footer__newsletter-field"),
      inputHeight: box(".valor-footer__newsletter-input")[3],
      buttonHeight: box(".valor-footer__newsletter-button")[3],
      socialGroup: box(".valor-footer__social-group"),
      bottom: box(".valor-footer__bottom"),
      localization: box(".valor-footer__localization"),
      payment: box(".valor-footer__payment"),
      copyright: box(".valor-footer__copyright"),
      policies: box(".valor-footer__policies"),
      sizes: [
        size(".valor-footer__heading"),
        size(".valor-footer__menu-link"),
        size(".valor-footer__block-heading"),
        size(".valor-footer__text"),
        size(".valor-footer__newsletter-input"),
        size(".valor-footer__copyright"),
      ],
    };
  });

module.exports = {
  engine,
  root,
  read,
  stylesheetOf,
  themeCss,
  textItem,
  menuItem,
  barMarkup,
  barScript,
  open,
  boxes,
  near,
  pixel,
  schemaOf,
  footerMarkup,
  footerScript,
  footerMetrics,
  DEFAULT_COLUMNS,
};
