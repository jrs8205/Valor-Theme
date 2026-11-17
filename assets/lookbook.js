/* Lookbook section (sections/lookbook.liquid).

   The image row scrolls and stops on the images by itself (assets/lookbook.css),
   so it works by touch and without this script. <valor-lookbook> adds:
   - the active look: the one in the middle of a centred row (its card is the
     one that shows), or the first one in a 4/5/6 row;
   - the arrows beside the card, the arrow keys on the row, and a click on an
     image at the side, which all bring another look to the middle;
   - dragging with the mouse: the row follows the mouse and comes to rest on
     a look; a drag is never a click. Touch and pen scroll the row natively;
   - the endless loop: when there are at least two more looks than touch the
     row, the looks at the far end move round to the near end before they are
     needed. Real looks move; nothing is copied, so no card exists twice;
   - the theme editor: selecting a look's block brings it into view;
   - the card of a variant that Shopify did not hand over with its product
     (a product has more than 250 variants): asked for by the variant's ID.

   Which layout applies comes from the stylesheet (--lb-mode, --lb-count), so
   the script and the styles cannot disagree at a breakpoint. */
(function () {
  "use strict";

  // A second copy of the section loads this file again.
  if (customElements.get("valor-lookbook")) return;

  // The row counts as stopped when it has not moved for this long.
  var SETTLE_MS = 120;
  // A row that was sent to a look and is not there yet is given this many
  // more of those moments before it counts as stopped short.
  var PATIENCE = 3;
  // A press that moves less than this is a click, not a drag.
  var DRAG_START_PX = 5;
  // How far a release at speed carries the row on (speed in px/ms times
  // this), never further than one look.
  var FLICK_MS = 150;
  // Mouse speed is read over the last moments before the release.
  var SPEED_WINDOW_MS = 80;

  // Is a control drawn, and not hidden along with its card?
  function shows(element) {
    return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  }

  class ValorLookbook extends HTMLElement {
    connectedCallback() {
      if (!this.track) return;
      this.focused = null; // the control a new layout took the focus from
      this.listeners = new AbortController();
      var signal = this.listeners.signal;
      this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.frame = 0;
      this.settleTimer = 0;
      this.touching = false;
      this.drag = null; // a mouse press on the row, and the drag it may become
      this.dragged = false; // the click that ends a drag is not a click
      this.current = null; // the active look, as last worked out
      this.heading = null; // the look a move is on its way to
      this.wanted = null; // the look a layout could not rest on (refresh)
      this.patience = 0; // how long a move is still waited for (onSettle)
      this.rushed = false; // presses have outrun the row: no sliding (step)
      // The merchant's order, read once: when the theme editor moves the
      // section the element connects again, with its looks as the loop left
      // them.
      if (!this.original) this.original = this.slides;

      this.setAttribute("data-enhanced", "");
      var track = this.track;
      track.addEventListener("scroll", this.onScroll.bind(this), { passive: true, signal: signal });
      track.addEventListener("keydown", this.onKeydown.bind(this), { signal: signal });
      // A finger resting on the row is not the row having stopped.
      track.addEventListener("touchstart", this.onTouch.bind(this, true), { passive: true, signal: signal });
      track.addEventListener("touchend", this.onTouch.bind(this, false), { passive: true, signal: signal });
      track.addEventListener("touchcancel", this.onTouch.bind(this, false), { passive: true, signal: signal });
      track.addEventListener("pointerdown", this.onPointerDown.bind(this), { signal: signal });
      track.addEventListener("pointermove", this.onPointerMove.bind(this), { signal: signal });
      track.addEventListener("pointerup", this.onPointerUp.bind(this), { signal: signal });
      track.addEventListener("pointercancel", this.onPointerUp.bind(this), { signal: signal });
      // A link or an image picked up by the mouse would end the drag.
      track.addEventListener("dragstart", this.onNativeDrag.bind(this), { signal: signal });
      this.addEventListener("click", this.onClickCapture.bind(this), { capture: true, signal: signal });
      this.addEventListener("click", this.onClick.bind(this), { signal: signal });
      // Bubbles up from the block's element, here a look.
      this.addEventListener("shopify:block:select", this.onBlockSelect.bind(this), { signal: signal });
      // Which control has the focus, for a layout change that hides it.
      this.addEventListener("focusin", this.onFocusIn.bind(this), { signal: signal });
      this.addEventListener("focusout", this.onFocusOut.bind(this), { signal: signal });

      this.resizeObserver = new ResizeObserver(this.onResize.bind(this));
      this.resizeObserver.observe(this);
      this.refresh();
      this.loadVariants();
    }

    disconnectedCallback() {
      if (this.listeners) this.listeners.abort();
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.frame) window.cancelAnimationFrame(this.frame);
      window.clearTimeout(this.settleTimer);
      // A variant's card that was being asked for was cut off with the
      // listeners: its look is asked about again when the section is back.
      var cut = this.querySelectorAll('[data-lookbook-variant-state="loading"]');
      for (var i = 0; i < cut.length; i++) cut[i].removeAttribute("data-lookbook-variant-state");
    }

    get track() {
      return this.querySelector(".valor-lookbook__track");
    }

    // The looks in the order they are in the row now.
    get slides() {
      var track = this.track;
      return track ? Array.prototype.slice.call(track.querySelectorAll("[data-look]")) : [];
    }

    get mode() {
      return getComputedStyle(this).getPropertyValue("--lb-mode").trim() === "tiles" ? "tiles" : "centered";
    }

    get count() {
      return parseFloat(getComputedStyle(this).getPropertyValue("--lb-count")) || 1;
    }

    // How many looks touch the row at rest: 3.6 centred images are a middle
    // one, a whole one and a cut one on each side.
    get touched() {
      var count = this.count;
      return this.mode === "tiles" ? Math.round(count) : 2 * Math.ceil((count - 1) / 2) + 1;
    }

    // What the row's geometry depends on: its width and the layout.
    get layout() {
      return this.track.clientWidth + "/" + this.mode + "/" + this.count;
    }

    get rtl() {
      return getComputedStyle(this).direction === "rtl";
    }

    get looping() {
      return this.hasAttribute("data-loop");
    }

    /* Where a look is measured from, and where the active one stands: the
       middle of the row when it is centred, its start edge in a 4/5/6 row. */
    anchorOf(box) {
      if (this.mode !== "tiles") return box.left + box.width / 2;
      return this.rtl ? box.right : box.left;
    }

    // The look nearest to the active place, or to a point that far along the
    // row from it (a distance on screen).
    lookNear(offset) {
      var slides = this.slides;
      var target = this.anchorOf(this.track.getBoundingClientRect()) + offset;
      var best = null;
      var bestDistance = Infinity;
      for (var i = 0; i < slides.length; i++) {
        var distance = Math.abs(this.anchorOf(slides[i].getBoundingClientRect()) - target);
        if (distance < bestDistance) {
          best = slides[i];
          bestDistance = distance;
        }
      }
      return best;
    }

    get active() {
      return this.lookNear(0);
    }

    /* Bring a look to the active place. The distance is measured on screen,
       so the same sum works left-to-right and right-to-left. */
    goTo(slide, options) {
      if (!slide || !this.track) return;
      var track = this.track;
      var instant = (options && options.instant) || this.reducedMotion.matches;
      var distance = this.anchorOf(slide.getBoundingClientRect()) - this.anchorOf(track.getBoundingClientRect());
      // Where the row can actually get to: at its end a look further on
      // cannot come to the active place. The move is then to the last look
      // that can, and that is the look it is heading for.
      var reach = track.scrollWidth - track.clientWidth;
      var wanted = track.scrollLeft + distance;
      var left = this.rtl ? Math.max(-reach, Math.min(0, wanted)) : Math.max(0, Math.min(reach, wanted));
      if (Math.abs(left - wanted) > 0.5) slide = this.lookNear(left - track.scrollLeft) || slide;
      if (Math.abs(left - track.scrollLeft) < 0.5) {
        // Nowhere to go. A move that has only just set off is called off,
        // there and then, where the row is.
        if (!this.heading) {
          this.update();
          return;
        }
        instant = true;
      }
      this.heading = instant ? null : slide;
      // scrollTo, not scrollBy: a move to an end position may pass the looks
      // on the way, which "one look per swipe" (scroll-snap-stop) would
      // otherwise cut short at the first of them.
      track.scrollTo({ left: left, behavior: instant ? "auto" : "smooth" });
      if (instant) {
        this.update();
      } else {
        // The wait for the row to stop starts afresh with the move, not with
        // the last scroll event before it.
        this.patience = PATIENCE;
        this.scheduleSettle();
      }
    }

    /* How many looks the row has in hand, at the end where it has fewer,
       when this look is the active one. Below 0 the row cannot rest on it
       with looks all the way across. */
    spare(slide) {
      var slides = this.slides;
      var index = slides.indexOf(slide);
      if (index < 0) return -1;
      var touched = this.touched;
      var before = this.mode === "tiles" ? 0 : Math.floor(touched / 2);
      return Math.min(index - before, slides.length - touched - index + before);
    }

    step(direction) {
      // A second press while the row is still sliding counts from where the
      // first one is going.
      var from = this.heading && this.heading.isConnected ? this.heading : this.active;
      var slides = this.slides;
      var target = slides[slides.indexOf(from) + direction];
      if (this.looping && this.spare(target) < 0) {
        /* Quicker presses than the row can settle between: bring the far
           looks round now. Not only when the list has run out: a look that
           is still in the list may be one the row cannot rest on any more
           (a 4/5/6 row is at the end of its scroll range before its last
           look has come to the front).
           If that breaks off a slide that is under way, the row goes
           straight to the look instead of sliding, and so do the presses
           that follow until it has rested: a slide asked for right after
           one was broken off is not something every browser carries out. */
        if (this.heading) {
          this.rushed = true;
          this.scheduleSettle();
        }
        this.recenter(from);
        slides = this.slides;
        target = slides[slides.indexOf(from) + direction];
      }
      if (target) this.goTo(target, this.rushed ? { instant: true } : null);
    }

    next() {
      this.step(1);
    }

    prev() {
      this.step(-1);
    }

    /* The loop: keep the look that everything is measured from (the active
       one, or the one a move is heading for) in the middle of the row's
       order, by moving looks from the far end to the near end. Only looks
       that are out of sight move, so a card in view keeps its focus. The
       scroll position is corrected by exactly what the move shifted, with
       snapping off for that moment, so nothing on screen changes. */
    recenter(anchor) {
      if (!this.looping) return;
      var slides = this.slides;
      anchor = anchor || this.active;
      var index = slides.indexOf(anchor);
      if (index < 0) return;
      var touched = this.touched;
      var target = Math.floor((slides.length - touched) / 2) + (this.mode === "tiles" ? 0 : Math.floor(touched / 2));
      var shift = index - target;
      if (!shift) return;

      var track = this.track;
      var before = anchor.getBoundingClientRect().left;
      track.setAttribute("data-shifting", "");
      var i;
      if (shift > 0) {
        for (i = 0; i < shift; i++) track.appendChild(slides[i]);
      } else {
        var first = slides[0];
        for (i = slides.length + shift; i < slides.length; i++) track.insertBefore(slides[i], first);
      }
      track.scrollLeft += anchor.getBoundingClientRect().left - before;
      // Read once more, so the position is settled before snapping returns.
      void track.scrollLeft;
      track.removeAttribute("data-shifting");
    }

    /* Is the row down to its last look in hand at either end? While the row
       is dragged this is checked as it goes. */
    get nearEnd() {
      return this.spare(this.active) < 1;
    }

    /* Back to the merchant's order, for a row that does not loop (any more).
       The look that holds the focus stays where it is and the others are put
       back around it: a look that is moved loses the focus. */
    restoreOrder(fixed) {
      var track = this.track;
      var slides = this.slides;
      var original = this.original.filter(function (slide) {
        return slide.parentNode === track;
      });
      var same = original.length === slides.length;
      for (var i = 0; same && i < slides.length; i++) same = slides[i] === original[i];
      if (same) return;
      var at = original.indexOf(fixed);
      for (var j = 0; j < original.length; j++) {
        if (j < at) track.insertBefore(original[j], fixed);
        else if (j > at) track.appendChild(original[j]);
      }
    }

    /* The control of this lookbook that has the focus, or had it until the
       new layout hid it (the card of a look that is no longer the active
       one, the arrows of a row that has none now). */
    get heldFocus() {
      var active = document.activeElement;
      if (active && this.contains(active)) return active;
      var nowhere = !active || active === document.body;
      return nowhere && this.focused && this.focused.isConnected ? this.focused : null;
    }

    onFocusIn(event) {
      this.focused = event.target;
    }

    /* The focus that goes on to something else, or leaves a control that is
       still there (a click on the page), is the visitor's doing and is not
       brought back. Only the one a new layout took away is remembered. */
    onFocusOut(event) {
      if (event.relatedTarget || shows(event.target)) this.focused = null;
    }

    /* The lookbook's box has changed. The looks are laid out again only when
       the row's width or the layout has: a card that grows (the card of a
       variant arriving, a message from the cart) changes the height alone,
       and the row is left as it is, sliding or in the visitor's hand. */
    onResize() {
      if (this.track && this.layout !== this.laidOut) this.refresh();
    }

    /* Layout changed (first run, a resize, a breakpoint): decide whether the
       row loops, keep the look that was active where the active look stands,
       and mark the row. In the centred row only the active look shows its
       card, so a card with the focus makes its look the one to keep. */
    refresh() {
      if (!this.track) return;
      this.laidOut = this.layout;
      var held = this.heldFocus;
      var holder = held ? held.closest("[data-look]") : null;
      var keep = this.current && this.current.isConnected ? this.current : null;
      if (this.wanted && this.wanted.isConnected) keep = this.wanted;
      if (holder && this.mode !== "tiles") keep = holder;
      var loop = this.slides.length >= this.touched + 2;
      if (!loop) this.restoreOrder(holder);
      this.toggleAttribute("data-loop", loop);
      this.toggleAttribute("data-static", this.track.scrollWidth <= this.track.clientWidth + 1);
      this.endDrag();
      // The looks go into this layout's order first, around the look to
      // keep: in the order of the layout before, a row with few looks in
      // hand could not scroll far enough to bring that look to its place.
      this.recenter(keep);
      if (keep) this.goTo(keep, { instant: true });
      this.update();
      /* A 4/5/6 row that does not loop cannot rest on every look: it may
         show them all at once, or be at its end before the look has come to
         the front. The look is then kept for the layout that follows (the
         window narrowed again), until the visitor moves the row (update). */
      this.wanted = keep && keep !== this.current ? keep : null;
      /* The focus goes back to where it was, or to the row when that
         control is not there in this layout (a browser may still count a
         hidden control as the one with the focus, and drop it later). */
      if (held && held.isConnected) {
        var place = shows(held) ? held : this.track;
        if (document.activeElement !== place) place.focus({ preventScroll: true });
      }
    }

    update() {
      var slides = this.slides;
      var active = this.active;
      // The row has gone to another look: that is where the visitor is now.
      if (active !== this.current) this.wanted = null;
      this.current = active;
      /* In the centred row a look that is no longer the active one hides its
         card. A card with the focus (the row was moved by a trackpad, a wheel
         or a finger) hands it to the row first, as a card that leaves a 4/5/6
         row does. */
      var focus = document.activeElement;
      var holder = focus && focus !== this.track && this.track.contains(focus) ? focus.closest("[data-look]") : null;
      if (holder && holder !== active && this.mode !== "tiles") this.track.focus({ preventScroll: true });
      for (var i = 0; i < slides.length; i++) slides[i].classList.toggle("is-active", slides[i] === active);

      var index = slides.indexOf(active);
      var looping = this.looping;
      var prev = this.querySelector("[data-lookbook-prev]");
      var next = this.querySelector("[data-lookbook-next]");
      var prevOff = !looping && index <= 0;
      var nextOff = !looping && index >= slides.length - 1;
      /* An arrow that answers again is switched on first: with two looks one
         press goes from end to end, and the arrow that goes off hands its
         focus to the one that comes on. */
      if (prev && !prevOff) prev.disabled = false;
      if (next && !nextOff) next.disabled = false;
      this.switchArrow(prev, prevOff, next);
      this.switchArrow(next, nextOff, prev);
      this.updateReach(slides, looping);
    }

    /* An arrow at the end of a row that does not loop is switched off. If it
       is the one in use, the focus goes to the other arrow rather than being
       left on a button that no longer answers. */
    switchArrow(arrow, off, other) {
      if (!arrow) return;
      var focused = off && !arrow.disabled && document.activeElement === arrow;
      arrow.disabled = off;
      if (focused && other && !other.disabled) other.focus({ preventScroll: true });
    }

    /* In a 4/5/6 row every card shows, those of the looks outside the row
       too. While the row loops, Tab would go from card to card for ever (the
       looks keep coming round), so only the cards of the looks in the row
       can be reached; the arrow keys on the row bring the others in. A row
       that does not loop is left alone: there Tab ends at the last card, and
       brings it into the row on the way. */
    updateReach(slides, looping) {
      var limit = looping && this.mode === "tiles";
      if (!limit && !this.limited) return;
      this.limited = limit;
      var row = limit ? this.track.getBoundingClientRect() : null;
      for (var i = 0; i < slides.length; i++) {
        var slot = slides[i].querySelector(".valor-lookbook__card-slot");
        if (!slot) continue;
        var box = limit ? slides[i].getBoundingClientRect() : null;
        var out = limit && (box.left < row.left - 1 || box.right > row.right + 1);
        // A card that leaves the row with the focus on it (the row was moved
        // by the mouse) hands the focus to the row.
        if (out && !slot.inert && slot.contains(document.activeElement)) this.track.focus({ preventScroll: true });
        slot.inert = out;
      }
    }

    /* A resize moves the row under its scroll position, and that scroll event
       can arrive before the resize is seen: the look that was active goes
       back first, it is not replaced by whichever look the resize left in
       its place. */
    sync() {
      if (this.layout !== this.laidOut) {
        this.refresh();
      } else {
        this.update();
      }
    }

    onScroll() {
      if (!this.frame) {
        this.frame = window.requestAnimationFrame(
          function () {
            this.frame = 0;
            this.sync();
          }.bind(this),
        );
      }
      this.scheduleSettle();
    }

    scheduleSettle() {
      window.clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(this.onSettle.bind(this), SETTLE_MS);
    }

    // The row has stopped: the place to bring the far looks round.
    onSettle() {
      if (this.touching) return; // touchend schedules it again
      if (this.drag && this.drag.moving) return; // and so does letting go
      /* No scroll event for a moment is taken for the row having stopped.
         But a row that has only just been sent on may not have set off yet
         (a busy page; a browser that takes its time to start a slide where
         it has just broken one off), and bringing the far looks round where
         it is now would cut the move off. A row that is not where it was
         sent is given a few more moments before it is taken to have stopped
         short. */
      var heading = this.heading && this.heading.isConnected ? this.heading : null;
      if (heading && heading !== this.active && this.patience > 0) {
        this.patience -= 1;
        this.scheduleSettle();
        return;
      }
      this.patience = 0;
      this.rushed = false;
      // The glide after a drag has come to rest: snapping takes over again.
      this.track.removeAttribute("data-free");
      this.heading = null;
      this.sync();
      this.recenter();
      this.update();
    }

    onTouch(down) {
      this.touching = down;
      if (!down) {
        this.scheduleSettle();
        return;
      }
      /* Swipes that follow each other without a rest never let the row
         stop, and a row that never stops would run out of looks. A finger
         landing on it holds the row still for a moment, before the swipe
         begins: the far looks come round now. A row at rest has them in
         place already, and nothing moves. */
      this.heading = null;
      this.recenter();
      this.update();
    }

    /* Mouse dragging. The row follows the mouse one to one, with snapping
       off (data-free) until it has glided to rest on a look. */
    onPointerDown(event) {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      if (this.hasAttribute("data-static")) return;
      this.drag = {
        id: event.pointerId,
        x: event.clientX,
        scroll: this.track.scrollLeft,
        moving: false,
        samples: [],
      };
    }

    onPointerMove(event) {
      var drag = this.drag;
      if (!drag || event.pointerId !== drag.id) return;
      // A press that was let go outside the row never came back as a
      // release: without the button held this is not a drag (any more).
      if (!(event.buttons & 1)) {
        if (drag.moving) {
          this.onPointerUp(event);
        } else {
          this.drag = null;
        }
        return;
      }
      var track = this.track;
      if (!drag.moving) {
        if (Math.abs(event.clientX - drag.x) < DRAG_START_PX) return;
        drag.moving = true;
        this.heading = null;
        // A row at rest follows the mouse from where it was pressed. A row
        // that was still sliding when pressed is taken from where it is now.
        if (Math.abs(track.scrollLeft - drag.scroll) > 1) {
          drag.x = event.clientX;
          drag.scroll = track.scrollLeft;
        }
        track.setAttribute("data-free", "");
        this.setAttribute("data-dragging", "");
        if (track.setPointerCapture) track.setPointerCapture(drag.id);
        var selection = window.getSelection ? window.getSelection() : null;
        if (selection && selection.removeAllRanges) selection.removeAllRanges();
      }
      track.scrollLeft = drag.scroll - (event.clientX - drag.x);
      drag.samples.push({ x: event.clientX, time: event.timeStamp });
      if (drag.samples.length > 8) drag.samples.shift();

      if (this.looping && this.nearEnd) {
        // Bring the far looks round, and carry on from the corrected position.
        var before = track.scrollLeft;
        this.recenter();
        drag.scroll += track.scrollLeft - before;
      }
    }

    onPointerUp(event) {
      var drag = this.drag;
      if (!drag || event.pointerId !== drag.id) return;
      this.drag = null;
      if (!drag.moving) return;

      this.removeAttribute("data-dragging");
      // The click the browser sends after the release belongs to the drag.
      this.dragged = true;
      window.setTimeout(
        function () {
          this.dragged = false;
        }.bind(this),
        0,
      );

      // Rest on the look nearest to where the row is, or, let go at speed,
      // to where it was going: at most one look further.
      var speed = this.speedOf(drag, event.timeStamp);
      var slides = this.slides;
      var step =
        slides.length > 1
          ? Math.abs(slides[1].getBoundingClientRect().left - slides[0].getBoundingClientRect().left)
          : 0;
      var carry = Math.max(-step, Math.min(step, speed * FLICK_MS));
      this.goTo(this.lookNear(-carry));
      this.scheduleSettle();
    }

    // Mouse speed in px/ms over the last moments of the drag; 0 once the
    // mouse has rested.
    speedOf(drag, now) {
      var samples = drag.samples.filter(function (sample) {
        return now - sample.time <= SPEED_WINDOW_MS;
      });
      if (samples.length < 2) return 0;
      var first = samples[0];
      var last = samples[samples.length - 1];
      var elapsed = last.time - first.time;
      return elapsed > 0 ? (last.x - first.x) / elapsed : 0;
    }

    // A drag cut short (the layout changed under it).
    endDrag() {
      this.drag = null;
      this.removeAttribute("data-dragging");
      if (this.track) this.track.removeAttribute("data-free");
    }

    onNativeDrag(event) {
      event.preventDefault();
    }

    onClickCapture(event) {
      if (!this.dragged) return;
      this.dragged = false;
      event.preventDefault();
      event.stopPropagation();
    }

    onKeydown(event) {
      if (event.target !== this.track) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      var forward = (event.key === "ArrowRight") !== this.rtl;
      this.step(forward ? 1 : -1);
    }

    onClick(event) {
      var target = event.target;
      if (!target.closest) return;
      if (target.closest("[data-lookbook-prev]")) {
        this.prev();
        return;
      }
      if (target.closest("[data-lookbook-next]")) {
        this.next();
        return;
      }
      if (this.mode !== "centered") return;
      var media = target.closest(".valor-lookbook__media");
      var slide = media ? media.closest("[data-look]") : null;
      if (slide && slide !== this.active) this.goTo(slide);
    }

    onBlockSelect(event) {
      var slide = event.target && event.target.closest ? event.target.closest("[data-look]") : null;
      if (slide && this.contains(slide)) this.goTo(slide, { instant: true });
    }

    /* A product comes with at most 250 of its variants. A look whose variant
       is not among them is printed with the product's own card (linked to
       that variant) and the variant's ID on the card's slot. The variant's
       card is asked for by the ID, from a section that Shopify renders for
       exactly that variant (sections/lookbook-variant.liquid), and takes the
       place of the product's. An ID that turns out to be no variant of the
       look's product leaves the card as it is, and the theme editor's note
       about it shows. */
    loadVariants() {
      var slots = this.querySelectorAll("[data-lookbook-variant]:not([data-lookbook-variant-state])");
      for (var i = 0; i < slots.length; i++) this.loadVariant(slots[i]);
    }

    loadVariant(slot) {
      var id = slot.getAttribute("data-lookbook-variant");
      if (!/^\d+$/.test(id)) return;
      // Cut off when the section leaves the page (the theme editor moving
      // it). From then on this request has nothing to say about the look:
      // the section, back in the page, has asked again.
      var signal = this.listeners.signal;
      var settle = function (state) {
        if (signal.aborted) return;
        slot.setAttribute("data-lookbook-variant-state", state);
        var note = slot.querySelector("[data-lookbook-variant-note]");
        if (note && state === "missing") note.hidden = false;
      };
      settle("loading");
      var root = this.getAttribute("data-root-url") || "/";
      if (root.charAt(root.length - 1) !== "/") root += "/";
      fetch(root + "variants/" + id + "/?section_id=lookbook-variant", {
        signal: signal,
        credentials: "same-origin",
      })
        .then(function (response) {
          if (response.status === 404) return ""; // no such variant
          if (!response.ok) throw new Error("lookbook variant: " + response.status);
          return response.text();
        })
        .then(
          function (text) {
            // An answer that comes all the same (an app that wraps fetch
            // may not pass the cut-off on) is not put in the look.
            if (signal.aborted) return;
            var found = text
              ? new DOMParser().parseFromString(text, "text/html").querySelector("[data-lookbook-variant-card]")
              : null;
            var own = found && found.getAttribute("data-product-id") === slot.getAttribute("data-lookbook-product");
            var card = own ? found.querySelector(".valor-lookbook__card") : null;
            if (!card || !slot.isConnected) return settle("missing");
            this.replaceCard(slot, document.importNode(card, true));
            settle("done");
          }.bind(this),
        )
        .catch(function () {
          // The shop could not be asked (or the section was taken away
          // meanwhile): the product's card stays.
          settle("failed");
        });
    }

    /* The new card in the old one's place. A control of the old card that
       has the focus hands it to the same control of the new one: its title,
       or its button where that can be pressed (a sold-out button cannot).

       The card may arrive between a change of layout and the row being told
       of it. A row narrowed to the centred one has by then hidden the old
       card, perhaps with the focus on it, and the browser may already have
       dropped that focus. The row is laid out first: that brings the focus
       back to the old card while it is still there, and its look to the
       middle, where the new card shows and can take the focus. */
    replaceCard(slot, card) {
      if (this.layout !== this.laidOut) this.refresh();
      var old = slot.querySelector(".valor-lookbook__card");
      var active = document.activeElement;
      var held = old && old.contains(active) ? active : null;
      if (old) {
        old.replaceWith(card);
      } else {
        slot.appendChild(card);
      }
      if (!held) return;
      var button = held.classList.contains("valor-lookbook__card-button")
        ? card.querySelector(".valor-lookbook__card-button:not([disabled])")
        : null;
      var place = button || card.querySelector(".valor-lookbook__card-title") || this.track;
      place.focus({ preventScroll: true });
    }
  }

  customElements.define("valor-lookbook", ValorLookbook);
})();
