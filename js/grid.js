/* ==========================================================================
   grid.js — choosing the sixteen letters.

   A random handful of letters makes a miserable game: too few vowels and
   nothing can be built. Every grid here is checked against the dictionary
   before it is shown, and every grid is guaranteed to contain at least two of
   the six tricky letters, because practising those is the entire point.
   ========================================================================== */

(function (global) {
  "use strict";

  var VOWELS = "aeiou";

  var VOWEL_WEIGHTS = { a: 10, e: 13, i: 8, o: 8, u: 4 };

  var CONSONANT_WEIGHTS = {
    b: 3, c: 5, d: 5, f: 3, g: 3, h: 4, j: 1, k: 2, l: 6, m: 4,
    n: 7, p: 4, q: 0.3, r: 7, s: 9, t: 9, v: 2, w: 3, x: 0.5,
    y: 3, z: 0.6
  };

  // q makes almost nothing without a u, so it is rarely the tricky letter.
  var TRICKY_WEIGHTS = { b: 4, d: 4, p: 3, n: 4, m: 4, q: 1 };

  function weightedPick(weights, exclude) {
    var total = 0;
    var key;
    for (key in weights) {
      if (!exclude || !exclude[key]) total += weights[key];
    }
    var roll = Math.random() * total;
    for (key in weights) {
      if (exclude && exclude[key]) continue;
      roll -= weights[key];
      if (roll <= 0) return key;
    }
    return key;
  }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var swap = list[i];
      list[i] = list[j];
      list[j] = swap;
    }
    return list;
  }

  function countOf(letters, letter) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) {
      if (letters[i] === letter) n++;
    }
    return n;
  }

  /* One candidate set of letters, before it has been checked for playability. */
  function draft(size) {
    var letters = [];
    var i;

    // Vowels first. Roughly a third of the grid, which is what makes long
    // words reachable.
    var vowelCount = Math.max(4, Math.round(size * 0.34));
    for (i = 0; i < vowelCount; i++) {
      var vowel;
      var guard = 0;
      do {
        vowel = weightedPick(VOWEL_WEIGHTS);
      } while (countOf(letters, vowel) >= 2 && guard++ < 12);
      letters.push(vowel);
    }

    // Then the tricky letters. Two thirds of the time both halves of a pair
    // turn up together, which is exactly the discrimination she needs to
    // practise, and the colours are there to make it fair.
    var trickyCount = 2 + (Math.random() < 0.45 ? 1 : 0);
    var first = weightedPick(TRICKY_WEIGHTS);
    letters.push(first);

    if (Math.random() < 0.66) {
      letters.push(global.Letters.partnerOf(first));
    } else {
      var used = {};
      used[first] = true;
      letters.push(weightedPick(TRICKY_WEIGHTS, used));
    }
    for (i = 2; i < trickyCount; i++) {
      letters.push(weightedPick(TRICKY_WEIGHTS));
    }

    // Fill up with ordinary consonants.
    while (letters.length < size) {
      var consonant;
      var attempts = 0;
      do {
        consonant = weightedPick(CONSONANT_WEIGHTS);
      } while (countOf(letters, consonant) >= 2 && attempts++ < 12);
      letters.push(consonant);
    }

    // A q with no u is a dead tile.
    if (letters.indexOf("q") !== -1 && letters.indexOf("u") === -1) {
      for (i = 0; i < letters.length; i++) {
        if (VOWELS.indexOf(letters[i]) !== -1 && letters[i] !== "u") {
          letters[i] = "u";
          break;
        }
      }
    }

    return shuffle(letters.slice(0, size));
  }

  /* How good is this grid to play? Words are what matter, but a grid where
     every word is three letters long gets dull fast, and a grid where none of
     the words use a tricky letter teaches nothing. */
  function rate(words) {
    var longer = 0;
    var tricky = 0;

    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      if (word.length >= 4) longer++;
      for (var j = 0; j < word.length; j++) {
        if (global.Letters.isTricky(word[j])) { tricky++; break; }
      }
    }

    return {
      total: words.length,
      longer: longer,
      tricky: tricky,
      score: Math.min(words.length, 220) + longer * 2.2 + Math.min(tricky, 90) * 1.6
    };
  }

  var Grid = {
    /* Returns { letters, words } where words is every word the grid can make,
       longest first. */
    generate: function (size) {
      size = size || 16;

      var best = null;
      var bestScore = -1;

      // Twenty five drafts is plenty to find a good grid and takes a few
      // milliseconds, because the dictionary scan is mask-filtered.
      for (var attempt = 0; attempt < 25; attempt++) {
        var letters = draft(size);
        var words = global.Dictionary.findFormable(letters.join(""), { min: 3, max: 8 });
        var rating = rate(words);

        if (rating.score > bestScore) {
          bestScore = rating.score;
          best = { letters: letters, words: words, rating: rating };
        }

        // Good enough to stop looking.
        if (rating.total >= 70 && rating.longer >= 28 && rating.tricky >= 22) break;
      }

      return best;
    },

    /* Same letters, new positions. */
    shuffle: shuffle
  };

  global.Grid = Grid;
})(window);
