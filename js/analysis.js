/* ==========================================================================
   analysis.js — turning a pile of log records into things worth knowing.

   No DOM in here at all, so it can be driven from node in a test and asked
   whether it actually measures what it claims to.

   Three ideas run through the whole file, and everything else follows them.

   FIRST ATTEMPTS ARE THE MEASUREMENT. When a letter goes in the wrong hole
   the tile falls back to the pile and she tries again - but now she knows one
   letter it is not. Her second guess at the same hole is a different, easier
   question, and counting it alongside the first would quietly flatter her.
   Every accuracy figure here is built from the first attempt at each hole.
   The later ones are still analysed, separately, as recovery.

   COUNTS, NOT JUST PERCENTAGES. A seven year old plays a few rounds a week.
   "b is 62% right" out of thirteen attempts is almost no information at all,
   and a dashboard that shows the 62% without the thirteen invites reading a
   mood swing as a trend. Every rate here carries its n and a 95% interval,
   and anything too thin to interpret says so instead of drawing a line.

   THE GAME IS PART OF THE MEASUREMENT. She can only put a d where a b belongs
   if a d was on offer. The generator does that about nine times in ten when
   the missing letter is tricky, so a raw substitution count is conditional on
   an offer that is not always made. Where the pool was recorded, the rates
   are worked out over the attempts where the wrong letter was actually there
   to pick.
   ========================================================================== */

(function (global) {
  "use strict";

  /* Below these, a number is not evidence. They are deliberately visible:
     everything that says "not enough yet" is pointing at one of them. */
  var MIN_FOR_RATE   = 8;    // before a percentage is worth showing at all
  var MIN_FOR_TREND  = 10;   // before a point goes on a trend line
  var MIN_PER_HALF   = 12;   // before before-and-after can be compared

  /* Past this many rounds a chart stops being a line and becomes a comb, and
     every point is thin enough to be mostly noise. Beyond it, consecutive
     rounds are grouped - which makes the picture readable and every point
     better evidenced at the same time. */
  var MAX_POINTS     = 30;

  /* Rushing is measured against her own pace, not a fixed millisecond count.
     An absolute threshold cannot work here: the first move on a word waits on
     the word being read aloud, so "under 800ms" means something quite
     different there than on a follow-up. Comparing her fastest quarter with
     her slowest quarter asks the question that actually matters - when she
     goes fast, is she still right? - and it asks it in her own units. */
  var FAST_QUARTILE = 0.25;

  var TRICKY = ["b", "d", "p", "q", "n", "m"];
  var PARTNER = { b: "d", d: "b", p: "q", q: "p", n: "m", m: "n" };

  // ------------------------------------------------------------------------
  // statistics
  // ------------------------------------------------------------------------

  /* Wilson score interval. Not k/n plus or minus something: at these sample
     sizes the textbook normal interval runs off the end of the scale and
     reports impossible things like "between -4% and 31%". Wilson stays inside
     0..1 and behaves when k is 0 or n. */
  function wilson(k, n, z) {
    z = z || 1.96;
    if (!n) return { k: 0, n: 0, rate: null, lo: 0, hi: 1, wide: true };

    var p = k / n;
    var z2 = z * z;
    var denom = 1 + z2 / n;
    var centre = p + z2 / (2 * n);
    var spread = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));

    return {
      k: k, n: n, rate: p,
      lo: Math.max(0, (centre - spread) / denom),
      hi: Math.min(1, (centre + spread) / denom),
      wide: n < MIN_FOR_RATE
    };
  }

  /* Newcombe's hybrid-score interval for the difference between two rates.
     Built out of the two Wilson intervals rather than a pooled normal
     approximation, for the same reason: small numbers. */
  function difference(k1, n1, k2, n2) {
    if (!n1 || !n2) return { delta: null, lo: -1, hi: 1 };

    var a = wilson(k1, n1);
    var b = wilson(k2, n2);
    var delta = b.rate - a.rate;

    var down = Math.sqrt(Math.pow(a.rate - a.lo, 2) + Math.pow(b.hi - b.rate, 2));
    var up   = Math.sqrt(Math.pow(a.hi - a.rate, 2) + Math.pow(b.rate - b.lo, 2));

    return { delta: delta, lo: delta - down, hi: delta + up, before: a, after: b };
  }

  /* What a before-and-after comparison is allowed to claim. The wording is
     the point: "no detectable change" is not "no change", and with numbers
     this small it is usually the honest answer. */
  function verdict(cmp) {
    if (!cmp || cmp.delta === null)
      return { say: "no data", moved: "has no data behind it", direction: 0, sure: false };
    if (cmp.before.n < MIN_PER_HALF || cmp.after.n < MIN_PER_HALF)
      return { say: "not enough yet", moved: "has not been seen enough times to say",
               direction: 0, sure: false };

    if (cmp.lo > 0)
      return { say: "better", moved: "has measurably improved", direction: 1, sure: true };
    if (cmp.hi < 0)
      return { say: "worse", moved: "has measurably got worse", direction: -1, sure: true };

    return {
      say: "no detectable change",
      moved: "has not measurably changed",
      direction: cmp.delta > 0 ? 1 : (cmp.delta < 0 ? -1 : 0),
      sure: false
    };
  }

  /* Roughly how many attempts each side would need to see a change of this
     size, at the usual 80% power and 5% level. Not a precision instrument -
     it is there so "not enough yet" can say how much longer, instead of
     leaving somebody to wonder whether it will ever say anything else. */
  function sampleNeeded(p1, p2) {
    if (p1 === null || p2 === null) return null;
    var gap = Math.abs(p2 - p1);
    if (gap < 0.005) return null;

    var pooled = (p1 + p2) / 2;
    var a = 1.96 * Math.sqrt(2 * pooled * (1 - pooled));
    var b = 0.84 * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
    return Math.ceil(Math.pow(a + b, 2) / (gap * gap));
  }

  function median(values) {
    if (!values.length) return null;
    var v = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  /* Medians, not means. One round where she wandered off mid-word puts a
     ninety second gap in the data, and a mean would follow it. */
  function spread(values) {
    if (!values.length) return null;
    var v = values.slice().sort(function (a, b) { return a - b; });
    var at = function (q) { return v[Math.min(v.length - 1, Math.floor(q * v.length))]; };
    return { n: v.length, median: median(v), q1: at(0.25), q3: at(0.75) };
  }

  // ------------------------------------------------------------------------
  // getting the records in
  // ------------------------------------------------------------------------

  /* Two shapes turn up in practice: plain records, which is what the fetch
     tool writes and what the game's own download button produces, and
     Firestore's typed values, which is what you get if you export from the
     console or call the REST API by hand. Rather than making somebody care
     which they have, take either. */
  function decode(raw) {
    if (typeof raw === "string") raw = JSON.parse(raw);

    var list = raw;
    if (raw && !Array.isArray(raw)) {
      list = raw.documents || raw.records || raw.logs || raw.data || [];
    }
    if (!Array.isArray(list)) return [];

    return list.map(function (item) {
      if (item && item.fields) return untype(item.fields);          // a REST document
      if (item && item.mapValue) return untype(item.mapValue.fields);
      return item;
    }).filter(function (r) { return r && typeof r === "object"; });
  }

  function untype(fields) {
    var out = {};
    for (var key in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        out[key] = untypeValue(fields[key]);
      }
    }
    return out;
  }

  function untypeValue(v) {
    if (v === null || typeof v !== "object") return v;
    if ("stringValue" in v)  return v.stringValue;
    if ("integerValue" in v) return parseInt(v.integerValue, 10);
    if ("doubleValue" in v)  return v.doubleValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("nullValue" in v)    return null;
    if ("timestampValue" in v) return Date.parse(v.timestampValue);
    if ("arrayValue" in v)   return (v.arrayValue.values || []).map(untypeValue);
    if ("mapValue" in v)     return untype(v.mapValue.fields || {});
    return null;
  }

  // ------------------------------------------------------------------------
  // the model
  // ------------------------------------------------------------------------

  /* One row per attempt, with everything already worked out that the rest of
     the file needs. Whether an attempt was right is decided here and nowhere
     else - the log deliberately does not store it, so that this line is the
     only place the definition lives. */
  function flatten(records) {
    var attempts = [];

    records.forEach(function (rec) {
      if (rec.k !== "word" || !rec.w || !Array.isArray(rec.tries)) return;

      var word = String(rec.w);
      var seenHole = {};

      rec.tries.forEach(function (t, i) {
        if (!t || typeof t.hole !== "number") return;

        var want = word.charAt(t.hole);
        if (!want) return;                      // a hole outside the word: skip

        var got = typeof t.got === "string" ? t.got : "";
        var firstAtHole = !seenHole[t.hole];
        seenHole[t.hole] = true;

        attempts.push({
          at: rec.t || 0,
          round: rec.r || "",
          device: rec.d || "",
          word: word,
          grade: typeof rec.g === "number" ? rec.g : null,
          level: typeof rec.lv === "number" ? rec.lv : null,
          holes: Array.isArray(rec.h) ? rec.h : [],
          pool: Array.isArray(rec.p) ? rec.p : null,

          hole: t.hole,
          want: want,
          got: got,
          ok: got === want,
          ms: typeof t.ms === "number" ? t.ms : null,

          first: firstAtHole,
          opening: i === 0,          // the very first move on this word
          index: i,
          solved: !!rec.solved,
          skipped: !!rec.skipped
        });
      });
    });

    attempts.sort(function (a, b) { return a.at - b.at || a.index - b.index; });
    return attempts;
  }

  /* Rounds, in the order they happened. A round is the natural session unit:
     it is one sitting, one balloon, one clock. */
  function buildRounds(records, attempts) {
    var byId = {};
    var order = [];

    function ensure(id, at) {
      if (!byId[id]) {
        byId[id] = {
          id: id, at: at, words: 0, attempts: 0, firstTries: 0, firstRight: 0,
          solved: 0, skipped: 0, fill: null, popped: false, minutes: null
        };
        order.push(byId[id]);
      }
      return byId[id];
    }

    records.forEach(function (rec) {
      if (!rec.r) return;
      var round = ensure(rec.r, rec.t || 0);
      if (rec.t && rec.t < round.at) round.at = rec.t;

      if (rec.k === "round-start") round.minutes = rec.minutes;
      if (rec.k === "round-end") {
        round.fill = typeof rec.fill === "number" ? rec.fill : null;
        round.popped = !!rec.popped;
      }
      if (rec.k === "word") {
        round.words += 1;
        if (rec.solved) round.solved += 1;
        if (rec.skipped) round.skipped += 1;
      }
    });

    attempts.forEach(function (a) {
      var round = byId[a.round];
      if (!round) return;
      round.attempts += 1;
      if (a.first) {
        round.firstTries += 1;
        if (a.ok) round.firstRight += 1;
      }
    });

    order.sort(function (a, b) { return a.at - b.at; });
    order.forEach(function (r, i) { r.number = i + 1; });
    return order;
  }

  // ------------------------------------------------------------------------
  // the questions
  // ------------------------------------------------------------------------

  function firstAttempts(attempts) {
    return attempts.filter(function (a) { return a.first; });
  }

  /* How she does on each letter she is asked for. This is the "where do we
     put the effort" table, so it is sorted worst first - but only among
     letters with enough attempts to rank at all. */
  function letterMastery(attempts) {
    var firsts = firstAttempts(attempts);
    var bucket = {};

    firsts.forEach(function (a) {
      var b = bucket[a.want] || (bucket[a.want] = {
        letter: a.want, n: 0, right: 0, tricky: TRICKY.indexOf(a.want) >= 0,
        toPartner: 0, toOther: 0, partnerOffered: 0, partnerTaken: 0, times: []
      });

      b.n += 1;
      if (a.ok) b.right += 1;
      else if (a.got && a.got === PARTNER[a.want]) b.toPartner += 1;
      else b.toOther += 1;

      /* Only count the partner as a temptation when it was actually there.
         Without the pool we cannot tell, so those attempts sit out of this
         particular sum rather than quietly diluting it. */
      if (a.pool && a.pool.indexOf(PARTNER[a.want]) >= 0) {
        b.partnerOffered += 1;
        if (a.got === PARTNER[a.want]) b.partnerTaken += 1;
      }

      if (a.ms !== null && !a.opening) b.times.push(a.ms);
    });

    return Object.keys(bucket).map(function (letter) {
      var b = bucket[letter];
      b.score = wilson(b.right, b.n);
      b.partnerPull = b.partnerOffered
        ? wilson(b.partnerTaken, b.partnerOffered) : null;
      b.speed = spread(b.times);
      return b;
    }).sort(function (a, b) {
      if (a.n < MIN_FOR_RATE && b.n >= MIN_FOR_RATE) return 1;
      if (b.n < MIN_FOR_RATE && a.n >= MIN_FOR_RATE) return -1;
      return a.score.rate - b.score.rate;
    });
  }

  /* Which letter she reaches for when she is wrong. The matrix is the raw
     picture; `pairs` is the part worth acting on. */
  function confusion(attempts) {
    var firsts = firstAttempts(attempts);
    var matrix = {};
    var pairs = {};

    firsts.forEach(function (a) {
      if (a.ok || !a.got) return;

      var row = matrix[a.want] || (matrix[a.want] = {});
      row[a.got] = (row[a.got] || 0) + 1;

      var key = a.want + a.got;
      var pair = pairs[key] || (pairs[key] = {
        key: key, want: a.want, got: a.got, n: 0,
        partner: PARTNER[a.want] === a.got,
        offered: 0, positions: {}
      });
      pair.n += 1;
      pair.positions[a.hole] = (pair.positions[a.hole] || 0) + 1;
    });

    /* How often the losing letter was on the table at all, so a pair can be
       reported as "she took the d 8 times out of the 20 it was offered"
       rather than the much less useful "she wrote d instead of b 8 times". */
    firsts.forEach(function (a) {
      if (!a.pool) return;
      Object.keys(pairs).forEach(function (key) {
        var pair = pairs[key];
        if (a.want !== pair.want) return;
        if (a.pool.indexOf(pair.got) >= 0) pair.offered += 1;
      });
    });

    var list = Object.keys(pairs).map(function (k) {
      var pair = pairs[k];
      pair.rate = pair.offered ? wilson(pair.n, pair.offered) : null;
      return pair;
    }).sort(function (a, b) { return b.n - a.n; });

    return { matrix: matrix, pairs: list };
  }

  /* A rate over time. `pick` says which attempts count towards the
     denominator, `hit` which of those count as a success.

     Points thinner than MIN_FOR_TREND are still returned, flagged `thin`, so
     the page can show them greyed rather than pretend the gap is not there. */
  function overTime(attempts, rounds, pick, hit) {
    var byRound = {};
    firstAttempts(attempts).forEach(function (a) {
      if (!pick(a)) return;
      var b = byRound[a.round] || (byRound[a.round] = { n: 0, k: 0 });
      b.n += 1;
      if (hit(a)) b.k += 1;
    });

    var used = rounds.filter(function (r) { return byRound[r.id]; });
    var per = Math.max(1, Math.ceil(used.length / MAX_POINTS));
    var out = [];

    for (var i = 0; i < used.length; i += per) {
      var group = used.slice(i, i + per);
      var n = 0, k = 0;
      group.forEach(function (r) { n += byRound[r.id].n; k += byRound[r.id].k; });

      var w = wilson(k, n);
      out.push({
        round: group[0].number,
        rounds: group.length,
        at: group[0].at,
        n: n, k: k,
        rate: w.rate, lo: w.lo, hi: w.hi,
        thin: n < MIN_FOR_TREND
      });
    }
    return out;
  }

  /* Before and after, splitting on attempts rather than on dates: half the
     practice on each side, whenever it happened. Splitting on the calendar
     puts a fortnight's holiday in one bucket and three rounds in the other,
     then reports the difference as progress. */
  function progress(attempts, pick, hit) {
    var chosen = firstAttempts(attempts).filter(pick);
    if (chosen.length < 2) {
      return { cmp: null, say: verdict(null), n: chosen.length };
    }

    var half = Math.floor(chosen.length / 2);
    var early = chosen.slice(0, half);
    var late = chosen.slice(chosen.length - half);

    var count = function (rows) {
      return rows.reduce(function (n, a) { return n + (hit(a) ? 1 : 0); }, 0);
    };

    var cmp = difference(count(early), early.length, count(late), late.length);
    return { cmp: cmp, say: verdict(cmp), n: chosen.length };
  }

  /* Her first few rounds against her most recent few.

     This answers a different question from the half-and-half split above, and
     both are worth having. Splitting in half is the more powerful test - it
     uses every attempt - but it is blunt when the learning is front-loaded,
     which is the usual shape. A child who goes from 55% to 88% in a fortnight
     and then holds steady for six months has two halves that look nearly
     alike, and the split will honestly report no change over the period,
     while a parent asking "is she better than when she started" would say
     obviously yes.

     So: the ends, plainly labelled as the ends. Fewer attempts, so a wider
     interval, but far more contrast. Where the two disagree the page says so
     rather than picking whichever reads better. */
  function bookends(attempts, rounds, pick, hit) {
    var span = Math.max(3, Math.round(rounds.length * 0.2));
    if (rounds.length < 6) return { enough: false, span: span };

    var firstIds = {}, lastIds = {};
    rounds.slice(0, span).forEach(function (r) { firstIds[r.id] = true; });
    rounds.slice(rounds.length - span).forEach(function (r) { lastIds[r.id] = true; });

    var chosen = firstAttempts(attempts).filter(pick);
    var early = chosen.filter(function (a) { return firstIds[a.round]; });
    var late = chosen.filter(function (a) { return lastIds[a.round]; });

    var count = function (rows) {
      return rows.reduce(function (n, a) { return n + (hit(a) ? 1 : 0); }, 0);
    };

    var cmp = difference(count(early), early.length, count(late), late.length);
    return {
      enough: early.length >= MIN_PER_HALF && late.length >= MIN_PER_HALF,
      span: span, cmp: cmp, say: verdict(cmp)
    };
  }

  /* Words she keeps getting wrong. Only ones she has met more than once -
     a single miss is an accident, a pattern needs repetition. */
  function problemWords(attempts) {
    var bucket = {};

    firstAttempts(attempts).forEach(function (a) {
      var b = bucket[a.word] || (bucket[a.word] = {
        word: a.word, n: 0, right: 0, grade: a.grade, misses: {}, sightings: {}
      });
      b.n += 1;
      if (a.ok) b.right += 1;
      else if (a.got) b.misses[a.want + "→" + a.got] =
        (b.misses[a.want + "→" + a.got] || 0) + 1;
      b.sightings[a.round] = true;
    });

    return Object.keys(bucket).map(function (w) {
      var b = bucket[w];
      b.rounds = Object.keys(b.sightings).length;
      /* Met more than once and still going wrong. One miss on one afternoon
         is an accident; this is the set worth actually drilling. */
      b.recurring = b.rounds > 1;
      b.score = wilson(b.right, b.n);
      b.worst = Object.keys(b.misses).sort(function (x, y) {
        return b.misses[y] - b.misses[x];
      })[0] || "";
      return b;
    }).filter(function (b) {
      return b.right < b.n;                 // she got it wrong at least once
    }).sort(function (a, b) {
      /* Recurring trouble first - a word she has met three times and still
         misses says far more than one she saw once on a bad afternoon - then
         by how badly it goes. */
      return (b.rounds - a.rounds)
          || (a.score.rate - b.score.rate)
          || (b.n - a.n);
    });
  }

  /* Speed, kept in two pieces because they are two different measurements.

     The opening move on a word is nearly all of the data - most words have
     one hole and she gets most of them first go - but it is not a pure
     thinking time: it waits on the word being read out, and the reading takes
     as long as the word takes. So the absolute number means little. The trend
     in it means a lot, because the mix of words does not change much from
     round to round, and whatever the speech adds it adds to every session
     alike.

     Follow-up attempts are clean decision times, with nothing being read
     aloud over them, but there are far fewer of them: they only exist when
     she got one wrong.

     Both are reported. Neither is quietly folded into the other. */
  function pace(attempts, rounds) {
    var firsts = firstAttempts(attempts);
    var opening = firsts.filter(function (a) { return a.opening && a.ms !== null; });
    var followUp = firsts.filter(function (a) { return !a.opening && a.ms !== null; });

    var byRound = {};
    opening.forEach(function (a) {
      var b = byRound[a.round] || (byRound[a.round] = { right: [], wrong: [], n: 0 });
      (a.ok ? b.right : b.wrong).push(a.ms);
      b.n += 1;
    });

    var used = rounds.filter(function (r) { return byRound[r.id]; });
    var per = Math.max(1, Math.ceil(used.length / MAX_POINTS));
    var series = [];

    for (var i = 0; i < used.length; i += per) {
      var group = used.slice(i, i + per);
      var right = [], wrong = [], count = 0;
      group.forEach(function (r) {
        right = right.concat(byRound[r.id].right);
        wrong = wrong.concat(byRound[r.id].wrong);
        count += byRound[r.id].n;
      });
      series.push({
        round: group[0].number, rounds: group.length, at: group[0].at,
        n: count,
        right: median(right), wrong: median(wrong),
        rightN: right.length, wrongN: wrong.length,
        thin: count < MIN_FOR_TREND
      });
    }

    return {
      opening: spread(opening.map(function (a) { return a.ms; })),
      followUp: spread(followUp.map(function (a) { return a.ms; })),
      whenRight: spread(opening.filter(function (a) { return a.ok; })
                               .map(function (a) { return a.ms; })),
      whenWrong: spread(opening.filter(function (a) { return !a.ok; })
                               .map(function (a) { return a.ms; })),
      rushing: rushing(opening),
      series: series,

      /* Getting quicker at the ones she gets right is the fluency measure.
         Getting quicker at the ones she gets wrong is the opposite. */
      faster: quickerOverTime(opening.filter(function (a) { return a.ok; }))
    };
  }

  /* Her fastest quarter against her slowest quarter. If the fast answers are
     markedly worse, she is guessing when she hurries - which is the thing the
     balloon was put in to stop, so it is worth watching. */
  function rushing(rows) {
    var timed = rows.filter(function (a) { return a.ms !== null; });
    if (timed.length < MIN_FOR_RATE * 2) {
      return { enough: false, n: timed.length, fast: null, slow: null, cmp: null };
    }

    var sorted = timed.slice().sort(function (a, b) { return a.ms - b.ms; });
    var cut = Math.max(1, Math.floor(sorted.length * FAST_QUARTILE));
    var fastRows = sorted.slice(0, cut);
    var slowRows = sorted.slice(sorted.length - cut);

    var hit = function (rows) {
      return rows.filter(function (a) { return a.ok; }).length;
    };

    var fast = wilson(hit(fastRows), fastRows.length);
    var slow = wilson(hit(slowRows), slowRows.length);

    return {
      enough: true,
      n: timed.length,
      fastUnder: fastRows[fastRows.length - 1].ms,
      slowOver: slowRows[0].ms,
      fast: fast,
      slow: slow,
      cmp: difference(fast.k, fast.n, slow.k, slow.n)
    };
  }

  /* Median time in the first half of her attempts against the second half.
     Medians rather than a fitted line: one distracted round would drag a
     line, and the question is only "is this coming down". */
  function quickerOverTime(rows) {
    if (rows.length < MIN_PER_HALF * 2) {
      return { enough: false, n: rows.length, before: null, after: null };
    }
    var half = Math.floor(rows.length / 2);
    var before = median(rows.slice(0, half).map(function (a) { return a.ms; }));
    var after = median(rows.slice(rows.length - half).map(function (a) { return a.ms; }));
    return {
      enough: true, n: rows.length, before: before, after: after,
      delta: after - before,
      shift: before ? (after - before) / before : 0
    };
  }

  /* Does she come apart later in a round? Tiredness and the clock both bite,
     and if accuracy falls off a cliff at word twelve then the round is too
     long rather than the letters being too hard. */
  function stamina(attempts) {
    var order = {};
    var counted = {};

    firstAttempts(attempts).forEach(function (a) {
      var seen = counted[a.round] || (counted[a.round] = {});
      if (!(a.word in seen)) seen[a.word] = Object.keys(seen).length;
      var nth = seen[a.word];

      var band = nth < 3 ? "1-3" : nth < 6 ? "4-6" : nth < 10 ? "7-10" : "11+";
      var b = order[band] || (order[band] = { band: band, n: 0, right: 0 });
      b.n += 1;
      if (a.ok) b.right += 1;
    });

    return ["1-3", "4-6", "7-10", "11+"].filter(function (band) { return order[band]; })
      .map(function (band) {
        var b = order[band];
        b.score = wilson(b.right, b.n);
        return b;
      });
  }

  /* Where in a word she goes wrong. A letter at the front of a word is a
     different job from the same letter buried in the middle. */
  function byPosition(attempts) {
    var bands = {};

    firstAttempts(attempts).forEach(function (a) {
      var band = a.hole === 0 ? "start"
               : a.hole === a.word.length - 1 ? "end" : "middle";
      var b = bands[band] || (bands[band] = { band: band, n: 0, right: 0 });
      b.n += 1;
      if (a.ok) b.right += 1;
    });

    return ["start", "middle", "end"].filter(function (k) { return bands[k]; })
      .map(function (k) { bands[k].score = wilson(bands[k].right, bands[k].n); return bands[k]; });
  }

  function byGrade(attempts) {
    var grades = {};

    firstAttempts(attempts).forEach(function (a) {
      if (a.grade === null) return;
      var b = grades[a.grade] || (grades[a.grade] = { grade: a.grade, n: 0, right: 0 });
      b.n += 1;
      if (a.ok) b.right += 1;
    });

    return Object.keys(grades).sort(function (a, b) { return a - b; })
      .map(function (g) { grades[g].score = wilson(grades[g].right, grades[g].n); return grades[g]; });
  }

  // ------------------------------------------------------------------------
  // what to do about it
  // ------------------------------------------------------------------------

  /* The top of the page: the few sentences somebody would actually act on.

     The hard part is not finding the weakest letter, it is saying how much to
     believe it. With a term's practice behind them these intervals overlap
     almost completely, and a summary that reports a ranking without saying so
     would have somebody drilling "b" all week because it came out two points
     below "d" by chance. So each line carries its numbers, and says plainly
     whether the gap is real or just the order they happened to land in.
     ---------------------------------------------------------------------- */
  function focus(model) {
    var out = [];

    var ranked = model.letters.filter(function (l) { return l.n >= MIN_FOR_RATE; });

    if (!ranked.length) {
      var have = model.firsts.length;
      return [{
        kind: "none",
        headline: "Not enough practice logged yet to point anywhere",
        detail: have
          ? have + " first tries so far, but none of the letters has reached "
            + MIN_FOR_RATE + " on its own yet. A few more rounds should do it."
          : "No attempts in this file at all. Check it is the right export."
      }];
    }

    /* Is the weakest letter actually weak, or is this just what noise looks
       like once you sort it?

       Deliberately not "worst against best". The best of a dozen noisy
       estimates is biased high by the act of picking it - some letter always
       comes out on top - so that comparison finds a gap almost every time.
       Against the pooled rest, which does not move when the ranking shuffles,
       the question is the honest one: is this letter below her own average. */
    var worst = ranked[0];
    var restRight = 0, restN = 0;
    ranked.slice(1).forEach(function (l) { restRight += l.right; restN += l.n; });

    var vsRest = restN ? difference(worst.right, worst.n, restRight, restN) : null;
    var separated = !!(vsRest && vsRest.lo > 0);
    var restRate = restN ? restRight / restN : null;

    var saidSpread = false;

    ranked.slice(0, 3).forEach(function (l, i) {
      var pull = l.partnerPull;
      var why;

      if (pull && pull.n >= MIN_FOR_RATE && pull.rate > 0.15) {
        why = "It is mostly “" + PARTNER[l.letter] + "” she reaches for instead: "
          + l.partnerTaken + " of the " + pull.n + " times a “" + PARTNER[l.letter]
          + "” was on the table.";
      } else if (l.tricky && pull && pull.n >= MIN_FOR_RATE) {
        /* True of most letters most of the time, so it is worth saying once
           and then not saying again three lines later. */
        why = saidSpread
          ? "Again no single muddle behind it."
          : "The wrong letters are spread about rather than one particular "
            + "muddle, so this looks like uncertainty about the word more than "
            + "about the letter shape.";
        saidSpread = true;
      } else {
        why = "Not enough wrong answers yet to say what she puts instead.";
      }

      out.push({
        kind: "letter",
        letter: l.letter,
        rank: i,
        headline: "“" + l.letter + "” goes in right " + pct(l.score.rate)
          + " of the time" + (i === 0 ? " — her weakest" : ""),
        detail: l.right + " of " + l.n + " first tries. Allowing for how few "
          + "that is, somewhere between " + pct(l.score.lo) + " and "
          + pct(l.score.hi) + ". " + why
          + (i === 0 && restN
              ? (separated
                  ? " That is genuinely below the " + pct(restRate)
                    + " she manages on every other letter put together, not "
                    + "just the order they landed in."
                  : " But every other letter put together comes to "
                    + pct(restRate) + ", and the two overlap — treat this "
                    + "ranking as a hint about where to look, not a finding.")
              : ""),
        score: l.score
      });
    });

    /* Anything that has actually moved. Worth its own line, because it is the
       only part of this page that answers "is what we are doing working". */
    var moved = model.letterTrends.filter(function (t) {
      return t.progress.say.sure
          || (t.bookends.enough && t.bookends.say.sure);
    });
    if (moved.length) {
      out.push({
        kind: "progress",
        headline: moved.length === 1
          ? "“" + moved[0].letter + "” " + moved[0].progress.say.moved
          : moved.length + " letters have measurably changed",
        detail: moved.map(function (t) {
          /* Prefer whichever view actually reached a verdict, and say which
             one it was - the two ask different questions. */
          var useEnds = !t.progress.say.sure && t.bookends.enough
                        && t.bookends.say.sure;
          var c = useEnds ? t.bookends.cmp : t.progress.cmp;
          return "“" + t.letter + "” " + pct(c.before.rate) + " → "
            + pct(c.after.rate) + (useEnds ? " (first and last few rounds)" : "");
        }).join(", ") + ". Where a letter is marked “first and last few "
          + "rounds”, the change shows at the ends but not across the halves — "
          + "which is what learning that happened early and then held steady "
          + "looks like.",
        trends: moved
      });
    } else {
      /* Say how far off an answer is, rather than only that there is not one
         yet. Otherwise "not enough data" reads as "this will never work". */
      var closest = null;
      model.letterTrends.forEach(function (t) {
        var c = t.progress.cmp;
        if (!c || c.delta === null) return;
        var need = sampleNeeded(c.before.rate, c.after.rate);
        if (need === null) return;
        if (!closest || need < closest.need) {
          closest = { letter: t.letter, need: need, have: Math.floor(t.progress.n / 2), cmp: c };
        }
      });

      out.push({
        kind: "progress",
        headline: "No change big enough to be sure of yet",
        detail: closest
          ? "The nearest is “" + closest.letter + "”, apparently "
            + pct(closest.cmp.before.rate) + " → " + pct(closest.cmp.after.rate)
            + ". A shift that size needs roughly " + closest.need
            + " first tries on each side of the split to call; there are about "
            + closest.have + " now."
          : "Nothing has enough attempts on both sides of the halfway split yet."
      });
    }

    /* Only words she has actually met more than once. Telling somebody to
       drill "morality" because it went wrong once on a Tuesday is worse than
       saying nothing. */
    var stubborn = model.problemWords.filter(function (w) { return w.recurring; });
    if (stubborn.length) {
      out.push({
        kind: "words",
        headline: "Words worth going back to",
        detail: stubborn.slice(0, 6).map(function (w) {
          return w.word + " (" + w.right + "/" + w.n
            + (w.worst ? ", " + w.worst : "") + ")";
        }).join(", ") + ". Each has come up in more than one round and still "
          + "gone wrong.",
        words: stubborn
      });
    } else if (model.problemWords.length) {
      out.push({
        kind: "words",
        headline: "No word has caught her twice yet",
        detail: model.problemWords.length + " words have gone wrong once, but "
          + "none has come round again and gone wrong a second time — so there "
          + "is nothing here that looks like a word rather than a moment. The "
          + "full list is below.",
        words: []
      });
    }

    var rush = model.pace.rushing;
    if (rush.enough) {
      var gap = rush.slow.rate - rush.fast.rate;
      var real = rush.cmp && rush.cmp.lo > 0;
      out.push({
        kind: "pace",
        headline: real
          ? "She is markedly worse when she answers quickly"
          : "Going fast does not seem to cost her accuracy",
        detail: "Her quickest quarter (under " + Math.round(rush.fastUnder / 100) / 10
          + "s) is " + pct(rush.fast.rate) + " right (" + rush.fast.k + "/"
          + rush.fast.n + "); her slowest quarter (over "
          + Math.round(rush.slowOver / 100) / 10 + "s) is " + pct(rush.slow.rate)
          + " (" + rush.slow.k + "/" + rush.slow.n + "). "
          + (real
              ? "Slowing her down is worth more right now than more practice."
              : gap > 0.1
                ? "The gap leans that way but is inside the noise."
                : "She is not guessing her way through."),
        score: rush.fast
      });
    }

    return out;
  }

  function pct(rate) {
    return rate === null ? "–" : Math.round(rate * 100) + "%";
  }

  // ------------------------------------------------------------------------

  function build(raw) {
    var records = decode(raw);
    var attempts = flatten(records);
    var rounds = buildRounds(records, attempts);
    var firsts = firstAttempts(attempts);

    var model = {
      records: records,
      attempts: attempts,
      firsts: firsts,
      rounds: rounds,

      span: {
        from: rounds.length ? rounds[0].at : null,
        to: rounds.length ? rounds[rounds.length - 1].at : null,
        rounds: rounds.length,
        words: records.filter(function (r) { return r.k === "word"; }).length,
        devices: Object.keys(attempts.reduce(function (set, a) {
          set[a.device] = true; return set;
        }, {})).length,
        withPool: firsts.filter(function (a) { return a.pool; }).length
      },

      overall: wilson(firsts.filter(function (a) { return a.ok; }).length, firsts.length),
      letters: letterMastery(attempts),
      /* The six she is here for, plus any other letter she has met enough
         times to say something about. The rest are a long tail of letters
         seen twice, and listing them all buries the point. */
      confusion: confusion(attempts),
      problemWords: problemWords(attempts),
      pace: pace(attempts, rounds),
      stamina: stamina(attempts),
      positions: byPosition(attempts),
      grades: byGrade(attempts),

      accuracyOverTime: overTime(attempts, rounds,
        function () { return true; },
        function (a) { return a.ok; }),

      overallProgress: progress(attempts,
        function () { return true; },
        function (a) { return a.ok; }),

      sinceTheStart: bookends(attempts, rounds,
        function () { return true; },
        function (a) { return a.ok; })
    };

    /* One trend per tricky letter, and one per confusion pair worth
       following. Built here rather than on demand so the page has nothing
       left to work out. */
    model.letterTrends = TRICKY.map(function (letter) {
      return {
        letter: letter,
        series: overTime(attempts, rounds,
          function (a) { return a.want === letter; },
          function (a) { return a.ok; }),
        progress: progress(attempts,
          function (a) { return a.want === letter; },
          function (a) { return a.ok; }),
        bookends: bookends(attempts, rounds,
          function (a) { return a.want === letter; },
          function (a) { return a.ok; })
      };
    }).filter(function (t) { return t.series.length; });

    /* A pair is only in play when the losing letter was on the table, so the
       denominator is the offers, not every sighting of the target letter.
       Without a recorded pool we cannot tell, and those attempts sit out. */
    model.pairTrends = model.confusion.pairs.filter(function (p) {
      return p.partner && p.n >= 3;
    }).map(function (p) {
      var inPlay = function (a) {
        return a.want === p.want && (!a.pool || a.pool.indexOf(p.got) >= 0);
      };
      var tookIt = function (a) { return a.got === p.got; };
      return {
        pair: p,
        series: overTime(attempts, rounds, inPlay, tookIt),
        progress: progress(attempts, inPlay, tookIt)
      };
    });

    model.listed = model.letters.filter(function (l) {
      return l.tricky || l.n >= MIN_FOR_RATE;
    });
    model.unlisted = model.letters.filter(function (l) {
      return !l.tricky && l.n < MIN_FOR_RATE;
    });

    model.focus = focus(model);
    return model;
  }

  global.Analysis = {
    build: build,
    decode: decode,
    wilson: wilson,
    difference: difference,
    verdict: verdict,
    sampleNeeded: sampleNeeded,
    median: median,
    spread: spread,
    pct: pct,
    TRICKY: TRICKY,
    PARTNER: PARTNER,
    MIN_FOR_RATE: MIN_FOR_RATE,
    MIN_FOR_TREND: MIN_FOR_TREND,
    MIN_PER_HALF: MIN_PER_HALF,
    MAX_POINTS: MAX_POINTS,
    FAST_QUARTILE: FAST_QUARTILE
  };
})(typeof window !== "undefined" ? window : globalThis);
