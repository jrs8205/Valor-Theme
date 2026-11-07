/**
 * <valor-product-media>
 *
 * Handles the product gallery:
 *   - Thumbnail switching (when shown)
 *   - Swipe navigation on touch devices (always when >1 image)
 *   - Click navigation arrows on the main image (always when >1 image)
 *   - Lightbox opening on tap/click (when enabled)
 *   - Variant image switching via 'valor:gallery:set-media' event
 *
 * Variant change protocol:
 *   gallery.dispatchEvent(new CustomEvent('valor:gallery:set-media', {
 *     detail: { mediaId: '...' }
 *   }));
 */
class ValorProductMedia extends HTMLElement {
  constructor() {
    super();
    this._handleThumbClick = this.onThumbClick.bind(this);
    this._handleProgressClick = this.onProgressClick.bind(this);
    this._handleGridClick = this.onGridClick.bind(this);
    this._handleMainClick = this.onMainClick.bind(this);
    this._handleSetMedia = this.onSetMedia.bind(this);
    this._handleTouchStart = this.onTouchStart.bind(this);
    this._handleTouchEnd = this.onTouchEnd.bind(this);
    this._handlePrevClick = this.onPrevClick.bind(this);
    this._handleNextClick = this.onNextClick.bind(this);
    this._handleThumbsScroll = this.onThumbsScroll.bind(this);
    this._handleThumbsPrev = this.onThumbsPrevClick.bind(this);
    this._handleThumbsNext = this.onThumbsNextClick.bind(this);
    this._handleResize = this.updateThumbsNavState.bind(this);
  }

  connectedCallback() {
    this.mainItems = Array.from(this.querySelectorAll(".valor-product-media__main-item"));
    this.thumbs = Array.from(this.querySelectorAll(".valor-product-media__thumb"));
    this.mainEl = this.querySelector(".valor-product-media__main");
    this.prevBtn = this.querySelector("[data-gallery-prev]");
    this.nextBtn = this.querySelector("[data-gallery-next]");
    this.counterEl = this.querySelector("[data-gallery-counter]");
    this.progressEl = this.querySelector("[data-gallery-progress]");
    this.progressButtons = Array.from(this.querySelectorAll("[data-gallery-progress-button]"));
    this.gridItems = Array.from(this.querySelectorAll("[data-gallery-grid-item]"));
    this.thumbsTrack = this.querySelector("[data-thumbs-track]");
    this.thumbsPrev = this.querySelector("[data-thumbs-prev]");
    this.thumbsNext = this.querySelector("[data-thumbs-next]");
    this.lightboxEnabled = this.dataset.lightboxEnabled !== "false";

    this.thumbs.forEach((t) => t.addEventListener("click", this._handleThumbClick));
    this.progressButtons.forEach((button) => button.addEventListener("click", this._handleProgressClick));
    this.gridItems.forEach((button) => button.addEventListener("click", this._handleGridClick));
    this.mainItems.forEach((m) => m.addEventListener("click", this._handleMainClick));
    this.addEventListener("valor:gallery:set-media", this._handleSetMedia);

    if (this.prevBtn) this.prevBtn.addEventListener("click", this._handlePrevClick);
    if (this.nextBtn) this.nextBtn.addEventListener("click", this._handleNextClick);

    // Thumbnail scroll arrows: hidden by default, revealed only when the
    // track overflows. Update on scroll, on resize, and once on init.
    if (this.thumbsTrack) {
      this.thumbsTrack.addEventListener("scroll", this._handleThumbsScroll, { passive: true });
      window.addEventListener("resize", this._handleResize);
      if (this.thumbsPrev) this.thumbsPrev.addEventListener("click", this._handleThumbsPrev);
      if (this.thumbsNext) this.thumbsNext.addEventListener("click", this._handleThumbsNext);
      // Defer to next frame so layout is settled before measuring
      requestAnimationFrame(() => this.updateThumbsNavState());
    }

    // Swipe support on the main image area (touch devices)
    if (this.mainEl && this.mainItems.length > 1) {
      this.mainEl.addEventListener("touchstart", this._handleTouchStart, { passive: true });
      this.mainEl.addEventListener("touchend", this._handleTouchEnd, { passive: true });
    }

    this.updateNavState();

    // Per-color image grouping (opt-in, product page only). Active only when
    // the root carries data-color-grouping; filters media to the selected color.
    this.colorGrouping = this.dataset.colorGrouping === "true";
    if (this.colorGrouping) this.initColorGrouping();
  }

  getActiveIndex() {
    return this.mainItems.findIndex((item) => item.classList.contains("is-active"));
  }

  onThumbClick(e) {
    const btn = e.currentTarget;
    const mediaId = btn.dataset.thumbFor;
    if (mediaId) this.setActiveMedia(mediaId);
  }

  onProgressClick(e) {
    const btn = e.currentTarget;
    const mediaId = btn.dataset.mediaId;
    if (mediaId) this.setActiveMedia(mediaId);
  }

  onGridClick(e) {
    if (!this.lightboxEnabled) return;
    e.preventDefault();
    const btn = e.currentTarget;
    this.openLightbox(btn.dataset.mediaId);
  }

  onSetMedia(e) {
    const mediaId = e.detail && e.detail.mediaId;
    if (!mediaId) return;
    if (this.colorGrouping) {
      const target = this.mainItems.find((it) => String(it.dataset.mediaId) === String(mediaId));
      // The variant's featured image isn't in the active color group; let the
      // color filter pick the first visible image instead of blanking the main.
      if (target && target.classList.contains("is-color-hidden")) return;
    }
    this.setActiveMedia(mediaId);
  }

  setActiveMedia(mediaId) {
    this.mainItems.forEach((item) => {
      const match = String(item.dataset.mediaId) === String(mediaId);
      if (match) {
        item.classList.add("is-active");
        item.removeAttribute("hidden");
      } else {
        item.classList.remove("is-active");
        item.setAttribute("hidden", "");
      }
    });
    this.thumbs.forEach((thumb) => {
      thumb.classList.toggle("is-active", String(thumb.dataset.thumbFor) === String(mediaId));
    });
    this.progressButtons.forEach((button) => {
      button.setAttribute("aria-current", String(button.dataset.mediaId) === String(mediaId) ? "true" : "false");
    });
    this.gridItems.forEach((button) => {
      button.classList.toggle("is-active", String(button.dataset.mediaId) === String(mediaId));
    });
    const activeThumb = this.thumbs.find((t) => t.classList.contains("is-active"));
    if (activeThumb) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      activeThumb.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "nearest",
        inline: "center",
      });
    }
    this.updateNavState();
    this.updateThumbsNavState();
  }

  setActiveByIndex(index) {
    const total = this.mainItems.length;
    if (total === 0) return;
    // Wrap around for continuous swipe feel
    if (index < 0) index = total - 1;
    if (index >= total) index = 0;
    const item = this.mainItems[index];
    if (item) this.setActiveMedia(item.dataset.mediaId);
  }

  // Step within the currently visible items. With color grouping off, the
  // visible set is every main item, so behavior is unchanged.
  step(direction) {
    const visible = this.colorGrouping ? this.getVisibleMainItems() : this.mainItems;
    if (!visible.length) return;
    const active = this.mainItems[this.getActiveIndex()];
    let pos = visible.indexOf(active);
    if (pos === -1) pos = 0;
    let nextPos = pos + direction;
    if (nextPos < 0) nextPos = visible.length - 1;
    if (nextPos >= visible.length) nextPos = 0;
    const target = visible[nextPos];
    if (target) this.setActiveMedia(target.dataset.mediaId);
  }

  next() {
    this.step(1);
  }
  prev() {
    this.step(-1);
  }

  onPrevClick(e) {
    e.preventDefault();
    e.stopPropagation();
    this.prev();
  }

  onNextClick(e) {
    e.preventDefault();
    e.stopPropagation();
    this.next();
  }

  updateNavState() {
    // Count within the visible set so the counter/progress reflect the
    // selected color when filtering; identical to before when grouping is off.
    const items = this.colorGrouping ? this.getVisibleMainItems() : this.mainItems;
    const activeItem = this.mainItems[this.getActiveIndex()];
    const i = activeItem ? items.indexOf(activeItem) : -1;
    const total = items.length;
    if (this.counterEl) {
      if (i >= 0 && total > 1) {
        this.counterEl.textContent = i + 1 + " / " + total;
        this.counterEl.removeAttribute("hidden");
      } else {
        this.counterEl.setAttribute("hidden", "");
      }
    }

    if (this.progressEl && i >= 0 && total > 1) {
      const width = 100 / total;
      this.progressEl.dataset.activeIndex = String(i);
      this.progressEl.style.setProperty("--gallery-progress-width", width + "%");
      this.progressEl.style.setProperty("--gallery-progress-left", i * width + "%");
    }
  }

  onMainClick(e) {
    if (!this.lightboxEnabled) return;
    if (this._suppressClick) {
      this._suppressClick = false;
      return;
    }
    e.preventDefault();
    this.openLightbox(e.currentTarget.dataset.mediaId);
  }

  openLightbox(mediaId) {
    // Show the currently visible set — the selected color when grouping is on,
    // otherwise every image. Index is resolved from the clicked media id.
    const source = this.colorGrouping ? this.getVisibleMainItems() : this.mainItems;
    const images = source.map((item) => ({
      src: item.dataset.mediaSrc,
      srcset: item.dataset.mediaSrcset,
      sizes: "100vw",
      alt: item.dataset.mediaAlt || "",
    }));
    let index = source.findIndex((item) => String(item.dataset.mediaId) === String(mediaId));
    if (index < 0) index = 0;

    document.dispatchEvent(
      new CustomEvent("valor:lightbox:open", {
        detail: { images: images, index: index },
      }),
    );
  }

  onTouchStart(e) {
    if (!e.touches || !e.touches.length) return;
    this._touchStartX = e.touches[0].clientX;
    this._touchStartY = e.touches[0].clientY;
    this._touchStartT = Date.now();
  }

  onTouchEnd(e) {
    if (this._touchStartX == null) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - this._touchStartX;
    const dy = t.clientY - this._touchStartY;
    const dt = Date.now() - this._touchStartT;
    this._touchStartX = null;
    this._touchStartY = null;

    // Treat as swipe if horizontal motion dominates and crosses threshold,
    // OR if it was a fast flick (>0.3 px/ms with at least 25px).
    const fastFlick = Math.abs(dx) / Math.max(dt, 1) > 0.3 && Math.abs(dx) > 25;
    const longSwipe = Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4;

    if (fastFlick || longSwipe) {
      this._suppressClick = true;
      // In right-to-left stores a swipe to the right moves forward.
      const towardPrevious = this._isRtl() ? dx < 0 : dx > 0;
      if (towardPrevious) this.prev();
      else this.next();
    }
  }

  _isRtl() {
    return getComputedStyle(this).direction === "rtl";
  }

  /* Thumbnail strip nav buttons. They appear only when the track has
     more content than visible width, and individually disappear when
     the user has scrolled all the way to that edge. We expose a fixed
     scroll step (~80% of visible width) so each click feels deliberate
     without overshooting. */
  onThumbsScroll() {
    this.updateThumbsNavState();
  }

  onThumbsPrevClick() {
    if (!this.thumbsTrack) return;
    const step = Math.max(this.thumbsTrack.clientWidth * 0.8, 80);
    // Toward the start: left in LTR, right (positive) in RTL.
    this.thumbsTrack.scrollBy({ left: this._isRtl() ? step : -step, behavior: "smooth" });
  }

  onThumbsNextClick() {
    if (!this.thumbsTrack) return;
    const step = Math.max(this.thumbsTrack.clientWidth * 0.8, 80);
    this.thumbsTrack.scrollBy({ left: this._isRtl() ? -step : step, behavior: "smooth" });
  }

  updateThumbsNavState() {
    if (!this.thumbsTrack) return;
    const track = this.thumbsTrack;
    const overflowing = track.scrollWidth > track.clientWidth + 1;

    if (!overflowing) {
      if (this.thumbsPrev) this.thumbsPrev.hidden = true;
      if (this.thumbsNext) this.thumbsNext.hidden = true;
      return;
    }

    // 2px tolerance for sub-pixel rounding at scroll extremes
    // scrollLeft is 0 at the start and negative toward the end in RTL.
    const offset = Math.abs(track.scrollLeft);
    const atStart = offset <= 2;
    const atEnd = offset + track.clientWidth >= track.scrollWidth - 2;

    if (this.thumbsPrev) this.thumbsPrev.hidden = atStart;
    if (this.thumbsNext) this.thumbsNext.hidden = atEnd;
  }

  /* --- Per-color image grouping (opt-in) ----------------------------------
     Groups media by the color found at the START of each image's alt text,
     then shows only the selected color's images (plus "shared" images whose
     alt doesn't start with a color). Self-wires to the color option control
     in the same section, so it works with any picker style. Falls back to
     showing everything when there's no color option or no tagged alts. */
  initColorGrouping() {
    const scope = this.closest(".valor-mp") || this.closest(".shopify-section") || document;
    this.colorRadios = Array.from(scope.querySelectorAll("input[data-option-color]"));
    this.colorSelect = scope.querySelector("select[data-option-color]");

    let colorValues = [];
    if (this.colorRadios.length) {
      colorValues = this.colorRadios.map((r) => r.value);
    } else if (this.colorSelect) {
      colorValues = Array.from(this.colorSelect.options).map((o) => o.value);
    }
    if (!colorValues.length) {
      this.colorGrouping = false;
      return;
    }

    // Longest-first so e.g. "Sky Blue" wins over "Blue" on a prefix match.
    this._colorList = colorValues
      .map((v) => this._normColor(v))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    this._colorByMediaId = {};
    let matchedAny = false;
    this.mainItems.forEach((item) => {
      const alt = this._normColor(item.dataset.mediaAlt || "");
      let color = null;
      for (let i = 0; i < this._colorList.length; i++) {
        const c = this._colorList[i];
        if (alt === c || alt.indexOf(c + " ") === 0) {
          color = c;
          matchedAny = true;
          break;
        }
      }
      this._colorByMediaId[String(item.dataset.mediaId)] = color;
    });

    if (!matchedAny) {
      // No image alt starts with a color → don't filter, never blank the gallery.
      this.colorGrouping = false;
      return;
    }

    this._handleColorChange = () => {
      // On an explicit color change, jump to that color's first own image.
      window.requestAnimationFrame(() => this.filterByColor(true));
    };
    this.colorRadios.forEach((r) => r.addEventListener("change", this._handleColorChange));
    if (this.colorSelect) this.colorSelect.addEventListener("change", this._handleColorChange);

    // Initial filter, deferred so it runs after product-info's own init.
    // Keep the variant's featured image if it's already in the starting color.
    window.requestAnimationFrame(() => this.filterByColor(false));
  }

  _normColor(value) {
    // Canonicalize separators so multi-word / two-tone colors match no matter
    // how the option value and the image alt are written: hyphen, underscore,
    // slash and runs of whitespace all collapse to a single space. So a
    // "Navy-White" option matches an alt that begins "Navy White", "Navy/White"
    // or "Navy-White" — and vice versa. Matching still uses the FULL color name
    // (longest-first, word-boundary), never just the first word.
    return String(value || "")
      .toLowerCase()
      .replace(/[\s\/_-]+/g, " ")
      .trim();
  }

  getSelectedColor() {
    if (this.colorRadios && this.colorRadios.length) {
      const checked = this.colorRadios.find((r) => r.checked);
      if (checked) return this._normColor(checked.value);
    }
    if (this.colorSelect) return this._normColor(this.colorSelect.value);
    return null;
  }

  getVisibleMainItems() {
    return this.mainItems.filter((item) => !item.classList.contains("is-color-hidden"));
  }

  filterByColor(forceColorFirst) {
    if (!this.colorGrouping) return;
    const selected = this.getSelectedColor();
    if (selected == null) return;
    const self = this;
    const shouldShow = function (mediaId) {
      const color = self._colorByMediaId[String(mediaId)];
      return color == null || color === selected; // shared (null) shows for every color
    };

    this.mainItems.forEach((item) => {
      item.classList.toggle("is-color-hidden", !shouldShow(item.dataset.mediaId));
    });
    this.thumbs.forEach((thumb) => {
      thumb.classList.toggle("is-color-hidden", !shouldShow(thumb.dataset.thumbFor));
    });
    this.gridItems.forEach((grid) => {
      grid.classList.toggle("is-color-hidden", !shouldShow(grid.dataset.mediaId));
    });
    this.progressButtons.forEach((button) => {
      button.classList.toggle("is-color-hidden", !shouldShow(button.dataset.mediaId));
    });

    // Decide the active image. On an explicit color change jump to that color's
    // first OWN image; on load keep the variant's featured image if still visible.
    const activeItem = this.mainItems[this.getActiveIndex()];
    const needsRepoint = forceColorFirst || !activeItem || activeItem.classList.contains("is-color-hidden");
    if (needsRepoint) {
      const firstOwn = this.mainItems.find(
        (it) =>
          !it.classList.contains("is-color-hidden") &&
          this._colorByMediaId[String(it.dataset.mediaId)] === selected,
      );
      const target = firstOwn || this.getVisibleMainItems()[0];
      if (target) {
        this.setActiveMedia(target.dataset.mediaId);
        return;
      }
    }
    this.updateNavState();
    this.updateThumbsNavState();
  }

  disconnectedCallback() {
    if (this.thumbsTrack) {
      this.thumbsTrack.removeEventListener("scroll", this._handleThumbsScroll);
      window.removeEventListener("resize", this._handleResize);
      if (this.thumbsPrev) this.thumbsPrev.removeEventListener("click", this._handleThumbsPrev);
      if (this.thumbsNext) this.thumbsNext.removeEventListener("click", this._handleThumbsNext);
    }
    if (this._handleColorChange) {
      if (this.colorRadios) {
        this.colorRadios.forEach((r) => r.removeEventListener("change", this._handleColorChange));
      }
      if (this.colorSelect) this.colorSelect.removeEventListener("change", this._handleColorChange);
    }
  }
}

if (!customElements.get("valor-product-media")) {
  customElements.define("valor-product-media", ValorProductMedia);
}
