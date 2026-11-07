# Valor Theme

[![Latest release](https://img.shields.io/github/v/release/jrs8205/Valor-Theme?label=version)](https://github.com/jrs8205/Valor-Theme/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/jrs8205/Valor-Theme/total?label=downloads)](https://github.com/jrs8205/Valor-Theme/releases)

Valor is a premium Shopify Online Store 2.0 theme for fashion, jewelry,
accessories, and other visual product brands.

- Official website: [valortheme.com](https://valortheme.com)
- Live demo: [valor-theme.myshopify.com](https://valor-theme.myshopify.com)
- Documentation: [valortheme.com/docs.html](https://valortheme.com/docs.html)
- Wiki: [github.com/jrs8205/Valor-Theme/wiki](https://github.com/jrs8205/Valor-Theme/wiki)
- Changelog: [valortheme.com/changelog.html](https://valortheme.com/changelog.html)
- License: [Valor Free License](https://valortheme.com/license.html)

## Current Version

The current release is `2.2.1`.

Download the release ZIP from
[GitHub Releases](https://github.com/jrs8205/Valor-Theme/releases/latest) or
from the official website, [valortheme.com](https://valortheme.com). Both carry
the same file; its SHA-256 checksum is listed with each release. Upload the ZIP
in Shopify admin under Online Store > Themes > Add theme > Upload zip file.
Downloading and using the theme means accepting the
[Valor Free License](https://valortheme.com/license.html).

This repository contains the theme source so issues, fixes, and improvements
can be reviewed transparently.

## License

Valor Theme is source-available under the Valor Free License. It is currently
free for one Shopify store per download, but it is not licensed under MIT,
Apache, GPL, or another open-source license.

In short:

- You may use Valor Theme in one Shopify store per download.
- You may customize it for that store.
- You may create backups for your own use.
- You may not resell, redistribute, repackage, or publish the theme as your own
  product.

See [LICENSE.md](LICENSE.md) and the canonical license page:
[valortheme.com/license.html](https://valortheme.com/license.html).

## Features

- Complete Shopify Online Store 2.0 theme structure.
- Color schemes: reusable background/text schemes defined in Theme settings and
  applied per section. Four ship out of the box (light, subtle, dark, accent);
  borders and button fallbacks derive from the chosen scheme automatically. A
  section's scheme fills its whole row from edge to edge, with the content kept
  within the page width.
- Page width: Compact, Standard, Wide, or Full width, followed by every section.
- Product, collection, search, cart, blog, article, policy, password, and gift
  card templates.
- Cart drawer with discounts and order notes.
- Cart tax and shipping note that matches the store: VAT-inclusive stores say
  taxes are included, and the note mentions duties, discounts, fees, and a link
  to the shipping policy when they apply.
- Checkout waits for quantity changes that are still saving, and Enter in a
  cart quantity field saves the quantity instead of starting checkout.
- AJAX collection filtering and sorting, with settings for the filter bar's
  line thickness and colour.
- Collection banner with a video and a separate phone video; each collection
  can have its own videos through collection metafields.
- Header with an optional drawer menu on desktop and a bottom border with
  thickness and colour settings.
- Predictive search.
- Product cards with in-place colour swatch swap: click a swatch to update the
  card image and price without leaving the page.
- Colour swatches in the product page variant picker and collection filters,
  with theme-wide picker and swatch defaults plus per-section overrides.
- Custom swatch colours set in Theme settings, including two- and three-colour
  swatches for multicolour products.
- Combined listings: choosing a colour or other option that belongs to a sibling
  product opens that product, on product pages and product cards.
- Product media gallery with lightbox support and a two-column desktop layout.
- Product page blocks for title, vendor, SKU, price, unit price, variant
  picker, quantity, buy buttons with gift card recipient fields, inventory
  status, description, collapsible rows, popups, text, share, rating,
  complementary products, product disclosures, EU legal guarantee, custom
  Liquid, pickup availability, payment terms, and app blocks.
- Homepage sections including image banner, slideshow, featured collection,
  featured product, collection list, image with text, icon columns, rich text,
  newsletter, collapsible content, marquee, testimonials, logo list, countdown
  timer, video, promo grid, shop the look, contact form, recently viewed
  products, and custom Liquid.
- Video section with hero-style overlay content: heading, subheading, and
  buttons over the video, with position, text box, and darkening controls plus
  a one-click "Video hero" preset.
- EU price and product information: an optional label for compare-at prices
  (for example "Lowest price in the last 30 days") and a product safety block
  for manufacturer, responsible person, identifiers, and warnings (GPSR).
- EU legal guarantee notice: upload the official European Commission notice in
  Theme settings and Valor shows it in full from a "Your legal guarantee
  rights" link in the footer and on product pages, with a text version and a
  link to the Your Europe page in the shopper's language. On phones the notice
  opens at a legible size, with an overview of the whole notice one tap away. Product pages can
  also show a producer's GARAN durability guarantee label per product.
- Product disclosures: safety warnings and regulatory notices added to a
  product in Shopify admin appear on the product page and, when enabled for
  the cart, under the cart line item.
- Shopify standard storefront events and actions: page, product, collection,
  search, and cart events for apps and AI agents, and `Shopify.actions`
  configured so apps that change or open the cart update the cart drawer,
  header count, and cart page in place.
- Shopify account sign-in in the header on desktop and mobile.
- Ordered cart updates: quantity, discount, and note changes are processed in
  sequence so the cart drawer, cart page, and header count always match the
  cart, including after returning with the browser Back button.
- Right-to-left layout for Arabic, Hebrew, and Urdu storefronts: drawers,
  arrows, sliders, and alignment mirror automatically.
- Accessibility checked against WCAG 2.2 AA: Lighthouse accessibility 100 on the
  home, product, and collection pages.
- Theme Editor controls for typography, color schemes, buttons, sections, and
  custom CSS.

## Development

Install dependencies:

```powershell
npm install
```

Run the isolated Chromium cart and storefront-event regressions:

```powershell
npx playwright install chromium
npm test
```

These tests use simulated cart responses and never modify a Shopify store.
To check the event contract against a downloaded copy of Shopify's
`https://cdn.shopify.com/storefront/standard-events.js` module, set
`VALOR_STANDARD_EVENTS` to its local path before running `npm test`.
The default event tests use an offline contract double.

The tests run in Chromium by default. Set `VALOR_BROWSER=webkit` (Safari's
engine) or `VALOR_BROWSER=firefox` to run the same suite in another engine;
install it first with `npx playwright install webkit` (or `firefox`).

Run formatting check:

```powershell
npm run format:check
```

Run Shopify Theme Check:

```powershell
npm run check:json
```

Package the theme:

```powershell
npm run package
```

To run the theme against your own development store, authenticate with Shopify
CLI and use your own store configuration. The included `shopify.theme.toml`
points to the Valor demo store for project maintainers and is not a credential.

## Contributing

Bug reports, accessibility findings, compatibility issues, and focused pull
requests are welcome.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
Use GitHub Issues for reproducible bugs and feature requests. Do not post store
passwords, private customer data, access tokens, theme access passwords, or API
keys in issues or pull requests.

## Security

Please do not report security issues publicly. Follow
[SECURITY.md](SECURITY.md) for responsible disclosure.

## Support

There is no guaranteed support for the free version. For questions, use the
contact form on [valortheme.com](https://valortheme.com/#contact).

## Sponsor

If Valor is useful to you, you can support its development:

- [GitHub Sponsors](https://github.com/sponsors/jrs8205) — monthly or one-time
- [Buy Me a Coffee](https://buymeacoffee.com/jrs8205) — no sign-up needed
