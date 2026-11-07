/* EU legal guarantee notice pop-up (snippets/legal-guarantee-notice.liquid).

   The notice always opens at a legible size: the Commission guidelines ask
   for it to be "always legible at default display size", so where the pop-up
   is narrower than that size the notice scrolls sideways inside it
   (critical.css). This script, on top:
   - measures whether the notice really overflows its pop-up at that size
     (data-needs-fit on the pop-up body). The legible width is in rem, so it
     grows with the theme's text scale; a viewport media query can't see that;
   - only then shows the hint and "Show the whole notice" (a tap on the notice
     does the same), which fits the notice to the pop-up as an overview, and
     "Show at readable size" to go back;
   - shades the edge that still has more of the notice to scroll to.
   The pop-up always opens again at the readable size. Without this script
   the notice still opens legible, with the hint on narrow screens. */
(function () {
  "use strict";

  if (window.ValorLegalNotice) return;
  window.ValorLegalNotice = true;

  function partsOf(el) {
    var popover = el && el.closest ? el.closest(".valor-legal-popover") : null;
    if (!popover) return null;
    var artwork = popover.querySelector("[data-legal-artwork]");
    return {
      popover: popover,
      body: artwork ? artwork.closest(".valor-legal-popover__body") : null,
      frame: popover.querySelector("[data-legal-frame]"),
      artwork: artwork,
      button: popover.querySelector("[data-legal-fit]"),
    };
  }

  function setFlag(el, name, on) {
    if (!el) return;
    if (on) {
      el.setAttribute(name, "");
    } else {
      el.removeAttribute(name);
    }
  }

  /* More to scroll to at the inline end? scrollLeft counts from the start
     edge: 0 up to a positive maximum in LTR, 0 down to a negative one in RTL. */
  function updateShade(parts) {
    if (!parts || !parts.frame || !parts.artwork) return;
    var artwork = parts.artwork;
    setFlag(parts.frame, "data-more", Math.abs(artwork.scrollLeft) + artwork.clientWidth < artwork.scrollWidth - 1);
  }

  function setWhole(parts, whole) {
    if (!parts || !parts.artwork || !parts.button) return;
    setFlag(parts.artwork, "data-fit", whole);
    parts.artwork.scrollLeft = 0;
    parts.button.textContent = parts.button.getAttribute(whole ? "data-label-readable" : "data-label-whole");
    updateShade(parts);
  }

  /* Does the notice overflow its pop-up at the legible size? The legible
     width is the image's min-width from the stylesheet, read (and kept) while
     the notice is at its readable size; in the overview it is 0. */
  function measure(parts) {
    if (!parts || !parts.artwork || !parts.body) return;
    var available = parts.artwork.clientWidth;
    if (!available) return; // pop-up closed: nothing to measure
    var image = parts.artwork.querySelector("img");
    if (image && !parts.artwork.hasAttribute("data-fit")) {
      parts.artwork.setAttribute("data-legible", String(parseFloat(getComputedStyle(image).minWidth) || 0));
    }
    var legible = parseFloat(parts.artwork.getAttribute("data-legible")) || 0;
    var needsFit = legible > available + 1;
    setFlag(parts.body, "data-needs-fit", needsFit);
    if (!needsFit && parts.artwork.hasAttribute("data-fit")) setWhole(parts, false);
    updateShade(parts);
  }

  function toggle(parts) {
    if (parts && parts.artwork) setWhole(parts, !parts.artwork.hasAttribute("data-fit"));
  }

  function eachNotice(callback) {
    var artworks = document.querySelectorAll("[data-legal-artwork]");
    for (var i = 0; i < artworks.length; i++) callback(partsOf(artworks[i]));
  }

  // The button only exists for people with this script; critical.css shows
  // it (and the hint) while data-needs-fit is set.
  eachNotice(function (parts) {
    setFlag(parts.body, "data-legal-enhanced", true);
    if (parts.button) parts.button.hidden = false;
    measure(parts);
  });

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-legal-fit]");
    if (button) {
      toggle(partsOf(button));
      return;
    }
    var image = event.target.closest("[data-legal-artwork] img");
    if (!image) return;
    var parts = partsOf(image);
    if (parts && parts.body && parts.body.hasAttribute("data-needs-fit")) toggle(parts);
  });

  // Scroll, image load and the pop-up opening or closing all change the
  // picture. None of them bubble, so listen in the capture phase.
  document.addEventListener(
    "scroll",
    function (event) {
      if (event.target.matches && event.target.matches("[data-legal-artwork]")) updateShade(partsOf(event.target));
    },
    true,
  );
  document.addEventListener(
    "load",
    function (event) {
      if (event.target.closest && event.target.closest("[data-legal-artwork]")) measure(partsOf(event.target));
    },
    true,
  );
  // Only the pop-up's own toggle: the text version inside it is a <details>
  // that fires toggle events too, and must not change the view.
  document.addEventListener(
    "toggle",
    function (event) {
      var target = event.target;
      if (!target || !target.hasAttribute || !target.hasAttribute("popover")) return;
      var parts = partsOf(target);
      if (!parts || !parts.artwork) return;
      if (event.newState === "closed") {
        setWhole(parts, false);
      } else {
        measure(parts);
      }
    },
    true,
  );

  // Turning a phone or resizing the window changes the room the notice has.
  window.addEventListener("resize", function () {
    eachNotice(measure);
  });
})();
