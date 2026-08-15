/* ==========================================================================
   kitten.js — the cat that watches her play.

   The point of the cat is that it reacts, and the point of *this* file is
   that it reacts differently each time. A celebration you have seen four
   times is wallpaper, so every state holds several animations and one is
   drawn at random, never the same one twice running.

   States, roughly in order of excitement:

     idle      nothing on the line. Occasional blinks, ear flicks, a yawn.
     watching  a letter just went down. Perks up, leans in.
     close     one letter away from a real word. Wiggles, bounces, paws.
     ready     the line already spells a word she has not found yet.
     cheer     she found one.
     bigcheer  she found a long one. Same idea, more of it, plus hearts.
     nudge     not a word. Curious and encouraging, never disappointed.
     sleep     the game is paused.
   ========================================================================== */

(function (global) {
  "use strict";

  /* Each entry is [class, milliseconds]. The duration must match the CSS or
     the class is stripped mid-animation. */
  var REACTIONS = {
    idle: [
      ["k-idle-blink", 1100],
      ["k-idle-earflick", 700],
      ["k-idle-tailflick", 1000],
      ["k-idle-tilt", 1800],
      ["k-idle-look", 2400],
      ["k-idle-yawn", 1600]
    ],
    watching: [
      ["k-watch-perk", 600],
      ["k-watch-lean", 800],
      ["k-watch-bob", 550],
      ["k-watch-blink", 700]
    ],
    close: [
      ["k-close-wiggle", 800],
      ["k-close-bounce", 750],
      ["k-close-paws", 920],
      ["k-close-eyes", 900],
      ["k-close-ears", 1800]
    ],
    ready: [
      ["k-ready-shimmy", 1000],
      ["k-ready-hop", 1000],
      ["k-ready-stretch", 1100]
    ],
    cheer: [
      ["k-cheer-jump", 1000],
      ["k-cheer-spin", 1050],
      ["k-cheer-wave", 1000],
      ["k-cheer-dance", 1100],
      ["k-cheer-purr", 1200]
    ],
    bigcheer: [
      ["k-cheer-jump k-cheer-hearts", 1550],
      ["k-cheer-spin k-cheer-hearts", 1550],
      ["k-cheer-dance k-cheer-hearts", 1550],
      ["k-cheer-purr k-cheer-hearts", 1550]
    ],
    nudge: [
      ["k-nudge-tilt", 1400],
      ["k-nudge-blink", 1400],
      ["k-nudge-paw", 1300],
      ["k-nudge-peer", 1300]
    ]
  };

  // How long to leave her alone before an idle fidget, in milliseconds.
  var IDLE_MIN = 3200;
  var IDLE_MAX = 8000;

  // A sustained state (close, ready) re-fires now and then so she stays alive
  // without being asked again.
  var REPEAT_MIN = 2600;
  var REPEAT_MAX = 5200;

  var root = null;
  var svg = null;
  var pupils = null;

  var enabled = true;
  var running = false;          // a reaction is playing right now
  var state = "idle";
  var lastPick = {};            // state -> last class used, to avoid repeats
  var clearTimer = null;
  var nextTimer = null;
  var pointerFrame = 0;

  function pickVariant(name) {
    var options = REACTIONS[name];
    if (!options || !options.length) return null;
    if (options.length === 1) return options[0];

    // Draw from everything except the one we used last time for this state.
    var previous = lastPick[name];
    var choice;
    var guard = 0;
    do {
      choice = options[(Math.random() * options.length) | 0];
    } while (choice[0] === previous && guard++ < 8);

    lastPick[name] = choice[0];
    return choice;
  }

  function stripAnimation() {
    if (!root) return;
    var classes = root.className.split(" ");
    for (var i = 0; i < classes.length; i++) {
      if (classes[i].indexOf("k-") === 0 && classes[i] !== "k-asleep") {
        root.classList.remove(classes[i]);
      }
    }
    running = false;
  }

  function scheduleNext() {
    global.clearTimeout(nextTimer);
    if (!enabled) return;

    var sustained = state === "close" || state === "ready";
    var min = sustained ? REPEAT_MIN : IDLE_MIN;
    var max = sustained ? REPEAT_MAX : IDLE_MAX;
    var wait = min + Math.random() * (max - min);

    nextTimer = global.setTimeout(function () {
      // Idle fidgets only when there is nothing more interesting going on.
      play(sustained ? state : "idle");
    }, wait);
  }

  /* Run one animation from `name`'s set. Interrupts whatever was playing:
     a cheer must never be held up by a leftover blink. */
  function play(name) {
    if (!enabled || !root || state === "sleep") return;

    var variant = pickVariant(name);
    if (!variant) return;

    global.clearTimeout(clearTimer);
    stripAnimation();

    // Force the browser to notice the classes went away, so re-playing the
    // same animation back to back actually restarts it.
    void root.offsetWidth;

    var classes = variant[0].split(" ");
    for (var i = 0; i < classes.length; i++) root.classList.add(classes[i]);
    running = true;

    clearTimer = global.setTimeout(function () {
      stripAnimation();
      scheduleNext();
    }, variant[1]);
  }

  /* Pupils drift towards wherever she is working. Cheap, and it does more for
     "this cat is watching me" than any amount of animation. */
  function lookAt(x, y) {
    if (!enabled || !pupils || state === "sleep") return;
    if (pointerFrame) return;

    pointerFrame = global.requestAnimationFrame(function () {
      pointerFrame = 0;
      if (!root) return;

      var box = root.getBoundingClientRect();
      if (!box.width) return;

      // Eye centre sits around a third of the way down the drawing.
      var originX = box.left + box.width * 0.5;
      var originY = box.top + box.height * 0.33;
      var dx = x - originX;
      var dy = y - originY;
      var distance = Math.sqrt(dx * dx + dy * dy) || 1;

      // Clamped hard: a pupil that swings far looks unsettling rather than
      // attentive.
      var reach = Math.min(3.2, distance / 90);
      pupils.style.transform =
        "translate(" + (dx / distance * reach).toFixed(2) + "px," +
        (dy / distance * reach * 0.7).toFixed(2) + "px)";
    });
  }

  var Kitten = {
    init: function (element) {
      root = element;
      if (!root) return;

      svg = root.querySelector(".kitten-svg");
      pupils = root.querySelector(".k-pupils");

      global.addEventListener("pointermove", function (event) {
        lookAt(event.clientX, event.clientY);
      }, { passive: true });

      scheduleNext();
    },

    /* The game calls this whenever the situation changes. Repeating the
       current state is ignored, so placing a fifth letter in an already
       "watching" word does not restart the animation every time — but a
       genuine change always gets a fresh, randomly chosen reaction. */
    setState: function (next) {
      if (!enabled || !root) return;
      if (next === state) return;

      var wasAsleep = state === "sleep";
      state = next;

      if (next === "sleep") {
        global.clearTimeout(clearTimer);
        global.clearTimeout(nextTimer);
        stripAnimation();
        root.classList.add("k-asleep");
        return;
      }

      if (wasAsleep) root.classList.remove("k-asleep");

      if (next === "idle") {
        scheduleNext();
        return;
      }
      play(next);
    },

    /* One-off reactions that do not change the ongoing state: she cheers,
       then goes back to watching an empty line. */
    react: function (name) {
      if (!enabled || !root) return;
      if (state === "sleep") root.classList.remove("k-asleep");
      state = "idle";
      play(name);
    },

    /* Look at a particular element — used when a letter lands. */
    watch: function (element) {
      if (!element || !element.getBoundingClientRect) return;
      var box = element.getBoundingClientRect();
      lookAt(box.left + box.width / 2, box.top + box.height / 2);
    },

    setEnabled: function (on) {
      enabled = !!on;
      document.body.classList.toggle("no-kitten", !enabled);

      if (!enabled) {
        global.clearTimeout(clearTimer);
        global.clearTimeout(nextTimer);
        stripAnimation();
      } else {
        state = "idle";
        scheduleNext();
      }
    },

    reset: function () {
      if (!root) return;
      global.clearTimeout(clearTimer);
      stripAnimation();
      root.classList.remove("k-asleep");
      state = "idle";
      if (pupils) pupils.style.transform = "";
      scheduleNext();
    },

    /* Exposed for the tests, which need to know what is available. */
    variants: function (name) {
      return (REACTIONS[name] || []).map(function (entry) { return entry[0]; });
    },

    currentState: function () {
      return state;
    }
  };

  global.Kitten = Kitten;
})(window);
