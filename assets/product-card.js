/*
 * <valor-product-card>
 *
 * Progressive-enhancement wrapper around a product card. When the card
 * renders colour swatches, clicking one swaps the card's primary image,
 * price, and active state IN PLACE instead of navigating to the product
 * page — the Horizon-style behaviour. Each swatch is still a real
 * <a href="…?variant=ID"> link, so without JavaScript (or on modified /
 * middle clicks) it falls back to opening the product page. The per-swatch
 * data (image src/srcset, price HTML, availability) is rendered by Liquid
 * in snippets/product-card.liquid.
 */
(function () {
  if (customElements.get('valor-product-card')) return;

  class ValorProductCard extends HTMLElement {
    connectedCallback() {
      this.swatches = Array.from(this.querySelectorAll('[data-swatch-swap]'));
      if (!this.swatches.length) return;

      this.card = this.querySelector('.valor-card');
      this.primaryImage = this.querySelector('.valor-card__image--primary');
      this.priceEl = this.querySelector('.valor-card__price');
      this.unitPriceEl = this.querySelector('.valor-card__unit-price');

      // Remember the card's initial image + hover-swap state so a colour that
      // has no distinct image of its own can restore it, instead of leaving a
      // previously-selected colour's photo on the card.
      if (this.primaryImage) {
        this.originalMedia = {
          src: this.primaryImage.getAttribute('src') || '',
          srcset: this.primaryImage.getAttribute('srcset') || '',
          alt: this.primaryImage.getAttribute('alt') || '',
          width: this.primaryImage.getAttribute('width') || '',
          height: this.primaryImage.getAttribute('height') || '',
        };
      }
      this.hoverSwap = !!(
        this.card && this.card.classList.contains('valor-card--swap-image')
      );

      this.links = Array.from(
        this.querySelectorAll(
          '.valor-card__media-link, .valor-card__title-link, a.valor-card__quick-add-button'
        )
      );

      this._onClick = this._onClick.bind(this);
      this.addEventListener('click', this._onClick);
    }

    disconnectedCallback() {
      this.removeEventListener('click', this._onClick);
    }

    _onClick(event) {
      // Leave modified / non-primary clicks to the browser so shoppers can
      // still open the product page in a new tab from a swatch.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const swatch = event.target.closest('[data-swatch-swap]');
      if (!swatch || !this.contains(swatch)) return;

      const src = swatch.getAttribute('data-media-src');
      const priceHtml = swatch.getAttribute('data-price');
      // Nothing to swap for this swatch → let the link navigate normally.
      if (!src && !priceHtml) return;

      event.preventDefault();
      this._select(swatch, src, priceHtml);
    }

    _select(swatch, src, priceHtml) {
      if (this.primaryImage) {
        if (src) {
          // This colour has its own image → swap to it and suppress the hover
          // secondary-image swap so hovering can't reveal a different colour.
          this.primaryImage.src = src;
          this.primaryImage.srcset =
            swatch.getAttribute('data-media-srcset') || '';
          this._setMediaMeta(
            swatch.getAttribute('data-media-alt'),
            swatch.getAttribute('data-media-width'),
            swatch.getAttribute('data-media-height')
          );
          if (this.card) this.card.classList.remove('valor-card--swap-image');
        } else if (this.originalMedia) {
          // This colour has no distinct image → restore the card's original
          // image rather than leaving a previously-selected colour's photo.
          this.primaryImage.src = this.originalMedia.src;
          this.primaryImage.srcset = this.originalMedia.srcset;
          this._setMediaMeta(
            this.originalMedia.alt,
            this.originalMedia.width,
            this.originalMedia.height
          );
          if (this.card && this.hoverSwap) {
            this.card.classList.add('valor-card--swap-image');
          }
        }
      }

      if (priceHtml && this.priceEl) {
        this.priceEl.innerHTML = priceHtml;
      }

      // Unit price of the colour's variant. An empty value means the colour
      // has none, so the line hides; cards rendered without the attribute
      // keep their unit price.
      const unitPrice = swatch.getAttribute('data-unit-price');
      if (unitPrice !== null && this.unitPriceEl) {
        const unitValue = this.unitPriceEl.querySelector('[data-unit-price]');
        if (unitValue) unitValue.innerHTML = unitPrice;
        this.unitPriceEl.hidden = unitPrice === '';
      }

      const href = swatch.getAttribute('href');
      if (href) {
        this.links.forEach((link) => {
          link.href = href;
        });
      }

      this.swatches.forEach((node) => {
        const isActive = node === swatch;
        node.classList.toggle('is-active', isActive);
        if (isActive) node.setAttribute('aria-current', 'true');
        else node.removeAttribute('aria-current');
      });
    }

    _setMediaMeta(alt, width, height) {
      if (!this.primaryImage) return;
      if (alt !== null && alt !== undefined) this.primaryImage.alt = alt;
      if (width) this.primaryImage.setAttribute('width', width);
      if (height) this.primaryImage.setAttribute('height', height);
    }
  }

  customElements.define('valor-product-card', ValorProductCard);
})();
