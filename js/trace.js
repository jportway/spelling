/* ==========================================================================
   trace.js — Cooper's Letter Tracing: the round, the canvas, and her finger.

   The other two games ask her to pick a letter. This one asks her to make
   it, which is a different thing entirely: a b and a d are the same shape,
   and the only thing that separates forming one from forming the other is
   which part your hand does first. Tracing teaches the hand.

   Each letter goes up a ladder, and each letter has its own rung:

     watch    a ghost finger draws it while the cue is read out (a demo, not
              a test; it plays before the first trace and on "Show me")
     trace    her finger follows a wide faint path, and the path lights up
              behind her - in order, so the second stroke cannot be lit
              before the first
     copy     the letter is shown small to one side; she draws it in the box
     memory   "draw a b". Nothing else on screen. This is the rung that says
              the reversal has actually gone.

   Two clean goes and a letter moves up; two slips and it moves down. Which
   letter comes next leans towards the ones she finds hardest, so the game
   spends its time where it is needed, but never so hard that a round is
   all the difficult ones - she needs the easy wins to keep going.

   No clock. The clock was where the rushing came from in the word games,
   and there is nothing to be gained from a fast letter.

   Judging is next door in recogniser.js and has no idea a canvas exists.
   ========================================================================== */

(function (global) {
  "use strict";

  var STORE_KEY = "cooper.trace.v1";
  var SETTINGS_KEY = "cooper.settings.v1";

  var STAGES = ["watch", "trace", "copy", "memory"];
  var FIRST_STAGE = 1;             // where a new letter starts
  var TOP_STAGE = 3;

  /* How much a letter is worth when it goes in the balloon. Harder rungs
     are worth more, so the balloon fills at roughly the same rate however
     good she is, which keeps the pop within reach of a ten-letter round. */
  var PUFFS_BY_STAGE = [0, 1, 2, 3];
  var FIRST_GO_BONUS = 1;
  var PUFFS_PER_LETTER = 2.2;       // what a decent round averages

  /* Tracing: how far off the path a finger may wander and still count, and
     how much of a stroke has to be covered before lifting counts as done. */
  var CORRIDOR = 0.09;
  var STROKE_DONE = 0.82;
  var TRACE_POINTS = 48;

  /* Free drawing: how long after lifting her finger before we assume the
     letter is finished. Long enough to lift for an i-dot or a t-bar, and
     long enough for a seven year old to think about where the next bit
     goes - a second is not, when the bit in question is the bowl of a b. */
  var SETTLE_MS = 1500;

  /* A template stroke this short is a dot, not a journey: the i and the j
     wear one. There is nothing to travel along, so it is tapped. */
  var DOT_LENGTH = 0.05;

  /* Failed goes at one stroke before she gets shown it again. */
  var STROKE_HELP_AFTER = 2;

  /* The ghost finger. */
  var DEMO_SPEED = 0.75;            // box-widths per second
  var DEMO_PAUSE_MS = 320;          // between strokes

  var ADVANCE_MS = 1300;            // pause after a good letter
  var CORRECTION_MS = 2400;         // long enough to actually look at it

  var DEFAULT_SETTINGS = {
    rewardVideo: true,
    autoSay: true,
    kitten: true,
    sound: true,
    calm: false,
    uploadLog: true
  };

  var dom = {};
  var settings = Object.assign({}, DEFAULT_SETTINGS);

  /* What each letter has done so far. Per letter: which rung it is on, its
     run of clean goes and of slips, and a short recent history of outcomes
     that the picker leans on. */
  var progress = { letters: {}, best: 0, pops: 0, mastered: [] };

  var canvas, ctx, size = 1, dpr = 1;
  var colours = {};

  var state = {
    running: false,
    paused: false,
    perRound: 10,
    done: 0,                // letters finished this round
    clean: 0,               // finished first go, formed properly
    banked: 0,
    popped: false,
    wobbly: {},             // letter -> latest fault, for the results screen

    letter: null,
    stage: FIRST_STAGE,
    attempt: 0,             // on this letter, this round
    strokes: [],            // finished strokes, box coordinates
    current: null,          // the stroke under her finger
    pointerId: null,
    startedAt: 0,

    // tracing
    traceIndex: 0,          // which template stroke she is on
    traceHit: -1,           // furthest template point reached on it
    traced: [],             // per template stroke: did she get it
    strokeTries: 0,         // failed goes at the stroke she is on now

    settle: null,
    advance: null,
    demo: null,             // the ghost finger animation
    demoAt: 0,
    feedback: null,         // what to draw over her ink after judging
    locked: false           // no drawing while feedback or the demo is up
  };

  function byId(id) { return document.getElementById(id); }

  /* The sounds, the speech, the kitten and the confetti are decoration. A
     throw from any of them used to take the round with it: the cheer would
     stop half way through, the timer that moves on to the next letter would
     never be set, and the board stayed locked until the page was reloaded -
     which is exactly what a missing argument to one sound did. Nothing
     decorative is worth a frozen game, so all of it goes through here. */
  function safely(what) {
    try {
      what();
    } catch (err) {
      if (global.console && global.console.warn) global.console.warn("trace: " + err.message);
    }
  }

  // ------------------------------------------------------------------------
  // storage
  // ------------------------------------------------------------------------

  function loadStore() {
    try {
      var saved = JSON.parse(global.localStorage.getItem(STORE_KEY) || "{}");
      if (saved.letters) progress.letters = saved.letters;
      progress.best = saved.best || 0;
      progress.pops = saved.pops || 0;
      progress.mastered = saved.mastered || [];

      var shared = global.localStorage.getItem(SETTINGS_KEY);
      if (shared) {
        var parsed = JSON.parse(shared);
        Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
          if (key in parsed) settings[key] = parsed[key];
        });
      }
    } catch (err) { /* a blocked localStorage must not stop her drawing */ }

    if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      settings.calm = true;
    }
  }

  function saveStore() {
    try {
      global.localStorage.setItem(STORE_KEY, JSON.stringify(progress));
      var shared = {};
      try { shared = JSON.parse(global.localStorage.getItem(SETTINGS_KEY) || "{}"); }
      catch (err) { shared = {}; }
      global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign(shared, settings)));
    } catch (err) { /* not worth interrupting for */ }
  }

  function letterRecord(letter) {
    var rec = progress.letters[letter];
    if (!rec) {
      rec = progress.letters[letter] = { stage: FIRST_STAGE, ups: 0, downs: 0, recent: [], tries: 0, oks: 0 };
    }
    return rec;
  }

  // ------------------------------------------------------------------------
  // choosing the next letter
  // ------------------------------------------------------------------------

  /* Leans towards what she finds hard, without becoming a session of only
     the hard ones. Every letter keeps a floor of weight so the easy wins
     still come round, and the tricky six get a nudge because they are the
     reason this exists. */
  function pickLetter(previous) {
    var pool = global.Strokes.all().filter(function (l) { return l !== previous; });
    var weights = pool.map(function (letter) {
      var rec = letterRecord(letter);
      var tries = rec.recent.length;
      var oks = rec.recent.filter(Boolean).length;
      var accuracy = tries ? (oks + 1) / (tries + 2) : 0.5;     // a gentle prior

      var w = 1;
      if (global.Letters.isTricky(letter)) w += 2;
      w += 3 * (1 - accuracy);
      if (rec.stage < TOP_STAGE) w += 1;
      if (progress.mastered.indexOf(letter) >= 0) w *= 0.35;
      return w;
    });

    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var roll = Math.random() * total;
    for (var i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  // ------------------------------------------------------------------------
  // the canvas
  // ------------------------------------------------------------------------

  function readColours() {
    var css = global.getComputedStyle(document.documentElement);
    ["b", "d", "p", "q", "n", "m"].forEach(function (l) {
      colours[l] = css.getPropertyValue("--tricky-" + l).trim() || "#a5b4fc";
    });
    colours.ink = css.getPropertyValue("--tile").trim() || "#fdfcf7";
    colours.go = css.getPropertyValue("--go").trim() || "#34d399";
    colours.gold = css.getPropertyValue("--gold").trim() || "#fbbf24";
    colours.nudge = css.getPropertyValue("--nudge").trim() || "#a5b4fc";
    colours.line = css.getPropertyValue("--surface-line").trim() || "#3a4677";
    colours.guide = "rgba(165, 180, 252, 0.22)";
    colours.warn = "#fb8a5c";
  }

  function inkFor(letter) {
    return colours[letter] || colours.ink;
  }

  function fitCanvas() {
    var box = dom.board.getBoundingClientRect();
    size = Math.max(200, Math.floor(Math.min(box.width, box.height)));
    dpr = Math.min(global.devicePixelRatio || 1, 3);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    draw();
  }

  function px(v) { return v * size; }

  function strokePath(points, from, to) {
    from = from || 0;
    to = to === undefined ? points.length : to;
    if (to - from < 1) return;
    ctx.beginPath();
    ctx.moveTo(px(points[from][0]), px(points[from][1]));
    if (to - from === 1) {
      ctx.lineTo(px(points[from][0]) + 0.01, px(points[from][1]));
    }
    for (var i = from + 1; i < to; i++) ctx.lineTo(px(points[i][0]), px(points[i][1]));
    ctx.stroke();
  }

  function drawLines() {
    var L = global.Strokes.LINES;
    ctx.lineCap = "round";
    [L.top, L.xHeight, L.base, L.descender].forEach(function (y) {
      ctx.strokeStyle = colours.line;
      ctx.lineWidth = y === L.base ? px(0.012) : px(0.006);
      ctx.setLineDash(y === L.base || y === L.top ? [] : [px(0.02), px(0.02)]);
      ctx.beginPath();
      ctx.moveTo(px(0.04), px(y));
      ctx.lineTo(px(0.96), px(y));
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  /* The letter as a wide pale road, with a dotted centre line. */
  function drawGuide(strokes, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    strokes.forEach(function (s) {
      ctx.strokeStyle = colours.guide;
      ctx.lineWidth = px(0.12);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      strokePath(s);
      ctx.strokeStyle = "rgba(244, 246, 255, 0.35)";
      ctx.lineWidth = px(0.008);
      ctx.setLineDash([px(0.015), px(0.02)]);
      strokePath(s);
      ctx.setLineDash([]);
    });
    ctx.globalAlpha = 1;
  }

  /* The green dot where the next stroke starts, and an arrow a little way
     along it saying which way to go. */
  function drawStart(stroke, number) {
    var a = stroke[0];
    ctx.fillStyle = colours.go;
    ctx.beginPath();
    ctx.arc(px(a[0]), px(a[1]), px(0.032), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#0b1230";
    ctx.font = "bold " + px(0.04) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), px(a[0]), px(a[1]) + px(0.002));

    var mid = Math.min(stroke.length - 1, Math.max(2, Math.floor(stroke.length * 0.35)));
    var p = stroke[mid], q = stroke[Math.min(stroke.length - 1, mid + 2)];
    var ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    ctx.save();
    ctx.translate(px(p[0]), px(p[1]));
    ctx.rotate(ang);
    ctx.fillStyle = "rgba(244, 246, 255, 0.85)";
    ctx.beginPath();
    ctx.moveTo(px(0.03), 0);
    ctx.lineTo(px(-0.02), px(0.022));
    ctx.lineTo(px(-0.02), px(-0.022));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawInk(strokes, colour, width, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.strokeStyle = colour;
    ctx.lineWidth = px(width || 0.055);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokes.forEach(function (s) { if (s && s.length) strokePath(s); });
    ctx.globalAlpha = 1;
  }

  function currentTemplate() {
    return state.letter ? global.Strokes.letter(state.letter).strokes : [];
  }

  function draw() {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    drawLines();
    if (!state.letter) return;

    var template = currentTemplate();
    var colour = inkFor(state.letter);
    var startMarker = null;

    if (state.demo) {
      drawDemoFrame(template, colour);
      return;
    }

    if (state.feedback) {
      drawFeedback(template, colour);
      return;
    }

    if (state.stage === 1) {
      /* One bit at a time. The whole letter used to be drawn as one bright
         road, which invites tracing it in a single sweep - and then only
         the first stroke counts. The bit she is on now is the bright one;
         the rest is there faintly so the letter is still a letter. */
      var others = template.filter(function (s, i) { return i !== state.traceIndex; });
      if (others.length) drawGuide(others, 0.3);
      if (state.traceIndex < template.length) drawGuide([template[state.traceIndex]], 1);

      // The part she has already covered, lit in her colour.
      var resampled = traceTemplate();
      for (var i = 0; i < state.traceIndex; i++) {
        drawInk([resampled[i]], colour, 0.11, 0.55);
      }
      if (state.traceIndex < resampled.length) {
        var s = resampled[state.traceIndex];
        if (state.traceHit >= 0) drawInk([s.slice(0, state.traceHit + 1)], colour, 0.11, 0.55);
        startMarker = template[state.traceIndex];
      }
    }

    drawInk(state.strokes, colour);
    if (state.current) drawInk([state.current], colour);

    /* The green dot goes on last, so her own ink cannot bury it. On a b the
       ball starts against the stick she has just this moment drawn, and the
       dot telling her where to begin was hidden underneath it. */
    if (startMarker) drawStart(startMarker, state.traceIndex + 1);
  }

  function pathLength(points) {
    var total = 0;
    for (var i = 1; i < points.length; i++) {
      total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    return total;
  }

  var traceCache = { letter: null, strokes: null, dots: null };
  function traceTemplate() {
    if (traceCache.letter !== state.letter) {
      traceCache.letter = state.letter;
      traceCache.strokes = currentTemplate().map(function (s) {
        return global.Recogniser.resample(s, TRACE_POINTS);
      });
      traceCache.dots = traceCache.strokes.map(function (s) {
        return pathLength(s) < DOT_LENGTH;
      });
    }
    return traceCache.strokes;
  }

  function strokeIsDot(index) {
    traceTemplate();
    return !!(traceCache.dots && traceCache.dots[index]);
  }

  // ------------------------------------------------------------------------
  // the ghost finger
  // ------------------------------------------------------------------------

  function startDemo(then) {
    stopDemo();
    var template = currentTemplate();
    var segments = [];
    var t = 0;
    template.forEach(function (s, i) {
      var length = 0;
      for (var k = 1; k < s.length; k++) {
        length += Math.hypot(s[k][0] - s[k - 1][0], s[k][1] - s[k - 1][1]);
      }
      var ms = Math.max(350, length / DEMO_SPEED * 1000);
      segments.push({ stroke: s, from: t, to: t + ms, index: i });
      t += ms + DEMO_PAUSE_MS;
    });

    state.demo = { segments: segments, total: t, then: then || null };
    state.demoAt = global.performance.now();
    state.locked = true;
    dom.board.classList.add("is-demo");
    global.requestAnimationFrame(demoTick);
  }

  function stopDemo() {
    state.demo = null;
    state.locked = false;
    dom.board.classList.remove("is-demo");
  }

  function demoTick() {
    if (!state.demo) return;
    var elapsed = global.performance.now() - state.demoAt;
    draw();
    if (elapsed >= state.demo.total) {
      var then = state.demo.then;
      stopDemo();
      draw();
      if (then) then();
      return;
    }
    global.requestAnimationFrame(demoTick);
  }

  function drawDemoFrame(template, colour) {
    var elapsed = global.performance.now() - state.demoAt;
    drawGuide(template, 0.6);

    state.demo.segments.forEach(function (seg) {
      if (elapsed < seg.from) return;
      var s = seg.stroke;
      var f = Math.min(1, (elapsed - seg.from) / (seg.to - seg.from));
      var resampled = global.Recogniser.resample(s, TRACE_POINTS);
      var upto = Math.max(1, Math.round(f * (resampled.length - 1)));
      drawInk([resampled.slice(0, upto + 1)], colour, 0.06);

      if (f < 1) {
        // the fingertip
        var tip = resampled[upto];
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.beginPath();
        ctx.arc(px(tip[0]), px(tip[1]), px(0.045), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(px(tip[0]), px(tip[1]), px(0.02), 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // the start of whichever stroke is next
    for (var i = 0; i < state.demo.segments.length; i++) {
      if (elapsed < state.demo.segments[i].to) {
        drawStart(template[i], i + 1);
        break;
      }
    }
  }

  // ------------------------------------------------------------------------
  // feedback: what she drew next to what it should be
  // ------------------------------------------------------------------------

  function drawFeedback(template, colour) {
    var fb = state.feedback;

    if (fb.good) {
      drawInk(state.strokes, colour, 0.06);
      ctx.globalAlpha = 0.35;
      drawInk(state.strokes, "#ffffff", 0.09);
      ctx.globalAlpha = 1;
      return;
    }

    // The letter it should have been, faintly, in green; hers over it.
    drawGuide(template, 0.7);
    drawInk(template, colours.go, 0.035, 0.9);
    drawInk(state.strokes, colours.warn, 0.05, 0.85);

    // For a reversal, point at the ball: where hers went, where it belongs.
    if (fb.fault === "reversal") {
      var info = global.Letters.info(state.letter);
      var ballX = info.ball === "right" ? 0.62 : 0.38;
      ctx.fillStyle = colours.go;
      ctx.beginPath();
      ctx.arc(px(ballX), px(0.60), px(0.05), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0b1230";
      ctx.font = "bold " + px(0.06) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✓", px(ballX), px(0.60));
    }
  }

  // ------------------------------------------------------------------------
  // a letter
  // ------------------------------------------------------------------------

  function nextLetter() {
    if (!state.running) return;
    var letter = pickLetter(state.letter);
    startLetter(letter, letterRecord(letter).stage);
  }

  function startLetter(letter, stage) {
    // Whatever was happening to the last letter stops here: a demo mid-stroke,
    // a correction on screen, a timer about to move on.
    stopDemo();
    global.clearTimeout(state.advance);
    state.feedback = null;

    state.letter = letter;
    state.stage = Math.max(1, Math.min(TOP_STAGE, stage));
    state.attempt = 0;
    resetInk();
    state.feedback = null;

    setStage(state.stage);
    dom.letterBig.textContent = letter;
    dom.letterBig.style.color = inkFor(letter);
    dom.cue.textContent = global.Strokes.letter(letter).cue;
    dom.doneBtn.hidden = true;

    setMessage("", "");
    global.Kitten.setState("watching");

    // A trace always opens with the demo; the other rungs say the letter
    // and wait, with "Show me" a tap away.
    if (state.stage === 1) {
      say(letter, true);
      startDemo(function () { state.startedAt = global.performance.now(); draw(); });
    } else {
      say(letter, state.stage === 3);
      state.startedAt = global.performance.now();
      draw();
    }
  }

  /* The rung shows on the section, so the stylesheet can hide the big
     letter from memory, and the model only appears for copying. */
  function setStage(stage) {
    dom.build.dataset.stage = STAGES[stage];
    dom.board.dataset.stage = STAGES[stage];
    dom.stageName.textContent = STAGES[stage] === "memory" ? "from memory" : STAGES[stage];
    dom.model.hidden = stage !== 2;
    if (stage === 2 && state.letter) drawModel(state.letter);
  }

  function resetInk() {
    state.strokes = [];
    state.current = null;
    state.pointerId = null;
    state.traceIndex = 0;
    state.traceHit = -1;
    state.traced = [];
    state.strokeTries = 0;
    global.clearTimeout(state.settle);
    state.settle = null;
  }

  function say(letter, withCue) {
    if (!settings.autoSay) return;
    var name = global.Letters.spokenName(letter);
    var cue = global.Strokes.letter(letter).cue;
    if (withCue) global.Speech.say(name + ". " + cue, { rate: 0.9 });
    else global.Speech.say("Draw " + global.Recogniser.article(letter) + ".", { rate: 0.9 });
  }

  /* A small copy of the letter beside the box, for the copy rung. */
  function drawModel(letter) {
    var c = dom.model;
    var mctx = c.getContext("2d");
    var s = c.width;
    mctx.clearRect(0, 0, s, s);
    var template = global.Strokes.letter(letter).strokes;
    var L = global.Strokes.LINES;
    mctx.strokeStyle = colours.line;
    mctx.lineWidth = 1;
    [L.top, L.xHeight, L.base, L.descender].forEach(function (y) {
      mctx.beginPath(); mctx.moveTo(s * 0.05, s * y); mctx.lineTo(s * 0.95, s * y); mctx.stroke();
    });
    mctx.strokeStyle = inkFor(letter);
    mctx.lineWidth = s * 0.07;
    mctx.lineCap = "round";
    mctx.lineJoin = "round";
    template.forEach(function (stroke) {
      mctx.beginPath();
      mctx.moveTo(s * stroke[0][0], s * stroke[0][1]);
      for (var i = 1; i < stroke.length; i++) mctx.lineTo(s * stroke[i][0], s * stroke[i][1]);
      mctx.stroke();
    });
  }

  // ------------------------------------------------------------------------
  // her finger
  // ------------------------------------------------------------------------

  function boxPoint(event) {
    var rect = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    ];
  }

  function onDown(event) {
    if (!state.running || state.paused || state.locked || !state.letter) return;
    if (state.pointerId !== null) return;          // one finger at a time
    event.preventDefault();

    state.pointerId = event.pointerId;
    try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* fine */ }

    global.clearTimeout(state.settle);
    state.settle = null;
    state.current = [boxPoint(event)];
    /* Where she puts her finger down counts. It used to be ignored - only
       movement was measured - so a tap was worth nothing at all. */
    if (state.stage === 1) {
      state.traceHit = -1;
      followTrace(state.current[0]);
    }
    safely(function () { global.Sound.pick(); });
    draw();
  }

  function onMove(event) {
    if (event.pointerId !== state.pointerId || !state.current) return;
    event.preventDefault();

    var p = boxPoint(event);
    var last = state.current[state.current.length - 1];
    var gap = Math.hypot(p[0] - last[0], p[1] - last[1]);
    if (gap < 0.004) return;
    state.current.push(p);

    /* A fast finger arrives as a few points far apart, not a smooth line.
       Walk the gap between samples in small steps so the corridor check
       sees the whole movement - otherwise a quick, perfectly good swipe
       down a stick looks like a finger that skipped most of it. */
    if (state.stage === 1) {
      var steps = Math.max(1, Math.ceil(gap / 0.012));
      for (var i = 1; i <= steps; i++) {
        var t = i / steps;
        followTrace([last[0] + (p[0] - last[0]) * t, last[1] + (p[1] - last[1]) * t]);
      }
    }
    draw();
  }

  /* Tracing: how far along the current template stroke has she got? The
     furthest point within the corridor, allowed to jump forward only a
     little at a time - so a finger that leaps to the end of the stroke has
     not traced it. */
  function followTrace(p) {
    var resampled = traceTemplate();
    if (state.traceIndex >= resampled.length) return;
    var s = resampled[state.traceIndex];

    /* A dot has no journey in it: all forty-eight of its points sit in the
       same place, so measuring how far along she has got measures nothing,
       and the cap on how fast that measure may move meant a tap could never
       finish one. The dot on an i was untraceable. Touch it and it is
       done - which is what tapping a dot ought to mean. */
    if (strokeIsDot(state.traceIndex)) {
      if (Math.hypot(p[0] - s[0][0], p[1] - s[0][1]) <= CORRIDOR) state.traceHit = s.length - 1;
      return;
    }

    var from = Math.max(0, state.traceHit - 3);
    var to = Math.min(s.length - 1, state.traceHit + 4);
    for (var i = from; i <= to; i++) {
      if (Math.hypot(p[0] - s[i][0], p[1] - s[i][1]) <= CORRIDOR) {
        if (i > state.traceHit) state.traceHit = i;
      }
    }
  }

  function onUp(event) {
    if (event.pointerId !== state.pointerId) return;
    event.preventDefault();
    state.pointerId = null;

    var stroke = state.current;
    state.current = null;
    if (!stroke || !stroke.length) { draw(); return; }

    if (state.stage === 1) {
      finishTraceStroke(stroke);
    } else {
      state.strokes.push(stroke);
      dom.doneBtn.hidden = false;
      state.settle = global.setTimeout(finishLetter, SETTLE_MS);
    }
    draw();
  }

  /* Why the stroke did not count, in the terms she can act on. It used to
     say "start at the green dot" however far she had got, which is no use
     at all to a child who started in the right place and stopped an inch
     short. */
  function missedWhy(covered) {
    if (covered <= 0) return "Start on the green dot and follow the arrow";
    if (covered < 0.5) return "Good start - now keep going, all the way along";
    return "Nearly! Follow it right to the end";
  }

  /* Short on purpose: this sits under the box on a tablet held in one hand,
     and a line that wraps pushes the drawing box about. */
  var NEXT_BIT = [
    "Good. Now the next bit",
    "And now the next bit",
    "One more bit"
  ];

  function finishTraceStroke(stroke) {
    var resampled = traceTemplate();
    var covered = (state.traceHit + 1) / TRACE_POINTS;

    if (covered < STROKE_DONE) {
      // Not far enough along. Not a failure - the ink just fades, and the
      // start dot is still there.
      state.traceHit = -1;
      state.strokeTries += 1;
      safely(function () { global.Sound.nudge(); });
      setMessage(missedWhy(covered), "nudge");
      safely(function () { global.Kitten.react("nudge"); });

      /* Two goes at the same bit and she has run out of things to try on
         her own. Show her again rather than leave her guessing. */
      if (state.strokeTries >= STROKE_HELP_AFTER) {
        state.strokeTries = 0;
        startDemo(function () { draw(); });
      }
      return;
    }

    state.strokes.push(stroke);
    state.traceIndex += 1;
    state.traceHit = -1;
    state.strokeTries = 0;
    safely(function () { global.Sound.place(); });

    if (state.traceIndex >= resampled.length) {
      setMessage("", "");
      finishLetter();
      return;
    }

    /* There is more of the letter to go. Saying nothing here is how a letter
       drawn in one long sweep ends up looking ignored: the first bit goes
       in, and the board just sits there. */
    setMessage(NEXT_BIT[Math.min(state.traceIndex - 1, NEXT_BIT.length - 1)], "good");
  }

  // ------------------------------------------------------------------------
  // judging
  // ------------------------------------------------------------------------

  function finishLetter() {
    global.clearTimeout(state.settle);
    state.settle = null;
    if (!state.running || !state.letter || state.locked) return;
    if (!state.strokes.length) return;

    dom.doneBtn.hidden = true;
    state.attempt += 1;
    var ms = Math.round(global.performance.now() - state.startedAt);
    var verdict = global.Recogniser.judge(state.strokes, state.letter);

    // Tracing cannot really be formed wrongly - the corridor saw to that -
    // but a very fat wobble can still miss by shape. Be kind about it.
    if (state.stage === 1 && !verdict.ok) {
      verdict.ok = true;
      verdict.formed = true;
      verdict.fault = null;
      verdict.cue = "That's " + global.Recogniser.article(state.letter) + "!";
    }

    // Keeping the log is worth doing and never worth stopping her for.
    safely(function () {
      global.Logbook.trace({
        letter: state.letter, stage: state.stage, attempt: state.attempt,
        ok: verdict.ok, formed: verdict.formed, fault: verdict.fault, ms: ms,
        strokes: global.Recogniser.compact(state.strokes)
      });
    });

    var rec = letterRecord(state.letter);
    rec.tries += 1;

    if (verdict.ok) {
      rec.oks += 1;
      rec.recent = rec.recent.concat([verdict.formed]).slice(-8);
      succeed(verdict, rec);
    } else {
      rec.recent = rec.recent.concat([false]).slice(-8);
      slip(verdict, rec);
    }
    saveStore();
  }

  function succeed(verdict, rec) {
    var clean = verdict.formed && state.attempt === 1;
    var puffs = PUFFS_BY_STAGE[state.stage];
    if (!verdict.formed) puffs = Math.max(1, Math.floor(puffs / 2));
    if (clean) puffs += FIRST_GO_BONUS;

    if (clean) {
      state.clean += 1;
      rec.ups += 1;
      rec.downs = 0;
      if (rec.ups >= 2) {
        rec.ups = 0;
        if (rec.stage < TOP_STAGE) rec.stage += 1;
        else if (progress.mastered.indexOf(state.letter) < 0) progress.mastered.push(state.letter);
      }
    } else {
      rec.ups = 0;
      if (verdict.fault) state.wobbly[state.letter] = verdict.fault;
    }

    state.feedback = { good: true };
    state.locked = true;
    state.done += 1;
    draw();

    setMessage(verdict.cue, "good");
    safely(function () { if (settings.autoSay) global.Speech.say(verdict.cue, { rate: 0.95 }); });
    // The cheer wants a size. It used to be called without one, which made a
    // run of NaN notes, which threw, which froze the round on every letter
    // she got right. Harder rungs now get a bigger cheer.
    safely(function () { global.Sound.success(3 + puffs); });
    safely(function () { global.Kitten.react(clean ? "bigcheer" : "cheer"); });
    safely(function () { if (clean) global.Confetti.burstFrom(canvas, 0.9); });

    flyPuffs(puffs, function () {
      var popped = false;
      safely(function () { popped = global.Balloon.add(puffs); });
      state.banked += puffs;
      if (popped) return;                          // burstRound takes it from here
      state.advance = global.setTimeout(function () {
        state.locked = false;
        if (state.done >= state.perRound) endRound(false);
        else nextLetter();
      }, ADVANCE_MS);
    });
  }

  function slip(verdict, rec) {
    rec.ups = 0;
    rec.downs += 1;
    state.wobbly[state.letter] = verdict.fault;

    state.feedback = { good: false, fault: verdict.fault };
    state.locked = true;
    draw();

    setMessage(verdict.cue, "nudge");
    safely(function () { if (settings.autoSay) global.Speech.say(verdict.cue, { rate: 0.9 }); });
    safely(function () { global.Sound.nudge(); });
    safely(function () { global.Kitten.react("nudge"); });

    state.advance = global.setTimeout(function () {
      state.feedback = null;
      resetInk();

      /* Two slips in a row and the letter drops a rung. Whatever rung it is
         on, the retry opens with the demo: she has just seen what went
         wrong, and now she sees it done. */
      if (rec.downs >= 2) {
        rec.downs = 0;
        rec.stage = Math.max(FIRST_STAGE, rec.stage - 1);
        state.stage = rec.stage;
        setStage(state.stage);
        saveStore();
      }

      setMessage("", "");
      startDemo(function () {
        state.startedAt = global.performance.now();
        draw();
      });
    }, CORRECTION_MS);
  }

  /* The puffs fly from the box to the balloon, as they do from the word in
     the other game, so the two feel like one thing. */
  function flyPuffs(count, then) {
    var n = Math.max(0, Math.min(count | 0, 5));
    var fired = false;

    /* The round carries on from here, so this has to run whatever became of
       the animation. It used to be called by whichever puff landed last,
       which meant a puff that was never made - or a sound that threw on its
       way out - stopped the game dead. One timer, one call, always. */
    function land() {
      if (fired) return;
      fired = true;
      safely(function () { global.Sound.inflate(global.Balloon.fill()); });
      then();
    }

    safely(function () {
      var from = canvas.getBoundingClientRect();
      var to = global.Balloon.element().getBoundingClientRect();

      for (var i = 0; i < n; i++) {
        (function (i) {
          var puff = document.createElement("span");
          puff.className = "puff-fly";
          puff.textContent = "•";
          puff.style.color = inkFor(state.letter);
          puff.style.left = (from.left + from.width / 2 + (i - n / 2) * 14) + "px";
          puff.style.top = (from.top + from.height * 0.45) + "px";
          document.body.appendChild(puff);
          global.requestAnimationFrame(function () {
            puff.style.transitionDelay = (i * 60) + "ms";
            puff.style.transform = "translate(" +
              (to.left + to.width / 2 - (from.left + from.width / 2 + (i - n / 2) * 14)) + "px, " +
              (to.top + to.height / 2 - (from.top + from.height * 0.45)) + "px) scale(.5)";
            puff.style.opacity = "0";
          });
          global.setTimeout(function () {
            if (puff.parentNode) puff.parentNode.removeChild(puff);
          }, 620 + i * 60);
        })(i);
      }
    });

    global.setTimeout(land, n ? 620 + n * 60 : 0);
  }

  function setMessage(text, kind) {
    dom.message.textContent = text;
    dom.message.className = "message" + (kind ? " is-" + kind : "") + (text ? " is-shown" : "");
  }

  // ------------------------------------------------------------------------
  // the round
  // ------------------------------------------------------------------------

  function startRound() {
    state.running = true;
    state.paused = false;
    state.done = 0;
    state.clean = 0;
    state.banked = 0;
    state.popped = false;
    state.wobbly = {};
    state.letter = null;
    state.locked = false;

    global.Balloon.reset(Math.round(state.perRound * PUFFS_PER_LETTER));
    global.Logbook.startRound({ game: "trace", letters: state.perRound });

    closeOverlay(dom.startScreen);
    closeOverlay(dom.endScreen);
    dom.app.classList.remove("is-paused");
    global.Kitten.setState("watching");
    global.Sound.start();

    fitCanvas();
    nextLetter();
  }

  function burstRound() {
    if (!state.running) return;
    state.popped = true;
    state.running = false;
    state.locked = true;
    global.clearTimeout(state.advance);
    progress.pops += 1;
    saveStore();

    global.Kitten.react("bigcheer");
    global.Confetti.celebrate();
    global.Sound.pop();
    logRoundEnd();

    global.Reward.show(function () { showResults(false); });
  }

  function pauseRound() {
    if (!state.running || state.paused) return;
    state.paused = true;
    dom.app.classList.add("is-paused");
    global.Speech.stop();
    global.Kitten.setState("sleep");
    openOverlay(dom.pauseScreen);
  }

  function resumeRound() {
    if (!state.paused) return;
    state.paused = false;
    dom.app.classList.remove("is-paused");
    global.Kitten.setState("watching");
    closeOverlay(dom.pauseScreen);
  }

  function endRound(quit) {
    if (!state.running) return;
    state.running = false;
    state.paused = false;
    state.locked = true;
    global.clearTimeout(state.advance);
    global.clearTimeout(state.settle);
    stopDemo();
    global.Speech.stop();
    dom.app.classList.remove("is-paused");
    closeOverlay(dom.pauseScreen);

    var fill = global.Balloon.percent();
    if (fill > progress.best) progress.best = fill;
    global.Balloon.cancel();
    saveStore();
    logRoundEnd();
    showResults(quit);
  }

  function logRoundEnd() {
    global.Logbook.endRound({
      game: "trace",
      letters: state.done,
      clean: state.clean,
      fill: global.Balloon.percent(),
      popped: state.popped
    });
  }

  function showResults(quit) {
    dom.endTitle.textContent = state.popped ? "POP!" : quit ? "Nice drawing" : "All done!";
    dom.endFill.textContent = global.Balloon.percent() + "%";
    dom.endLetters.textContent = String(state.done);
    dom.endClean.textContent = String(state.clean);

    var wobblyLetters = Object.keys(state.wobbly);
    dom.wobblyBlock.hidden = !wobblyLetters.length;
    dom.wobblyList.innerHTML = "";
    wobblyLetters.forEach(function (letter) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "wobbly-letter";
      item.style.color = inkFor(letter);
      item.textContent = letter;
      item.title = describeFault(state.wobbly[letter]);
      item.addEventListener("click", function () {
        global.Speech.say(global.Letters.spokenName(letter) + ". "
          + global.Strokes.letter(letter).cue, { rate: 0.9 });
      });
      dom.wobblyList.appendChild(item);
    });

    var mastered = progress.mastered.length;
    dom.endNote.textContent = state.popped
      ? "You filled the whole balloon with letters!"
      : state.clean === state.done && state.done
        ? "Every single one first go."
        : mastered ? mastered + " letter" + (mastered > 1 ? "s" : "") + " learned from memory so far."
        : "Keep going - the balloon remembers.";

    refreshRecords();
    openOverlay(dom.endScreen);
    global.Kitten.setState("sleep");
  }

  function describeFault(fault) {
    return {
      reversal: "the ball went on the wrong side",
      humps: "the wrong number of humps",
      "wrong-end": "started at the wrong end",
      order: "the strokes in the wrong order",
      "wrong-way": "went round the wrong way",
      strokes: "lifted the finger in the wrong places",
      size: "the wrong size",
      wobbly: "a bit wobbly",
      "wrong-letter": "came out as a different letter"
    }[fault] || "";
  }

  function refreshRecords() {
    dom.bestScore.textContent = progress.best + "%";
    dom.collectionCount.textContent = String(progress.pops);
    dom.masteredCount.textContent = String(progress.mastered.length);
  }

  // ------------------------------------------------------------------------
  // settings, overlays, buttons
  // ------------------------------------------------------------------------

  var SETTING_INPUTS = {
    rewardVideo: "setRewardVideo",
    autoSay: "setAutoSay",
    kitten: "setKitten",
    sound: "setSound",
    calm: "setCalm",
    uploadLog: "setUploadLog"
  };

  function applySettings() {
    global.Sound.enabled = settings.sound;
    global.Reward.enabled = settings.rewardVideo;
    global.Kitten.setEnabled(settings.kitten);
    global.Confetti.calm = settings.calm;
    global.Logbook.uploading = settings.uploadLog;
    document.body.classList.toggle("calm", settings.calm);
  }

  function wireSettings() {
    Object.keys(SETTING_INPUTS).forEach(function (key) {
      var input = byId(SETTING_INPUTS[key]);
      if (!input) return;
      input.checked = !!settings[key];
      input.addEventListener("change", function () {
        settings[key] = input.checked;
        applySettings();
        saveStore();
        if (key === "sound" && input.checked) global.Sound.place();
        if (key === "kitten" && input.checked) global.Kitten.react("cheer");
        if (key === "uploadLog" && input.checked) global.Logbook.flush();
      });
    });
  }

  function agoText(at) {
    var seconds = Math.round((Date.now() - at) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return Math.round(seconds / 60) + " min ago";
    if (seconds < 86400) return Math.round(seconds / 3600) + " hr ago";
    return Math.round(seconds / 86400) + " days ago";
  }

  function refreshLogbook() {
    var info = global.Logbook.status();
    dom.logbookCount.textContent = info.pending;
    var line = dom.logbookStatus;
    line.className = "logbook-status";
    line.textContent = !info.target ? "No upload destination is set."
      : !info.uploading ? "Uploading is switched off. " + info.pending + " records are being kept here."
      : !info.last ? (info.pending ? "Nothing sent yet. Tap Send now to try." : "Nothing to send yet.")
      : info.last.ok ? "Last upload worked " + agoText(info.last.at) + " (" + info.last.sent + " records)."
      : "Last upload failed " + agoText(info.last.at) + ". " + info.last.why;
    if (info.last) line.className += info.last.ok ? " is-ok" : " is-bad";
  }

  function wireLogbook() {
    dom.logbookExportBtn.addEventListener("click", function () { global.Logbook.download(); });
    dom.logbookSendBtn.addEventListener("click", function () {
      dom.logbookSendBtn.disabled = true;
      dom.logbookSendBtn.textContent = "Sending…";
      var done = function () {
        dom.logbookSendBtn.disabled = false;
        dom.logbookSendBtn.textContent = "Send now";
        refreshLogbook();
      };
      var attempt = global.Logbook.flush();
      if (attempt && attempt.then) attempt.then(done, done); else done();
    });
  }

  function openOverlay(el) { el.classList.add("is-open"); }
  function closeOverlay(el) { el.classList.remove("is-open"); }

  function wireButtons() {
    dom.playBtn.addEventListener("click", function () {
      global.Sound.unlock();
      global.Speech.init();
      startRound();
    });
    dom.againBtn.addEventListener("click", function () { startRound(); });
    dom.homeBtn.addEventListener("click", function () {
      closeOverlay(dom.endScreen);
      refreshRecords();
      openOverlay(dom.startScreen);
    });

    dom.pauseBtn.addEventListener("click", function () {
      if (state.paused) resumeRound(); else pauseRound();
    });
    dom.resumeBtn.addEventListener("click", resumeRound);
    dom.quitBtn.addEventListener("click", function () { endRound(true); });

    /* Show me and Skip are the two ways out of being stuck, so neither may
       be refused while the board is locked - that is the moment they are
       wanted. Both cancel whatever the board was waiting for. */
    dom.showBtn.addEventListener("click", function () {
      if (!state.running || state.paused || state.demo || !state.letter) return;
      global.clearTimeout(state.advance);
      global.clearTimeout(state.settle);
      state.feedback = null;
      resetInk();
      say(state.letter, true);
      setMessage("", "");
      startDemo(function () { state.startedAt = global.performance.now(); draw(); });
    });
    dom.sayBtn.addEventListener("click", function () {
      if (!state.letter) return;
      global.Speech.say(global.Letters.spokenName(state.letter) + ". "
        + global.Strokes.letter(state.letter).cue, { rate: 0.9 });
    });
    dom.clearBtn.addEventListener("click", function () {
      if (!state.running || state.locked) return;
      resetInk();
      dom.doneBtn.hidden = true;
      setMessage("", "");
      draw();
    });
    dom.doneBtn.addEventListener("click", function () { finishLetter(); });
    dom.skipBtn.addEventListener("click", function () {
      if (!state.running || state.demo || !state.letter) return;
      global.clearTimeout(state.advance);
      global.clearTimeout(state.settle);

      /* Pressed during the cheer for a letter she has just got right, this
         is "get on with it", not "skip this one": that letter is already
         counted and logged, and must not be counted or logged twice. */
      var alreadyCounted = !!(state.feedback && state.feedback.good);
      if (!alreadyCounted) {
        safely(function () {
          global.Logbook.trace({
            letter: state.letter, stage: state.stage, attempt: state.attempt + 1,
            ok: false, formed: false, fault: "skipped", ms: 0, strokes: []
          });
        });
        state.done += 1;
      }

      state.feedback = null;
      state.locked = false;
      if (state.done >= state.perRound) endRound(false); else nextLetter();
    });

    dom.countChips.addEventListener("click", function (event) {
      var chip = event.target.closest(".chip");
      if (!chip) return;
      state.perRound = parseInt(chip.dataset.letters, 10) || 10;
      Array.prototype.forEach.call(dom.countChips.querySelectorAll(".chip"), function (c) {
        c.classList.toggle("is-on", c === chip);
      });
    });

    dom.helpBtn.addEventListener("click", function () {
      if (state.running && !state.paused) pauseRound();
      openOverlay(dom.helpScreen);
    });
    dom.startHelpBtn.addEventListener("click", function () { openOverlay(dom.helpScreen); });
    dom.helpCloseBtn.addEventListener("click", function () { closeOverlay(dom.helpScreen); });

    dom.settingsBtn.addEventListener("click", function () {
      if (state.running && !state.paused) pauseRound();
      refreshLogbook();
      openOverlay(dom.settingsScreen);
    });
    dom.startSettingsBtn.addEventListener("click", function () {
      refreshLogbook();
      openOverlay(dom.settingsScreen);
    });
    dom.settingsCloseBtn.addEventListener("click", function () { closeOverlay(dom.settingsScreen); });

    global.addEventListener("resize", fitCanvas);
    global.addEventListener("keydown", function (event) {
      if (event.key === " " && state.running) {
        event.preventDefault();
        if (state.paused) resumeRound(); else pauseRound();
      }
    });
  }

  function wireCanvas() {
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  function buildHelpCards() {
    global.Letters.all().forEach(function (letter) {
      var info = global.Letters.info(letter);
      var card = document.createElement("div");
      card.className = "help-card";
      card.innerHTML =
        '<div class="tile"></div><div class="help-card-text"></div>';
      card.querySelector(".tile").textContent = letter;
      card.querySelector(".tile").classList.add(global.Letters.colourClass(letter));
      card.querySelector(".help-card-text").innerHTML =
        "<b>" + letter + "</b> - " + global.Strokes.letter(letter).cue +
        "<br><small>" + info.hint + "</small>";
      card.addEventListener("click", function () {
        global.Speech.say(global.Letters.spokenName(letter) + ". " +
          global.Strokes.letter(letter).cue, { rate: 0.9 });
      });
      dom.helpCards.appendChild(card);
    });
  }

  function collectDom() {
    ["app", "build", "board", "pad", "model", "letterBig", "stageName", "cue", "message",
     "showBtn", "sayBtn", "clearBtn", "doneBtn", "skipBtn", "balloon", "balloonLabel",
     "pauseBtn", "helpBtn", "settingsBtn", "startScreen", "startBody", "loadingRow",
     "playBtn", "countChips", "bestScore", "collectionCount", "masteredCount",
     "startHelpBtn", "startSettingsBtn", "pauseScreen", "resumeBtn", "quitBtn",
     "endScreen", "endTitle", "endFill", "endLetters", "endClean", "endNote",
     "wobblyBlock", "wobblyList", "againBtn", "homeBtn", "helpScreen", "helpCards",
     "helpCloseBtn", "settingsScreen", "settingsCloseBtn", "logbookCount",
     "logbookStatus", "logbookSendBtn", "logbookExportBtn", "rewardScreen",
     "rewardFrame", "rewardParty", "rewardDoneBtn"
    ].forEach(function (id) { dom[id] = byId(id); });
  }

  function boot() {
    collectDom();
    loadStore();
    readColours();

    canvas = dom.pad;
    ctx = canvas.getContext("2d");

    global.Logbook.uploading = settings.uploadLog;
    global.Logbook.init();
    global.Confetti.init(byId("confetti"));
    global.Kitten.init(byId("kitten"));
    global.Balloon.init({ element: dom.balloon, label: dom.balloonLabel, onPop: burstRound });
    global.Reward.init({
      screen: dom.rewardScreen, frame: dom.rewardFrame,
      party: dom.rewardParty, doneBtn: dom.rewardDoneBtn
    });

    wireSettings();
    wireLogbook();
    wireButtons();
    wireCanvas();
    buildHelpCards();
    applySettings();
    refreshRecords();

    dom.loadingRow.hidden = true;
    dom.startBody.hidden = false;
    dom.app.classList.remove("is-loading");
    fitCanvas();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* For the tests. */
  global.TraceGame = {
    state: function () { return state; },
    progress: function () { return progress; },
    finishLetter: finishLetter,
    startLetter: startLetter,
    pickLetter: pickLetter
  };
})(window);
