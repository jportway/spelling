/* ==========================================================================
   speech.js — reads letters, words and meanings aloud.

   Uses the browser's own speech synthesis, so the game stays a single folder
   of files with no network and no downloads.
   ========================================================================== */

(function (global) {
  "use strict";

  var synth = global.speechSynthesis || null;
  var voice = null;
  var voicePicked = false;

  /* Novelty voices ("Bad News", "Bubbles", "Trinoids") are installed by
     default on macOS and are useless for hearing a letter clearly. */
  var NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|junior|organ|superstar|trinoids|whisper|wobble|zarvox|hysterical|pipe organ|princess|ralph|fred/i;

  function score(candidate) {
    var name = (candidate.name || "").toLowerCase();
    var lang = (candidate.lang || "").replace("_", "-");
    var points = 0;

    if (NOVELTY.test(name)) return -1;
    if (lang.indexOf("en") !== 0) return -1;

    // British English first: this is a British household, and hearing "zed"
    // rather than "zee" matters when you are seven.
    if (lang === "en-GB") points += 40;
    else if (lang === "en-AU" || lang === "en-IE") points += 20;
    else points += 8;

    // The higher quality voices tend to announce themselves.
    if (/natural|neural|enhanced|premium|siri/.test(name)) points += 14;
    if (/google/.test(name)) points += 10;
    if (/daniel|kate|serena|sonia|libby|amy|emma|arthur/.test(name)) points += 6;
    if (candidate.localService) points += 3;

    return points;
  }

  function pickVoice() {
    if (!synth) return;
    var available = synth.getVoices();
    if (!available.length) return;

    var best = null;
    var bestScore = 0;
    for (var i = 0; i < available.length; i++) {
      var points = score(available[i]);
      if (points > bestScore) {
        bestScore = points;
        best = available[i];
      }
    }
    voice = best;
    voicePicked = true;
  }

  function utter(text, rate, pitch) {
    var u = new global.SpeechSynthesisUtterance(text);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = "en-GB";
    }
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 1;
    return u;
  }

  var Speech = {
    enabled: true,

    available: function () {
      return !!synth;
    },

    init: function () {
      if (!synth) return;
      pickVoice();
      // Voices load asynchronously in Chrome, so ask again when they arrive.
      if (!voicePicked && typeof synth.addEventListener === "function") {
        synth.addEventListener("voiceschanged", pickVoice);
      }
    },

    stop: function () {
      if (synth) synth.cancel();
    },

    /* One phrase at a time: whatever she just did matters more than whatever
       is still being said about the last thing. */
    say: function (text, options) {
      if (!synth || !this.enabled || !text) return;
      options = options || {};
      synth.cancel();

      var u = utter(text, options.rate || 0.95, options.pitch || 1);
      try {
        synth.speak(u);
      } catch (err) {
        /* A browser that refuses to speak should never break the game. */
      }
    },

    /* Several phrases back to back, with the gaps written in. */
    sayAll: function (phrases, options) {
      if (!synth || !this.enabled || !phrases.length) return;
      options = options || {};
      synth.cancel();

      for (var i = 0; i < phrases.length; i++) {
        var phrase = phrases[i];
        var text = typeof phrase === "string" ? phrase : phrase.text;
        if (!text) continue;
        var rate = (typeof phrase === "object" && phrase.rate) || options.rate || 0.95;
        var pitch = (typeof phrase === "object" && phrase.pitch) || options.pitch || 1;
        try {
          synth.speak(utter(text, rate, pitch));
        } catch (err) {
          return;
        }
      }
    },

    /* "bee", said slowly and clearly. */
    letter: function (letter) {
      this.say(global.Letters.spokenName(letter), { rate: 0.8, pitch: 1.05 });
    },

    /* c - a - t ... cat. The pause between letters is what makes it useful,
       and separate utterances give a more natural pause than commas do. */
    spellOut: function (word) {
      var phrases = [];
      for (var i = 0; i < word.length; i++) {
        phrases.push({ text: global.Letters.spokenName(word[i]), rate: 0.7 });
      }
      phrases.push({ text: word, rate: 0.75, pitch: 1.05 });
      this.sayAll(phrases);
    },

    /* Celebrate the word, then explain it. */
    foundWord: function (entry, praise, withDefinition) {
      var phrases = [];
      if (praise) phrases.push({ text: praise, rate: 1.02, pitch: 1.15 });
      phrases.push({ text: entry.word, rate: 0.82, pitch: 1.1 });

      if (withDefinition && entry.definition) {
        var lead = "";
        if (entry.base && entry.base !== entry.word) {
          lead = "From " + entry.base + ". ";
        }
        phrases.push({ text: lead + entry.definition + ".", rate: 0.92 });
      }
      this.sayAll(phrases);
    }
  };

  global.Speech = Speech;
})(window);
