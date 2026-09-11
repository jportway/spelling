/* ==========================================================================
   strokes.js — how each letter is formed, as data.

   Every lowercase letter is an ordered list of strokes, and every stroke is a
   polyline in a unit box. The order matters and so does the direction: a b
   and a d are the same shape, and the only difference between forming one
   and forming the other is which part of it your hand does first. That is
   the whole point of tracing rather than tapping.

   The box has writing lines in it, like an exercise book: an ascender line
   at the top, the x-height line, the baseline, and a descender line. Letters
   are drawn between them at the sizes a child is taught, so "start at the
   top" means a particular place and the recogniser can check she did.

   THIS IS ONE STYLE - plain print, no lead-in or exit strokes, the c-family
   drawn anticlockwise. Schools differ, and teaching a different stroke
   pattern from the one she gets at school would confuse her. That is why it
   is data and not code: a second style is another table like LETTERS, and
   the game does not need to know.

   Where more than one formation is common, the extras are in `alts`. A
   letter formed like an alt passes; an alt with a `tip` passes and says the
   tip, which is how "go round the other way, like a c" gets said without
   failing a perfectly good o.
   ========================================================================== */

(function (global) {
  "use strict";

  /* The writing lines, as fractions of the box height. */
  var TOP  = 0.12;   // ascenders reach here: b d f h k l t(ish)
  var XH   = 0.42;   // the x-height line: where a, c, e and the rest start
  var BASE = 0.78;   // the baseline
  var DESC = 0.96;   // descenders reach here: g j p q y

  /* The body of a round letter: a circle sitting between XH and BASE. */
  var CX = 0.50, CY = 0.60, R = 0.18;
  var L = CX - R;    // 0.32, the left edge of the bowl
  var Rt = CX + R;   // 0.68, the right edge

  function round(v) { return Math.round(v * 1000) / 1000; }

  function line(x1, y1, x2, y2) {
    return [[x1, y1], [x2, y2]];
  }

  /* Points along a circle. Angles in degrees with the screen's y pointing
     down: 0 is right, 90 is the bottom, 180 is left, 270 is the top - so an
     increasing angle goes clockwise as you look at it, and a decreasing one
     anticlockwise. The c-family (a c d g o q) is anticlockwise: the arc runs
     from a higher angle to a lower one. */
  function arc(cx, cy, r, a0, a1) {
    var steps = Math.max(6, Math.round(Math.abs(a1 - a0) / 10));
    var points = [];
    for (var i = 0; i <= steps; i++) {
      var a = (a0 + (a1 - a0) * i / steps) * Math.PI / 180;
      points.push([round(cx + r * Math.cos(a)), round(cy + r * Math.sin(a))]);
    }
    return points;
  }

  /* One stroke made of several pieces, drawn without lifting the finger. */
  function join() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var piece = arguments[i];
      for (var j = 0; j < piece.length; j++) {
        var p = piece[j];
        var last = out[out.length - 1];
        if (last && last[0] === p[0] && last[1] === p[1]) continue;
        out.push([round(p[0]), round(p[1])]);
      }
    }
    return out;
  }

  function dot(x, y) {
    return [[x, y - 0.01], [x, y + 0.01]];
  }

  /* The anticlockwise bowl, starting just right of the top. Shared by
     a d g q, and o - which is why they all feel like the same movement. */
  function bowl() { return arc(CX, CY, R, -40, -400); }

  /* The clockwise bowl that hangs off a stick, for b and p: from the stick
     on the left, over the top, down the right, back to the stick. */
  function bowlFromStick() { return arc(CX, CY, R, 180, 540); }

  var LETTERS = {
    a: {
      cue: "round like a c, then down",
      strokes: [join(bowl(), [[Rt, 0.44], [Rt, BASE]])],
      alts: [{ strokes: [bowl(), line(Rt, XH, Rt, BASE)] }]
    },
    b: {
      cue: "down the stick, then the ball on the right",
      strokes: [line(L, TOP, L, BASE), bowlFromStick()],
      alts: [{ strokes: [join(line(L, TOP, L, BASE), [[L, 0.62]], bowlFromStick())] }]
    },
    c: {
      cue: "start near the top, curl round",
      strokes: [arc(CX, CY, R, -45, -315)]
    },
    d: {
      cue: "the ball first, then the stick",
      strokes: [bowl(), line(Rt, TOP, Rt, BASE)],
      alts: [{ strokes: [join(bowl(), [[Rt, TOP], [Rt, BASE]])] }]
    },
    e: {
      cue: "across, then round",
      strokes: [join(line(L, CY, Rt, CY), arc(CX, CY, R, 0, -300))]
    },
    f: {
      cue: "curl over the top, down, then cross",
      strokes: [join(arc(0.60, 0.26, 0.14, 300, 180), line(0.46, 0.26, 0.46, BASE)),
                line(0.34, XH, 0.60, XH)]
    },
    g: {
      cue: "round, then down and hook under",
      strokes: [bowl(), join(line(Rt, XH, Rt, 0.84), arc(0.52, 0.84, 0.16, 0, 180))],
      alts: [{ strokes: [join(bowl(), [[Rt, XH]], line(Rt, XH, Rt, 0.84),
                              arc(0.52, 0.84, 0.16, 0, 180))] }]
    },
    h: {
      cue: "down, then up and over",
      strokes: [line(L, TOP, L, BASE),
                join(arc(CX, 0.58, R, 180, 360), line(Rt, 0.58, Rt, BASE))],
      alts: [{ strokes: [join(line(L, TOP, L, BASE), [[L, 0.58]],
                              arc(CX, 0.58, R, 180, 360), line(Rt, 0.58, Rt, BASE))] }]
    },
    i: {
      cue: "down, then the dot",
      strokes: [line(0.5, XH, 0.5, BASE), dot(0.5, 0.27)]
    },
    j: {
      cue: "down, hook, then the dot",
      strokes: [join(line(0.56, XH, 0.56, 0.84), arc(0.42, 0.84, 0.14, 0, 180)),
                dot(0.56, 0.27)]
    },
    k: {
      cue: "down, then in and out",
      strokes: [line(L, TOP, L, BASE), [[0.62, 0.44], [0.34, 0.62], [0.64, BASE]]]
    },
    l: {
      cue: "straight down",
      strokes: [line(0.5, TOP, 0.5, BASE)]
    },
    m: {
      cue: "down, over, down, over, down - two humps",
      strokes: [line(0.26, XH, 0.26, BASE),
                join(arc(0.38, 0.56, 0.12, 180, 360), line(0.50, 0.56, 0.50, BASE)),
                join(arc(0.62, 0.56, 0.12, 180, 360), line(0.74, 0.56, 0.74, BASE))],
      alts: [{ strokes: [join(line(0.26, XH, 0.26, BASE), [[0.26, 0.56]],
                              arc(0.38, 0.56, 0.12, 180, 360), line(0.50, 0.56, 0.50, BASE),
                              [[0.50, 0.56]],
                              arc(0.62, 0.56, 0.12, 180, 360), line(0.74, 0.56, 0.74, BASE))] }]
    },
    n: {
      cue: "down, then over - one hump",
      strokes: [line(L, XH, L, BASE),
                join(arc(CX, 0.58, R, 180, 360), line(Rt, 0.58, Rt, BASE))],
      alts: [{ strokes: [join(line(L, XH, L, BASE), [[L, 0.58]],
                              arc(CX, 0.58, R, 180, 360), line(Rt, 0.58, Rt, BASE))] }]
    },
    o: {
      cue: "start near the top, all the way round",
      strokes: [arc(CX, CY, R, -60, -420)],
      alts: [{ strokes: [arc(CX, CY, R, -120, 240)],
               tip: "try going round the other way, like a c" }]
    },
    p: {
      cue: "down the tail, then the ball on the right",
      strokes: [line(L, XH, L, DESC), bowlFromStick()],
      alts: [{ strokes: [join(line(L, XH, L, DESC), [[L, 0.62]], bowlFromStick())] }]
    },
    q: {
      cue: "the ball first, then the tail down",
      strokes: [bowl(), line(Rt, XH, Rt, DESC)],
      alts: [{ strokes: [join(bowl(), [[Rt, XH], [Rt, DESC]])] }]
    },
    r: {
      cue: "down, then up and over a little",
      strokes: [line(0.36, XH, 0.36, BASE), arc(0.52, 0.58, 0.16, 180, 320)],
      alts: [{ strokes: [join(line(0.36, XH, 0.36, BASE), [[0.36, 0.58]],
                              arc(0.52, 0.58, 0.16, 180, 320))] }]
    },
    s: {
      cue: "curl one way, then the other",
      strokes: [[[0.64, 0.46], [0.58, 0.42], [0.48, 0.42], [0.40, 0.46], [0.38, 0.52],
                 [0.42, 0.58], [0.50, 0.60], [0.58, 0.62], [0.62, 0.68], [0.60, 0.74],
                 [0.52, 0.78], [0.42, 0.78], [0.36, 0.74]]]
    },
    t: {
      cue: "down with a little curl, then cross",
      strokes: [join(line(0.48, 0.20, 0.48, 0.72), [[0.50, 0.77], [0.58, 0.78], [0.64, 0.74]]),
                line(0.34, XH, 0.64, XH)]
    },
    u: {
      cue: "down, round, up, then down",
      strokes: [join(line(L, XH, L, 0.62), arc(CX, 0.62, R, 180, 0),
                     [[Rt, XH]], [[Rt, BASE]])]
    },
    v: {
      cue: "down and up",
      strokes: [[[L, XH], [0.50, BASE], [Rt, XH]]]
    },
    w: {
      cue: "down up, down up",
      strokes: [[[0.26, XH], [0.38, BASE], [0.50, 0.50], [0.62, BASE], [0.74, XH]]]
    },
    x: {
      cue: "one way, then the other",
      strokes: [line(L, XH, Rt, BASE), line(Rt, XH, L, BASE)]
    },
    y: {
      cue: "down, round, up, then down and hook",
      strokes: [join(line(L, XH, L, 0.62), arc(CX, 0.62, R, 180, 0),
                     [[Rt, XH]], line(Rt, XH, Rt, 0.84), arc(0.54, 0.84, 0.14, 0, 180))],
      alts: [{ strokes: [join(line(L, XH, L, 0.62), arc(CX, 0.62, R, 180, 0), [[Rt, XH]]),
                         join(line(Rt, XH, Rt, 0.84), arc(0.54, 0.84, 0.14, 0, 180))] }]
    },
    z: {
      cue: "across, down, across",
      strokes: [[[L, XH], [Rt, XH], [L, BASE], [Rt, BASE]]]
    }
  };

  var Strokes = {
    LINES: { top: TOP, xHeight: XH, base: BASE, descender: DESC },

    letter: function (letter) {
      return LETTERS[letter] || null;
    },

    all: function () {
      return Object.keys(LETTERS);
    },

    /* Every formation that counts as this letter: the taught one first. */
    formations: function (letter) {
      var def = LETTERS[letter];
      if (!def) return [];
      var out = [{ strokes: def.strokes, tip: "" }];
      (def.alts || []).forEach(function (alt) {
        out.push({ strokes: alt.strokes, tip: alt.tip || "" });
      });
      return out;
    }
  };

  global.Strokes = Strokes;
})(typeof window !== "undefined" ? window : globalThis);
