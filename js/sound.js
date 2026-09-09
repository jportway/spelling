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


  /* Filtered white noise. Everything else here is an oscillator, but a puff
     of air and a bursting balloon are both noise - no amount of sine waves
     sounds like either. */
  function noise(start, length, level, cutoff) {
    var audio = context();
    if (!audio) return;

    var frames = Math.max(1, Math.floor(audio.sampleRate * length));
    var buffer = audio.createBuffer(1, frames, audio.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frames; i++) {
      // Fading the noise itself as well as the gain keeps the tail soft.
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }

    var source = audio.createBufferSource();
    source.buffer = buffer;

    var gain = audio.createGain();
    var at = audio.currentTime + start;
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);

    if (cutoff) {
      var filter = audio.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(cutoff, at);
      source.connect(filter);
      filter.connect(gain);
    } else {
      source.connect(gain);
    }

    gain.connect(master);
    source.start(at);
    source.stop(at + length + 0.05);
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


    /* Air going in. Pitched by how full the balloon already is, so the
       thirtieth puff sounds tighter than the first - the ear notices the
       climb long before the numbers would tell her. */
    inflate: function (fill) {
      if (!this.enabled) return;
      var tightness = Math.max(0, Math.min(1, fill || 0));
      noise(0, 0.16, 0.1, 700 + tightness * 2200);
      slide(220 + tightness * 260, 320 + tightness * 420, 0.01, 0.18, 0.05);
    },

    /* Stretched rubber. Deliberately uncomfortable, because the whole point
       of the last few puffs is that she can hear it coming. */
    creak: function (fill) {
      if (!this.enabled) return;
      var tightness = Math.max(0, Math.min(1, fill || 0));
      slide(520 + tightness * 300, 900 + tightness * 500, 0, 0.22, 0.05);
      note(1500 + tightness * 400, 0.06, 0.1, 0.02, "triangle");
    },

    /* The moment itself. */
    pop: function () {
      if (!this.enabled) return;
      noise(0, 0.09, 0.42, 9000);
      slide(900, 90, 0, 0.16, 0.16);
      // The cheer underneath, so the burst lands as a reward and not a bang.
      for (var i = 0; i < CHEER.length; i++) {
        note(CHEER[i], 0.14 + i * 0.07, 0.42, 0.14, "sine");
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
