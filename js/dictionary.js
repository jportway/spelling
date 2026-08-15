/* ==========================================================================
   dictionary.js — the offline word list.

   data/dictionary.js hands us one big string, one word per line, in the form
       word
       word|pos|baseWord|definition

   The whole thing is about 24,000 words chosen to be words a child would
   recognise, so a word she has genuinely made is very unlikely to be turned
   down, and a random mash of letters is very unlikely to be accepted.
   ========================================================================== */

(function (global) {
  "use strict";

  var A = 97; // "a"

  var entries = Object.create(null); // word -> raw line
  var words = [];                    // every word, in dictionary order
  var masks = null;                  // Int32Array: which letters each word uses
  var wordSet = null;                // Set of every word, for fast near misses
  var everydaySet = null;            // words a child certainly knows
  var familiarSet = null;            // real words, but a step up
  var loaded = false;

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

  function wordListFrom(raw) {
    return new Set(typeof raw === "string" && raw.trim() ? raw.trim().split(" ") : []);
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

  var Dictionary = {
    ready: false,
    size: 0,

    load: function () {
      if (loaded) return;

      var raw = global.SPELLING_DICTIONARY_RAW;
      if (typeof raw !== "string") {
        throw new Error("dictionary data did not load");
      }

      var lines = raw.trim().split("\n");
      words = new Array(lines.length);
      masks = new Int32Array(lines.length);

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var bar = line.indexOf("|");
        var word = bar === -1 ? line : line.slice(0, bar);
        words[i] = word;
        masks[i] = letterMask(word);
        entries[word] = line;
      }

      wordSet = new Set(words);
      everydaySet = wordListFrom(global.SPELLING_EVERYDAY_RAW);
      familiarSet = wordListFrom(global.SPELLING_FAMILIAR_RAW);

      loaded = true;
      this.ready = true;
      this.size = words.length;
    },

    has: function (word) {
      return typeof word === "string" && entries[word] !== undefined;
    },

    /* 0 = everyday, 1 = familiar, 2 = the long tail. Words are accepted at
       every tier; this only decides what is worth suggesting. */
    familiarity: function (word) {
      if (everydaySet && everydaySet.has(word)) return 0;
      if (familiarSet && familiarSet.has(word)) return 1;
      return 2;
    },

    /* { word, pos, base, definition } — base is set when the definition came
       from a root form, so "babies" explains itself via "baby". */
    lookup: function (word) {
      var line = entries[word];
      if (line === undefined) return null;

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
        if (!entries[variant.word]) continue;
        if (available && !canForm(variant.word, available, scratch)) continue;
        return variant;
      }
      return null;
    },

    /* Any real word one edit away, so we can say "so close" and mean it.
       Only ever called after a word has already been rejected. */
    nearMiss: function (word, available) {
      var scratch = new Uint8Array(26);
      var i, j, candidate;

      function usable(text) {
        if (!wordSet.has(text)) return false;
        return !available || canForm(text, available, scratch);
      }

      // A letter in the wrong place: "colur" -> "colour" is not this, but
      // "brwn" -> "brown" is, and swapped neighbours are very common.
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
