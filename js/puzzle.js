/* ==========================================================================
   puzzle.js — building one missing-letter puzzle.

   A puzzle is a word with holes punched in it and a small pile of letters to
   fill them from. Two decisions are what make it teach anything:

     Which letter comes out. Most of the time it is one of the six she
     muddles, because that is the entire point of this game. Not every time,
     though: if the answer were always a b or a d she could stop reading the
     word and play the pile instead.

     What sits next to the right answer in the pile. A b with no d beside it
     is not a decision, so the confusable partner is nearly always dealt in.
     That is the moment the game exists for — the one where she has to look
     at the shape and work out which way round it goes.
   ========================================================================== */

(function (global) {
  "use strict";

  var TRICKY_RE = /[bdpqnm]/;

  var TRICKY_GAP_CHANCE = 0.78;
  var PARTNER_CHANCE = 0.9;

  var POOL_MIN = 5;
  var POOL_MAX = 6;

  /* Levels 0-5. The round controller walks her up after a run of clean
     answers and back down after a struggle, so this is a ladder to climb
     rather than a schedule to get through.

       min, max  how long a word to look for
       maxGrade  the hardest word allowed in, where grade 0 sounds out
                 cleanly and she is near certain to know it. Worked out at
                 build time - see tools/grade_words.py.
       twoGaps   chance of a second hole, on words long enough to spare it

     She starts on nothing but grade 0 and the band only widens as she gets
     them right. `coup` is grade 4 and so is never reachable at all: four
     letters, two sounds, a silent p, and no way to reason it out. */
  var LEVELS = [
    { min: 3, max: 4, maxGrade: 0, twoGaps: 0    },
    { min: 3, max: 5, maxGrade: 0, twoGaps: 0.08 },
    { min: 4, max: 6, maxGrade: 1, twoGaps: 0.18 },
    { min: 4, max: 6, maxGrade: 2, twoGaps: 0.28 },
    { min: 5, max: 7, maxGrade: 2, twoGaps: 0.38 },
    { min: 5, max: 8, maxGrade: 3, twoGaps: 0.5  }
  ];

  /* Nothing above this ever reaches her, at any level. */
  var MAX_GRADE = 3;

  var MAX_LENGTH = 8;

  /* Roughly in order of how often they turn up in a child's writing, so a
     decoy is usually a letter she has some reason to consider. */
  var COMMON = "eatoirnslcudhmpgbfywkv";

  var index = null; // index[grade][length] = { all: [...], tricky: [...] }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var swap = list[i];
      list[i] = list[j];
      list[j] = swap;
    }
    return list;
  }

  function build() {
    if (index) return;

    index = [];
    for (var grade = 0; grade <= MAX_GRADE; grade++) {
      index[grade] = [];
      for (var len = 0; len <= MAX_LENGTH; len++) {
        index[grade][len] = { all: [], tricky: [] };
      }
    }

    global.Dictionary.forEach(function (word, tier, wordGrade) {
      if (wordGrade > MAX_GRADE) return;
      var bucket = index[wordGrade][word.length];
      if (!bucket) return;

      bucket.all.push(word);
      if (TRICKY_RE.test(word)) bucket.tricky.push(word);
    });
  }

  /* A word for this level, or null if the level has nothing left to offer.

     Drawn at random and rejected rather than filtered: the alternative is
     building a fresh array of a few thousand words before every single
     puzzle, to use exactly one of them. */
  function pickWord(level, wantTricky, used) {
    var spec = LEVELS[level] || LEVELS[0];
    var pools = [];
    var grade, len, copies;

    for (grade = 0; grade <= spec.maxGrade; grade++) {
      // The easier end of a level's band comes up more often than the hard
      // end, so widening the band adds harder words without the level
      // suddenly being made of them.
      copies = spec.maxGrade - grade + 1;

      for (len = spec.min; len <= spec.max; len++) {
        var bucket = index[grade][len];
        if (!bucket) continue;
        var list = wantTricky ? bucket.tricky : bucket.all;
        if (!list.length) continue;
        for (var c = 0; c < copies; c++) pools.push(list);
      }
    }
    if (!pools.length) return null;

    var fallback = null;

    for (var tries = 0; tries < 60; tries++) {
      var pool = pools[(Math.random() * pools.length) | 0];
      var word = pool[(Math.random() * pool.length) | 0];
      if (used && used.has(word)) continue;

      // A word whose meaning can be read out is worth a good deal more than
      // one the game can only say the name of. The definitions download in
      // the background though, so in the first seconds of the first round
      // there may not be one yet — take the word anyway rather than stall.
      var entry = global.Dictionary.lookup(word);
      if (entry && entry.definition) return { word: word, entry: entry };
      if (!fallback) fallback = { word: word, entry: entry };
    }

    return fallback;
  }

  /* Which positions to punch out.

     `wantTricky` decides which letters are even eligible. If the word turns
     out to have none of the right kind, any position will do — that is far
     better than throwing away a word we have already chosen. */
  function chooseHoles(word, wantTricky, count) {
    var eligible = [];
    var everything = [];
    var i;

    for (i = 0; i < word.length; i++) {
      everything.push(i);
      if (global.Letters.isTricky(word[i]) === wantTricky) eligible.push(i);
    }

    var from = shuffle(eligible.length ? eligible : everything);
    var holes = [from[0]];

    // Never two holes side by side: adjacent blanks stop being two decisions
    // and turn into one guess.
    for (i = 1; i < from.length && holes.length < count; i++) {
      var clear = true;
      for (var j = 0; j < holes.length; j++) {
        if (Math.abs(from[i] - holes[j]) <= 1) clear = false;
      }
      if (clear) holes.push(from[i]);
    }

    holes.sort(function (a, b) { return a - b; });
    return holes;
  }

  /* Decoys worth offering, most tempting first.

     A letter from elsewhere in the word comes first — it is right there in
     front of her, so reaching for it is the natural mistake. Then one more
     of the six, because rejecting a p on a hole that wants a t is still
     shape practice. Ordinary letters fill whatever is left: a pile made
     entirely of b, d, p and q stops being a word game and becomes an eye
     test. */
  function decoyOrder(word, taken) {
    var seen = {};
    var fromWord = [];
    var tricky = [];
    var ordinary = [];
    var six = global.Letters.all();
    var i;

    for (i = 0; i < taken.length; i++) seen[taken[i]] = true;

    for (i = 0; i < word.length; i++) {
      if (seen[word[i]]) continue;
      seen[word[i]] = true;
      fromWord.push(word[i]);
    }
    for (i = 0; i < six.length; i++) {
      if (seen[six[i]]) continue;
      seen[six[i]] = true;
      tricky.push(six[i]);
    }
    for (i = 0; i < COMMON.length; i++) {
      if (seen[COMMON[i]]) continue;
      seen[COMMON[i]] = true;
      ordinary.push(COMMON[i]);
    }

    shuffle(fromWord);
    shuffle(tricky);
    shuffle(ordinary);

    var out = [];
    if (fromWord.length) out.push(fromWord.shift());
    if (tricky.length) out.push(tricky.shift());
    return out.concat(fromWord, ordinary, tricky);
  }

  function buildPool(word, holes) {
    var pool = [];
    var i;

    // The answers, duplicates and all: "bib" with both b's out needs two b's
    // in the pile or it cannot be finished.
    for (i = 0; i < holes.length; i++) pool.push(word[holes[i]]);

    // Then the letter she is most likely to reach for by mistake. Already
    // being in the pile counts — if the word needs both a b and a d, the
    // decision is on the board without any help from us.
    for (i = 0; i < holes.length; i++) {
      var partner = global.Letters.partnerOf(word[holes[i]]);
      if (!partner || pool.indexOf(partner) !== -1) continue;
      if (Math.random() < PARTNER_CHANCE) pool.push(partner);
    }

    var target = POOL_MIN + ((Math.random() * (POOL_MAX - POOL_MIN + 1)) | 0);
    if (target < pool.length + 1) target = pool.length + 1;

    var decoys = decoyOrder(word, pool);
    for (i = 0; i < decoys.length && pool.length < target; i++) {
      pool.push(decoys[i]);
    }

    return shuffle(pool);
  }

  var Puzzle = {
    levelCount: LEVELS.length,

    /* Index the word list by tier and length. Cheap — one pass over about
       24,000 words — and it happens once, before the clock starts. */
    prepare: build,

    /* { word, entry, holes: [index...], pool: [letter...] } or null.

       `used` is the set of words already seen this round, so she is not
       asked to spell the same one twice. */
    make: function (level, used) {
      build();

      var spec = LEVELS[level] || LEVELS[0];
      var wantTricky = Math.random() < TRICKY_GAP_CHANCE;

      var chosen = pickWord(level, wantTricky, used);
      // Running out of one kind of word is no reason to stop the round: take
      // the other kind, and failing that anything at all.
      if (!chosen) {
        wantTricky = !wantTricky;
        chosen = pickWord(level, wantTricky, used);
      }
      if (!chosen) chosen = pickWord(0, true, null);
      if (!chosen) return null;

      var word = chosen.word;
      var count = (word.length >= 5 && Math.random() < spec.twoGaps) ? 2 : 1;
      var holes = chooseHoles(word, wantTricky, count);

      return {
        word: word,
        entry: chosen.entry,
        holes: holes,
        pool: buildPool(word, holes)
      };
    },

    /* Exposed for the tests, which check the ladder is actually a ladder. */
    levels: function () {
      return LEVELS;
    }
  };

  global.Puzzle = Puzzle;
})(window);
