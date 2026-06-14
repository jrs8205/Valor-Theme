/**
 * <div is="valor-product-media">
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
class ValorProductMedia extends HTMLDivElement {
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
    const index = parseInt(btn.dataset.mediaIndex, 10) || 0;
    this.openLightbox(index);
  }

  onSetMedia(e) {
    const mediaId = e.detail && e.detail.mediaId;
    if (mediaId) this.setActiveMedia(mediaId);
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

  next() {
    this.setActiveByIndex(this.getActiveIndex() + 1);
  }
  prev() {
    this.setActiveByIndex(this.getActiveIndex() - 1);
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
    const i = this.getActiveIndex();
    if (this.counterEl) {
      if (i >= 0 && this.mainItems.length > 1) {
        this.counterEl.textContent = i + 1 + " / " + this.mainItems.length;
        this.counterEl.removeAttribute("hidden");
      } else {
        this.counterEl.setAttribute("hidden", "");
      }
    }

    if (this.progressEl && i >= 0 && this.mainItems.length > 1) {
      const width = 100 / this.mainItems.length;
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
    const clickedItem = e.currentTarget;
    const clickedIndex = parseInt(clickedItem.dataset.mediaIndex, 10) || 0;

    this.openLightbox(clickedIndex);
  }

  openLightbox(clickedIndex) {
    const images = this.mainItems.map((item) => ({
      src: item.dataset.mediaSrc,
      srcset: item.dataset.mediaSrcset,
      sizes: "100vw",
      alt: item.dataset.mediaAlt || "",
    }));

    document.dispatchEvent(
      new CustomEvent("valor:lightbox:open", {
        detail: { images: images, index: clickedIndex },
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
      if (dx > 0) this.prev();
      else this.next();
    }
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
    this.thumbsTrack.scrollBy({ left: -step, behavior: "smooth" });
  }

  onThumbsNextClick() {
    if (!this.thumbsTrack) return;
    const step = Math.max(this.thumbsTrack.clientWidth * 0.8, 80);
    this.thumbsTrack.scrollBy({ left: step, behavior: "smooth" });
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
    const atStart = track.scrollLeft <= 2;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;

    if (this.thumbsPrev) this.thumbsPrev.hidden = atStart;
    if (this.thumbsNext) this.thumbsNext.hidden = atEnd;
  }

  disconnectedCallback() {
    if (this.thumbsTrack) {
      this.thumbsTrack.removeEventListener("scroll", this._handleThumbsScroll);
      window.removeEventListener("resize", this._handleResize);
      if (this.thumbsPrev) this.thumbsPrev.removeEventListener("click", this._handleThumbsPrev);
      if (this.thumbsNext) this.thumbsNext.removeEventListener("click", this._handleThumbsNext);
    }
  }
}

if (!customElements.get("valor-product-media")) {
  customElements.define("valor-product-media", ValorProductMedia, { extends: "div" });
}
