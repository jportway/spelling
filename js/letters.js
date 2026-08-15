/* ==========================================================================
   letters.js — everything about the six letters Cooper mixes up.

   b, d, p and q are the same shape in four rotations, and n and m differ only
   by a hump. Two things make them separable here:

     1. Colour. Each letter keeps one colour for the whole game, and the two
        halves of each pair are far apart in hue.
     2. A ball-and-stick diagram drawn under the letter, showing which side
        the ball is on and whether the tail drops below the line.

   The diagram teaches a rule that actually generalises:
        ball on the RIGHT -> b or p        ball on the LEFT -> d or q
        sits ON the line  -> b or d        tail HANGS DOWN  -> p or q
   ========================================================================== */

(function (global) {
  "use strict";

  var PARTNER = { b: "d", d: "b", p: "q", q: "p", n: "m", m: "n" };

  var INFO = {
    b: { colour: "b", ball: "right", tail: false, word: "bed",   hint: "ball on the right, sitting on the line" },
    d: { colour: "d", ball: "left",  tail: false, word: "dog",   hint: "ball on the left, sitting on the line" },
    p: { colour: "p", ball: "right", tail: true,  word: "pig",   hint: "ball on the right, tail hanging down" },
    q: { colour: "q", ball: "left",  tail: true,  word: "queen", hint: "ball on the left, tail hanging down" },
    n: { colour: "n", humps: 1,      word: "net",  hint: "one hump" },
    m: { colour: "m", humps: 2,      word: "moon", hint: "two humps" }
  };

  /* Letter names as a speech engine will actually say them. Feeding a bare
     "a" to speechSynthesis gets you "uh", which is the one thing a child
     learning to spell must not hear. */
  var SPOKEN_NAME = {
    a: "ay",  b: "bee",  c: "see", d: "dee", e: "ee",   f: "eff",
    g: "jee", h: "aitch", i: "eye", j: "jay", k: "kay", l: "ell",
    m: "em",  n: "en",   o: "oh",  p: "pee", q: "cue",  r: "ar",
    s: "ess", t: "tee",  u: "you", v: "vee", w: "double you",
    x: "ex",  y: "why",  z: "zed"
  };

  var SVG_NS = "http://www.w3.org/2000/svg";

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    for (var key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        node.setAttribute(key, attrs[key]);
      }
    }
    return node;
  }

  /* The cue is drawn in an 80x42 box with the writing line at y=26. A tail is
     therefore literally below the line in the picture, which is the whole
     point: p and q must not look like b and d in miniature. */
  var BASELINE = 26;

  function buildCue(letter) {
    var info = INFO[letter];
    if (!info) return null;

    var svg = el("svg", {
      "class": "tile-cue",
      viewBox: "0 0 80 42",
      "aria-hidden": "true",
      focusable: "false"
    });

    svg.appendChild(el("line", {
      "class": "cue-base", x1: 2, y1: BASELINE, x2: 78, y2: BASELINE
    }));

    if (info.humps) {
      // One arch 24 wide, or two arches 20 wide, centred on the box either way.
      var width = info.humps === 1 ? 24 : 20;
      var start = 40 - (width * info.humps) / 2;

      for (var i = 0; i < info.humps; i++) {
        var left = start + i * width;
        svg.appendChild(el("path", {
          "class": "cue-arch",
          d: "M" + left + " " + BASELINE +
             " V18 a" + (width / 2) + " " + (width / 2) + " 0 0 1 " + width + " 0" +
             " V" + BASELINE
        }));
      }
      return svg;
    }

    var ballRight = info.ball === "right";

    svg.appendChild(el("rect", {
      "class": "cue-stick",
      x: ballRight ? 17 : 53, width: 10, rx: 5,
      y: info.tail ? 4 : 0,
      height: info.tail ? 38 : BASELINE
    }));
    svg.appendChild(el("circle", {
      "class": "cue-ball",
      cx: ballRight ? 48 : 32, cy: 15.5, r: 11
    }));

    return svg;
  }

  var Letters = {
    /* Is this one of the six? */
    isTricky: function (letter) {
      return Object.prototype.hasOwnProperty.call(INFO, letter);
    },

    /* The letter it is most often confused with, or "". */
    partnerOf: function (letter) {
      return PARTNER[letter] || "";
    },

    all: function () {
      return Object.keys(INFO);
    },

    info: function (letter) {
      return INFO[letter] || null;
    },

    /* CSS class carrying this letter's colour. */
    colourClass: function (letter) {
      return INFO[letter] ? "tricky-" + INFO[letter].colour : "";
    },

    cue: buildCue,

    /* "bee", not "buh" and definitely not "uh". */
    spokenName: function (letter) {
      return SPOKEN_NAME[letter] || letter;
    },

    /* "b — ball on the right, sitting on the line. b like in bed." */
    describe: function (letter) {
      var info = INFO[letter];
      if (!info) return "";
      return info.hint + ". " + letter + " like in " + info.word;
    },

    mnemonicWord: function (letter) {
      return INFO[letter] ? INFO[letter].word : "";
    },

    /* Every way of swapping tricky letters in a word for their partners,
       nearest miss first. Used to spot "dad" typed when "bad" was meant. */
    confusionVariants: function (word) {
      var positions = [];
      var i;
      for (i = 0; i < word.length; i++) {
        if (PARTNER[word[i]]) positions.push(i);
      }
      if (!positions.length) return [];

      var seen = {};
      var out = [];
      // Bit i of `mask` means "swap the letter at positions[i]".
      var combinations = 1 << positions.length;
      for (var mask = 1; mask < combinations; mask++) {
        var chars = word.split("");
        var swaps = [];
        for (i = 0; i < positions.length; i++) {
          if (mask & (1 << i)) {
            var at = positions[i];
            chars[at] = PARTNER[word[at]];
            swaps.push(at);
          }
        }
        var variant = chars.join("");
        if (variant !== word && !seen[variant]) {
          seen[variant] = true;
          out.push({ word: variant, swaps: swaps });
        }
      }

      // Fewest swaps first: a one letter fix is a far better hint.
      out.sort(function (a, b) { return a.swaps.length - b.swaps.length; });
      return out;
    }
  };

  global.Letters = Letters;
})(window);
