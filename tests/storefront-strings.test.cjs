const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Every text a shopper sees or hears comes from locales/en.default.json (the
// `t` filter) or from a setting, so a store can translate it with Shopify's
// Translate & Adapt app or edit it under "Edit default theme content". This
// scan reads the Liquid markup of sections, snippets, blocks and layouts and
// lists text written straight into it: text between tags, and the
// aria-label, placeholder, alt and title attributes.
const root = path.resolve(__dirname, "..");

// Names that stay the same in every language, and notes that only the theme
// editor shows (request.design_mode), which are for the merchant like the
// settings themselves.
const ALLOWED = new Set([
  "Facebook",
  "Twitter",
  "Pinterest",
  "Instagram",
  "TikTok",
  "YouTube",
  "LinkedIn",
  "Threads",
  "Snapchat",
  "WhatsApp",
  "Set an end date to start the countdown.",
  "Recently viewed products appear here after a visitor opens at least one other product.",
]);

// Removed before scanning, in this order: comments first (their prose may
// mention tags), then code and markup that is not shopper-facing text.
const STRIP = [
  /{%-?\s*comment\s*-?%}[\s\S]*?{%-?\s*endcomment\s*-?%}/g,
  /{%-?\s*doc\s*-?%}[\s\S]*?{%-?\s*enddoc\s*-?%}/g,
  /{%-?\s*schema\s*-?%}[\s\S]*?{%-?\s*endschema\s*-?%}/g,
  /{%-?\s*stylesheet\s*-?%}[\s\S]*?{%-?\s*endstylesheet\s*-?%}/g,
  /{%-?\s*javascript\s*-?%}[\s\S]*?{%-?\s*endjavascript\s*-?%}/g,
  /{%-?\s*style\s*-?%}[\s\S]*?{%-?\s*endstyle\s*-?%}/g,
  /<script\b[\s\S]*?<\/script>/g,
  /<style\b[\s\S]*?<\/style>/g,
  /<svg\b[\s\S]*?<\/svg>/g,
  /<!--[\s\S]*?-->/g,
  /{%[\s\S]*?%}/g,
  /{{[\s\S]*?}}/g,
  // Character references (&rarr;, &copy;, &ndash;) are symbols, not words.
  /&[a-zA-Z]+;|&#\d+;/g,
];

function hardcodedStrings() {
  const found = [];
  for (const dir of ["sections", "snippets", "blocks", "layout", "templates"]) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).filter((f) => f.endsWith(".liquid"))) {
      let text = fs.readFileSync(path.join(full, name), "utf8");
      // Keep line numbers: replace each stripped part with its newlines.
      for (const pattern of STRIP) text = text.replace(pattern, (m) => m.replace(/[^\n]/g, ""));
      const file = `${dir}/${name}`;
      for (const m of text.matchAll(/>([^<>]*[A-Za-z]{3,}[^<>]*)</g)) {
        const value = m[1].replace(/\s+/g, " ").trim();
        if (!ALLOWED.has(value)) found.push(`${file}: text "${value}"`);
      }
      for (const m of text.matchAll(/\b(aria-label|placeholder|alt|title)="([^"]*[A-Za-z]{3,}[^"]*)"/g)) {
        const value = m[2].replace(/\s+/g, " ").trim();
        if (!ALLOWED.has(value)) found.push(`${file}: ${m[1]} "${value}"`);
      }
    }
  }
  return found;
}

test("shopper-facing text comes from the locale file or settings, so stores can translate it", () => {
  assert.deepEqual(hardcodedStrings(), []);
});

test("the scan finds text written straight into markup", () => {
  // The scan itself: text and attributes are caught, Liquid output is not.
  const sample = `<span class="a">Days</span><div aria-label="{{ n }} out of 5 stars"></div><p>{{ 'x' | t }}</p><a>&rarr;</a>`;
  let text = sample;
  for (const pattern of STRIP) text = text.replace(pattern, "");
  const texts = [...text.matchAll(/>([^<>]*[A-Za-z]{3,}[^<>]*)</g)].map((m) => m[1].trim());
  const attrs = [...text.matchAll(/\b(aria-label|placeholder|alt|title)="([^"]*[A-Za-z]{3,}[^"]*)"/g)].map((m) =>
    m[2].trim(),
  );
  assert.deepEqual(texts, ["Days"]);
  assert.deepEqual(attrs, ["out of 5 stars"]);
});

const locale = JSON.parse(fs.readFileSync(path.join(root, "locales", "en.default.json"), "utf8"));
const lookup = (key) => key.split(".").reduce((node, part) => node && node[part], locale);

test("every translation key the Liquid uses exists in the locale file", () => {
  const missing = [];
  for (const dir of ["sections", "snippets", "blocks", "layout"]) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).filter((f) => f.endsWith(".liquid"))) {
      const text = fs.readFileSync(path.join(full, name), "utf8");
      for (const m of text.matchAll(/'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'\s*\|\s*t\b/g)) {
        if (lookup(m[1]) === undefined) missing.push(`${dir}/${name}: ${m[1]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
