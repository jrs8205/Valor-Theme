const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The Lookbook section's Liquid (sections/lookbook.liquid and
// snippets/lookbook-card.liquid): what can be checked from the source without
// rendering it. The browser behaviour is in lookbook.test.cjs; the paths only
// Shopify can render (variant lookup, prices, cart) are checked on a store.
const root = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const section = () => read("sections", "lookbook.liquid");
const card = () => read("snippets", "lookbook-card.liquid");
const schema = () => JSON.parse(section().match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);
const markup = () => section().replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}/, "");

function lookup(object, key) {
  return key.split(".").reduce((value, part) => (value == null ? undefined : value[part]), object);
}

test("the lookbook schema has the agreed settings", () => {
  const s = schema();
  assert.equal(s.name, "t:sections.lookbook.name");
  assert.equal(s.max_blocks, 50, "Shopify's limit, and the section's");
  const ids = s.settings.filter((setting) => setting.id).map((setting) => setting.id);
  assert.deepEqual(ids, [
    "color_scheme",
    // The card's button: the section's own button colours (tests/button-colors.test.cjs).
    "button_background_color",
    "button_text_color",
    "button_border_color",
    "eyebrow",
    "heading",
    "heading_size",
    "text",
    "content_alignment",
    "desktop_layout",
    "show_product_card",
    "padding_top",
    "padding_bottom",
  ]);
  const byId = Object.fromEntries(s.settings.filter((setting) => setting.id).map((setting) => [setting.id, setting]));
  assert.deepEqual(
    byId.desktop_layout.options.map((option) => option.value),
    ["centered", "4", "5", "6"],
  );
  assert.equal(byId.desktop_layout.default, "centered");
  assert.equal(byId.show_product_card.default, true);
  assert.equal(byId.content_alignment.default, "center");
  assert.deepEqual(
    byId.heading_size.options.map((option) => option.value),
    ["small", "medium", "large"],
  );
});

test("a look is an image, a product and an optional variant", () => {
  const s = schema();
  assert.equal(s.blocks.length, 1);
  assert.equal(s.blocks[0].type, "look");
  assert.deepEqual(
    s.blocks[0].settings.map((setting) => [setting.id, setting.type]),
    [
      ["image", "image_picker"],
      ["product", "product"],
      ["variant", "text"],
    ],
  );
});

test("the preset adds eight looks, enough for the row to loop on a desktop", () => {
  const preset = schema().presets[0];
  assert.equal(preset.blocks.length, 8);
  assert.ok(preset.blocks.every((block) => block.type === "look"));
});

test("every lookbook string exists in the locale files", () => {
  const storefront = JSON.parse(read("locales", "en.default.json"));
  const editor = JSON.parse(read("locales", "en.default.schema.json"));
  const source = markup() + card();
  const used = [...source.matchAll(/'([a-z_]+(?:\.[a-z_0-9]+)+)'\s*\|\s*t\b/g)].map((m) => m[1]);
  assert.ok(
    used.some((key) => key.startsWith("sections.lookbook.")),
    "the section has strings of its own",
  );
  for (const key of used) {
    assert.equal(typeof lookup(storefront, key), "string", `${key} is missing from en.default.json`);
  }
  const labels = [...JSON.stringify(schema()).matchAll(/"t:([a-z_0-9.]+)"/g)].map((m) => m[1]);
  assert.ok(labels.length > 10);
  for (const key of labels) {
    assert.equal(typeof lookup(editor, key), "string", `${key} is missing from en.default.schema.json`);
  }
});

test("the lookbook's own strings read as agreed", () => {
  const strings = JSON.parse(read("locales", "en.default.json")).sections.lookbook;
  assert.deepEqual(strings, {
    label: "Lookbook",
    previous: "Previous look",
    next: "Next look",
    add_to_cart: "Add to cart: {{ title }}",
    choose_options: "Choose options: {{ title }}",
    example_product: "Example product title",
    variant_missing: "Variant not found. Check the variant ID.",
  });
});

test("the large lookbook image is never inside a link", () => {
  const source = markup();
  const start = source.indexOf('class="valor-lookbook__media"');
  assert.ok(start > -1, "the image wrapper is there");
  const end = source.indexOf("valor-lookbook__card-slot");
  assert.ok(end > start);
  assert.doesNotMatch(source.slice(start, end), /<a\b/, "no link between the image wrapper and the card");
  assert.doesNotMatch(source.slice(0, start), /<a\b/, "and none opened before it");
});

test("a look image without alt text keeps an empty alt attribute", () => {
  // Seen on a store: image_tag leaves the attribute out when it is given a
  // nil alt, and an image from the image picker has a nil alt until the
  // merchant writes one.
  const source = markup();
  assert.match(source, /assign look_alt = look_image\.alt \| default: ''/);
  assert.match(source, /alt: look_alt,/);
  assert.doesNotMatch(source, /alt: look_image\.alt/, "never the image's alt straight into image_tag");
});

test("the row's name is the heading as text, escaped once", () => {
  // Seen on a store: a heading saved as "Fall &amp; Winter" (rich text keeps
  // its ampersand that way) came out of a plain escape as "&amp;amp;", which
  // a screen reader reads aloud. escape_once leaves an entity as it is and
  // still escapes a bare ampersand and quotes.
  const source = markup();
  assert.match(source, /assign row_label = section\.settings\.heading \| strip_html \| strip/);
  assert.match(source, /aria-label="\{\{ row_label \| escape_once \}\}"/);
});

test("the lookbook card posts one variant to the cart add route", () => {
  const source = card();
  assert.match(source, /<form[^>]*method="post"[^>]*action="\{\{ routes\.cart_add_url \}\}"/);
  assert.match(source, /<input type="hidden" name="id" value="\{\{ card_variant\.id \}\}">/);
  assert.match(source, /<button[^>]*type="submit"[^>]*name="add"/);
  assert.match(source, /data-cart-error[^>]*role="alert"[^>]*hidden/, "the cart script writes a failed add here");
});

test("the lookbook card shows a price with the theme's price pieces", () => {
  const source = card();
  assert.match(source, /\| money/);
  assert.match(source, /render 'price-compare-label'/, "the compare-at label setting applies");
  assert.match(source, /render 'product-unit-price'/, "and the unit price");
  assert.match(source, /'product\.from_price' \| t/, "a multi-variant product without an ID shows From");
});

// From the external review: has_only_default_variant says that a product has
// no options, not that it has one variant. A product whose single variant has
// a named option (Size: M) got a link to its page instead of being added.
test("a product with one variant is added straight away, whatever its option is called", () => {
  const source = card();
  assert.match(
    source,
    /assign single_variant = false\s+if product\.variants\.size == 1\s+assign single_variant = true/,
  );
  assert.match(
    source,
    /if variant != blank or single_variant\s+assign exact_variant = true/,
    "its price is that variant's",
  );
  assert.match(source, /elsif single_variant\s+assign card_action = 'add'/, "and the button adds it");
  assert.match(source, /if product\.requires_selling_plan\s+assign card_action = 'link'/, "subscriptions still link");
  assert.match(source, /quantity_rule\.min > 1[^\n]*\n\s+assign card_action = 'link'/, "and so do quantity rules");
  // What has_only_default_variant does say: whether there is an option to name.
  const uses = (source.match(/[^\n]*has_only_default_variant[^\n]*/g) || [])
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"));
  assert.deepEqual(uses, ["if exact_variant and product.has_only_default_variant == false"]);
  assert.match(source, /assign variant_text = card_variant\.options \| join: ' · '/, "the card names what it adds");
});

test("the heading uses the theme's shared heading classes and settings", () => {
  const source = markup();
  assert.match(source, /class="valor-lookbook__heading valor-heading valor-heading--\{\{ heading_size \}\}"/);
  assert.match(source, /class="color-\{\{ section\.settings\.color_scheme \}\} /);
  assert.match(source, /--valor-section-padding-top: \{\{ section\.settings\.padding_top \}\}px/);
  assert.match(source, /--valor-section-padding-bottom: \{\{ section\.settings\.padding_bottom \}\}px/);
});

test("with the product card off the section renders no card and no arrows", () => {
  const source = markup();
  assert.match(source, /assign show_cards = section\.settings\.show_product_card/);
  for (const part of ["valor-lookbook__card-slot", "valor-lookbook__nav"]) {
    const at = source.indexOf(`class="${part}"`);
    assert.ok(at > -1, `${part} is in the section`);
    const before = source.slice(0, at);
    const opened = before.lastIndexOf("if show_cards");
    assert.ok(opened > -1 && at - opened < 80, `${part} sits right inside "if show_cards"`);
  }
});

test("the buy button does not depend on the theme-wide quick add setting", () => {
  assert.doesNotMatch(section() + card(), /show_quick_add/);
});

test("the variant field takes an ID or a product link with ?variant=", () => {
  const source = markup();
  assert.match(source, /block\.settings\.variant \| strip/);
  assert.match(source, /contains 'variant='/);
  assert.match(source, /split: 'variant=' \| last \| split: '&' \| first \| split: '#' \| first/);
});

test("the editor-only notes stay out of the storefront", () => {
  const sectionSource = markup();
  const cardSource = card();
  assert.match(sectionSource, /request\.design_mode/, "the example card is for the theme editor");
  const note = cardSource.indexOf("sections.lookbook.variant_missing");
  assert.ok(note > -1);
  assert.match(cardSource.slice(Math.max(0, note - 200), note), /request\.design_mode/);
});

test("the section loads its stylesheet and its script", () => {
  const source = markup();
  assert.match(source, /\{\{ 'lookbook\.css' \| asset_url \| stylesheet_tag \}\}/);
  assert.match(source, /<script src="\{\{ 'lookbook\.js' \| asset_url \}\}" defer><\/script>/);
  assert.ok(fs.existsSync(path.join(root, "assets", "lookbook.css")));
  assert.ok(fs.existsSync(path.join(root, "assets", "lookbook.js")));
});

// ---------------------------------------------------------------------------
// External review, round 4: a variant outside the first 250 of its product.
// Shopify hands a theme at most 250 of a product's variants, so the list
// cannot say that an ID is not a variant of the product once it is that long.
// ---------------------------------------------------------------------------

const variantSection = () => read("sections", "lookbook-variant.liquid");

test("an ID that is not in the product's list is only called missing when the list is whole", () => {
  assert.match(
    markup(),
    /if look_variant == null\s+(#[^\n]*\s+)*if variant_id > 0 and look_product\.variants\.size >= 250\s+assign pending_variant_id = variant_id\s+else\s+assign variant_missing = true\s+endif\s+endif/,
  );
  assert.match(markup(), /assign pending_variant_id = null/, "reset for every look");
});

test("a look with such a variant carries the ID, its product and the shop's root address for the script", () => {
  const source = markup();
  assert.match(source, /data-root-url="{{ routes\.root_url }}"/);
  const slot = source.slice(source.indexOf('class="valor-lookbook__card-slot"'));
  assert.match(
    slot.slice(0, 400),
    /{%-?\s*if pending_variant_id\s*%}\s*data-lookbook-variant="{{ pending_variant_id }}"\s+data-lookbook-product="{{ look_product\.id }}"\s*{%-?\s*endif\s*-?%}/,
  );
  assert.match(source, /pending_variant_id: pending_variant_id/, "and the card is told");
});

test("without the script such a look links to the product page with the variant chosen", () => {
  assert.match(
    card(),
    /elsif pending_variant_id != blank\s+assign card_url = product\.url \| append: '\?variant=' \| append: pending_variant_id/,
  );
});

test("the note for an ID that turns out to be no variant is for the theme editor, and hidden until the script knows", () => {
  const source = card();
  assert.match(
    source,
    /{%-?\s*elsif pending_variant_id != blank and request\.design_mode\s*-?%}\s*<p class="valor-lookbook__card-note" data-lookbook-variant-note hidden>/,
  );
});

test("the variant's card is a section of its own, rendered from the variant's ID", () => {
  const source = variantSection();
  assert.match(source, /{%-?\s*if product_variant != blank\s*-?%}/);
  assert.match(source, /<div data-lookbook-variant-card data-product-id="{{ product_variant\.product\.id }}">/);
  assert.match(
    source,
    /render 'lookbook-card',\s*product: product_variant\.product,\s*variant: product_variant\s*-?%}/,
  );
  const s = JSON.parse(source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);
  assert.equal(s.presets, undefined, "it cannot be added in the theme editor");
  assert.equal(s.blocks, undefined);
  // The script asks for it by this file's name.
  assert.match(read("assets", "lookbook.js"), /"variants\/" \+ id \+ "\/\?section_id=lookbook-variant"/);
});
