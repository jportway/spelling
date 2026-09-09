/* ==========================================================================
   balloon.js — the thing she is actually playing for.

   Every word she finishes puffs it up a little further. The point of a
   balloon rather than a bar or a tower is the strain: it does not just get
   fuller, it gets visibly more precarious. It stretches, the rubber goes
   pale and thin, the wobble quickens, and past about four fifths full it
   starts trembling and creaking. By the end she can see the pop coming,
   which is the whole feeling a progress bar cannot give you.

   Fill only ever goes up. A wrong letter costs her puffs before they are
   banked - it never takes air back out - so the balloon is a record of what
   she has earned and nothing on screen ever retreats.
   ========================================================================== */

(function (global) {
  "use strict";

  /* Past these fractions the balloon starts looking worried. */
  var STRAINING = 0.8;
  var CRITICAL = 0.95;

  var POP_MS = 900;

  var root = null;
  var label = null;
  var onPop = null;

  var capacity = 1;
  var filled = 0;
  var popped = false;
  var popTimer = null;

  function ratio() {
    return capacity > 0 ? Math.min(1, filled / capacity) : 0;
  }

  function paint() {
    if (!root) return;

    var fill = ratio();
    root.style.setProperty("--fill", fill.toFixed(4));
    root.classList.toggle("is-straining", fill >= STRAINING && !popped);
    root.classList.toggle("is-critical", fill >= CRITICAL && !popped);

    var left = Math.max(0, capacity - filled);
    root.setAttribute("aria-valuenow", String(Math.round(fill * 100)));

    if (!label) return;
    if (popped) {
      label.textContent = "POP!";
    } else if (left === 0) {
      label.textContent = "ready to go!";
    } else {
      // A count of puffs means nothing to her; a count of words is something
      // she can actually aim at.
      label.textContent = left + (left === 1 ? " more puff" : " more puffs");
    }
  }

  var Balloon = {
    /* options: { element, label, onPop } */
    init: function (options) {
      root = options.element;
      label = options.label || null;
      onPop = options.onPop || null;
      this.reset(1);
    },

    reset: function (size) {
      capacity = Math.max(1, size | 0);
      filled = 0;
      popped = false;
      global.clearTimeout(popTimer);

      if (root) root.classList.remove("is-popping", "is-popped");
      paint();
    },

    /* Puff it up. Returns true on the puff that bursts it, and only ever
       once - the round ends on that, so a second call must not fire it
       again. */
    add: function (puffs) {
      if (popped || !root) return false;

      filled += Math.max(0, puffs | 0);
      paint();

      if (filled < capacity) return false;

      popped = true;
      root.classList.add("is-popping");
      paint();

      popTimer = global.setTimeout(function () {
        if (!root) return;
        root.classList.add("is-popped");
        if (onPop) onPop();
      }, POP_MS);

      return true;
    },

    /* Where the puffs should fly to, for the animation that sends them. */
    element: function () {
      return root;
    },

    fill: function () {
      return ratio();
    },

    percent: function () {
      return Math.round(ratio() * 100);
    },

    remaining: function () {
      return Math.max(0, capacity - filled);
    },

    capacity: function () {
      return capacity;
    },

    hasPopped: function () {
      return popped;
    },

    /* Stop a pending pop dead - used when the clock beats her to it. */
    cancel: function () {
      global.clearTimeout(popTimer);
    }
  };

  global.Balloon = Balloon;
})(window);
