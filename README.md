# Valor Theme

Valor is a premium Shopify Online Store 2.0 theme for fashion, jewelry,
accessories, and other visual product brands.

- Official website: [valortheme.com](https://valortheme.com)
- Live demo: [valor-theme.myshopify.com](https://valor-theme.myshopify.com)
- Documentation: [valortheme.com/docs.html](https://valortheme.com/docs.html)
- Changelog: [valortheme.com/changelog.html](https://valortheme.com/changelog.html)
- License: [Valor Free License](https://valortheme.com/license.html)

## Current Version

The current release is `1.3.6`.

Downloadable release ZIPs are published from the official website. This
repository contains the theme source so issues, fixes, and improvements can be
reviewed transparently.

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
- Product, collection, search, cart, blog, article, policy, password, and gift
  card templates.
- Cart drawer with discounts and order notes.
- AJAX collection filtering and sorting.
- Predictive search.
- Product media gallery with lightbox support.
- Product page blocks for title, price, variant picker, quantity, buy buttons,
  description, share, rating, complementary products, custom Liquid, pickup
  availability, payment terms, unit price, and gift card recipient fields.
- Homepage sections including image banner, featured collection, collection
  list, image with text, icon columns, rich text, newsletter, collapsible
  content, marquee, testimonials, logo list, custom Liquid, slideshow, promo
  grid, and shop the look.
- Theme Editor controls for typography, colors, buttons, sections, and custom
  CSS.

## Development

Install dependencies:

```powershell
npm install
```

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
