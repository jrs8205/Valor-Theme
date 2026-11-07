/* Collection banner video (sections/collection.liquid).

   The banner can show a video, and a separate one on phones, in place of
   the collection image. Each is in the markup once, muted, looping and with
   preload="none"; CSS shows the one for the current screen width
   (.is-desktop / .is-mobile). This element plays only the video that is
   shown, so the hidden one never loads, and switches when the screen width
   changes.

   - With reduced motion the video does not start by itself.
   - The pause button stops and restarts it (WCAG 2.2.2: moving content that
     plays for more than five seconds can be paused). A pause holds across a
     change of screen width.
   - Without this script nothing plays: the video's poster image shows. */
(function () {
  "use strict";

  if (!window.customElements || customElements.get("valor-banner-video")) return;

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var desktopWidth = window.matchMedia("(min-width: 750px)");

  function listen(query, handler) {
    if (query.addEventListener) query.addEventListener("change", handler);
    else query.addListener(handler);
  }

  function unlisten(query, handler) {
    if (query.removeEventListener) query.removeEventListener("change", handler);
    else query.removeListener(handler);
  }

  class ValorBannerVideo extends HTMLElement {
    constructor() {
      super();
      this.update = this.update.bind(this);
      this.onToggle = this.onToggle.bind(this);
      // Starts paused with reduced motion; otherwise it plays until the
      // shopper pauses it. Kept on the element, so it survives the banner
      // being moved back in after a filter or sort refresh.
      this.paused = reducedMotion.matches;
    }

    connectedCallback() {
      this.toggle = this.querySelector("[data-banner-video-toggle]");
      if (this.toggle) this.toggle.addEventListener("click", this.onToggle);
      listen(desktopWidth, this.update);
      this.update();
    }

    disconnectedCallback() {
      if (this.toggle) this.toggle.removeEventListener("click", this.onToggle);
      unlisten(desktopWidth, this.update);
    }

    videos() {
      return Array.prototype.slice.call(this.querySelectorAll("video"));
    }

    // The video CSS shows at this screen width, if any.
    current() {
      var shown = this.videos().filter(function (video) {
        return video.getClientRects().length > 0;
      });
      return shown[0] || null;
    }

    play(video) {
      var self = this;
      video.preload = "auto";
      var started = video.play();
      if (started && started.catch) {
        started.catch(function () {
          // Refused (the browser's autoplay policy) or interrupted. If this
          // is still the video shown and it is not playing, show the real
          // state: paused, with a Play button that starts it in one tap.
          // An interruption by our own pause (another width, or the
          // shopper's tap) leaves the state as it is.
          if (video === self.current() && video.paused && !self.paused) {
            self.paused = true;
            self.render(video);
          }
        });
      }
    }

    update() {
      var current = this.current();
      this.videos().forEach(function (video) {
        if (video !== current) video.pause();
      });
      if (current && !this.paused) this.play(current);
      this.render(current);
    }

    render(current) {
      if (!this.toggle) return;
      var playing = !!current && !this.paused;
      this.toggle.hidden = !current;
      this.toggle.dataset.playing = String(playing);
      this.toggle.setAttribute(
        "aria-label",
        this.toggle.getAttribute(playing ? "data-label-pause" : "data-label-play"),
      );
    }

    onToggle() {
      this.paused = !this.paused;
      var current = this.current();
      if (current) {
        if (this.paused) current.pause();
        else this.play(current);
      }
      this.render(current);
    }
  }

  customElements.define("valor-banner-video", ValorBannerVideo);
})();
