const { test } = require("node:test");
const assert = require("node:assert/strict");
const { read, schemaOf, stylesheetOf } = require("./footer-fixture.cjs");

// Source-level checks of the Footer bar section, the Footer section, the
// selector snippets and the layout: what Liquid prints cannot run locally,
// so the rules that matter are pinned on the source.
const bar = () => read("sections", "footer-bar.liquid");
const barSchema = () => schemaOf("sections/footer-bar.liquid");
const schemaStrings = JSON.parse(read("locales", "en.default.schema.json"));

const byId = (settings) => Object.fromEntries(settings.filter((s) => s.id).map((s) => [s.id, s]));
const lookUp = (key) => key.split(".").reduce((node, part) => (node == null ? node : node[part]), schemaStrings);

// Every "t:…" string in a schema, wherever it is.
function translationKeys(node, out = []) {
  if (typeof node === "string") {
    if (node.startsWith("t:")) out.push(node.slice(2));
  } else if (Array.isArray(node)) {
    node.forEach((child) => translationKeys(child, out));
  } else if (node && typeof node === "object") {
    Object.values(node).forEach((child) => translationKeys(child, out));
  }
  return out;
}

// The part of the section's Liquid that renders one block type.
function blockBranch(source, type) {
  const start = source.indexOf(`when '${type}'`);
  assert.ok(start >= 0, `no branch for ${type}`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\bwhen '|\bendcase\b/);
  return rest.slice(0, end);
}

test("footer bar: can only be added to the footer group, and comes with a ready-made preset", () => {
  const schema = barSchema();
  assert.deepEqual(schema.enabled_on, { groups: ["footer"] });
  assert.equal(schema.presets.length, 1);
  const blocks = schema.presets[0].blocks;
  assert.deepEqual(
    blocks.map((block) => [block.type, block.settings && block.settings.position]),
    [
      ["text", "left"],
      ["payment", "right"],
    ],
  );
});

test("footer bar: the section's settings and their defaults", () => {
  const settings = byId(barSchema().settings);
  const defaults = Object.fromEntries(Object.entries(settings).map(([id, setting]) => [id, setting.default]));
  assert.deepEqual(defaults, {
    color_scheme: "scheme-1",
    width: "page",
    line_above: true,
    line_below: false,
    text_size: "small",
    phone_alignment: "center",
    row_gap: 12,
    padding_top: 20,
    padding_bottom: 20,
  });
  assert.deepEqual(
    settings.width.options.map((o) => o.value),
    ["page", "full"],
  );
  assert.deepEqual(
    settings.text_size.options.map((o) => o.value),
    ["small", "normal"],
  );
  assert.deepEqual(
    settings.phone_alignment.options.map((o) => o.value),
    ["center", "left"],
  );
  assert.deepEqual([settings.row_gap.min, settings.row_gap.max, settings.row_gap.step], [0, 40, 4]);
  for (const id of ["padding_top", "padding_bottom"]) {
    assert.deepEqual([settings[id].min, settings[id].max, settings[id].step], [0, 100, 4], id);
  }
});

test("footer bar: every block has the same three placement settings", () => {
  for (const block of barSchema().blocks) {
    const settings = byId(block.settings);
    assert.deepEqual(
      [settings.position.default, settings.position.options.map((o) => o.value)],
      ["center", ["left", "center", "right"]],
      block.type,
    );
    assert.deepEqual(
      [settings.row.default, settings.row.options.map((o) => o.value)],
      ["1", ["1", "2", "3"]],
      block.type,
    );
    assert.deepEqual(
      [settings.visibility.default, settings.visibility.options.map((o) => o.value)],
      ["all", ["all", "desktop", "phone"]],
      block.type,
    );
  }
});

test("footer bar: the Text, Menu, Policy links and Payment icons blocks", () => {
  const blocks = Object.fromEntries(barSchema().blocks.map((block) => [block.type, block]));
  const own = (type) =>
    Object.fromEntries(
      blocks[type].settings
        .filter((s) => s.id && !["position", "row", "visibility"].includes(s.id))
        .map((s) => [s.id, [s.type, s.default]]),
    );
  assert.deepEqual(own("text"), { text: ["inline_richtext", "© [year] [shop_name]"] });
  assert.deepEqual(own("menu"), { menu: ["link_list", "footer"] });
  assert.deepEqual(own("policies"), {});
  assert.deepEqual(own("payment"), {});
});

test("footer bar: every editor string comes from the schema locale file", () => {
  const keys = translationKeys(barSchema());
  assert.ok(keys.length > 20, `the schema is translated through keys (${keys.length})`);
  const missing = keys.filter((key) => typeof lookUp(key) !== "string");
  assert.deepEqual(missing, []);
  const literal = [];
  (function walk(node, trail) {
    if (Array.isArray(node)) return node.forEach((child, i) => walk(child, `${trail}[${i}]`));
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (
          ["name", "label", "info", "content"].includes(key) &&
          typeof value === "string" &&
          !value.startsWith("t:")
        ) {
          literal.push(`${trail}.${key}: ${value}`);
        }
        walk(value, `${trail}.${key}`);
      }
    }
  })(barSchema(), "schema");
  assert.deepEqual(literal, []);
});

test("footer bar: the stylesheet is its own file, loaded by the section", () => {
  assert.match(bar(), /{{\s*'footer-bar\.css'\s*\|\s*asset_url\s*\|\s*stylesheet_tag\s*}}/);
  assert.doesNotMatch(bar(), /{%-?\s*stylesheet\s*-?%}/);
});

// The bar is laid out by its stylesheet alone. Its one script only keeps the
// keyboard focus when a device hides an item, and is printed for a bar that
// has such an item.
test("footer bar: the script is printed only for a bar with an item for one device, and answers once", () => {
  const source = bar();
  assert.equal((source.match(/<script/g) || []).length, 1);
  const at = source.indexOf("<script");
  assert.match(source.slice(at - 60, at), /{%-?\s*if bar_devices\s*-?%}\s*$/);
  assert.match(source, /assign bar_devices = false/);
  for (const visibility of ["desktop", "phone"]) {
    const branch = source.slice(source.indexOf(`block.settings.visibility == '${visibility}'`));
    const end = branch.search(/\n\s*(elsif|else)\b/);
    assert.match(branch.slice(0, end), /assign bar_devices = true/, visibility);
  }
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(script, /if \(window\.valorFooterBarFocus\) return;/);
});

test("footer bar: the text block fills in the year and the shop's name, escaped once", () => {
  const branch = blockBranch(bar(), "text");
  assert.match(branch, /replace:\s*'\[year\]',\s*bar_year/);
  assert.match(branch, /replace:\s*'\[shop_name\]',\s*bar_shop_name/);
  assert.match(bar(), /assign bar_year = 'now' \| date: '%Y'/);
  assert.match(bar(), /assign bar_shop_name = shop\.name \| escape/);
  assert.doesNotMatch(
    branch,
    /\|\s*escape/,
    "rich text from the editor is already markup: escaping it again would show tags",
  );
});

test("footer bar: the menu is a navigation landmark named by the menu, with its top-level links", () => {
  const branch = blockBranch(bar(), "menu");
  assert.match(branch, /<nav[^>]*aria-label="{{ block\.settings\.menu\.title \| escape }}"/);
  assert.match(branch, /for link in block\.settings\.menu\.links/);
  assert.match(branch, /{{-? link\.title \| escape -?}}/);
  assert.doesNotMatch(branch, /link\.links/, "no sub-menus");
});

test("footer bar: a block that has nothing to show prints no item", () => {
  const source = bar();
  // The item's wrapper is printed from the captured content, and only when
  // that is not blank.
  assert.match(source, /{%-?\s*capture item_content\s*-?%}/);
  assert.match(source, /if item_content != blank/);
  const wrapper = source.indexOf('class="valor-footer-bar__item ');
  assert.ok(wrapper > source.indexOf("if item_content != blank"), "the wrapper sits inside that condition");
  assert.match(blockBranch(source, "menu"), /block\.settings\.menu\.links\.size > 0/);
  assert.match(blockBranch(source, "payment"), /shop\.enabled_payment_types\.size > 0/);
  assert.match(blockBranch(source, "text"), /block\.settings\.text != blank/);
});

test("footer bar: the device classes are worked out before the root is printed", () => {
  const source = bar();
  const rows = source.indexOf("capture bar_rows");
  const rootElement = source.indexOf("valor-footer-bar valor-footer-bar--text-");
  assert.ok(rows >= 0 && rootElement > rows, "rows are captured first");
  for (const name of [
    "valor-footer-bar--no-desktop",
    "valor-footer-bar--no-phone",
    "valor-footer-bar__row--no-desktop",
  ]) {
    assert.ok(source.includes(name), name);
  }
  assert.match(source, /--fb-order: {{ forloop\.index }}/, "an item's phone order is its place in the editor");
});

// The settings of a block type that are its own (not the three placement ones).
const ownSettings = (type) => {
  const block = barSchema().blocks.find((candidate) => candidate.type === type);
  assert.ok(block, `no ${type} block`);
  return Object.fromEntries(
    block.settings
      .filter((s) => s.id && !["position", "row", "visibility"].includes(s.id))
      .map((s) => [s.id, [s.type, s.default]]),
  );
};

test("footer bar: the Logo block uses the theme's logo and logo heights unless told otherwise", () => {
  assert.deepEqual(ownSettings("logo"), {
    image: ["image_picker", undefined],
    size: ["select", "theme"],
    width: ["range", 150],
  });
  const width = barSchema()
    .blocks.find((block) => block.type === "logo")
    .settings.find((s) => s.id === "width");
  assert.deepEqual([width.min, width.max, width.step], [40, 400, 10]);
  const branch = blockBranch(bar(), "logo");
  assert.match(branch, /assign logo_image = block\.settings\.image \| default: settings\.logo/);
  assert.match(branch, /href="{{ routes\.root_url }}"/);
  assert.match(branch, /--fb-logo-height: {{ settings\.logo_height }}px/);
  assert.match(branch, /--fb-logo-height-phone: {{ settings\.logo_height_mobile \| default: 32 }}px/);
  assert.match(branch, /--fb-logo-width: {{ block\.settings\.width }}px/);
  // image_tag drops the alt attribute when it is handed nil.
  assert.match(branch, /assign logo_alt = logo_image\.alt \| default: shop\.name/);
  assert.match(branch, /alt: logo_alt/);
  assert.match(
    branch,
    /valor-footer-bar__logo--text[^>]*>\s*{{-? shop\.name \| escape -?}}/,
    "no logo: the shop's name",
  );
});

test("footer bar: the Social icons block shows the theme's accounts, and nothing when there are none", () => {
  assert.deepEqual(ownSettings("social"), { size: ["select", "medium"] });
  const branch = blockBranch(bar(), "social");
  assert.match(branch, /render 'social-icons', class: 'valor-footer-bar__social'/);
  assert.match(branch, /if social_icons contains 'valor-social-icons__item'/);
  assert.match(branch, /--valor-footer-social-size:/);
});

test("footer bar: the Legal guarantee link block depends on the notice image only", () => {
  assert.deepEqual(ownSettings("legal_guarantee"), {});
  const branch = blockBranch(bar(), "legal_guarantee");
  assert.match(branch, /render 'legal-guarantee-notice', mode: 'trigger', class: 'valor-footer-bar__legal'/);
  assert.doesNotMatch(bar(), /legal_guarantee_show_in_footer/);
  // The snippet prints nothing until a notice image is uploaded, and the
  // layout always renders the pop-up the link opens.
  assert.match(
    read("snippets", "legal-guarantee-notice.liquid"),
    /Renders nothing when no notice image has been uploaded/,
  );
  assert.match(read("layout", "theme.liquid"), /render 'legal-guarantee-notice', mode: 'dialog'/);
  const themeSettings = JSON.parse(read("config", "settings_schema.json"));
  const setting = themeSettings
    .flatMap((group) => group.settings || [])
    .find((s) => s.id === "legal_guarantee_show_in_footer");
  assert.match(setting.info, /Footer section/, "the theme setting says which link it is about");
  assert.match(setting.info, /Footer bar/);
});

// ---------------------------------------------------------------------------
// Country and language selectors
// ---------------------------------------------------------------------------

const countrySnippet = () => read("snippets", "country-localization.liquid");
const languageSnippet = () => read("snippets", "language-localization.liquid");

test("selector snippets: the new options are off unless asked for, so today's callers print what they did", () => {
  const country = countrySnippet();
  // false has to stay false: a plain `default: true` would turn it back on.
  assert.match(country, /assign selector_show_currency = show_currency \| default: true, allow_false: true/);
  assert.match(country, /assign selector_show_arrow = show_arrow \| default: true, allow_false: true/);
  assert.match(languageSnippet(), /assign selector_show_arrow = show_arrow \| default: true, allow_false: true/);
  // The button's text as it was on main, now inside the currency condition.
  assert.match(
    country,
    /{{- localization\.country\.name }} \|\s+{{ localization\.country\.currency\.iso_code }}\s+{{ localization\.country\.currency\.symbol -}}/,
  );
  assert.match(
    country,
    /{%- if label != blank -%}\s*<span class="valor-localization__label">{{ label \| escape }}<\/span>/,
  );
  assert.match(country, /{%- if show_flag -%}/);
  for (const [file, source] of [
    ["sections/footer.liquid", read("sections", "footer.liquid")],
    ["sections/header.liquid", read("sections", "header.liquid")],
  ]) {
    const calls = source.match(/render '(country|language)-localization'[^%]*%}/g) || [];
    assert.ok(calls.length > 0, `${file} renders the selectors`);
    for (const call of calls) assert.doesNotMatch(call, /label|show_/, `${file}: ${call}`);
  }
});

test("selector snippets: the flag is the country's own image, and decorative", () => {
  const country = countrySnippet();
  assert.match(country, /localization\.country\s*\|\s*image_url: width: 32/);
  assert.match(country, /class: 'valor-localization__flag'/);
  assert.match(country, /alt: ''/, "the country's name is right beside it");
});

test("footer bar: the Country and Language selector blocks", () => {
  const blocks = Object.fromEntries(barSchema().blocks.map((block) => [block.type, block]));
  assert.deepEqual(ownSettings("country"), {
    label: ["text", undefined],
    show_flag: ["checkbox", false],
    show_currency: ["checkbox", true],
    show_arrow: ["checkbox", true],
  });
  assert.deepEqual(ownSettings("language"), { show_arrow: ["checkbox", true] });
  assert.deepEqual([blocks.country.limit, blocks.language.limit], [1, 1], "one long list per bar is enough");

  const country = blockBranch(bar(), "country");
  assert.match(country, /if localization\.available_countries\.size > 1/);
  assert.match(country, /assign selector_position = 'FooterBarCountry-' \| append: block\.id/);
  assert.match(country, /form 'localization', id: selector_form, class: 'valor-localization__form'/);
  assert.match(country, /id="{{ selector_position }}Label"/);
  assert.match(
    country,
    /render 'country-localization',\s*localPosition: selector_position,\s*label: block\.settings\.label,\s*show_flag: block\.settings\.show_flag,\s*show_currency: block\.settings\.show_currency,\s*show_arrow: block\.settings\.show_arrow/,
  );
  const language = blockBranch(bar(), "language");
  assert.match(language, /if localization\.available_languages\.size > 1/);
  assert.match(language, /assign selector_position = 'FooterBarLanguage-' \| append: block\.id/);
  assert.match(
    language,
    /render 'language-localization',\s*localPosition: selector_position,\s*show_arrow: block\.settings\.show_arrow/,
  );
  for (const branch of [country, language]) {
    assert.match(branch, /valor-localization valor-localization--align-up valor-localization--sheet/);
    assert.match(branch, /{% if zone == 'left' %} valor-localization--align-left{% endif %}/);
  }
});

test("selector styles: the phone sheet also applies to a selector marked for it, wherever it opens on a desktop", () => {
  const header = read("sections", "header.liquid");
  assert.match(
    header,
    /\.valor-localization--align-left\.valor-localization--align-up \.valor-localization__panel,\s*\.valor-localization--sheet \.valor-localization__panel \{\s*position: fixed;/,
  );
});

// ---------------------------------------------------------------------------
// The Footer section's additions
// ---------------------------------------------------------------------------

const footer = () => read("sections", "footer.liquid");
const footerSchema = () => schemaOf("sections/footer.liquid");
const footerCss = () => stylesheetOf("sections/footer.liquid");

test("footer: the new settings default to what the footer has always shown", () => {
  const settings = byId(footerSchema().settings);
  assert.deepEqual(
    ["show_copyright", "copyright_text", "heading_style", "mobile_columns"].map((id) => [
      settings[id].type,
      settings[id].default,
    ]),
    [
      ["checkbox", true],
      ["inline_richtext", undefined],
      ["select", "theme"],
      ["select", "menus"],
    ],
  );
  assert.deepEqual(
    settings.heading_style.options.map((o) => o.value),
    ["theme", "uppercase"],
  );
  assert.deepEqual(
    settings.mobile_columns.options.map((o) => o.value),
    ["menus", "all", "none"],
  );
  // The settings the footer already had are all still there, with their defaults.
  const kept = {
    color_scheme: "scheme-1",
    newsletter_enable: true,
    newsletter_heading: "Subscribe to our emails",
    enable_follow_on_shop: true,
    show_social: true,
    social_icon_size: "medium",
    enable_country_selector: true,
    enable_language_selector: true,
    payment_enable: true,
    show_policy: true,
    margin_top: 0,
    padding_top: 36,
    padding_bottom: 36,
  };
  for (const [id, value] of Object.entries(kept)) assert.equal(settings[id].default, value, id);
  assert.ok("social_heading" in settings);
  assert.deepEqual(
    footerSchema().blocks.map((block) => block.type),
    ["link_list", "brand_information", "text", "image", "social"],
    "the four column blocks, and the new one after them",
  );
  const social = footerSchema().blocks.find((block) => block.type === "social");
  assert.deepEqual([social.limit, byId(social.settings).heading.default], [1, "Follow us"]);
  assert.deepEqual(
    footerSchema().default,
    { blocks: [{ type: "link_list" }, { type: "text" }] },
    "a new footer starts as before",
  );
});

test("footer: the default copyright line is the released one, and an own text fills in its tokens", () => {
  const source = footer();
  assert.match(source, /&copy; {{ 'now' \| date: '%Y' }}, {{ shop\.name \| link_to: routes\.root_url -}}/);
  assert.match(source, /if section\.settings\.copyright_text != blank/);
  assert.match(
    source,
    /section\.settings\.copyright_text\s*\|\s*replace: '\[year\]', footer_year\s*\|\s*replace: '\[shop_name\]', footer_shop_name/,
  );
  assert.match(source, /assign footer_year = 'now' \| date: '%Y'/);
  assert.match(source, /assign footer_shop_name = shop\.name \| escape/);
});

test("footer: the lower part is only printed when one of its parts is", () => {
  const source = footer();
  const flags = source.slice(
    source.indexOf("assign show_bottom"),
    source.indexOf('<div class="valor-footer__bottom">'),
  );
  assert.match(source, /assign show_copyright_row = false/);
  assert.match(source, /if section\.settings\.show_copyright or show_policies or show_legal/);
  assert.match(flags, /if show_copyright_row or show_country or show_language or show_payment/);
  assert.match(source, /{%-? if show_bottom -?%}\s*<div class="valor-footer__bottom">/);
  assert.match(source, /{%-? if show_copyright_row -?%}\s*<div class="valor-footer__copyright">/);
  // What each flag stands for.
  assert.match(source, /if section\.settings\.enable_country_selector and localization\.available_countries\.size > 1/);
  assert.match(
    source,
    /if section\.settings\.enable_language_selector and localization\.available_languages\.size > 1/,
  );
  assert.match(source, /if section\.settings\.payment_enable and shop\.enabled_payment_types\.size > 0/);
  assert.match(source, /if settings\.legal_guarantee_show_in_footer and settings\.legal_guarantee_notice != blank/);
});

test("footer: which columns fold on phones", () => {
  const source = footer();
  const rule = source.slice(source.indexOf("assign column_folds = false"), source.indexOf("assign column_id"));
  assert.ok(rule.length > 50, "the rule is worked out per column");
  // A menu folds unless nothing does; any other column with a heading folds when all do.
  assert.match(rule, /if section\.settings\.mobile_columns != 'none'/);
  assert.match(rule, /if block\.type == 'link_list'/);
  assert.match(rule, /elsif section\.settings\.mobile_columns == 'all' and block\.settings\.heading != blank/);
  assert.match(source, /assign column_id = 'FooterColumn-' \| append: block\.id/);
  assert.match(source, /{% if section\.settings\.mobile_columns == 'all' %} valor-footer--fold-all{% endif %}/);
  assert.match(
    source,
    /valor-footer__block--{{ block\.type }}{% if column_folds %} valor-footer__block--foldable{% endif %}/,
  );
});

test("footer: a folding heading holds a real button that names what it opens", () => {
  const source = footer();
  assert.doesNotMatch(source, /onclick=/, "no inline handler");
  assert.doesNotMatch(source, /valorToggleFooterColumn/, "and no global function");
  assert.match(
    source,
    /<button\s+type="button"\s+class="valor-footer__heading-button"\s+aria-expanded="false"\s+aria-controls="{{ column_id }}"/,
  );
  assert.match(
    source,
    /aria-label="{{ block\.settings\.menu\.title \| escape }}"/,
    "a menu without a heading is named by its menu",
  );
  assert.match(
    source,
    /class="valor-footer__menu{% if column_folds %} valor-footer__panel{% endif %}"\s+id="{{ column_id }}"/,
  );
  // The script answers clicks on the buttons, once however often it is loaded.
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(script, /closest\(['"]\.valor-footer__heading-button['"]\)/);
  assert.match(script, /setAttribute\(['"]aria-expanded['"]/);
  assert.match(script, /if \(window\.valorFooterColumns\) return;/);
});

test("footer: the root is a div, and the layout wraps the whole footer group in the one footer landmark", () => {
  const source = footer();
  assert.doesNotMatch(source, /<footer|<\/footer>/);
  assert.match(source, /^<div\s+class="color-{{ section\.settings\.color_scheme }} valor-footer/m);
  const layout = read("layout", "theme.liquid");
  assert.match(layout, /<footer class="valor-footer-group">\s*{% sections 'footer-group' %}\s*<\/footer>/);
  assert.equal((layout.match(/<footer/g) || []).length, 1);
  assert.doesNotMatch(read("sections", "footer-bar.liquid"), /<footer/);
});

test("footer: the Subscribe button is the theme's shared button", () => {
  assert.match(footer(), /class="valor-button valor-button--primary valor-footer__newsletter-button"/);
  const rules = footerCss().match(/[^{}]*\.valor-footer__newsletter-button[^{}]*\{[^}]*\}/g) || [];
  const declared = rules.join("\n");
  for (const property of [
    "background",
    "color:",
    "border",
    "font-size",
    "font-weight",
    "text-transform",
    "letter-spacing",
    "opacity",
  ]) {
    assert.ok(!declared.includes(property), `the footer no longer sets the button's ${property}`);
  }
  assert.match(declared, /padding: 0 1rem/, "its compact padding stays");
});

// ---------------------------------------------------------------------------
// Nothing in the footer's or the bar's styles overrides a theme setting
// ---------------------------------------------------------------------------

for (const [name, css] of [
  ["sections/footer.liquid", () => stylesheetOf("sections/footer.liquid")],
  ["assets/footer-bar.css", () => read("assets", "footer-bar.css")],
]) {
  test(`${name}: fonts, text sizes and colours come from the theme's variables only`, () => {
    const source = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const families = (source.match(/font-family:[^;]+;/g) || []).filter(
      (declaration) => !/var\(--font-(heading|body)--family\)|inherit/.test(declaration),
    );
    assert.deepEqual(families, [], "no font named in the file");
    const fonts = (source.match(/\bfont:[^;]+;/g) || []).filter((declaration) => !/inherit/.test(declaration));
    assert.deepEqual(fonts, []);
    assert.deepEqual(source.match(/font-size:\s*[\d.]+px/g) || [], [], "no text size in pixels");
    // A size the theme has a token for is taken from the token.
    const literal = source.match(/font-size:[^;]*?(?<![\w.-])(0\.75|0\.8125|0\.875|0\.9375|1|1\.125)rem[^;]*;/g) || [];
    assert.deepEqual(literal, []);
    assert.deepEqual(source.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [], [], "no colour written out");
    const named =
      source.match(/(?<![\w-])(color|background(-color)?|border(-[a-z-]+)?):\s*(black|white|gray|grey|red|blue)\b/g) ||
      [];
    assert.deepEqual(named, []);
  });
}

// ---------------------------------------------------------------------------
// Whole-change review
// ---------------------------------------------------------------------------

test("footer bar: each visibility raises the flags of its own device", () => {
  const source = bar();
  const desktop = source.match(
    /if block\.settings\.visibility == 'desktop'([\s\S]*?)elsif block\.settings\.visibility == 'phone'([\s\S]*?)else([\s\S]*?)endif/,
  );
  assert.ok(desktop, "the three branches");
  const [, onDesktop, onPhone, onBoth] = desktop;
  assert.match(onDesktop, /assign bar_desktop = true/);
  assert.match(onDesktop, /assign row_desktop = true/);
  assert.doesNotMatch(onDesktop, /bar_phone/);
  assert.match(onPhone, /assign bar_phone = true/);
  assert.doesNotMatch(onPhone, /bar_desktop|row_desktop|row_sides/);
  for (const flag of ["bar_desktop", "bar_phone", "row_desktop"])
    assert.match(onBoth, new RegExp(`assign ${flag} = true`), flag);
  // A row whose left and right zones hold nothing on a desktop gives the centre the whole row.
  assert.match(source, /assign row_sides = false/);
  assert.match(source, /{% unless row_sides %} valor-footer-bar__row--center-only{% endunless %}/);
});

test("footer bar: every width is either a phone or a desktop, in print too", () => {
  const css = read("assets", "footer-bar.css");
  const queries = [...css.matchAll(/@media ([^{]+)\{/g)].map((match) => match[1].trim());
  assert.ok(queries.length >= 4);
  for (const query of queries) {
    assert.ok(
      ["(min-width: 750px)", "not all and (min-width: 750px)", "(min-width: 990px)"].includes(query),
      `one condition and its exact opposite: ${query}`,
    );
  }
  assert.ok(queries.includes("(min-width: 750px)") && queries.includes("not all and (min-width: 750px)"));
});

test("footer: a link written into a folding heading is not put inside the button", () => {
  const source = footer();
  const button = source.slice(source.indexOf('class="valor-footer__heading-button"'), source.indexOf("</button>"));
  assert.match(button, /<span>{{ block\.settings\.heading \| strip_html }}<\/span>/);
  assert.match(
    source,
    /<span class="valor-footer__heading-text">{{ block\.settings\.heading }}<\/span>/,
    "the plain heading keeps it",
  );
});

test("the test page's size tokens are the theme's own", () => {
  const variables = read("snippets", "css-variables.liquid");
  const fixture = read("tests", "footer-fixture.cjs");
  const tokens = [...variables.matchAll(/(--font-size-(?:body-[a-z0-9]+|heading-(?:xs|sm))):\s*([^;]+);/g)];
  assert.ok(tokens.length >= 8, `tokens found: ${tokens.length}`);
  for (const [, name, value] of tokens) {
    const mirrored = fixture.match(new RegExp(`${name}:\\s*([^;]+);`));
    assert.ok(mirrored, `${name} is on the test page`);
    assert.equal(mirrored[1].replace(/\s+/g, " ").trim(), value.replace(/\s+/g, " ").trim(), name);
  }
});
