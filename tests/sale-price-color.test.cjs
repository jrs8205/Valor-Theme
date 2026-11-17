const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The colour of a sale price. It is the theme's red where that reads on the
// colour scheme's background, and a lighter or darker red where it does not
// (measured on a store: #b91c1c on the dark default scheme has a contrast of
// 2.8). One token, --valor-color-sale, declared for every colour scheme in
// snippets/css-variables.liquid; every sale price that is shown in red uses it,
// so they all change together.
const root = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");

function sources() {
  const files = [];
  for (const [dir, ext] of [
    ["assets", ".css"],
    ["sections", ".liquid"],
    ["snippets", ".liquid"],
    ["blocks", ".liquid"],
    ["layout", ".liquid"],
  ]) {
    const folder = path.join(root, dir);
    if (!fs.existsSync(folder)) continue;
    for (const name of fs.readdirSync(folder)) {
      if (name.endsWith(ext)) files.push([`${dir}/${name}`, read(dir, name)]);
    }
  }
  return files;
}

// Every rule whose selector names a sale price, with the colour it sets.
function salePriceRules() {
  const rules = [];
  for (const [file, source] of sources()) {
    for (const match of source.matchAll(/([^{}]*price[a-z_-]*--sale[^{}]*)\{([^{}]*)\}/g)) {
      const color = match[2].match(/(?:^|[;\s])color:\s*([^;]+);/);
      if (color) rules.push({ file, selector: match[1].trim().replace(/\s+/g, " "), color: color[1].trim() });
    }
  }
  return rules;
}

test("the sale price colour is declared for every colour scheme", () => {
  const source = read("snippets", "css-variables.liquid");
  const schemes = source.slice(source.indexOf("{% for scheme in settings.color_schemes"));
  const declarations = schemes.slice(schemes.indexOf("capture scheme_declarations"), schemes.indexOf("endcapture"));
  assert.match(declarations, /--valor-color-sale:\s*\{\{ sale_color \}\};/, "inside the per-scheme declarations");
  const logic = schemes.slice(0, schemes.indexOf("capture scheme_declarations"));
  assert.match(logic, /color_contrast: scheme\.settings\.background/, "measured against the scheme's background");
  assert.match(logic, /color_mix: scheme\.settings\.text/, "and moved towards the scheme's text colour until it reads");
  const fallback = source.slice(source.indexOf(":root {"), source.indexOf("{% for scheme in settings.color_schemes"));
  assert.match(
    fallback,
    /--valor-color-sale:\s*var\(--valor-color-error\);/,
    "a fallback should the scheme list be empty",
  );
});

// From the external review: the mixing stopped at one tenth red, whether or not
// that read. On a background where only the text colour itself reads (#767676
// with black text: 4.6) the sale price came out at about 4.4.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (first, second, share) =>
  `#${[1, 3, 5]
    .map((at) => {
      const value =
        (parseInt(first.slice(at, at + 2), 16) * share + parseInt(second.slice(at, at + 2), 16) * (100 - share)) / 100;
      return Math.round(value).toString(16).padStart(2, "0");
    })
    .join("")}`;

// The steps as the snippet takes them, read from its source.
function saleColor(background, text) {
  const source = read("snippets", "css-variables.liquid");
  const logic = source.slice(
    source.indexOf("assign sale_color = '#b91c1c'"),
    source.indexOf("capture scheme_declarations"),
  );
  const steps = Number(logic.match(/for step in \(1\.\.(\d+)\)/)[1]);
  assert.match(logic, /assign red_share = 10 \| minus: step \| times: 10/);
  // color_contrast rounds to one decimal; the snippet asks for 4.6.
  const reads = (color) => Math.round(contrast(color, background) * 10) / 10 >= 4.6;
  let color = "#b91c1c";
  if (reads(color)) return color;
  for (let step = 1; step <= steps; step += 1) {
    color = mix("#b91c1c", text, (10 - step) * 10);
    if (reads(color)) break;
  }
  return color;
}

test("the sale price colour reads wherever the scheme's own text does", () => {
  for (const [background, text] of [
    ["#ffffff", "#111111"],
    ["#111111", "#ffffff"],
    ["#767676", "#000000"],
    ["#757575", "#ffffff"],
    ["#b91c1c", "#ffffff"],
    ["#5a1010", "#ffe9e9"],
    ["#f4d9d9", "#3a0d0d"],
  ]) {
    assert.ok(contrast(text, background) >= 4.5, `a scheme whose text reads: ${text} on ${background}`);
    const color = saleColor(background, text);
    const ratio = contrast(color, background);
    assert.ok(ratio >= 4.5, `${color} on ${background} (text ${text}): ${ratio.toFixed(2)}`);
  }
  assert.equal(saleColor("#ffffff", "#111111"), "#b91c1c", "the theme's red where it reads");
  assert.equal(saleColor("#767676", "#000000"), "#000000", "the text colour itself where nothing redder reads");
});

test("every sale price shown in red uses the one token", () => {
  const rules = salePriceRules();
  const red = rules.filter((rule) => !/^var\(--color-foreground\)$/.test(rule.color));
  assert.deepEqual(
    red.map((rule) => rule.file).sort(),
    ["assets/lookbook.css", "assets/product-card.css", "sections/featured-product.liquid"],
    JSON.stringify(rules, null, 1),
  );
  for (const rule of red) {
    assert.equal(rule.color, "var(--valor-color-sale)", `${rule.file}: ${rule.selector}`);
  }
});

test("no sale price is coloured with the error colour itself", () => {
  for (const rule of salePriceRules()) {
    assert.doesNotMatch(rule.color, /--valor-color-error/, `${rule.file}: ${rule.selector}`);
  }
});

test("an image from an image picker is never given its own alt straight", () => {
  // Seen on a store: such an image has a nil alt until the merchant writes
  // one, and image_tag leaves the alt attribute out when it is given nil.
  const offenders = [];
  for (const [file, source] of sources()) {
    for (const match of source.matchAll(
      /alt:\s*((?:block_settings|block\.settings|section\.settings|settings)\.[a-z_0-9]+\.alt)\b(?!\s*\|)/g,
    )) {
      offenders.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
  const promo = read("snippets", "header-menu-promo.liquid");
  assert.match(promo, /assign promo_image_alt = block_settings\.promo_image\.alt \| default: ''/);
  assert.match(promo, /alt: promo_image_alt\b/);
});
