const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

// VALOR_BROWSER=webkit|firefox runs the same tests on another engine
// (webkit = Safari's engine); chromium by default.
const engine = playwright[process.env.VALOR_BROWSER || "chromium"];

// Collection banner video (sections/collection.liquid): a banner video and an
// optional mobile video play muted and on a loop in place of the collection
// image; each can be connected to a collection metafield, so every
// collection can have its own. Real assets/collection-banner-video.js and
// collection.css; the markup mirrors the Liquid. Media playback is replaced
// by a recorder (no video files in the fixture).
const root = path.resolve(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const liquid = read("sections", "collection.liquid");
const css = read("assets", "critical.css") + read("assets", "collection.css");
const scriptPath = path.join(root, "assets", "collection-banner-video.js");

let browser;
before(async () => {
  browser = await engine.launch({ headless: true });
});
after(async () => {
  // WebKit on Windows can stall in close() after every test has passed;
  // npm test runs with --test-force-exit, so a stalled close can't hold the run.
  await Promise.race([browser?.close(), new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
});

// --- Settings and Liquid ----------------------------------------------------------

const schema = JSON.parse(liquid.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)[1]);
const setting = (id) => schema.settings.find((s) => s.id === id);

test("the banner has a video and a mobile video setting, with the banner settings", () => {
  assert.equal(setting("banner_video")?.type, "video");
  assert.equal(setting("banner_video_mobile")?.type, "video");
  const ids = schema.settings.map((s) => s.id || s.content);
  const banner = ids.indexOf("Banner");
  assert.ok(ids.indexOf("banner_video") > banner && ids.indexOf("banner_video") < ids.indexOf("Header"));
  assert.ok(ids.indexOf("banner_video_mobile") > ids.indexOf("banner_video"));
  assert.match(setting("banner_video").info, /metafield/i, "the info tells how to give each collection its own video");
});

test("the videos are muted, loop, play inline, have no controls and load nothing until played", () => {
  const tags = [...liquid.matchAll(/{{\s*banner_video(?:_mobile)?\s*\|\s*video_tag:([\s\S]*?)}}/g)].map((m) => m[1]);
  assert.equal(tags.length, 2, "one video_tag per video");
  for (const args of tags) {
    assert.match(args, /muted: true/);
    assert.match(args, /loop: true/);
    assert.match(args, /playsinline: true/);
    assert.match(args, /controls: false/);
    assert.match(args, /preload: 'none'/);
    assert.doesNotMatch(args, /autoplay: true/, "the script starts only the video that is shown");
  }
  assert.match(
    liquid,
    /{%-? if has_banner_video -?%}\s*<script src="{{ 'collection-banner-video\.js' \| asset_url }}" defer><\/script>/,
  );
});

// --- Behaviour ------------------------------------------------------------------

const poster = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="#888"/></svg>')}`;
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#ccc"/></svg>')}`;

// desktop / mobile: which media each one shows, as the Liquid decides it.
function markup({
  desktop = "video",
  mobile = "mobile_video",
  hasDesktopVideo = true,
  hasMobileVideo = true,
  hasImage = false,
}) {
  const media = [];
  const flags = (kind) => `${desktop === kind ? " is-desktop" : ""}${mobile === kind ? " is-mobile" : ""}`;
  if (hasImage)
    media.push(
      `<div class="valor-collection__banner-media${flags("image")}"><img id="Image" class="valor-collection__banner-image" src="${image}" width="1600" height="900" alt="Shirts"></div>`,
    );
  if (hasDesktopVideo)
    media.push(
      `<div class="valor-collection__banner-media${flags("video")}" aria-hidden="true"><video id="DesktopVideo" class="valor-collection__banner-video" muted loop playsinline preload="none" poster="${poster}"></video></div>`,
    );
  if (hasMobileVideo)
    media.push(
      `<div class="valor-collection__banner-media valor-collection__banner-media--own-ratio${flags("mobile_video")}" style="--valor-banner-ratio: 0.5625;" aria-hidden="true"><video id="MobileVideo" class="valor-collection__banner-video" muted loop playsinline preload="none" poster="${poster}"></video></div>`,
    );
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { --color-background: #fff; --color-foreground: #333; --page-width: 1200px; --page-margin: 20px; }
    ${css} body { margin: 0; }
  </style></head><body>
    <div class="shopify-section"><div class="valor-collection">
      <valor-banner-video class="valor-collection__banner valor-collection__banner--height-medium valor-collection__banner--video">
        ${media.join("\n")}
        <button type="button" class="valor-collection__banner-toggle" data-banner-video-toggle data-label-play="Play video" data-label-pause="Pause video" aria-label="Pause video" hidden>
          <svg class="valor-collection__banner-toggle-icon--play" viewBox="0 0 24 24" aria-hidden="true"></svg>
          <svg class="valor-collection__banner-toggle-icon--pause" viewBox="0 0 24 24" aria-hidden="true"></svg>
        </button>
      </valor-banner-video>
    </div></div>
    <script src="/assets/collection-banner-video.js"></script>
  </body></html>`;
}

async function open(t, width, options = {}, { reducedMotion = "no-preference", blockAutoplay = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  t.after(() => page.close());
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript((blockAutoplay) => {
    // blockAutoplay: the browser refuses the first play() (autoplay policy),
    // as a real one does with NotAllowedError; the video stays paused.
    let refused = !blockAutoplay;
    HTMLMediaElement.prototype.play = function () {
      if (!refused) {
        refused = true;
        return new Promise((resolve, reject) =>
          setTimeout(() => reject(new DOMException("play() was blocked", "NotAllowedError")), 20),
        );
      }
      this.dataset.state = "playing";
      this.dataset.plays = String(Number(this.dataset.plays || 0) + 1);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      if (this.dataset.state) this.dataset.state = "paused";
    };
  }, blockAutoplay);
  await page.route("http://banner.test/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/assets/collection-banner-video.js")
      return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(scriptPath, "utf8") });
    return route.fulfill({ contentType: "text/html", body: markup(options) });
  });
  await page.goto("http://banner.test/collections/shirts", { waitUntil: "load" });
  return page;
}

const state = (page) =>
  page.evaluate(() => {
    const video = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        state: el.dataset.state || "idle",
        shown: r.width > 0,
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    };
    const toggle = document.querySelector("[data-banner-video-toggle]");
    return {
      desktop: video("DesktopVideo"),
      mobile: video("MobileVideo"),
      image: video("Image"),
      toggle: { hidden: toggle.hidden, label: toggle.getAttribute("aria-label"), playing: toggle.dataset.playing },
    };
  });

test("desktop plays the banner video; the mobile video stays hidden and loads nothing", async (t) => {
  const page = await open(t, 1280);
  const s = await state(page);
  assert.equal(s.desktop.state, "playing");
  assert.equal(s.desktop.shown, true);
  assert.equal(s.mobile.state, "idle");
  assert.equal(s.mobile.shown, false);
  assert.deepEqual(s.toggle, { hidden: false, label: "Pause video", playing: "true" });
});

test("on desktop the video keeps the chosen banner height (Medium = 3:1)", async (t) => {
  const page = await open(t, 1280);
  const s = await state(page);
  assert.ok(Math.abs(s.desktop.height - s.desktop.width / 3) <= 2, JSON.stringify(s.desktop));
});

test("phones play the mobile video, in its own shape (a 9:16 cut stays whole)", async (t) => {
  const page = await open(t, 390);
  const s = await state(page);
  assert.equal(s.mobile.state, "playing");
  assert.equal(s.desktop.state, "idle");
  assert.equal(s.desktop.shown, false);
  assert.ok(Math.abs(s.mobile.height - (s.mobile.width * 16) / 9) <= 2, JSON.stringify(s.mobile));
});

test("without a mobile video, phones play the banner video", async (t) => {
  const page = await open(t, 390, { mobile: "video", hasMobileVideo: false });
  const s = await state(page);
  assert.equal(s.desktop.state, "playing");
  assert.equal(s.desktop.shown, true);
});

test("the collection image on desktop and a mobile video on phones", async (t) => {
  const options = { desktop: "image", mobile: "mobile_video", hasDesktopVideo: false, hasImage: true };
  const desk = await open(t, 1280, options);
  let s = await state(desk);
  assert.equal(s.image.shown, true);
  assert.equal(s.mobile.shown, false);
  assert.equal(s.mobile.state, "idle");
  assert.equal(s.toggle.hidden, true, "no video shown, no pause button");
  const phone = await open(t, 390, options);
  s = await state(phone);
  assert.equal(s.image.shown, false);
  assert.equal(s.mobile.state, "playing");
  assert.equal(s.toggle.hidden, false);
});

test("turning to a phone width switches to the mobile video", async (t) => {
  const page = await open(t, 1280);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForFunction(() => document.getElementById("MobileVideo").dataset.state === "playing");
  const s = await state(page);
  assert.equal(s.desktop.state, "paused");
  assert.equal(s.mobile.state, "playing");
});

test("the pause button stops the video, and it stays paused across a resize", async (t) => {
  const page = await open(t, 1280);
  await page.click("[data-banner-video-toggle]");
  let s = await state(page);
  assert.equal(s.desktop.state, "paused");
  assert.deepEqual(s.toggle, { hidden: false, label: "Play video", playing: "false" });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(100);
  s = await state(page);
  assert.equal(s.mobile.state, "idle", "a paused banner stays paused on the other video too");
  await page.click("[data-banner-video-toggle]");
  s = await state(page);
  assert.equal(s.mobile.state, "playing");
  assert.equal(s.toggle.label, "Pause video");
});

test("when the browser blocks autoplay, the button shows Play and one tap starts the video", async (t) => {
  const page = await open(t, 1280, {}, { blockAutoplay: true });
  await page.waitForFunction(() => document.querySelector("[data-banner-video-toggle]").dataset.playing === "false");
  let s = await state(page);
  assert.equal(s.desktop.state, "idle", "nothing plays");
  assert.deepEqual(s.toggle, { hidden: false, label: "Play video", playing: "false" });
  await page.click("[data-banner-video-toggle]");
  s = await state(page);
  assert.equal(s.desktop.state, "playing", "a single tap starts it");
  assert.deepEqual(s.toggle, { hidden: false, label: "Pause video", playing: "true" });
});

test("with reduced motion the video does not start by itself; the button starts it", async (t) => {
  const page = await open(t, 1280, {}, { reducedMotion: "reduce" });
  let s = await state(page);
  assert.equal(s.desktop.state, "idle");
  assert.deepEqual(s.toggle, { hidden: false, label: "Play video", playing: "false" });
  await page.click("[data-banner-video-toggle]");
  s = await state(page);
  assert.equal(s.desktop.state, "playing");
});

// --- Filtering keeps the banner ------------------------------------------------------

async function openSwapPage(t) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  t.after(() => page.close());
  await page.addInitScript(() => {
    window.plays = [];
    HTMLMediaElement.prototype.play = function () {
      window.plays.push(this.id + (this.dataset.marker ? ":" + this.dataset.marker : ":new"));
      this.dataset.state = "playing";
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      if (this.dataset.state) this.dataset.state = "paused";
    };
    // Every <valor-banner-video> put into the document other than the one
    // the page started with (which may be moved back in).
    window.bannersAdded = 0;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          const banners = node.matches("valor-banner-video")
            ? [node]
            : [...node.querySelectorAll("valor-banner-video")];
          window.bannersAdded += banners.filter((banner) => banner !== window.bannerBefore).length;
        }
    }).observe(document, { childList: true, subtree: true });
  });
  const section = (
    count,
  ) => `<valor-collection data-collection-section-id="main" data-template="collection" data-results-count="${count}">
      <valor-banner-video class="valor-collection__banner valor-collection__banner--video" data-banner-key="v1-v2-">
        <div class="valor-collection__banner-media is-desktop is-mobile" aria-hidden="true"><video id="DesktopVideo" muted loop playsinline preload="none"></video></div>
        <button type="button" data-banner-video-toggle data-label-play="Play video" data-label-pause="Pause video" hidden></button>
      </valor-banner-video>
      <p id="Count">${count} products</p>
    </valor-collection>`;
  await page.route("http://banner.test/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/assets/"))
      return route.fulfill({ contentType: "text/javascript", body: read(...url.pathname.slice(1).split("/")) });
    if (url.searchParams.get("section_id") === "main")
      return route.fulfill({ contentType: "text/html", body: `<div id="shopify-section-main">${section(3)}</div>` });
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><script>window.Shopify={routes:{root:'/'}};</script>
        <script src="/assets/collection-banner-video.js" defer></script>
        <script src="/assets/collection.js" defer></script></head>
        <body><main>${section(12)}</main></body></html>`,
    });
  });
  await page.goto("http://banner.test/collections/shirts", { waitUntil: "load" });
  await page.evaluate(() => {
    window.bannerBefore = document.querySelector("valor-banner-video");
    window.bannerBefore.querySelector("video").dataset.marker = "kept";
    window.bannersAdded = 0;
    window.plays = [];
  });
  return page;
}

async function refresh(page) {
  await page.evaluate(() =>
    document.querySelector("valor-collection")._fetchAndReplace("?sort_by=price-ascending", false),
  );
  await page.waitForFunction(() => document.getElementById("Count").textContent === "3 products");
  return page.evaluate(() => ({
    same: document.querySelector("valor-banner-video") === window.bannerBefore,
    marker: document.querySelector("valor-banner-video video").dataset.marker,
    state: document.querySelector("valor-banner-video video").dataset.state,
    banners: document.querySelectorAll("valor-banner-video").length,
    newBannersInDocument: window.bannersAdded,
    plays: window.plays,
  }));
}

test("filtering or sorting keeps the playing banner: no new banner or video ever enters the page", async (t) => {
  const page = await openSwapPage(t);
  const r = await refresh(page);
  assert.equal(r.same, true);
  assert.equal(r.marker, "kept");
  assert.equal(r.state, "playing");
  assert.equal(r.banners, 1);
  assert.equal(r.newBannersInDocument, 0, "the fresh banner is never put into the document");
  assert.ok(
    r.plays.every((p) => p.endsWith(":kept")),
    `only the kept video is (re)played: ${JSON.stringify(r.plays)}`,
  );
});

test("a banner the shopper paused stays paused through a filter or sort refresh", async (t) => {
  const page = await openSwapPage(t);
  await page.click("[data-banner-video-toggle]");
  await page.evaluate(() => (window.plays = []));
  const r = await refresh(page);
  assert.equal(r.same, true);
  assert.equal(r.state, "paused");
  assert.deepEqual(r.plays, [], "nothing starts playing");
  assert.equal(r.newBannersInDocument, 0);
});

// --- A collection's own videos ---------------------------------------------------------

// Collections can have their own videos in the collection metafields
// custom.banner_video and custom.banner_video_mobile (File, videos), read by
// the theme itself, without connecting anything in the editor. The section's
// videos are the default for collections without their own.
const bannerLogic = liquid.match(/assign banner_video = [\s\S]*?assign desktop_media = ''/)[0];

test("the section reads the collection's own video metafields", () => {
  assert.match(bannerLogic, /collection\.metafields\.custom\.banner_video\.value/);
  assert.match(bannerLogic, /collection\.metafields\.custom\.banner_video_mobile\.value/);
  // Only a video counts: a metafield that holds an image (or anything else)
  // is ignored rather than passed to video_tag.
  assert.match(bannerLogic, /own_video\.media_type == 'video'/);
  assert.match(bannerLogic, /own_video_mobile\.media_type == 'video'/);
});

test("a collection's own videos replace the section's videos as a set", () => {
  // With any own video, the section's defaults are cleared first, so a
  // collection never mixes its own video with the store-wide one.
  const ownBranch = bannerLogic.match(/if has_own_video([\s\S]*?)\n  endif\n/)[1];
  assert.match(ownBranch, /assign banner_video = (nil|null)\b/);
  assert.match(ownBranch, /assign banner_video_mobile = (nil|null)\b/);
  assert.match(ownBranch, /assign banner_video = own_video\b/);
  assert.match(ownBranch, /assign banner_video_mobile = own_video_mobile\b/);
  assert.ok(
    bannerLogic.indexOf("assign banner_video = section.settings.banner_video") <
      bannerLogic.indexOf("if has_own_video"),
    "the section's videos are the default, set before",
  );
});

test("the settings tell how a collection gets its own video", () => {
  assert.match(setting("banner_video").info, /custom\.banner_video/);
  assert.match(setting("banner_video_mobile").info, /custom\.banner_video_mobile/);
});
