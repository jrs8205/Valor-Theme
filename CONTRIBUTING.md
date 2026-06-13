# Contributing to Valor Theme

Thanks for helping improve Valor Theme. This project accepts bug reports,
accessibility findings, Shopify compatibility reports, focused fixes, and
carefully scoped feature proposals.

## Before You Start

- Check the existing issues and pull requests.
- For larger changes, open an issue first and wait for maintainer feedback.
- Keep pull requests focused on one problem.
- Do not include store passwords, customer data, access tokens, API keys, theme
  access passwords, or private merchant data.

## Development Setup

Install dependencies:

```powershell
npm install
```

Run formatting and Theme Check before submitting:

```powershell
npm run format:check
npm run check:json
```

If you use Shopify CLI locally, connect it to your own development store. Do not
expect access to the Valor demo store.

## Code Standards

- Keep the theme HTML-first and Liquid-first.
- Use JavaScript only where progressive enhancement is needed.
- Do not add jQuery, React, Vue, external UI libraries, or remote UI assets.
- Keep assets in the theme and serve them through Shopify.
- Use Valor class naming; new theme classes should start with `valor-`.
- Use lowercase snake_case for setting IDs.
- Merchant-facing text should use translation keys.
- Avoid duplicate snippets, dead CSS, debug code, TODO comments, and unused
  settings.
- Do not add parser-blocking scripts.
- Images should use Shopify image filters with explicit widths where needed.
- Preserve backwards compatibility for existing merchants where possible.

## Pull Request Checklist

Before opening a pull request:

- [ ] The change has a clear reason and scope.
- [ ] `npm run format:check` passes.
- [ ] `npm run check:json` passes, or the reason it cannot run is explained.
- [ ] New visible text has translation keys.
- [ ] New settings have clear labels and defaults.
- [ ] No secrets, passwords, private store data, or generated ZIP files are
      included.
- [ ] Relevant pages were manually checked in a Shopify development store when
      behavior changed.

## Licensing of Contributions

By contributing, you agree that your contribution may be included in Valor Theme
and distributed under the Valor Free License or a future Valor license published
by the project maintainer.

## Security

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
