(function () {
  "use strict";

  if (customElements.get("valor-slideshow")) return;

  class ValorSlideshow extends HTMLElement {
    connectedCallback() {
      if (this.initialized) return;
      this.initialized = true;

      this.viewport = this.querySelector("[data-slideshow-viewport]");
      this.track = this.querySelector("[data-slideshow-track]");
      this.slides = Array.prototype.slice.call(this.querySelectorAll("[data-slide]"));
      this.buttons = Array.prototype.slice.call(this.querySelectorAll("[data-slide-button]"));
      this.autoplay = this.dataset.autoplay === "true";
      this.interval = Math.max(parseInt(this.dataset.interval, 10) || 5000, 3000);
      this.pauseOnHover = this.dataset.pauseOnHover !== "false";
      this.currentIndex = Math.max(
        this.slides.findIndex(function (slide) {
          return slide.classList.contains("is-active");
        }),
        0,
      );
      this.touchStartX = 0;
      this.touchStartY = 0;
      this.touchStartIndex = this.currentIndex;
      this.timer = null;
      this.scrollFrame = null;
      this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.abortController = new AbortController();

      this.onScroll = this.onScroll.bind(this);
      this.onTouchStart = this.onTouchStart.bind(this);
      this.onTouchEnd = this.onTouchEnd.bind(this);
      this.onResize = this.onResize.bind(this);
      this.onKeydown = this.onKeydown.bind(this);
      this.onVisibilityChange = this.onVisibilityChange.bind(this);
      this.stopAutoplay = this.stopAutoplay.bind(this);
      this.startAutoplay = this.startAutoplay.bind(this);
      this.onBlockSelect = this.onBlockSelect.bind(this);
      this.onBlockDeselect = this.onBlockDeselect.bind(this);

      if (!this.viewport || this.slides.length === 0) return;

      this.bindEvents();
      this.update(this.currentIndex);
      this.scrollToSlide(this.currentIndex, true);
      this.startAutoplay();
    }

    disconnectedCallback() {
      this.stopAutoplay();
      if (this.abortController) this.abortController.abort();
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.scrollFrame) window.cancelAnimationFrame(this.scrollFrame);
      this.initialized = false;
    }

    bindEvents() {
      var signal = this.abortController.signal;

      this.buttons.forEach(
        function (button) {
          button.addEventListener(
            "click",
            function () {
              this.show(Number(button.dataset.slideIndex));
              this.restartAutoplay();
            }.bind(this),
            { signal: signal },
          );
        }.bind(this),
      );

      this.viewport.addEventListener("scroll", this.onScroll, { passive: true, signal: signal });
      this.viewport.addEventListener("touchstart", this.onTouchStart, { passive: true, signal: signal });
      this.viewport.addEventListener("touchend", this.onTouchEnd, { passive: true, signal: signal });
      window.addEventListener("resize", this.onResize, { signal: signal });
      window.addEventListener("load", this.onResize, { signal: signal });
      document.addEventListener("visibilitychange", this.onVisibilityChange, { signal: signal });
      this.addEventListener("keydown", this.onKeydown, { signal: signal });
      this.addEventListener("focusin", this.stopAutoplay, { signal: signal });
      this.addEventListener("focusout", this.startAutoplay, { signal: signal });

      if (this.pauseOnHover) {
        this.addEventListener("mouseenter", this.stopAutoplay, { signal: signal });
        this.addEventListener("mouseleave", this.startAutoplay, { signal: signal });
      }

      if (window.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(this.onResize);
        this.resizeObserver.observe(this.viewport);
      }

      if (window.Shopify && window.Shopify.designMode) {
        document.addEventListener("shopify:block:select", this.onBlockSelect, { signal: signal });
        document.addEventListener("shopify:block:deselect", this.onBlockDeselect, { signal: signal });
      }
    }

    isRtl() {
      return getComputedStyle(this.viewport || this).direction === "rtl";
    }

    onKeydown(event) {
      // Arrow keys follow the reading direction: in right-to-left stores
      // ArrowLeft moves forward.
      var forwardKey = this.isRtl() ? "ArrowLeft" : "ArrowRight";
      var backKey = this.isRtl() ? "ArrowRight" : "ArrowLeft";
      if (event.key === backKey) {
        event.preventDefault();
        this.previous();
      }

      if (event.key === forwardKey) {
        event.preventDefault();
        this.next();
      }
    }

    onTouchStart(event) {
      if (this.slides.length < 2 || !event.changedTouches || !event.changedTouches.length) return;
      this.touchStartX = event.changedTouches[0].clientX;
      this.touchStartY = event.changedTouches[0].clientY;
      this.touchStartIndex = this.currentIndex;
    }

    onTouchEnd(event) {
      if (this.slides.length < 2 || !event.changedTouches || !event.changedTouches.length) return;

      var touch = event.changedTouches[0];
      var deltaX = touch.clientX - this.touchStartX;
      var deltaY = touch.clientY - this.touchStartY;
      var isHorizontalSwipe = Math.abs(deltaX) > 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;

      if (!isHorizontalSwipe) return;

      // A swipe toward the reading direction's end moves forward.
      var forwardSwipe = this.isRtl() ? deltaX > 0 : deltaX < 0;
      if (this.touchStartIndex === this.slides.length - 1 && forwardSwipe) {
        this.show(0);
        this.restartAutoplay();
      } else if (this.touchStartIndex === 0 && !forwardSwipe) {
        this.show(this.slides.length - 1);
        this.restartAutoplay();
      }
    }

    previous(event) {
      if (event) event.preventDefault();
      this.show(this.currentIndex - 1);
      this.restartAutoplay();
    }

    next(event) {
      if (event) event.preventDefault();
      this.show(this.currentIndex + 1);
      this.restartAutoplay();
    }

    show(index, instant) {
      if (this.slides.length < 1) return;
      var nextIndex = this.normalizeIndex(index);
      this.update(nextIndex);
      this.scrollToSlide(nextIndex, instant);
    }

    normalizeIndex(index) {
      return (index + this.slides.length) % this.slides.length;
    }

    getSlideOffset(slide) {
      if (!slide) return 0;
      if (this.isRtl()) {
        // Right-to-left scrollers start at their right edge with scrollLeft 0
        // and go negative, so measure each slide from the first slide's
        // right edge.
        var first = this.slides[0];
        return slide.offsetLeft + slide.offsetWidth - (first.offsetLeft + first.offsetWidth);
      }
      var base = this.track || this.slides[0];
      return slide.offsetLeft - base.offsetLeft;
    }

    scrollToSlide(index, instant) {
      var slide = this.slides[index];
      if (!slide || !this.viewport) return;

      this.viewport.scrollTo({
        left: this.getSlideOffset(slide),
        behavior: instant || this.reducedMotionQuery.matches ? "auto" : "smooth",
      });
    }

    onScroll() {
      if (this.scrollFrame) window.cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = window.requestAnimationFrame(
        function () {
          this.scrollFrame = null;
          this.update(this.getClosestSlideIndex());
        }.bind(this),
      );
    }

    getClosestSlideIndex() {
      if (!this.viewport || this.slides.length < 2) return 0;

      var viewportLeft = this.viewport.scrollLeft;
      var closestIndex = 0;
      var closestDistance = Infinity;

      this.slides.forEach(
        function (slide, index) {
          var distance = Math.abs(this.getSlideOffset(slide) - viewportLeft);

          if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
          }
        }.bind(this),
      );

      return closestIndex;
    }

    update(index) {
      this.currentIndex = index;

      this.slides.forEach(function (slide, slideIndex) {
        var isActive = slideIndex === index;
        slide.classList.toggle("is-active", isActive);
        slide.setAttribute("aria-hidden", isActive ? "false" : "true");
        slide.setAttribute("tabindex", isActive ? "0" : "-1");

        slide.querySelectorAll("a, button, input, select, textarea").forEach(function (element) {
          if (isActive) {
            element.removeAttribute("tabindex");
          } else {
            element.setAttribute("tabindex", "-1");
          }
        });
      });

      this.buttons.forEach(function (button) {
        var isActive = Number(button.dataset.slideIndex) === index;
        button.setAttribute("aria-current", isActive ? "true" : "false");
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    onResize() {
      this.scrollToSlide(this.currentIndex, true);
    }

    onVisibilityChange() {
      if (document.hidden) {
        this.stopAutoplay();
      } else {
        this.startAutoplay();
      }
    }

    onBlockSelect(event) {
      var slide = event.target && event.target.closest ? event.target.closest("[data-slide]") : null;
      var index = this.slides.indexOf(slide);

      if (index < 0 || !this.contains(slide)) return;
      this.stopAutoplay();
      this.show(index, true);
    }

    onBlockDeselect(event) {
      var slide = event.target && event.target.closest ? event.target.closest("[data-slide]") : null;

      if (!slide || !this.contains(slide)) return;
      this.startAutoplay();
    }

    startAutoplay() {
      if (!this.autoplay || this.reducedMotionQuery.matches || this.slides.length < 2 || this.timer) return;
      this.viewport.setAttribute("aria-live", "off");
      this.timer = window.setInterval(
        function () {
          this.show(this.currentIndex + 1);
        }.bind(this),
        this.interval,
      );
    }

    stopAutoplay() {
      if (!this.timer) return;
      window.clearInterval(this.timer);
      this.timer = null;
      if (this.viewport) this.viewport.setAttribute("aria-live", "polite");
    }

    restartAutoplay() {
      this.stopAutoplay();
      this.startAutoplay();
    }
  }

  customElements.define("valor-slideshow", ValorSlideshow);
})();
