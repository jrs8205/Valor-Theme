(function () {
  "use strict";

  if (customElements.get("valor-slideshow")) return;

  class ValorSlideshow extends HTMLElement {
    connectedCallback() {
      if (this.initialized) return;
      this.initialized = true;

      this.slides = Array.prototype.slice.call(this.querySelectorAll("[data-slide]"));
      this.dots = Array.prototype.slice.call(this.querySelectorAll("[data-slide-dot]"));
      this.viewport = this.querySelector(".valor-slideshow__viewport") || this;
      this.previousButton = this.querySelector("[data-slide-previous]");
      this.nextButton = this.querySelector("[data-slide-next]");
      this.autoplay = this.dataset.autoplay === "true";
      this.interval = Math.max(parseInt(this.dataset.interval, 10) || 5000, 3000);
      this.pauseOnHover = this.dataset.pauseOnHover !== "false";
      this.currentIndex = Math.max(
        this.slides.findIndex(function (slide) {
          return !slide.hidden;
        }),
        0,
      );
      this.timer = null;
      this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.swipeStartX = null;
      this.swipeStartY = null;
      this.swipePointerId = null;
      this.swipeThreshold = 48;

      if (this.slides.length < 2) return;

      this.bindEvents();
      this.show(this.currentIndex);
      this.startAutoplay();
    }

    disconnectedCallback() {
      this.stopAutoplay();
    }

    bindEvents() {
      if (this.previousButton) {
        this.previousButton.addEventListener("click", this.previous.bind(this));
      }

      if (this.nextButton) {
        this.nextButton.addEventListener("click", this.next.bind(this));
      }

      this.dots.forEach(
        function (dot) {
          dot.addEventListener(
            "click",
            function () {
              this.show(Number(dot.dataset.slideDot));
              this.restartAutoplay();
            }.bind(this),
          );
        }.bind(this),
      );

      this.viewport.addEventListener("pointerdown", this.onPointerDown.bind(this));
      this.viewport.addEventListener("pointerup", this.onPointerUp.bind(this));
      this.viewport.addEventListener("pointercancel", this.resetSwipe.bind(this));

      this.addEventListener(
        "keydown",
        function (event) {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            this.previous();
          }

          if (event.key === "ArrowRight") {
            event.preventDefault();
            this.next();
          }
        }.bind(this),
      );

      if (this.pauseOnHover) {
        this.addEventListener("mouseenter", this.stopAutoplay.bind(this));
        this.addEventListener("mouseleave", this.startAutoplay.bind(this));
      }
      this.addEventListener("focusin", this.stopAutoplay.bind(this));
      this.addEventListener("focusout", this.startAutoplay.bind(this));

      document.addEventListener(
        "visibilitychange",
        function () {
          if (document.hidden) {
            this.stopAutoplay();
          } else {
            this.startAutoplay();
          }
        }.bind(this),
      );
    }

    onPointerDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target.closest && event.target.closest("a, button, input, select, textarea, summary")) return;

      this.swipeStartX = event.clientX;
      this.swipeStartY = event.clientY;
      this.swipePointerId = event.pointerId;

      if (this.viewport.setPointerCapture) {
        this.viewport.setPointerCapture(event.pointerId);
      }
    }

    onPointerUp(event) {
      if (this.swipePointerId !== event.pointerId || this.swipeStartX === null || this.swipeStartY === null) return;

      var deltaX = event.clientX - this.swipeStartX;
      var deltaY = event.clientY - this.swipeStartY;
      var isHorizontalSwipe = Math.abs(deltaX) >= this.swipeThreshold && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;

      this.resetSwipe(event);

      if (!isHorizontalSwipe) return;

      if (deltaX < 0) {
        this.next();
      } else {
        this.previous();
      }
    }

    resetSwipe(event) {
      if (event && this.viewport.releasePointerCapture && this.swipePointerId !== null) {
        try {
          this.viewport.releasePointerCapture(this.swipePointerId);
        } catch (error) {
          // Browser may already have released this pointer.
        }
      }

      this.swipeStartX = null;
      this.swipeStartY = null;
      this.swipePointerId = null;
    }

    previous() {
      this.show(this.currentIndex - 1);
      this.restartAutoplay();
    }

    next() {
      this.show(this.currentIndex + 1);
      this.restartAutoplay();
    }

    show(index) {
      var nextIndex = (index + this.slides.length) % this.slides.length;
      this.currentIndex = nextIndex;

      this.slides.forEach(function (slide, slideIndex) {
        var isActive = slideIndex === nextIndex;
        slide.hidden = !isActive;
        slide.classList.toggle("is-active", isActive);
        slide.setAttribute("aria-hidden", isActive ? "false" : "true");
      });

      this.dots.forEach(function (dot, dotIndex) {
        dot.setAttribute("aria-pressed", dotIndex === nextIndex ? "true" : "false");
      });
    }

    startAutoplay() {
      if (!this.autoplay || this.reducedMotion || this.slides.length < 2 || this.timer) return;
      this.timer = window.setInterval(this.next.bind(this), this.interval);
    }

    stopAutoplay() {
      if (!this.timer) return;
      window.clearInterval(this.timer);
      this.timer = null;
    }

    restartAutoplay() {
      this.stopAutoplay();
      this.startAutoplay();
    }
  }

  customElements.define("valor-slideshow", ValorSlideshow);
})();
