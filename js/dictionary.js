/* ==========================================================================
   dictionary.js — the offline word list.

   Loaded in two stages, because the two halves have very different sizes and
   very different urgency:

     data/words.js        ~170 KB, three space separated lists, one per
                          familiarity tier. Needed before she can play.
     data/definitions.js  ~1.2 MB, one "word|pos|root|meaning" per line.
                          Only needed the moment a word is found, so it
                          arrives in the background while she is already
                          playing. On a slow connection the game starts in a
                          second and the first meaning may be a beat late,
                          rather than the whole game waiting on the download.

   About 24,000 words, chosen to be words a child would recognise, so a word
   she has genuinely made is very unlikely to be turned down and a random mash
   of letters is very unlikely to be accepted.
   ========================================================================== */

(function (global) {
  "use strict";

  var A = 97; // "a"

  var words = [];        // every playable word
  var masks = null;      // Int32Array: which letters each word uses
  var tiers = null;      // Uint8Array: 0 everyday, 1 familiar, 2 rarer
  var index = null;      // Map of word -> position in `words`
  var meanings = null;   // Map of word -> raw definition line, once loaded

  function letterMask(word) {
    var mask = 0;
    for (var i = 0; i < word.length; i++) {
      mask |= 1 << (word.charCodeAt(i) - A);
    }
    return mask;
  }

  /* Count of each letter a-z, as a 26 slot array. */
  function countLetters(letters) {
    var counts = new Uint8Array(26);
    for (var i = 0; i < letters.length; i++) {
      var slot = letters.charCodeAt(i) - A;
      if (slot >= 0 && slot < 26) counts[slot]++;
    }
    return counts;
  }

  function canForm(word, counts, scratch) {
    scratch.set(counts);
    for (var i = 0; i < word.length; i++) {
      var slot = word.charCodeAt(i) - A;
      if (scratch[slot] === 0) return false;
      scratch[slot]--;
    }
    return true;
  }

  function splitList(raw) {
    return typeof raw === "string" && raw.trim() ? raw.trim().split(" ") : [];
  }

  var Dictionary = {
    ready: false,          // the word list is in; the game can start
    hasMeanings: false,    // the definitions have arrived too
    size: 0,

    load: function () {
      if (this.ready) return;

      var byTier = [
        splitList(global.SPELLING_WORDS_EVERYDAY),
        splitList(global.SPELLING_WORDS_FAMILIAR),
        splitList(global.SPELLING_WORDS_REST)
      ];
      var total = byTier[0].length + byTier[1].length + byTier[2].length;
      if (!total) throw new Error("word list did not load");

      words = new Array(total);
      masks = new Int32Array(total);
      tiers = new Uint8Array(total);
      index = new Map();

      var at = 0;
      for (var tier = 0; tier < 3; tier++) {
        var list = byTier[tier];
        for (var i = 0; i < list.length; i++) {
          var word = list[i];
          words[at] = word;
          masks[at] = letterMask(word);
          tiers[at] = tier;
          index.set(word, at);
          at++;
        }
      }

      this.ready = true;
      this.size = total;
    },

    /* Called once data/definitions.js has downloaded. Everything works
       without it; words just get celebrated without an explanation. */
    loadDefinitions: function () {
      if (this.hasMeanings) return;

      var raw = global.SPELLING_DEFINITIONS_RAW;
      if (typeof raw !== "string" || !raw.trim()) return;

      var lines = raw.trim().split("\n");
      meanings = new Map();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var bar = line.indexOf("|");
        if (bar > 0) meanings.set(line.slice(0, bar), line);
      }
      this.hasMeanings = true;
    },

    has: function (word) {
      return typeof word === "string" && !!index && index.has(word);
    },

    /* 0 = everyday, 1 = familiar, 2 = the long tail. Words are accepted at
       every tier; this only decides what is worth suggesting. */
    familiarity: function (word) {
      var at = index ? index.get(word) : undefined;
      return at === undefined ? 2 : tiers[at];
    },

    /* { word, pos, base, definition } — base is set when the definition came
       from a root form, so "babies" explains itself via "baby". The
       definition is "" until data/definitions.js has arrived. */
    lookup: function (word) {
      if (!this.has(word)) return null;

      var line = meanings ? meanings.get(word) : undefined;
      if (line === undefined) {
        return { word: word, pos: "", base: "", definition: "" };
      }

      var parts = line.split("|");
      return {
        word: parts[0],
        pos: parts[1] || "",
        base: parts[2] || "",
        definition: parts[3] || ""
      };
    },

    /* Every dictionary word that can be spelled with `letters`, longest
       first. Used to score a grid before showing it, and to list the words
       that got away at the end of a round. */
    findFormable: function (letters, options) {
      options = options || {};
      var minLength = options.min || 3;
      var maxLength = options.max || letters.length;
      var limit = options.limit || Infinity;

      var counts = countLetters(letters);
      var scratch = new Uint8Array(26);
      var available = letterMask(letters);
      var found = [];

      for (var i = 0; i < words.length; i++) {
        // One integer test throws out the great majority of the list: if a
        // word uses any letter the grid does not have at all, skip it.
        if (masks[i] & ~available) continue;

        var word = words[i];
        if (word.length < minLength || word.length > maxLength) continue;
        if (!canForm(word, counts, scratch)) continue;

        found.push(word);
        if (found.length >= limit) break;
      }

      found.sort(function (a, b) {
        return b.length - a.length || (a < b ? -1 : 1);
      });
      return found;
    },

    /* Does swapping one or more of b/d, p/q, n/m turn this into a real word?
       This is the whole point of the game, so it gets its own lookup.

       `available` is a 26 slot count of the letters she could actually reach
       (the tiles on the line plus the ones still in the grid), so we never
       suggest a fix she has no tile for. */
    confusionMiss: function (word, available) {
      var variants = global.Letters.confusionVariants(word);
      var scratch = new Uint8Array(26);

      for (var i = 0; i < variants.length; i++) {
        var variant = variants[i];
        if (!this.has(variant.word)) continue;
        if (available && !canForm(variant.word, available, scratch)) continue;
        return variant;
      }
      return null;
    },

    /* Any real word one edit away, so we can say "so close" and mean it.
       Only ever called after a word has already been rejected. */
    nearMiss: function (word, available) {
      var scratch = new Uint8Array(26);
      var self = this;
      var i, j, candidate;

      function usable(text) {
        if (!self.has(text)) return false;
        return !available || canForm(text, available, scratch);
      }

      // Two letters the wrong way round, which is very common.
      for (i = 0; i < word.length - 1; i++) {
        candidate = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
        if (candidate !== word && usable(candidate)) {
          return { word: candidate, kind: "swap" };
        }
      }

      // One letter too many.
      for (i = 0; i < word.length; i++) {
        candidate = word.slice(0, i) + word.slice(i + 1);
        if (candidate.length >= 3 && usable(candidate)) {
          return { word: candidate, kind: "remove", at: i };
        }
      }

      // One letter missing.
      for (i = 0; i <= word.length; i++) {
        for (j = 0; j < 26; j++) {
          candidate = word.slice(0, i) + String.fromCharCode(A + j) + word.slice(i);
          if (usable(candidate)) {
            return { word: candidate, kind: "add", at: i };
          }
        }
      }

      // One letter wrong.
      for (i = 0; i < word.length; i++) {
        for (j = 0; j < 26; j++) {
          var letter = String.fromCharCode(A + j);
          if (letter === word[i]) continue;
          candidate = word.slice(0, i) + letter + word.slice(i + 1);
          if (usable(candidate)) {
            return { word: candidate, kind: "change", at: i };
          }
        }
      }

      return null;
    },

    countLetters: countLetters,
    canForm: canForm
  };

  global.Dictionary = Dictionary;
})(window);
