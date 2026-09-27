# Storefront standards: repair and validation

Released as **Valor 2.1.0** on 2026-09-27 (this document records the
pre-release validation of the candidate).

Date: 2026-09-27. Branch: `storefront-standards`, based on `80f0d9f`.
The existing storefront standards changes were retained. Nothing was committed,
pushed, or published as a live theme during this repair.

## Corrections in this pass

- Drawer and cart-page quantity changes identify the item by its AJAX line key.
  Removing A and then B from A/B/C while requests are queued leaves C, including
  when rows contain the same variant. No positional fallback can remove a
  different product if a row key is missing.
- Both surfaces share the intended discount-code set until all pending discount
  actions finish. Rapid removals, mixed removal/application, and actions across
  both surfaces preserve the buyer's choices. The initial set is deduplicated
  because both the pill and its button carry `data-discount-code`. Pending state
  is released on success and failure; the page also has a local fallback.
- Cart-page refresh bookkeeping retains a synchronously reported start
  generation. A mutation with missing bundled sections therefore starts the
  required new refresh instead of joining an older snapshot.
- Additional confirmed defect: failed discount/note responses could reach
  `applyCartResponse()` as if an error message were a cart, clearing the header
  count and broadcasting invalid state. Both cart scripts now settle the
  standard event and reject the UI success path for non-success HTTP responses.
  Already-classified business declines are not subsequently reclassified by
  the catch handler.

The Shopify [Cart API](https://shopify.dev/docs/api/ajax/reference/cart) accepts
line keys as `id` for changes. Its keys can change when line characteristics
change; an obsolete key is allowed to decline and recover through refresh,
rather than falling back to a potentially different line position.
The [event dispatch contract](https://shopify.dev/docs/api/storefront-events-and-actions/events/dispatch)
distinguishes business declines from service failures.

## Automated and browser evidence

- `npm test`: 31 Chromium tests, covering the last review's three findings,
  the earlier stale-read and notification races, shared mutation ordering,
  overlapping external refreshes with and without the drawer, strict refresh
  failures, promise rejection handling, event readiness, action configuration,
  action reload recovery, and the additional HTTP-error rendering defect.
- The same 31 tests also passed with Shopify's CDN event library rather than
  the event double. Downloaded module SHA-256:
  `8509de1c86b86c53cda295862ecf11280334655e54dde8ea40963000ae2aa5ff`.
- Theme Check: 106 files, zero offenses.
- `node --check`: all 20 JavaScript assets passed. `git diff --check` passed.
- Formatting checks pass for the repaired cart scripts and new tests. The
  repository-wide formatting command also reports existing issues in unrelated
  theme files and local review-request documents; it is not a clean global gate.
- Existing local Shopify preview on `127.0.0.1:9292`: home, collection, search,
  cart, and product pages returned HTTP 200, initialized `ValorEvents`, and had
  no observed JavaScript page errors. Cart writes were blocked for these preview
  smoke checks. Race tests used simulated cart and section responses.
- A separate fresh browser session then exercised the real Shopify AJAX cart:
  product-form add to quantity 1, drawer change to 2, cart-page change to 3,
  and removal to 0. Server quantities and header counts matched, with no
  JavaScript page errors. The session started with an empty cart and its test
  cart was cleared afterward. No order was placed.

The supplied final-round findings are fixed in the tested paths. The earlier
initial-event, status, derived-promise, configuration, and refresh tests remain
green. Existing guarantee QR links, text alternatives, and named focusable
artwork regions were retained and checked in source.

## Distribution and merchant setup

The local candidate ZIP is built from the standard Shopify theme directories
only. It includes the previously added storefront-events and guarantee files,
and excludes tests, dependencies, caches, review documents, and developer logs.
The stock `settings_data.json` matches the committed default and contains only
the default color schemes. Existing release ZIPs are preserved.

Artifact:
`dist/valor-customer-candidate-20260927/Valor-2.0.0-storefront-standards-candidate.zip`
(157 files, 442,091 bytes). Every packaged file was byte-compared with the
working tree; ZIP integrity and forward-slash paths were verified. SHA-256:
`a81503a3642741559ea59c618f8e3c10ca1af457fc6302b411db8c9336b801d4`.

The candidate retained version metadata `2.0.0`; the release was then
versioned `2.1.0` and packaged as `Valor-2.1.0.zip`.

Before customer distribution, verify the complete cart-to-checkout flow in a
development store, including real discount eligibility, quantity limits,
customer accounts, and the target store's apps. Checkout/payment and account
login were not exercised in this pass. These local and preview results are not
evidence of a completed order or of every app integration.

For stores using the guarantee features, upload the unmodified official notice
in the appropriate language, translate its text equivalent, and configure the
product-specific GARAN artwork and accessible description, including duration,
producer and product identification. Actual merchant artwork and translations
were not supplied or validated here. Use the official files linked from the
theme settings. No artwork is fabricated or bundled as merchant content.
