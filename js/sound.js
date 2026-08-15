/* ==========================================================================
   sound.js — small synthesised sounds, no audio files.

   Deliberately soft. A wrong answer gets a warm two note "hmm", never a
   buzzer: getting it wrong has to stay safe or she will stop trying.
   ========================================================================== */

(function (global) {
  "use strict";

  var ctx = null;
  var master = null;

  function context() {
    if (ctx) return ctx;
    var Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return ctx;
  }

  /* One note. `type` shapes the timbre, the gain envelope stops it clicking. */
  function note(freq, start, length, level, type) {
    var audio = context();
    if (!audio) return;

    var osc = audio.createOscillator();
    var gain = audio.createGain();
    var at = audio.currentTime + start;

    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, at);

    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);

    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }

  function slide(from, to, start, length, level) {
    var audio = context();
    if (!audio) return;

    var osc = audio.createOscillator();
    var gain = audio.createGain();
    var at = audio.currentTime + start;

    osc.type = "sine";
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + length);

    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);

    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }

  // A major pentatonic run: there is no way to make it sound wrong.
  var CHEER = [523.25, 659.25, 783.99, 1046.5, 1318.5];

  var Sound = {
    enabled: true,

    /* Browsers hold the audio context suspended until a real gesture. */
    unlock: function () {
      var audio = context();
      if (audio && audio.state === "suspended") audio.resume();
    },

    pick: function () {
      if (!this.enabled) return;
      note(880, 0, 0.06, 0.12, "triangle");
    },

    place: function () {
      if (!this.enabled) return;
      note(523.25, 0, 0.08, 0.13, "triangle");
    },

    remove: function () {
      if (!this.enabled) return;
      note(392, 0, 0.08, 0.1, "triangle");
    },

    shuffle: function () {
      if (!this.enabled) return;
      for (var i = 0; i < 4; i++) {
        note(400 + i * 90, i * 0.035, 0.06, 0.07, "triangle");
      }
    },

    /* Longer words get a longer run up the scale. */
    success: function (length) {
      if (!this.enabled) return;
      var steps = Math.min(CHEER.length, Math.max(3, length - 1));
      for (var i = 0; i < steps; i++) {
        note(CHEER[i], i * 0.075, 0.3, 0.16, "sine");
      }
      note(CHEER[Math.min(steps, CHEER.length - 1)] * 2, steps * 0.075, 0.5, 0.09, "sine");
    },

    /* Warm, curious, going nowhere near a buzzer. */
    nudge: function () {
      if (!this.enabled) return;
      note(392, 0, 0.16, 0.11, "sine");
      note(349.23, 0.13, 0.24, 0.1, "sine");
    },

    /* For "you already had that one". */
    repeat: function () {
      if (!this.enabled) return;
      note(587.33, 0, 0.1, 0.09, "sine");
      note(587.33, 0.12, 0.14, 0.07, "sine");
    },

    tick: function () {
      if (!this.enabled) return;
      note(1100, 0, 0.04, 0.06, "sine");
    },

    timeUp: function () {
      if (!this.enabled) return;
      slide(660, 330, 0, 0.7, 0.13);
      note(523.25, 0.5, 0.6, 0.1, "sine");
      note(392, 0.5, 0.7, 0.08, "sine");
    },

    start: function () {
      if (!this.enabled) return;
      note(523.25, 0, 0.14, 0.13, "triangle");
      note(783.99, 0.11, 0.3, 0.13, "triangle");
    }
  };

  global.Sound = Sound;
})(window);
