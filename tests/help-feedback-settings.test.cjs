const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The "Help & feedback" group is the first group in Theme settings. It shows
// the installed version and links to the feedback board with that version
// filled in, so a merchant's report says which release they run. The version
// is written into the text by hand, so this test makes sure a version bump
// updates it together with theme_version.
const schemaPath = path.resolve(__dirname, "..", "config", "settings_schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const info = schema[0];
const version = info.theme_version;
const group = schema[1];

function linksIn(text) {
  return [...String(text || "").matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
}

// Links live in paragraph settings. The theme editor shows no `info` text
// under a header in Theme settings (found in the 2.2.2 hands-on check), so a
// link there never reaches the merchant.
function paragraphLinks() {
  return group.settings.filter((s) => s.type === "paragraph").flatMap((s) => linksIn(s.content));
}

test("theme info points to the documentation and the feedback board", () => {
  assert.equal(info.name, "theme_info");
  assert.equal(info.theme_documentation_url, "https://valortheme.com/docs");
  assert.equal(info.theme_support_url, "https://valortheme.com/feedback");
});

test("Help & feedback is the first settings group and names the installed version", () => {
  assert.equal(group.name, "Help & feedback");
  const contents = group.settings.map((s) => s.content);
  assert.ok(
    contents.includes(`Valor ${version}`),
    `expected a "Valor ${version}" header, got ${JSON.stringify(contents)}`,
  );
});

test("the feedback board link fills in the installed version", () => {
  const links = paragraphLinks();
  assert.ok(
    links.includes(`https://valortheme.com/feedback/new?v=${version}`),
    `expected a feedback link with v=${version}, got ${JSON.stringify(links)}`,
  );
});

test("every help link goes straight to a valortheme.com page without a redirect", () => {
  const links = paragraphLinks();
  assert.ok(links.length >= 4, `expected at least 4 links, got ${links.length}`);
  for (const link of links) {
    const url = new URL(link);
    assert.equal(url.protocol, "https:", link);
    assert.equal(url.hostname, "valortheme.com", link);
    assert.ok(!url.pathname.endsWith(".html"), `${link} redirects to the clean URL`);
  }
});

test("no header carries an info text, which the editor would not show", () => {
  for (const setting of group.settings.filter((s) => s.type === "header")) {
    assert.equal(setting.info, undefined, JSON.stringify(setting));
  }
});

test("the group holds only headers and paragraphs, so it stores nothing in settings_data", () => {
  for (const setting of group.settings) {
    assert.ok(["header", "paragraph"].includes(setting.type), JSON.stringify(setting));
    assert.equal(setting.id, undefined, JSON.stringify(setting));
  }
});
