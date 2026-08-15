/* ==========================================================================
   confetti.js — the reward.

   Finding a word has to feel like something happened. Everything is drawn on
   one full screen canvas that ignores pointer events, and the loop stops
   itself the moment the last piece has fallen.
   ========================================================================== */

(function (global) {
  "use strict";

  var canvas = null;
  var ctx = null;
  var pieces = [];
  var running = false;
  var dpr = 1;

  var COLOURS = [
    "#4d9bff", "#ff9838", "#c07bff", "#3ddc84",
    "#ff7bac", "#2fd8d8", "#fbbf24", "#f4f6ff"
  ];

  function resize() {
    if (!canvas) return;
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(global.innerWidth * dpr);
    canvas.height = Math.floor(global.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(x, y, config) {
    var angle = config.angle + (Math.random() - 0.5) * config.spread;
    var speed = config.speed * (0.55 + Math.random() * 0.75);

    pieces.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 7,
      colour: COLOURS[(Math.random() * COLOURS.length) | 0],
      spin: (Math.random() - 0.5) * 0.32,
      rotation: Math.random() * Math.PI * 2,
      round: Math.random() < 0.35,
      life: 1,
      decay: 0.006 + Math.random() * 0.008,
      gravity: config.gravity
    });
  }

  function step() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var alive = 0;
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (p.life <= 0) continue;

      p.vy += p.gravity;
      p.vx *= 0.99;
      p.vy *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      p.life -= p.decay;

      if (p.y > global.innerHeight + 40) {
        p.life = 0;
        continue;
      }
      alive++;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.colour;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }

    if (alive === 0) {
      pieces.length = 0;
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    if (pieces.length > 900) {
      pieces = pieces.filter(function (p) { return p.life > 0; });
    }
    global.requestAnimationFrame(step);
  }

  function run() {
    if (running) return;
    running = true;
    global.requestAnimationFrame(step);
  }

  var Confetti = {
    calm: false,

    init: function (element) {
      canvas = element;
      ctx = canvas.getContext("2d");
      resize();
      global.addEventListener("resize", resize);
    },

    /* A burst out of a point on the page — used at the word she just made. */
    burst: function (x, y, strength) {
      if (!ctx) return;
      strength = strength || 1;

      var count = Math.round((this.calm ? 22 : 52) * strength);
      for (var i = 0; i < count; i++) {
        spawn(x, y, {
          angle: -Math.PI / 2,
          spread: Math.PI * 1.55,
          speed: (this.calm ? 6 : 9) * strength,
          gravity: 0.26
        });
      }
      run();
    },

    /* Two side cannons plus a fall from above, for the end of a round. */
    celebrate: function () {
      if (!ctx) return;

      var height = global.innerHeight;
      var width = global.innerWidth;
      var count = this.calm ? 26 : 60;
      var i;

      for (i = 0; i < count; i++) {
        spawn(0, height * 0.72, { angle: -Math.PI / 3.1, spread: 0.75, speed: 17, gravity: 0.24 });
        spawn(width, height * 0.72, { angle: -Math.PI + Math.PI / 3.1, spread: 0.75, speed: 17, gravity: 0.24 });
      }
      for (i = 0; i < count; i++) {
        spawn(Math.random() * width, -20, { angle: Math.PI / 2, spread: 0.6, speed: 2.5, gravity: 0.1 });
      }
      run();
    },

    /* A burst centred on an element, which is nearly always what we want. */
    burstFrom: function (element, strength) {
      if (!element) return;
      var box = element.getBoundingClientRect();
      this.burst(box.left + box.width / 2, box.top + box.height / 2, strength);
    },

    clear: function () {
      pieces.length = 0;
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  global.Confetti = Confetti;
})(window);
