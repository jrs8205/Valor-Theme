/**
 * <valor-lightbox> — autonomous custom element wrapping a native <dialog>.
 *
 * Autonomous (not a customized built-in `<dialog is="...">`) because Safari /
 * WebKit never shipped customized built-in elements, so an `is=` dialog would
 * never upgrade there and the lightbox would silently do nothing. Wrapping a
 * real <dialog> keeps the native focus trap + ESC-to-close while working in
 * every browser. Mirrors how Dawn/Horizon build modals as autonomous elements.
 *
 * Listens for `valor:lightbox:open` events:
 *   document.dispatchEvent(new CustomEvent('valor:lightbox:open', {
 *     detail: { images: [{ src, alt, srcset, sizes }, ...], index: 0 }
 *   }));
 *
 * Features:
 *   - Native <dialog> = built-in focus trap + ESC closes
 *   - Click backdrop closes
 *   - Prev/next buttons + arrow keys
 *   - Touch swipe on mobile
 *   - Body scroll lock while open
 *   - Respects prefers-reduced-motion
 */
class ValorLightbox extends HTMLElement {
  constructor() {
    super();
    this.images = [];
    this.index = 0;

    this._handleOpen = this.openWith.bind(this);
    this._handleClick = this.onClick.bind(this);
    this._handleKey = this.onKey.bind(this);
    this._handleTouchStart = this.onTouchStart.bind(this);
    this._handleTouchEnd = this.onTouchEnd.bind(this);
    this._handleDialogClose = this.onClose.bind(this);
  }

  connectedCallback() {
    this.dialog = this.querySelector("dialog");
    this.imgEl = this.querySelector("[data-lightbox-image]");
    this.counterEl = this.querySelector("[data-lightbox-counter]");
    this.prevBtn = this.querySelector("[data-lightbox-prev]");
    this.nextBtn = this.querySelector("[data-lightbox-next]");
    this.viewportEl = this.querySelector("[data-lightbox-viewport]");

    document.addEventListener("valor:lightbox:open", this._handleOpen);
    if (this.dialog) {
      this.dialog.addEventListener("click", this._handleClick);
      this.dialog.addEventListener("keydown", this._handleKey);
      this.dialog.addEventListener("close", this._handleDialogClose);
    }
    if (this.viewportEl) {
      this.viewportEl.addEventListener("touchstart", this._handleTouchStart, { passive: true });
      this.viewportEl.addEventListener("touchend", this._handleTouchEnd, { passive: true });
    }

    // Hook prev/next directly (in addition to general click handler)
    if (this.prevBtn) this.prevBtn.addEventListener("click", this.prev.bind(this));
    if (this.nextBtn) this.nextBtn.addEventListener("click", this.next.bind(this));
    var closeBtn = this.querySelector("[data-lightbox-close]");
    if (closeBtn) closeBtn.addEventListener("click", this.closeDialog.bind(this));
  }

  disconnectedCallback() {
    document.removeEventListener("valor:lightbox:open", this._handleOpen);
  }

  closeDialog() {
    if (this.dialog && typeof this.dialog.close === "function") this.dialog.close();
  }

  openWith(event) {
    if (!this.dialog) return;
    var detail = event.detail || {};
    if (!detail.images || !detail.images.length) return;
    this.images = detail.images;
    this.index = Math.max(0, Math.min(detail.index || 0, this.images.length - 1));
    this.dialog.setAttribute("data-single", this.images.length <= 1 ? "true" : "false");
    this.render();
    if (typeof this.dialog.showModal === "function") {
      this.dialog.showModal();
    } else {
      this.dialog.setAttribute("open", "");
    }
    document.body.classList.add("valor-no-scroll");
  }

  onClose() {
    document.body.classList.remove("valor-no-scroll");
  }

  render() {
    var img = this.images[this.index];
    if (!img || !img.src || !this.viewportEl) return;
    if (!this.imgEl) {
      this.imgEl = document.createElement("img");
      this.imgEl.className = "valor-lightbox__image";
      this.imgEl.setAttribute("data-lightbox-image", "");
      this.viewportEl.appendChild(this.imgEl);
    }
    this.imgEl.src = img.src;
    this.imgEl.alt = img.alt || "";
    this.imgEl.removeAttribute("width");
    this.imgEl.removeAttribute("height");
    var imgEl = this.imgEl;
    var setDims = function () {
      if (imgEl.naturalWidth) {
        imgEl.width = imgEl.naturalWidth;
        imgEl.height = imgEl.naturalHeight;
      }
    };
    if (imgEl.complete) setDims();
    else imgEl.addEventListener("load", setDims, { once: true });
    if (img.srcset) {
      this.imgEl.srcset = img.srcset;
    } else {
      this.imgEl.removeAttribute("srcset");
    }
    if (img.sizes) {
      this.imgEl.sizes = img.sizes;
    } else {
      this.imgEl.removeAttribute("sizes");
    }
    if (this.counterEl) {
      this.counterEl.textContent = this.index + 1 + " / " + this.images.length;
    }
    if (this.prevBtn) this.prevBtn.toggleAttribute("disabled", this.index === 0);
    if (this.nextBtn) this.nextBtn.toggleAttribute("disabled", this.index === this.images.length - 1);
  }

  prev() {
    if (this.index > 0) {
      this.index -= 1;
      this.render();
    }
  }

  next() {
    if (this.index < this.images.length - 1) {
      this.index += 1;
      this.render();
    }
  }

  onClick(e) {
    // Click on the dialog backdrop itself (not on inner content) closes.
    // The dialog element receives the click when the backdrop is clicked.
    if (e.target === this.dialog) this.closeDialog();
  }

  _isRtl() {
    return getComputedStyle(this.dialog || document.documentElement).direction === "rtl";
  }

  onKey(e) {
    // Arrow keys follow the reading direction (ArrowLeft is "next" in RTL).
    var rtl = this._isRtl();
    if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) {
      e.preventDefault();
      this.prev();
    } else if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) {
      e.preventDefault();
      this.next();
    }
  }

  onTouchStart(e) {
    if (!e.touches || !e.touches.length) return;
    this._touchStartX = e.touches[0].clientX;
    this._touchStartY = e.touches[0].clientY;
  }

  onTouchEnd(e) {
    if (this._touchStartX == null) return;
    var endX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0;
    var endY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : 0;
    var dx = endX - this._touchStartX;
    var dy = endY - this._touchStartY;
    // Only treat as swipe if horizontal motion is dominant and crosses threshold
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      var towardPrevious = this._isRtl() ? dx < 0 : dx > 0;
      if (towardPrevious) this.prev();
      else this.next();
    }
    this._touchStartX = null;
    this._touchStartY = null;
  }
}

if (!customElements.get("valor-lightbox")) {
  customElements.define("valor-lightbox", ValorLightbox);
}

// Body scroll lock helper (CSS class — defined in lightbox.css indirectly via inline style)
// We use a simple class because dialog::backdrop already covers the page.
(function () {
  var style = document.createElement("style");
  style.textContent = ".valor-no-scroll { overflow: hidden; }";
  document.head.appendChild(style);
})();
