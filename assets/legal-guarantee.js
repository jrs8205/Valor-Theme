/* EU legal guarantee notice pop-up (snippets/legal-guarantee-notice.liquid).

   The notice always opens at a legible size: the Commission guidelines ask
   for it to be "always legible at default display size", so where the pop-up
   is narrower than that size the notice scrolls sideways inside it
   (critical.css). This script, on top:
   - measures whether the notice really overflows its pop-up at that size
     (data-needs-fit on the pop-up body). The legible width is in rem, so it
     grows with the theme's text scale; a viewport media query can't see that;
   - shows the zoom buttons. Plus enlarges the notice in steps (150%, 200%,
     300% of the size it opens at) and minus steps back. Where the notice
     overflows at the readable size, one more step below it fits the whole
     notice to the pop-up as an overview;
   - labels the third button: "Show the whole notice" at the readable size
     (only where the notice overflows; a tap on the notice does the same),
     "Show at readable size" at every other size;
   - shades the edge that still has more of the notice to scroll to.
   The pop-up always opens again at the readable size. Without this script
   the notice still opens legible, with the hint on narrow screens. */
(function () {
  "use strict";

  if (window.ValorLegalNotice) return;
  window.ValorLegalNotice = true;

  // The readable size and the steps above it, as multiples of it.
  var STEPS = [1, 1.5, 2, 3];
  var WHOLE = "fit";

  function partsOf(el) {
    var popover = el && el.closest ? el.closest(".valor-legal-popover") : null;
    if (!popover) return null;
    var artwork = popover.querySelector("[data-legal-artwork]");
    return {
      popover: popover,
      header: popover.querySelector(".valor-legal-popover__header"),
      body: artwork ? artwork.closest(".valor-legal-popover__body") : null,
      frame: popover.querySelector("[data-legal-frame]"),
      artwork: artwork,
      zoom: popover.querySelector("[data-legal-zoom]"),
      zoomIn: popover.querySelector("[data-legal-zoom-in]"),
      zoomOut: popover.querySelector("[data-legal-zoom-out]"),
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

  /* The size the notice is at: WHOLE (data-fit), or a multiple of the
     readable size (data-zoom; no attribute is 1). */
  function levelOf(parts) {
    if (parts.artwork.hasAttribute("data-fit")) return WHOLE;
    var zoom = parseFloat(parts.artwork.getAttribute("data-zoom"));
    return zoom > 1 ? zoom : 1;
  }

  // The whole notice is only a step where the readable size overflows.
  function levelsOf(parts) {
    var needsFit = parts.body && parts.body.hasAttribute("data-needs-fit");
    return (needsFit ? [WHOLE] : []).concat(STEPS);
  }

  /* A zoom button at its end is switched off. If it is the one in use, the
     focus goes to the other one rather than being left on a button that no
     longer answers. */
  function switchButton(button, off, other) {
    if (!button) return;
    var focused = off && !button.disabled && document.activeElement === button;
    button.disabled = off;
    if (focused && other && !other.disabled) other.focus();
  }

  /* The browser chose the notice's file for the size it opens at. Enlarged,
     the image says how wide it is drawn now, and the browser picks again
     from the same list; back at the readable size it says what the theme
     said. */
  function updateFile(parts) {
    var image = parts.artwork.querySelector("img");
    if (!image || !image.getAttribute("srcset")) return;
    if (!image.hasAttribute("data-sizes")) image.setAttribute("data-sizes", image.getAttribute("sizes") || "");
    var level = levelOf(parts);
    var width = level !== WHOLE && level > 1 ? Math.ceil(image.getBoundingClientRect().width) : 0;
    var sizes = width ? width + "px" : image.getAttribute("data-sizes");
    if (image.getAttribute("sizes") !== sizes) image.setAttribute("sizes", sizes);
  }

  function updateControls(parts) {
    if (!parts || !parts.artwork) return;
    var levels = levelsOf(parts);
    var level = levelOf(parts);
    var index = levels.indexOf(level);
    switchButton(parts.zoomOut, index <= 0, parts.zoomIn);
    switchButton(parts.zoomIn, index >= levels.length - 1, parts.zoomOut);
    if (parts.button) {
      parts.button.textContent = parts.button.getAttribute(level === 1 ? "data-label-whole" : "data-label-readable");
      // At the readable size the button offers the whole notice, which is
      // only there to offer where the notice overflows.
      var gone = level === 1 && levels[0] !== WHOLE;
      // If it is the one in use, the focus goes to a zoom button that still
      // answers (or to the notice) before the button is taken away.
      if (gone && document.activeElement === parts.button) {
        var zoomIn = parts.zoomIn && !parts.zoomIn.disabled ? parts.zoomIn : null;
        var zoomOut = parts.zoomOut && !parts.zoomOut.disabled ? parts.zoomOut : null;
        (zoomIn || zoomOut || parts.artwork).focus();
      }
      parts.button.hidden = gone;
    }
  }

  function setLevel(parts, level) {
    if (!parts || !parts.artwork) return;
    var artwork = parts.artwork;
    setFlag(artwork, "data-fit", level === WHOLE);
    if (level === WHOLE || level === 1) {
      artwork.removeAttribute("data-zoom");
    } else {
      artwork.setAttribute("data-zoom", String(level));
    }
    artwork.scrollLeft = 0;
    updateControls(parts);
    updateShade(parts);
    updateFile(parts);
  }

  function step(parts, direction) {
    if (!parts || !parts.artwork) return;
    var levels = levelsOf(parts);
    var index = levels.indexOf(levelOf(parts)) + direction;
    if (index < 0 || index >= levels.length) return;
    setLevel(parts, levels[index]);
  }

  /* The third button, and a tap on the notice: between the readable size and
     the whole notice, and from any enlarged size back to the readable one. */
  function reset(parts) {
    if (!parts || !parts.artwork) return;
    if (levelOf(parts) !== 1) {
      setLevel(parts, 1);
    } else if (levelsOf(parts)[0] === WHOLE) {
      setLevel(parts, WHOLE);
    }
  }

  /* Does the notice overflow its pop-up at the legible size? The legible
     width is the image's min-width from the stylesheet, read (and kept) while
     the notice is at its readable size; in the overview it is 0 and at an
     enlarged size it is a multiple. */
  function measure(parts) {
    if (!parts || !parts.artwork || !parts.body) return;
    var available = parts.artwork.clientWidth;
    if (!available) return; // pop-up closed: nothing to measure
    // The zoom bar sticks right below the title bar, whatever its height.
    if (parts.header) {
      parts.popover.style.setProperty("--valor-legal-header-height", parts.header.offsetHeight + "px");
    }
    var image = parts.artwork.querySelector("img");
    if (image && levelOf(parts) === 1) {
      parts.artwork.setAttribute("data-legible", String(parseFloat(getComputedStyle(image).minWidth) || 0));
    }
    var legible = parseFloat(parts.artwork.getAttribute("data-legible")) || 0;
    var needsFit = legible > available + 1;
    setFlag(parts.body, "data-needs-fit", needsFit);
    if (!needsFit && parts.artwork.hasAttribute("data-fit")) {
      setLevel(parts, 1);
    } else {
      updateControls(parts);
    }
    updateShade(parts);
    // More or less room draws an enlarged notice at another width.
    updateFile(parts);
  }

  function eachNotice(callback) {
    var artworks = document.querySelectorAll("[data-legal-artwork]");
    for (var i = 0; i < artworks.length; i++) callback(partsOf(artworks[i]));
  }

  // The buttons only exist for people with this script.
  eachNotice(function (parts) {
    setFlag(parts.body, "data-legal-enhanced", true);
    if (parts.zoom) parts.zoom.hidden = false;
    updateControls(parts);
    measure(parts);
  });

  document.addEventListener("click", function (event) {
    var target = event.target;
    var zoomIn = target.closest("[data-legal-zoom-in]");
    if (zoomIn) {
      step(partsOf(zoomIn), 1);
      return;
    }
    var zoomOut = target.closest("[data-legal-zoom-out]");
    if (zoomOut) {
      step(partsOf(zoomOut), -1);
      return;
    }
    var button = target.closest("[data-legal-fit]");
    if (button) {
      reset(partsOf(button));
      return;
    }
    var image = target.closest("[data-legal-artwork] img");
    if (!image) return;
    var parts = partsOf(image);
    if (!parts || !parts.body || !parts.body.hasAttribute("data-needs-fit")) return;
    // A tap only swaps the readable size and the whole notice; an enlarged
    // notice is being read and scrolled, and stays as it is.
    var level = levelOf(parts);
    if (level === 1 || level === WHOLE) reset(parts);
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
        setLevel(parts, 1);
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
