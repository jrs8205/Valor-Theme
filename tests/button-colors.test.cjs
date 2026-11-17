const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// Button colours of a section (snippets/button-colors.liquid), and the
// buttons that stand over a picture or a video. Three things are held
// together here:
//   1. the Liquid itself, read as text: which sections have the settings and
//      hand them to the snippet;
//   2. the snippet and the color scheme lines of snippets/css-variables.liquid,
//      run by the two small readers below (the theme has no Liquid engine in
//      its tests), so the real source decides what a button gets;
//   3. a page built from that output and the theme's real stylesheets, where
//      the colours a visitor sees are measured.
const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const sectionSource = (name) => read("sections", `${name}.liquid`);
const schemaOf = (name) => JSON.parse(sectionSource(name).match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);
const stylesheetOf = (name) => sectionSource(name).match(/{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/)[1];
const criticalCss = read("assets", "critical.css");
const variables = read("snippets", "css-variables.liquid");

// Sections whose own settings colour every button in them.
const SECTIONS = [
  "404",
  "article",
  "cart-drawer",
  "collection-list",
  "collection",
  "contact-form",
  "countdown-timer",
  "featured-collection",
  "featured-product",
  "footer",
  "image-banner",
  "image-with-text",
  "lookbook",
  "main-cart",
  "main-product",
  "newsletter",
  "password",
  "recently-viewed-products",
  "related-products",
  "rich-text",
  "search",
  "video",
];
// Sections where every slide or card has a picture of its own: the block
// has the settings.
const BLOCKS = { slideshow: "slide", "promo-grid": "promo" };
// Draws a button, has no settings: its markup is fetched into a Lookbook
// section and takes that section's colours.
const ELSEWHERE = ["lookbook-variant"];
const IDS = ["button_background_color", "button_text_color", "button_border_color"];
const LABELS = ["t:labels.button_background", "t:labels.button_text", "t:labels.button_border"];

// --- Reader 1: the snippet -------------------------------------------------
// snippets/button-colors.liquid is one {% liquid %} tag of assign / if /
// elsif / else / endif / echo with the filters downcase, strip, remove,
// default and append. This reads exactly that much Liquid.
function runSnippet(args) {
  const source = read("snippets", "button-colors.liquid");
  const body = source.match(/{%-\s*liquid([\s\S]*?)-%}/)[1];
  const rest = source
    .replace(/{%-\s*comment\s*-%}[\s\S]*?{%-\s*endcomment\s*-%}/, "")
    .replace(/{%-\s*liquid[\s\S]*?-%}/, "");
  assert.equal(rest.trim(), "", "the snippet is a comment and one liquid tag");
  const vars = Object.assign({}, args);
  const blank = (value) => value === undefined || value === null || value === "";
  const value = (token) => {
    token = token.trim();
    if (/^'.*'$/.test(token)) return token.slice(1, -1);
    if (token === "blank") return "";
    if (token === "true") return true;
    if (token === "false") return false;
    return vars[token];
  };
  const filtered = (expression) => {
    const [first, ...filters] = expression.split("|");
    let result = value(first);
    for (const filter of filters) {
      const at = filter.indexOf(":");
      const name = (at < 0 ? filter : filter.slice(0, at)).trim();
      const arg = at < 0 ? undefined : value(filter.slice(at + 1));
      const text = blank(result) ? "" : String(result);
      if (name === "downcase") result = text.toLowerCase();
      else if (name === "strip") result = text.trim();
      else if (name === "remove") result = text.split(arg).join("");
      else if (name === "append") result = text + (blank(arg) ? "" : String(arg));
      else if (name === "default") result = blank(result) || result === false ? arg : result;
      else throw new Error(`a filter this reader does not know: ${name}`);
    }
    return result;
  };
  const term = (text) => {
    const compare = text.match(/^(.*?)\s(!=|==)\s(.*)$/);
    if (!compare) {
      const single = value(text);
      return single !== undefined && single !== null && single !== false;
    }
    const [left, right] = [value(compare[1]), value(compare[3])];
    const same =
      compare[3].trim() === "blank"
        ? blank(left)
        : (blank(left) ? "" : String(left)) === (blank(right) ? "" : String(right));
    return compare[2] === "==" ? same : !same;
  };
  const condition = (text) => {
    assert.ok(!(/\sand\s/.test(text) && /\sor\s/.test(text)), "a condition mixes and with or");
    if (/\sor\s/.test(text)) return text.split(/\sor\s/).some(term);
    return text.split(/\sand\s/).every(term);
  };
  let output = "";
  // One entry per open if: has a branch run, and is the current one running.
  const stack = [];
  const live = () => stack.every((level) => level.running);
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let match;
    if ((match = line.match(/^if\s+(.*)$/))) {
      const outer = live();
      const hit = outer && condition(match[1]);
      stack.push({ outer, done: hit, running: hit });
    } else if ((match = line.match(/^elsif\s+(.*)$/))) {
      const level = stack[stack.length - 1];
      const hit = level.outer && !level.done && condition(match[1]);
      level.running = hit;
      level.done = level.done || hit;
    } else if (line === "else") {
      const level = stack[stack.length - 1];
      level.running = level.outer && !level.done;
      level.done = true;
    } else if (line === "endif") {
      stack.pop();
    } else if ((match = line.match(/^assign\s+(\w+)\s*=\s*(.*)$/))) {
      if (live()) vars[match[1]] = filtered(match[2]);
    } else if ((match = line.match(/^echo\s+(.*)$/))) {
      if (live()) output += filtered(match[1]);
    } else {
      throw new Error(`a line this reader does not know: ${line}`);
    }
  }
  assert.equal(stack.length, 0, "every if is closed");
  return output;
}

// The custom properties of a snippet's output, by name.
const declared = (output) =>
  Object.fromEntries([...output.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

// --- Reader 2: the scheme lines of snippets/css-variables.liquid -----------
// Every button token is one line: --name: {%- if a or b -%}X{%- elsif c -%}Y
// {%- else -%}Z{%- endif -%};
const isSet = (color) => {
  const plain = String(color || "")
    .toLowerCase()
    .trim()
    .split(" ")
    .join("");
  return plain !== "" && plain !== "transparent" && plain !== "rgba(0,0,0,0)";
};
function tokenLines() {
  const lines = {};
  for (const match of variables.matchAll(/^\s*(--color-button-[\w-]+):\s*({%-.*-%});\s*$/gm))
    lines[match[1]] = match[2];
  return lines;
}
function resolveLine(line, theme, scheme) {
  const flags = {
    button_bg_is_set: isSet(theme.button_background_color),
    button_text_is_set: isSet(theme.button_text_color),
    button_border_is_set: isSet(theme.button_border_color),
    button_hover_bg_is_set: isSet(theme.button_hover_background_color),
    button_hover_text_is_set: isSet(theme.button_hover_text_color),
    button_hover_border_is_set: isSet(theme.button_hover_border_color),
    button_outline_text_is_set: isSet(theme.button_outline_text_color),
    button_outline_hover_text_is_set: isSet(theme.button_outline_hover_text_color),
  };
  const out = (text) =>
    text.trim().replace(/{{\s*([\w.]+)\s*}}/g, (_, name) => {
      if (name.startsWith("settings.")) return theme[name.slice(9)];
      if (name === "scheme.settings.text") return scheme.text;
      if (name === "scheme.settings.background") return scheme.background;
      throw new Error(`an output this reader does not know: ${name}`);
    });
  const parts = line.split(/{%-\s*(if\s+[^%]*?|elsif\s+[^%]*?|else|endif)\s*-%}/).filter((part) => part !== "");
  let chosen = null;
  for (let i = 0; i < parts.length; i += 2) {
    const tag = parts[i];
    if (tag === "endif") break;
    const holds =
      tag === "else" ||
      tag
        .replace(/^(if|elsif)\s+/, "")
        .split(/\sor\s/)
        .some((flag) => {
          assert.ok(flag.trim() in flags, `a flag this reader does not know: ${flag}`);
          return flags[flag.trim()];
        });
    if (holds && chosen === null) chosen = out(parts[i + 1]);
  }
  return chosen;
}
// What the theme prints for one color scheme: the scheme's own block.
function schemeBlock(theme, scheme) {
  const lines = tokenLines();
  const declarations = [`--color-background: ${scheme.background};`, `--color-foreground: ${scheme.text};`];
  for (const [name, line] of Object.entries(lines)) {
    if (/^--color-button-(bg|hover-bg|outline-hover-bg)$/.test(name)) continue;
    declarations.push(`${name}: ${resolveLine(line, theme, scheme)};`);
  }
  return declarations.join(" ");
}
// The tokens that do not depend on the scheme (:root).
function rootBlock(theme) {
  const lines = tokenLines();
  const any = [
    "button_hover_background_color",
    "button_hover_text_color",
    "button_hover_border_color",
    "button_outline_hover_text_color",
  ].some((id) => isSet(theme[id]));
  return (
    ["--color-button-bg", "--color-button-hover-bg", "--color-button-outline-hover-bg"]
      .map((name) => `${name}: ${resolveLine(lines[name], theme, {})};`)
      .join(" ") + ` --button-hover-opacity: ${any ? 1 : 0.85}; --style-button-border-width: 1.5px;`
  );
}

const LIGHT = { background: "#ffffff", text: "#333333" };
const DARK = { background: "#141414", text: "#f5f4f2" };
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};
const CLEAR = "rgba(0, 0, 0, 0)";

// --- 1. The Liquid, read as text -------------------------------------------

test("every section that can draw a button has the settings, or is named as taking them from elsewhere", () => {
  const known = new Set([...SECTIONS, ...Object.keys(BLOCKS), ...ELSEWHERE]);
  const draws =
    /valor-button|--color-button-|render 'product-card'|render 'product-buy-buttons'|render 'lookbook-card'/;
  for (const file of fs.readdirSync(path.join(root, "sections"))) {
    if (!file.endsWith(".liquid")) continue;
    const name = file.replace(/\.liquid$/, "");
    if (draws.test(sectionSource(name)))
      assert.ok(known.has(name), `sections/${file} draws a button and is not in this test's lists`);
  }
});

for (const name of SECTIONS) {
  test(`sections/${name}.liquid: three optional colours under the color scheme, handed to the snippet on the section's root`, () => {
    const settings = schemaOf(name).settings;
    const at = settings.findIndex((setting) => setting.id === "color_scheme");
    assert.ok(at >= 0, "the section has a color scheme");
    const three = settings.slice(at + 1, at + 4);
    assert.deepEqual(
      three.map((setting) => setting.id),
      IDS,
    );
    assert.deepEqual(
      three.map((setting) => setting.label),
      LABELS,
    );
    for (const setting of three) {
      assert.equal(setting.type, "color");
      assert.ok(!("default" in setting), `${setting.id} is empty until a merchant picks a colour`);
    }
    assert.equal(three[0].info, "t:labels.button_colors_info");
    const rootTag = sectionSource(name).match(
      /<[\w-]+\s[^<]*?class="color-{{ section\.settings\.color_scheme }}[\s\S]*?\n?\s*>/,
    );
    assert.ok(rootTag, "the root element carries the scheme class");
    // A tag the formatter has laid out over several lines reads the same.
    assert.match(
      rootTag[0].replace(/\s+/g, " "),
      /{%-? render 'button-colors', background: section\.settings\.button_background_color, text: section\.settings\.button_text_color, border: section\.settings\.button_border_color(, attribute: true)? -?%}/,
    );
  });
}

for (const [name, type] of Object.entries(BLOCKS)) {
  test(`sections/${name}.liquid: every ${type} has the three colours, handed to the snippet on its own element`, () => {
    const schema = schemaOf(name);
    assert.ok(
      !schema.settings.some((setting) => IDS.includes(setting.id)),
      "not on the section: every picture is different",
    );
    const block = schema.blocks.find((entry) => entry.type === type);
    const ids = block.settings.map((setting) => setting.id);
    const at = ids.indexOf(IDS[0]);
    assert.deepEqual(ids.slice(at, at + 3), IDS);
    assert.ok(/button_style/.test(ids[at - 1]), "they follow the button's style");
    for (const setting of block.settings.slice(at, at + 3)) {
      assert.equal(setting.type, "color");
      assert.ok(!("default" in setting));
    }
    assert.equal(block.settings[at].info, "t:labels.button_colors_info");
    assert.match(
      sectionSource(name).replace(/\s+/g, " "),
      /{%-? render 'button-colors', background: block\.settings\.button_background_color, text: block\.settings\.button_text_color, border: block\.settings\.button_border_color(, attribute: true)? -?%}/,
    );
  });
}

test("the editor strings the settings use exist", () => {
  const labels = JSON.parse(read("locales", "en.default.schema.json")).labels;
  for (const key of ["button_background", "button_text", "button_border", "button_colors_info"])
    assert.ok(labels[key], `labels.${key}`);
});

test("every scheme token of a button has a twin for buttons over a picture: the same, but its last fallback is the colour of the text around the button", () => {
  const lines = tokenLines();
  const names = Object.keys(lines).filter(
    (name) => !/^--color-button-(bg|hover-bg|outline-hover-bg)$/.test(name) && !name.endsWith("-on-media"),
  );
  assert.equal(names.length, 8);
  for (const name of names) {
    const twin = lines[`${name}-on-media`];
    assert.ok(twin, `${name}-on-media`);
    assert.ok(
      lines[name].endsWith("{%- else -%}{{ scheme.settings.text }}{%- endif -%}"),
      `${name} ends on the scheme's text colour`,
    );
    assert.equal(
      twin,
      lines[name].replace(
        /{%- else -%}{{ scheme\.settings\.text }}{%- endif -%}$/,
        "{%- else -%}currentColor{%- endif -%}",
      ),
    );
  }
});

test("a promo card marks itself as a picture its button stands over", () => {
  assert.match(
    sectionSource("promo-grid"),
    /class="valor-promo-card valor-promo-card--size-[^"]*valor-promo-card--text-{{ block\.settings\.text_color }} valor-buttons-on-media"/,
  );
});

test("the banner and the video mark their content as standing over the picture, unless it has a box of its own", () => {
  assert.match(
    sectionSource("image-banner"),
    /class="valor-hero__content{% if section\.settings\.show_text_box %} valor-hero__content--box{% else %} valor-buttons-on-media{% endif %}"/,
  );
  assert.match(
    sectionSource("video"),
    /class="valor-video__content{% if section\.settings\.show_text_box %} valor-video__content--box{% else %} valor-buttons-on-media{% endif %}"/,
  );
});

// --- 2. The snippet --------------------------------------------------------

const WHITE = "#ffffff";
const BLACK = "#000000";
const GOLD = "#c8a24a";

test("no colour picked: the snippet prints nothing", () => {
  assert.equal(runSnippet({}), "");
  assert.equal(runSnippet({ background: "", text: "", border: "" }), "");
  assert.equal(runSnippet({ background: "transparent", text: "rgba(0, 0, 0, 0)", border: "RGBA(0,0,0,0)" }), "");
  assert.equal(runSnippet({ attribute: true }), "");
});

test("text only: every button's label, also an outline button's and a text link's", () => {
  const tokens = declared(runSnippet({ text: WHITE }));
  assert.equal(tokens["--color-button-text"], WHITE);
  assert.equal(tokens["--color-button-outline-text"], WHITE);
  assert.ok(
    !("--color-button-bg" in tokens) &&
      !("--color-button-border" in tokens) &&
      !("--color-button-outline-border" in tokens),
  );
});

test("border only: every button's border, and an outline button's label as the theme's own settings do it", () => {
  const tokens = declared(runSnippet({ border: GOLD }));
  assert.equal(tokens["--color-button-border"], GOLD);
  assert.equal(tokens["--color-button-outline-border"], GOLD);
  assert.equal(tokens["--color-button-outline-text"], GOLD);
  assert.ok(!("--color-button-text" in tokens) && !("--color-button-bg" in tokens));
});

test("text and border: labels in the one, borders in the other", () => {
  const tokens = declared(runSnippet({ text: WHITE, border: GOLD }));
  assert.equal(tokens["--color-button-text"], WHITE);
  assert.equal(tokens["--color-button-outline-text"], WHITE);
  assert.equal(tokens["--color-button-border"], GOLD);
  assert.equal(tokens["--color-button-outline-border"], GOLD);
});

test("a background: the solid button is filled and bordered with it, and an outline button or a text link is drawn in it", () => {
  const tokens = declared(runSnippet({ background: WHITE, text: BLACK }));
  assert.equal(tokens["--color-button-bg"], WHITE);
  assert.equal(tokens["--color-button-text"], BLACK);
  assert.equal(tokens["--color-button-border"], WHITE);
  assert.equal(tokens["--color-button-outline-text"], WHITE);
  assert.equal(tokens["--color-button-outline-border"], WHITE);
});

test("a background and a border: the border colour is the border's, and the outline button's", () => {
  const tokens = declared(runSnippet({ background: WHITE, text: BLACK, border: GOLD }));
  assert.equal(tokens["--color-button-bg"], WHITE);
  assert.equal(tokens["--color-button-border"], GOLD);
  assert.equal(tokens["--color-button-outline-text"], GOLD);
  assert.equal(tokens["--color-button-outline-border"], GOLD);
});

test("every colour a section sets is set for buttons over a picture too", () => {
  for (const args of [
    { text: WHITE },
    { border: GOLD },
    { background: WHITE, text: BLACK },
    { background: WHITE, text: BLACK, border: GOLD },
  ]) {
    const tokens = declared(runSnippet(args));
    for (const name of [
      "--color-button-text",
      "--color-button-border",
      "--color-button-outline-text",
      "--color-button-outline-border",
    ]) {
      assert.equal(tokens[`${name}-on-media`], tokens[name], `${name}-on-media for ${JSON.stringify(args)}`);
    }
  }
});

test("a section with a colour of its own keeps it while the pointer is on the button", () => {
  const tokens = declared(runSnippet({ text: WHITE }));
  assert.equal(tokens["--color-button-hover-bg"], "var(--color-button-bg)");
  assert.equal(tokens["--color-button-hover-text"], "var(--color-button-text)");
  assert.equal(tokens["--color-button-hover-border"], "var(--color-button-border)");
  assert.equal(tokens["--color-button-outline-hover-bg"], "transparent");
  assert.equal(tokens["--color-button-outline-hover-text"], "var(--color-button-outline-text)");
  assert.equal(tokens["--color-button-outline-hover-border"], "var(--color-button-outline-border)");
  assert.equal(tokens["--color-button-hover-text-on-media"], "var(--color-button-text-on-media)");
  assert.equal(tokens["--color-button-hover-border-on-media"], "var(--color-button-border-on-media)");
  assert.equal(tokens["--color-button-outline-hover-text-on-media"], "var(--color-button-outline-text-on-media)");
  assert.equal(tokens["--color-button-outline-hover-border-on-media"], "var(--color-button-outline-border-on-media)");
  assert.equal(tokens["--button-hover-opacity"], "0.85");
  assert.equal(tokens["--button-outline-hover-opacity"], "0.85");
});

test("inside a style attribute the output starts with a space and ends with a semicolon; asked for an attribute, it is one", () => {
  const inline = runSnippet({ text: WHITE });
  assert.match(inline, /^ --[\s\S]*;$/);
  assert.ok(!/["<>\n]/.test(inline), "nothing that could end the attribute");
  const attribute = runSnippet({ text: WHITE, attribute: true });
  assert.match(attribute, /^ style="--[^"]*;"$/);
  assert.deepEqual(declared(attribute), declared(inline));
});

// --- 3. What a visitor sees ------------------------------------------------

let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  // WebKit on Windows can stall in close() after every test has passed;
  // npm test runs with --test-force-exit, so a stalled close can't hold the run.
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

const BUTTONS = `<a href="#" class="valor-button valor-button--primary" data-b="solid">Shop</a>
  <a href="#" class="valor-button valor-button--secondary" data-b="outline">More</a>
  <a href="#" class="valor-button valor-button--link" data-b="link">Read</a>`;

// theme: Theme settings > Buttons. scheme: the section's color scheme.
// colors: the section's own three settings (on a promo card: the card's).
// box / below: the banner's "text box" and "text below the image on phones".
// card: a promo card's "Text color", light or dark.
function page({ theme = {}, scheme = LIGHT, colors = {}, box = false, below = false, card = "light" } = {}) {
  const own = runSnippet(colors);
  const cardButtons = BUTTONS.replace(/<a href="#"/g, "<span")
    .replace(/<\/a>/g, "</span>")
    .replace(/class="valor-button /g, 'class="valor-promo-card__button valor-button ');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { ${rootBlock(theme)} ${schemeBlock(theme, LIGHT)} }
    .color-scheme-x { ${schemeBlock(theme, scheme)} }
    ${criticalCss}${stylesheetOf("image-banner")}${stylesheetOf("promo-grid")} body { margin: 0; }
  </style></head><body>
    <section id="promo" class="color-scheme-x valor-promo-grid valor-promo-grid--columns-2">
      <div class="valor-promo-grid__grid">
        <article class="valor-promo-card valor-promo-card--size-standard valor-promo-card--ratio-portrait valor-promo-card--content-bottom-left valor-promo-card--align-left valor-promo-card--text-${card} valor-buttons-on-media" style="--valor-promo-overlay: 0.2;${own}">
          <a class="valor-promo-card__link" href="#">
            <div class="valor-promo-card__media"></div>
            <div class="valor-promo-card__content">
              <h3 class="valor-promo-card__heading">Card</h3>
              ${cardButtons}
            </div>
          </a>
        </article>
      </div>
    </section>
    <section id="plain" class="color-scheme-x" style="padding: 20px;${own}">${BUTTONS}</section>
    <section id="banner" class="color-scheme-x valor-hero valor-hero--medium${below ? " valor-hero--text-below-mobile" : ""}" style="--valor-hero-overlay: 0.3;${own}">
      <div class="valor-hero__media" style="background: #222; height: 400px"></div>
      <div class="valor-hero__content-wrapper valor-hero__content-wrapper--pos-middle-center valor-hero__content-wrapper--align-center">
        <div class="valor-hero__content${box ? " valor-hero__content--box" : " valor-buttons-on-media"}">
          <h2 class="valor-hero__heading">Heading</h2>
          <div class="valor-hero__buttons">${BUTTONS}</div>
        </div>
      </div>
    </section>
  </body></html>`;
}

async function colours(t, options, { width = 1280, hover = null } = {}) {
  const tab = await browser.newPage({ viewport: { width, height: 900 } });
  t.after(() => tab.close());
  await tab.setContent(page(options));
  // Colours are read once any transition has run its course.
  await tab.addStyleTag({ content: ".valor-button { transition: none !important; }" });
  if (hover) await tab.hover(hover);
  return tab.evaluate(() => {
    const read = (scope) => {
      const out = {};
      for (const button of document.querySelectorAll(`${scope} [data-b]`)) {
        const style = getComputedStyle(button);
        out[button.dataset.b] = {
          text: style.color,
          fill: style.backgroundColor,
          border: style.borderTopColor,
          opacity: style.opacity,
        };
      }
      return out;
    };
    return {
      plain: read("#plain"),
      banner: read("#banner"),
      heading: getComputedStyle(document.querySelector(".valor-hero__heading")).color,
      promo: read("#promo"),
      cardHeading: getComputedStyle(document.querySelector(".valor-promo-card__heading")).color,
    };
  });
}

test("nothing set anywhere: a section's buttons are drawn in the scheme's text colour, as before", async (t) => {
  const r = await colours(t, {});
  for (const kind of ["solid", "outline", "link"]) assert.equal(r.plain[kind].text, rgb(LIGHT.text), kind);
  assert.equal(r.plain.solid.border, rgb(LIGHT.text));
  assert.equal(r.plain.outline.border, rgb(LIGHT.text));
  assert.equal(r.plain.solid.fill, CLEAR);
});

for (const [name, scheme] of [
  ["a light scheme", LIGHT],
  ["a dark scheme", DARK],
]) {
  test(`over the banner's picture, ${name}: the buttons take the colour of the text over the picture`, async (t) => {
    const r = await colours(t, { scheme });
    assert.equal(r.heading, rgb(scheme.background));
    for (const kind of ["solid", "outline", "link"]) assert.equal(r.banner[kind].text, r.heading, kind);
    assert.equal(r.banner.solid.border, r.heading);
    assert.equal(r.banner.outline.border, r.heading);
    // The same section's buttons outside the picture are unchanged.
    assert.equal(r.plain.solid.text, rgb(scheme.text));
  });
}

test("the banner's text box: its buttons are drawn in the scheme's text colour, like the text in the box", async (t) => {
  const r = await colours(t, { box: true });
  assert.equal(r.heading, rgb(LIGHT.text));
  for (const kind of ["solid", "outline", "link"]) assert.equal(r.banner[kind].text, rgb(LIGHT.text), kind);
  assert.equal(r.banner.outline.border, rgb(LIGHT.text));
});

test("the banner's text below the image on a phone: its buttons follow the text there, and the picture on a desktop", async (t) => {
  const phone = await colours(t, { below: true }, { width: 390 });
  assert.equal(phone.heading, rgb(LIGHT.text));
  for (const kind of ["solid", "outline", "link"]) assert.equal(phone.banner[kind].text, rgb(LIGHT.text), kind);
  assert.equal(phone.banner.outline.border, rgb(LIGHT.text));
  const desktop = await colours(t, { below: true });
  for (const kind of ["solid", "outline", "link"]) assert.equal(desktop.banner[kind].text, rgb(LIGHT.background), kind);
});

for (const [card, colour] of [
  ["light", "#ffffff"],
  ["dark", "#111111"],
]) {
  test(`a promo card with ${card} text: its button is drawn in the card's text colour`, async (t) => {
    const r = await colours(t, { card });
    assert.equal(r.cardHeading, rgb(colour));
    for (const kind of ["solid", "outline", "link"]) assert.equal(r.promo[kind].text, rgb(colour), kind);
    assert.equal(r.promo.solid.border, rgb(colour));
    assert.equal(r.promo.outline.border, rgb(colour));
    assert.equal(r.promo.solid.fill, CLEAR);
  });
}

test("a promo card's own colours win over the card's text colour", async (t) => {
  const r = await colours(t, { card: "light", colors: { text: "#ff00ff", border: "#00ffff" } });
  for (const kind of ["solid", "outline", "link"]) assert.equal(r.promo[kind].text, rgb("#ff00ff"), kind);
  assert.equal(r.promo.solid.border, rgb("#00ffff"));
  assert.equal(r.promo.outline.border, rgb("#00ffff"));
});

test("a theme-wide text colour alone: over a picture the solid button's border follows its label, and the outline button the text there", async (t) => {
  const r = await colours(t, { theme: { button_text_color: "#aa0000" } });
  // In a plain section: the label is the theme's, the border the scheme's text colour.
  assert.equal(r.plain.solid.text, rgb("#aa0000"));
  assert.equal(r.plain.solid.border, rgb(LIGHT.text));
  for (const where of ["banner", "promo"]) {
    assert.equal(r[where].solid.text, rgb("#aa0000"), where);
    assert.equal(r[where].solid.border, rgb("#aa0000"), where);
    assert.equal(r[where].outline.text, rgb("#ffffff"), where);
    assert.equal(r[where].outline.border, rgb("#ffffff"), where);
  }
});

test("the theme's own button colours still win over the picture's default", async (t) => {
  const theme = { button_text_color: "#aa0000", button_border_color: "#00aa00", button_outline_text_color: "#0000aa" };
  const r = await colours(t, { theme });
  assert.equal(r.banner.solid.text, rgb("#aa0000"));
  assert.equal(r.banner.solid.border, rgb("#00aa00"));
  assert.equal(r.banner.outline.text, rgb("#0000aa"));
  assert.equal(r.banner.outline.border, rgb("#00aa00"));
  assert.deepEqual(r.banner, r.plain);
  assert.deepEqual(r.promo, r.plain);
});

test("a theme-wide button background: the label on the fill is the same over a picture", async (t) => {
  const r = await colours(t, { theme: { button_background_color: "#101010" } });
  assert.equal(r.banner.solid.fill, rgb("#101010"));
  assert.equal(r.banner.solid.text, rgb(LIGHT.background));
  assert.deepEqual(r.banner.solid, r.plain.solid);
});

test("a section's text and border colours reach every button, over a picture too", async (t) => {
  const r = await colours(t, { colors: { text: "#ff00ff", border: "#00ffff" } });
  for (const where of ["plain", "banner"]) {
    for (const kind of ["solid", "outline", "link"])
      assert.equal(r[where][kind].text, rgb("#ff00ff"), `${where} ${kind}`);
    assert.equal(r[where].solid.border, rgb("#00ffff"), where);
    assert.equal(r[where].outline.border, rgb("#00ffff"), where);
    assert.equal(r[where].solid.fill, CLEAR, where);
  }
});

test("a section's colours win over the theme's own button colours", async (t) => {
  const theme = {
    button_background_color: "#101010",
    button_text_color: "#aa0000",
    button_border_color: "#00aa00",
    button_outline_text_color: "#0000aa",
  };
  const r = await colours(t, { theme, colors: { background: "#ffffff", text: "#000000", border: "#c8a24a" } });
  for (const where of ["plain", "banner"]) {
    assert.deepEqual(
      { text: r[where].solid.text, fill: r[where].solid.fill, border: r[where].solid.border },
      { text: rgb("#000000"), fill: rgb("#ffffff"), border: rgb("#c8a24a") },
      where,
    );
    assert.deepEqual(
      { text: r[where].outline.text, fill: r[where].outline.fill, border: r[where].outline.border },
      { text: rgb("#c8a24a"), fill: CLEAR, border: rgb("#c8a24a") },
      where,
    );
    assert.equal(r[where].link.text, rgb("#c8a24a"), where);
  }
});

test("a section's background without a border: the solid button's border is the fill's colour", async (t) => {
  const r = await colours(t, { colors: { background: "#ffffff", text: "#000000" } });
  assert.equal(r.banner.solid.border, rgb("#ffffff"));
  assert.equal(r.banner.outline.text, rgb("#ffffff"));
  assert.equal(r.banner.outline.border, rgb("#ffffff"));
});

for (const [kind, selector] of [
  ["solid", '#banner [data-b="solid"]'],
  ["outline", '#banner [data-b="outline"]'],
]) {
  test(`a section with colours of its own: the ${kind} button keeps them under the pointer and dims`, async (t) => {
    const theme = {
      button_hover_background_color: "#aa0000",
      button_hover_text_color: "#00aa00",
      button_hover_border_color: "#0000aa",
      button_outline_hover_text_color: "#aaaa00",
    };
    const options = { theme, colors: { background: "#ffffff", text: "#000000", border: "#c8a24a" } };
    const rest = await colours(t, options);
    const over = await colours(t, options, { hover: selector });
    assert.deepEqual(
      { text: over.banner[kind].text, fill: over.banner[kind].fill, border: over.banner[kind].border },
      { text: rest.banner[kind].text, fill: rest.banner[kind].fill, border: rest.banner[kind].border },
    );
    assert.equal(over.banner[kind].opacity, "0.85");
    assert.equal(rest.banner[kind].opacity, "1");
  });
}

test("without colours of its own a section's buttons keep the theme's hover colours", async (t) => {
  const theme = {
    button_background_color: "#101010",
    button_hover_background_color: "#aa0000",
    button_hover_text_color: "#00aa00",
  };
  const solid = await colours(t, { theme }, { hover: '#plain [data-b="solid"]' });
  assert.equal(solid.plain.solid.fill, rgb("#aa0000"));
  assert.equal(solid.plain.solid.text, rgb("#00aa00"));
  assert.equal(solid.plain.solid.opacity, "1");
  const outline = await colours(t, { theme }, { hover: '#plain [data-b="outline"]' });
  assert.equal(outline.plain.outline.fill, rgb("#aa0000"));
  assert.equal(outline.plain.outline.opacity, "1");
});

// --- 4. The buttons that have a class of their own -------------------------
// They are not .valor-button, but read the same properties: the Lookbook
// card's button, the Subscribe button of the Newsletter section, "Apply" of
// the discount field in the cart drawer and on the cart page, and Shopify's
// unbranded "Buy it now", which the product page colours as a solid button.

const OTHER = {
  lookbook: {
    solid: true,
    markup: '<button type="button" class="valor-lookbook__card-button" data-o="lookbook">+</button>',
  },
  newsletter: {
    solid: true,
    markup: '<button type="submit" class="valor-newsletter__button" data-o="newsletter">Subscribe</button>',
  },
  drawerApply: {
    solid: false,
    markup: '<button type="submit" class="valor-cart-drawer__discount-apply" data-o="drawerApply">Apply</button>',
  },
  cartApply: {
    solid: false,
    markup: '<button type="submit" class="valor-cart__discount-apply" data-o="cartApply">Apply</button>',
  },
  buyNow: {
    solid: true,
    noBorder: true,
    markup:
      '<div class="valor-mp__form"><div class="shopify-payment-button"><button type="button" class="shopify-payment-button__button shopify-payment-button__button--unbranded" data-o="buyNow">Buy it now</button></div></div>',
  },
};

function otherPage({ theme = {}, colors = {} } = {}) {
  const own = runSnippet(colors);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { ${rootBlock(theme)} ${schemeBlock(theme, LIGHT)} }
    .color-scheme-x { ${schemeBlock(theme, LIGHT)} }
    ${criticalCss}${read("assets", "lookbook.css")}${read("assets", "cart-page.css")}${read("assets", "product-info.css")}
    ${stylesheetOf("newsletter")}${stylesheetOf("cart-drawer")} body { margin: 0; }
  </style></head><body>
    <section id="own" class="color-scheme-x" style="padding: 20px;${own}">
      ${Object.values(OTHER)
        .map((button) => `<div style="margin: 8px 0">${button.markup}</div>`)
        .join("")}
    </section>
  </body></html>`;
}

async function others(t, options, hover = null) {
  const tab = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  t.after(() => tab.close());
  await tab.setContent(otherPage(options));
  await tab.addStyleTag({ content: "#own * { transition: none !important; }" });
  if (hover) await tab.hover(`[data-o="${hover}"]`);
  return tab.evaluate(() => {
    const out = {};
    for (const button of document.querySelectorAll("[data-o]")) {
      const style = getComputedStyle(button);
      out[button.dataset.o] = {
        text: style.color,
        fill: style.backgroundColor,
        border: style.borderTopColor,
        opacity: style.opacity,
      };
    }
    return out;
  });
}

const OWN = { background: "#1d4ed8", text: "#ffffff", border: "#c8a24a" };

test("the buttons with a class of their own take a section's colours", async (t) => {
  const r = await others(t, { colors: OWN });
  for (const [name, button] of Object.entries(OTHER)) {
    if (button.solid) {
      assert.equal(r[name].fill, rgb(OWN.background), `${name}: fill`);
      assert.equal(r[name].text, rgb(OWN.text), `${name}: label`);
      if (!button.noBorder) assert.equal(r[name].border, rgb(OWN.border), `${name}: border`);
    } else {
      // Drawn like an outline button: with a background set, in the border's colour.
      assert.equal(r[name].fill, CLEAR, `${name}: fill`);
      assert.equal(r[name].text, rgb(OWN.border), `${name}: label`);
      assert.equal(r[name].border, rgb(OWN.border), `${name}: border`);
    }
  }
});

test("the buttons with a class of their own are as before while a section sets nothing", async (t) => {
  const r = await others(t, {});
  for (const name of ["lookbook", "newsletter", "drawerApply", "cartApply"]) {
    assert.equal(r[name].text, rgb(LIGHT.text), `${name}: label`);
    assert.equal(r[name].border, rgb(LIGHT.text), `${name}: border`);
    assert.equal(r[name].fill, CLEAR, `${name}: fill`);
  }
});

for (const name of Object.keys(OTHER)) {
  test(`a section with colours of its own: ${name} keeps them under the pointer`, async (t) => {
    const theme = {
      button_hover_background_color: "#aa0000",
      button_hover_text_color: "#00aa00",
      button_hover_border_color: "#0000aa",
      button_outline_hover_text_color: "#aaaa00",
    };
    const rest = await others(t, { theme, colors: OWN });
    const over = await others(t, { theme, colors: OWN }, name);
    assert.deepEqual(
      { text: over[name].text, fill: over[name].fill, border: over[name].border },
      { text: rest[name].text, fill: rest[name].fill, border: rest[name].border },
    );
  });
}
