/* ==========================================================================
   dragdrop.js — moving letters with a finger or a mouse.

   Two ways in, because dragging is genuinely hard at seven and harder still
   with ADHD:

     - Drag a tile anywhere onto the word line. The gap nearest your finger
       opens up, so letters can go on the front, the end, or into the middle.
     - Or just tap. The letter drops in at the caret, and tapping a gap moves
       the caret first.

   Pointer events cover mouse, touch and pen with one code path. A dragged
   tile is reparented to <body> and fixed to the viewport so it can never be
   clipped by whatever it is flying over.

   The game supplies the callbacks and owns all the state; this file only
   decides where a letter was let go of.
   ========================================================================== */

(function (global) {
  "use strict";

  var MOVE_THRESHOLD = 8; // px of movement before a press becomes a drag

  var config = null;
  var drag = null; // the press in progress, or null

  /* Which gap in the word line is nearest the pointer, or null if the pointer
     is nowhere near the line. The catchment is generous on purpose. */
  function insertionIndexAt(x, y) {
    var box = config.lineEl.getBoundingClientRect();
    if (x < box.left - 70 || x > box.right + 70) return null;
    if (y < box.top - 80 || y > box.bottom + 80) return null;

    var gaps = config.lineEl.querySelectorAll(".gap");
    if (!gaps.length) return 0;

    var bestIndex = 0;
    var bestDistance = Infinity;

    for (var i = 0; i < gaps.length; i++) {
      var gapBox = gaps[i].getBoundingClientRect();
      var dx = Math.abs(gapBox.left + gapBox.width / 2 - x);
      var dy = Math.abs(gapBox.top + gapBox.height / 2 - y);

      // Weighting the vertical distance keeps a long, wrapped word honest:
      // the gap on the row you are actually over wins.
      var distance = dx + dy * 4;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = parseInt(gaps[i].getAttribute("data-index"), 10) || 0;
      }
    }
    return bestIndex;
  }

  function highlightGap(index) {
    var gaps = config.lineEl.querySelectorAll(".gap");
    for (var i = 0; i < gaps.length; i++) {
      var gapIndex = parseInt(gaps[i].getAttribute("data-index"), 10);
      gaps[i].classList.toggle("is-active", index !== null && gapIndex === index);
    }
    config.lineEl.classList.toggle("is-target", index !== null);
  }

  function moveGhost(x, y) {
    drag.tile.style.left = (x - drag.grabX) + "px";
    drag.tile.style.top = (y - drag.grabY) + "px";
  }

  function beginDrag(x, y) {
    var tile = drag.tile;
    var rect = tile.getBoundingClientRect();

    drag.dragging = true;
    drag.grabX = drag.startX - rect.left;
    drag.grabY = drag.startY - rect.top;

    // Lift the tile clean out of the layout so nothing can clip it.
    document.body.appendChild(tile);
    tile.classList.add("is-dragging");
    tile.style.width = rect.width + "px";
    tile.style.height = rect.height + "px";
    moveGhost(x, y);

    if (config.onPick) config.onPick(tile, drag.from);
  }

  /* Hand the tile back to the game, which decides where it actually lands. */
  function finish(tile, from, index) {
    var ghostRect = tile.getBoundingClientRect();

    tile.classList.remove("is-dragging");
    tile.style.left = "";
    tile.style.top = "";
    tile.style.width = "";
    tile.style.height = "";

    highlightGap(null);
    if (config.onDrop) config.onDrop(tile, index, from, ghostRect);
  }

  function onPointerDown(event) {
    if (drag || event.button > 0) return;
    if (config.enabled && !config.enabled()) return;
    if (!event.target.closest) return;

    var tile = event.target.closest(".tile");
    if (!tile) return;

    drag = {
      tile: tile,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      from: tile.parentElement === config.lineEl ? "line" : "grid"
    };

    try {
      tile.setPointerCapture(event.pointerId);
    } catch (err) {
      /* Without capture the window listeners still see every move. */
    }
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (!drag.dragging) {
      var moved = Math.abs(event.clientX - drag.startX) +
                  Math.abs(event.clientY - drag.startY);
      if (moved < MOVE_THRESHOLD) return;
      beginDrag(event.clientX, event.clientY);
    }

    moveGhost(event.clientX, event.clientY);
    highlightGap(insertionIndexAt(event.clientX, event.clientY));
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    var current = drag;
    drag = null; // clear first: the callbacks below re-render the board

    try {
      current.tile.releasePointerCapture(event.pointerId);
    } catch (err) {
      /* Already released. */
    }

    if (!current.dragging) {
      if (config.onTap) config.onTap(current.tile, current.from);
      return;
    }

    finish(current.tile, current.from, insertionIndexAt(event.clientX, event.clientY));
  }

  function onPointerCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    var current = drag;
    drag = null;
    if (current.dragging) {
      finish(current.tile, current.from, null);
    }
  }

  var DragDrop = {
    /* options: { lineEl, enabled(), onPick(tile, from), onTap(tile, from),
                  onDrop(tile, index, from, ghostRect), onGapTap(index) } */
    init: function (options) {
      config = options;

      document.addEventListener("pointerdown", onPointerDown);
      global.addEventListener("pointermove", onPointerMove);
      global.addEventListener("pointerup", onPointerUp);
      global.addEventListener("pointercancel", onPointerCancel);

      // Tapping an empty gap moves the caret without moving any letters.
      config.lineEl.addEventListener("click", function (event) {
        if (!event.target.closest) return;
        var gap = event.target.closest(".gap");
        if (gap && config.onGapTap) {
          config.onGapTap(parseInt(gap.getAttribute("data-index"), 10) || 0);
        }
      });
    },

    /* Slide an element from where it used to be to where it is now. Called
       after the DOM has already been updated, so a letter appears to fly home
       rather than teleporting there. */
    flyFrom: function (element, fromRect) {
      if (!fromRect) return;

      var to = element.getBoundingClientRect();
      if (!to.width) return;

      var dx = fromRect.left - to.left;
      var dy = fromRect.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      var scale = fromRect.width / to.width;
      element.style.transition = "none";
      element.style.transform =
        "translate(" + dx + "px," + dy + "px) scale(" + scale.toFixed(3) + ")";

      void element.offsetWidth; // commit the start position

      element.style.transition = "";
      element.classList.add("is-returning");
      element.style.transform = "";

      global.setTimeout(function () {
        element.classList.remove("is-returning");
      }, 360);
    },

    isDragging: function () {
      return !!(drag && drag.dragging);
    }
  };

  global.DragDrop = DragDrop;
})(window);
