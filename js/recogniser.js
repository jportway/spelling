/* ==========================================================================
   recogniser.js — deciding what she drew, and how she drew it.

   No DOM, no learning, no library: strokes go in, a judgement comes out, and
   the whole thing can be driven from node with synthetic strokes to check it
   says what it should. A letter recogniser that cannot be tested is one that
   will quietly tell a child her good b was a d.

   Two separate questions, answered separately, because they need different
   answers:

   WHAT LETTER IS THIS? Answered by shape alone - where the ink is, ignoring
   which way it was drawn or in what order. Her drawing is compared with
   every letter, and the closest wins. This is how "that's a d" gets said
   about a d, however it was formed.

   WAS IT FORMED THE TAUGHT WAY? Answered by comparing stroke by stroke, in
   order, in the direction drawn, against each accepted formation of the
   target letter. A d that started with the stick is still a d - the first
   question says so - but it was not formed like one, and the second question
   says that. The two are kept apart so the feedback can be "good d - next
   time start with the ball", rather than a bare wrong.

   Everything is measured in the guide box, deliberately without normalising
   her drawing to its own size and position first. Where she starts and how
   big she draws are part of what is being taught. A separate fitted
   comparison catches "right shape, wrong size" so it can be said kindly
   rather than failing her for it.
   ========================================================================== */

(function (global) {
  "use strict";

  /* Points per stroke after resampling. Enough to tell a c from an o; few
     enough that comparing against every letter is instant. */
  var N = 24;

  /* Fewer for the log, and rounded, so a term of tracing is not megabytes. */
  var N_LOG = 10;

  /* Distances are fractions of the box. A finger is fat and a child is
     seven, so these are generous: a stroke can wander a tenth of the box off
     its path and still be the right letter. */
  var SHAPE_PASS   = 0.075;   // this close, by shape, is the letter
  var SHAPE_CLEAR  = 0.72;    // another letter this much closer is what she drew
  var FORM_PASS    = 0.13;    // this close, stroke by stroke in order, is formed right
  var BETTER       = 0.62;    // a rearrangement this much better explains the fault
  var FIT_PASS     = 0.075;   // shape once moved and scaled onto the guide

  /* A point "covers" the other drawing if something of it is within a
     finger's width. Shape distance alone is an average, and an average is
     far too forgiving of a part that is simply not there: a q is an a with a
     tail, and averaged over every point the tail hardly moves the number.
     Requiring most of each drawing to be covered by the other is what makes
     "all of the letter, and nothing else" part of the judgement. */
  var COVER_R      = 0.08;
  var UNCOVERED    = 0.30;    // added per whole-letter's-worth of uncovered points

  var MIRROR = { b: "d", d: "b", p: "q", q: "p" };
  var HUMPS  = { n: "m", m: "n" };

  // ------------------------------------------------------------------------
  // geometry
  // ------------------------------------------------------------------------

  function dist(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pathLength(points) {
    var total = 0;
    for (var i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
    return total;
  }

  /* The same number of points along any stroke, evenly spaced by distance,
     so two strokes can be compared point for point. A dot comes out as N
     copies of itself, which is exactly what a dot should compare as. */
  function resample(points, n) {
    if (!points.length) return [];
    if (points.length === 1) points = [points[0], points[0]];

    var total = pathLength(points);
    if (total === 0) {
      var same = [];
      for (var k = 0; k < n; k++) same.push([points[0][0], points[0][1]]);
      return same;
    }

    var step = total / (n - 1);
    var out = [[points[0][0], points[0][1]]];
    var carried = 0;

    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      var seg = dist(a, b);
      if (seg === 0) continue;

      while (carried + seg >= step && out.length < n) {
        var t = (step - carried) / seg;
        var p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        out.push(p);
        a = p;
        seg = dist(a, b);
        carried = 0;
      }
      carried += seg;
    }
    while (out.length < n) out.push([points[points.length - 1][0], points[points.length - 1][1]]);
    return out;
  }

  function flatten(strokes) {
    var cloud = [];
    for (var i = 0; i < strokes.length; i++) {
      for (var j = 0; j < strokes[i].length; j++) cloud.push(strokes[i][j]);
    }
    return cloud;
  }

  /* How far apart two clouds of points are, taking no notice of order. Each
     point's distance to the nearest point on the other side, averaged, both
     ways - plus a penalty for the share of points on either side with nothing
     near them at all. Both ways matters: one way alone would let a drawing
     that covers half the letter score as perfect. */
  function cloudDistance(a, b) {
    if (!a.length || !b.length) return 1;
    var ab = nearest(a, b);
    var ba = nearest(b, a);
    var uncovered = Math.max(1 - ab.covered, 1 - ba.covered);
    return (ab.mean + ba.mean) / 2 + UNCOVERED * uncovered;
  }

  function nearest(from, to) {
    var sum = 0, covered = 0;
    for (var i = 0; i < from.length; i++) {
      var best = Infinity;
      for (var j = 0; j < to.length; j++) {
        var d = dist(from[i], to[j]);
        if (d < best) best = d;
      }
      sum += best;
      if (best <= COVER_R) covered++;
    }
    return { mean: sum / from.length, covered: covered / from.length };
  }

  /* Stroke against stroke, point for point, in the order drawn. This is the
     one that knows the difference between a b and a d. */
  function strokeDistance(a, b) {
    var sum = 0;
    for (var i = 0; i < N; i++) sum += dist(a[i], b[i]);
    return sum / N;
  }

  function reversed(stroke) {
    return stroke.slice().reverse();
  }

  function mirrored(strokes) {
    return strokes.map(function (s) {
      return s.map(function (p) { return [1 - p[0], p[1]]; });
    });
  }

  function bounds(cloud) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < cloud.length; i++) {
      var p = cloud[i];
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    return { x: minX, y: minY, w: Math.max(maxX - minX, 0.02), h: Math.max(maxY - minY, 0.02) };
  }

  /* Her drawing moved and scaled so its box lands on the template's box.
     Used only to tell "wrong size" apart from "wrong letter". */
  function fitTo(strokes, target) {
    var from = bounds(flatten(strokes));
    var to = bounds(flatten(target));
    var sx = to.w / from.w, sy = to.h / from.h;
    return strokes.map(function (s) {
      return s.map(function (p) {
        return [to.x + (p[0] - from.x) * sx, to.y + (p[1] - from.y) * sy];
      });
    });
  }

  // ------------------------------------------------------------------------
  // templates, resampled once
  // ------------------------------------------------------------------------

  var cache = null;

  function templates() {
    if (cache) return cache;
    cache = {};
    global.Strokes.all().forEach(function (letter) {
      cache[letter] = global.Strokes.formations(letter).map(function (f) {
        var strokes = f.strokes.map(function (s) { return resample(s, N); });
        return { strokes: strokes, cloud: flatten(strokes), tip: f.tip };
      });
    });
    return cache;
  }

  // ------------------------------------------------------------------------
  // the judgement
  // ------------------------------------------------------------------------

  /* What letter does this look like? The closest by shape, over every
     formation of every letter, with the distance to the one we wanted. */
  function shapeSearch(input, target) {
    var all = templates();
    var cloud = flatten(input);
    var best = { letter: null, d: Infinity };
    var toTarget = Infinity;

    Object.keys(all).forEach(function (letter) {
      var d = Infinity;
      all[letter].forEach(function (f) {
        d = Math.min(d, cloudDistance(cloud, f.cloud));
      });
      if (d < best.d) best = { letter: letter, d: d };
      if (letter === target) toTarget = d;
    });

    return { best: best, toTarget: toTarget };
  }

  /* Was it formed like the target? Against each accepted formation with the
     same stroke count, in order and direction. Also tries the rearrangements
     that name a fault: every stroke reversed, and the first two swapped. */
  function formationSearch(input, target) {
    var forms = templates()[target] || [];
    var result = { d: Infinity, tip: "", reversedD: Infinity, swappedD: Infinity, countOk: false };

    forms.forEach(function (f) {
      if (f.strokes.length !== input.length) return;
      result.countOk = true;

      var direct = 0, rev = 0;
      for (var i = 0; i < input.length; i++) {
        direct += strokeDistance(input[i], f.strokes[i]);
        rev += strokeDistance(reversed(input[i]), f.strokes[i]);
      }
      direct /= input.length;
      rev /= input.length;

      if (direct < result.d) { result.d = direct; result.tip = f.tip; }
      if (rev < result.reversedD) result.reversedD = rev;

      if (input.length === 2) {
        var swapped = (strokeDistance(input[1], f.strokes[0]) +
                       strokeDistance(input[0], f.strokes[1])) / 2;
        if (swapped < result.swappedD) result.swappedD = swapped;
      }
    });

    return result;
  }

  function judge(rawStrokes, target) {
    var info = global.Letters ? global.Letters.info(target) : null;
    var input = (rawStrokes || [])
      .filter(function (s) { return s && s.length; })
      .map(function (s) { return resample(s, N); });

    var out = {
      target: target,
      ok: false,          // it is the target letter
      formed: false,      // and it was formed the taught way
      letter: null,       // what it looks most like
      shape: Infinity,    // distance to the target, by shape
      formation: Infinity,
      fault: null,
      tip: "",
      cue: ""
    };

    if (!input.length) {
      out.fault = "nothing";
      out.cue = "Have a go - start at the green dot.";
      return out;
    }

    var shape = shapeSearch(input, target);
    out.letter = shape.best.d <= SHAPE_PASS ? shape.best.letter : null;
    out.shape = shape.toTarget;

    /* A different letter, clearly. The partner pairs get their own wording
       because they are the whole reason this game exists. */
    if (shape.best.letter !== target && shape.best.d <= SHAPE_PASS &&
        shape.best.d < shape.toTarget * SHAPE_CLEAR) {
      var drew = shape.best.letter;
      if (MIRROR[target] === drew) {
        out.fault = "reversal";
        out.cue = "That's " + a(drew) + " - the ball went " + ballSide(drew)
          + ". " + capitalise(a(target)) + " has its ball on the " + ballSide(target) + ".";
      } else if (HUMPS[target] === drew) {
        out.fault = "humps";
        out.cue = "That's " + a(drew) + " - " + humps(drew) + ". "
          + capitalise(a(target)) + " has " + humps(target) + ".";
      } else {
        out.fault = "wrong-letter";
        out.cue = "That looks like " + a(drew) + ". Let's try the "
          + say(target) + " again.";
      }
      return out;
    }

    /* Not the target by shape. Is it the target at a different size? */
    if (shape.toTarget > SHAPE_PASS) {
      var fitted = fitTo(input, templates()[target][0].strokes);
      var fittedD = shapeSearch(fitted, target).toTarget;
      if (fittedD <= FIT_PASS) {
        out.ok = true;
        out.fault = "size";
        out.shape = fittedD;
        var big = bounds(flatten(input)).h < bounds(templates()[target][0].cloud).h;
        out.cue = "That's " + a(target) + "! Next time make it "
          + (big ? "bigger, right down to the line." : "a bit smaller, between the lines.");
        return out;
      }

      out.fault = "wobbly";
      out.cue = "Nearly. Watch once more, then have another go.";
      return out;
    }

    // It is the letter. Now: was it formed the way it is taught?
    out.ok = true;
    var form = formationSearch(input, target);
    out.formation = form.d;

    if (form.d <= FORM_PASS) {
      out.formed = true;
      out.tip = form.tip;
      out.cue = form.tip ? "That's " + a(target) + "! " + capitalise(form.tip) + "."
                         : "That's " + a(target) + "!";
      return out;
    }

    if (!form.countOk) {
      out.fault = "strokes";
      out.cue = "That's " + a(target) + "! Try it "
        + (input.length > formCount(target) ? "without lifting your finger so much."
                                             : "with a lift in the middle - watch once more.");
      return out;
    }

    if (form.reversedD < form.d * BETTER) {
      out.fault = "wrong-end";
      out.cue = "That's " + a(target) + "! But you started at the wrong end - "
        + "begin at the green dot.";
      return out;
    }

    if (input.length === 2 && form.swappedD < form.d * BETTER) {
      out.fault = "order";
      out.cue = "That's " + a(target) + "! Next time " + firstStrokeCue(target) + ".";
      return out;
    }

    out.fault = "wrong-way";
    out.cue = "That's " + a(target) + "! Watch which way the arrow goes, and follow it.";
    return out;
  }

  function formCount(target) {
    var forms = templates()[target] || [];
    return forms.length ? forms[0].strokes.length : 1;
  }

  function firstStrokeCue(target) {
    var def = global.Strokes.letter(target);
    var cue = def && def.cue ? def.cue : "";
    return cue ? "do it in this order: " + cue : "start with the first stroke";
  }

  function ballSide(letter) {
    var info = global.Letters ? global.Letters.info(letter) : null;
    return info && info.ball ? info.ball : "other side";
  }

  function humps(letter) {
    var info = global.Letters ? global.Letters.info(letter) : null;
    var n = info && info.humps ? info.humps : (letter === "m" ? 2 : 1);
    return n === 1 ? "one hump" : "two humps";
  }

  function say(letter) {
    return global.Letters && global.Letters.spokenName
      ? global.Letters.spokenName(letter) : letter;
  }

  /* "an em", "a bee": the article follows the spoken name, not the letter.
     Getting this wrong is the kind of thing a seven year old notices. */
  function a(letter) {
    var name = say(letter);
    return (/^[aeiou]/i.test(name) ? "an " : "a ") + name;
  }

  function capitalise(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /* Small enough to log: ten points a stroke as whole percentages of the
     box, each stroke one comma-separated string - "32,12,32,78". A string
     rather than a list of numbers because Firestore refuses an array nested
     directly inside an array, and a record Firestore refuses is a record
     that jams the upload queue behind it. Enough to re-judge later with a
     better recogniser without having kept the world. `expand` is the way
     back. */
  function compact(rawStrokes) {
    return (rawStrokes || []).map(function (s) {
      var pts = resample(s, N_LOG);
      var flat = [];
      for (var i = 0; i < pts.length; i++) {
        flat.push(Math.round(pts[i][0] * 100), Math.round(pts[i][1] * 100));
      }
      return flat.join(",");
    });
  }

  function expand(packed) {
    return (packed || []).map(function (stroke) {
      var flat = typeof stroke === "string"
        ? stroke.split(",").map(Number) : (stroke || []);
      var pts = [];
      for (var i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i] / 100, flat[i + 1] / 100]);
      return pts;
    });
  }

  global.Recogniser = {
    judge: judge,
    resample: resample,
    cloudDistance: cloudDistance,
    compact: compact,
    expand: expand,
    article: a,
    mirrored: mirrored,
    N: N,
    SHAPE_PASS: SHAPE_PASS,
    FORM_PASS: FORM_PASS
  };
})(typeof window !== "undefined" ? window : globalThis);
