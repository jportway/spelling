/* ==========================================================================
   logbook.js — what actually happened, so it can be looked at later.

   One record per word: which word, which letters were taken out, and every
   letter she tried at which hole, with how long she thought about it.

   Deliberately raw. Whether an attempt was right, and whether a wrong one
   was the b-for-d muddle rather than something else, are both worked out
   from the word and the position when the log is read - not decided here.
   Writing "this was a b/d error" into the record would bake in an opinion
   about what counts as a mistake, and quietly hide any pattern that opinion
   did not anticipate. The word and the position are enough to recover all of
   it later, and to ask questions nobody has thought of yet.

   Storage is local first and always. The queue in localStorage is the real
   copy; uploading is a drain on it, not a destination, which is what makes
   an iPad on a train work exactly like one at home. Records only leave the
   queue once a server has actually acknowledged them.

   Nothing in here may ever break the game. Every entry point swallows its
   own errors: a full disk or a blocked cookie jar costs a log line, not a
   round.
   ========================================================================== */

(function (global) {
  "use strict";

  var QUEUE_KEY = "cooper.logbook.v1";
  var DEVICE_KEY = "cooper.logbook.device";

  /* Where to send them. Deliberately not in this file: the site is public, so
     a URL committed here would be an open endpoint for anyone who found it.
     It is pasted in once on her iPad instead, from Settings, and lives only
     in that browser. */
  var ENDPOINT_KEY = "cooper.logbook.endpoint";

  /* About 300 KB of records at roughly 250 bytes each, well inside the 5 MB
     localStorage gives us, and months of play. Oldest go first if it ever
     fills: recent history is the interesting history. */
  var MAX_RECORDS = 1200;

  /* Upload in batches so one bad round cannot wedge the whole queue. */
  var BATCH = 60;

  var queue = [];
  var device = "";
  var round = null;
  var current = null;   // the word in progress
  var lastAt = 0;
  var sending = false;

  function now() {
    return global.performance && global.performance.now
      ? global.performance.now() : Date.now();
  }

  function read(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function write(key, value) {
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      return false;
    }
  }

  function save() {
    if (queue.length > MAX_RECORDS) queue = queue.slice(queue.length - MAX_RECORDS);
    if (write(QUEUE_KEY, JSON.stringify(queue))) return;

    // Out of room. Halve it and try once more rather than losing the lot.
    queue = queue.slice(Math.floor(queue.length / 2));
    write(QUEUE_KEY, JSON.stringify(queue));
  }

  function push(record) {
    record.d = device;
    record.r = round;
    record.t = Date.now();
    queue.push(record);
    save();
  }

  function makeId(prefix) {
    return prefix + Math.random().toString(36).slice(2, 10);
  }

  var Logbook = {
    enabled: true,

    init: function () {
      try {
        queue = JSON.parse(read(QUEUE_KEY) || "[]");
        if (!Array.isArray(queue)) queue = [];
      } catch (err) {
        queue = [];
      }

      device = read(DEVICE_KEY) || "";
      if (!device) {
        // A random id for the iPad, so rounds can be told apart. Not her
        // name, and nothing that identifies a person.
        device = makeId("d_");
        write(DEVICE_KEY, device);
      }

      // Anything left over from last time goes as soon as there is a network.
      global.addEventListener("online", function () { Logbook.flush(); });
      this.flush();
    },

    endpoint: function (url) {
      if (url === undefined) return read(ENDPOINT_KEY) || "";
      if (url) write(ENDPOINT_KEY, url);
      else {
        try {
          global.localStorage.removeItem(ENDPOINT_KEY);
        } catch (err) { /* nothing to do */ }
      }
      return url || "";
    },

    startRound: function (meta) {
      if (!this.enabled) return;
      round = makeId("r_");
      current = null;
      push({ k: "round-start", minutes: meta.minutes, game: "missing" });
    },

    /* A word has appeared and the clock on her thinking starts now. */
    word: function (info) {
      if (!this.enabled) return;
      current = {
        k: "word",
        w: info.word,
        g: info.grade,
        lv: info.level,
        h: info.holes.slice(),
        tries: []
      };
      lastAt = now();
    },

    /* One letter, into one hole.

       `hole` is the position in the word, not which gap it was in the queue,
       so a word with two letters missing says exactly which one she was
       filling. `ms` is how long she took over this particular choice: since
       the word appeared for her first attempt, and since her previous
       attempt after that.

       Whether it was right is not stored. It is `letter === word[hole]`, and
       leaving it out keeps the record to what actually happened. */
    attempt: function (info) {
      if (!this.enabled || !current) return;

      var at = now();
      current.tries.push({
        hole: info.hole,
        got: info.letter,
        ms: Math.round(at - lastAt)
      });
      lastAt = at;
    },

    endWord: function (info) {
      if (!this.enabled || !current) return;
      current.solved = !!info.solved;
      current.skipped = !!info.skipped;
      current.puffs = info.puffs || 0;
      push(current);
      current = null;
    },

    endRound: function (summary) {
      if (!this.enabled) return;
      push({
        k: "round-end",
        words: summary.words,
        firstGo: summary.firstGo,
        tricky: summary.tricky,
        fill: summary.fill,
        popped: !!summary.popped
      });
      current = null;
      this.flush();
    },

    /* Send what we can. Records stay in the queue until a server has said it
       has them, so a failed upload costs nothing but a retry. */
    flush: function () {
      var url = this.endpoint();
      if (!url || sending || !queue.length) return;
      if (global.navigator && global.navigator.onLine === false) return;
      if (typeof global.fetch !== "function") return;

      sending = true;
      var batch = queue.slice(0, BATCH);

      // text/plain on purpose: anything else triggers a CORS preflight, and
      // a Google Apps Script web app redirects, which preflight will not
      // follow. This is the one content type that gets through.
      global.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ v: 1, device: device, records: batch })
      }).then(function (response) {
        sending = false;
        if (!response || !response.ok) return;

        queue = queue.slice(batch.length);
        save();
        if (queue.length) Logbook.flush();
      })["catch"](function () {
        // Offline, blocked, or the endpoint is wrong. Try again next time.
        sending = false;
      });
    },

    /* Everything, as a file, for when there is no endpoint at all - which is
       the state this ships in. */
    download: function () {
      var blob = new global.Blob([JSON.stringify(queue, null, 1)],
                                 { type: "application/json" });
      var url = global.URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "coopers-logbook-" +
        new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
    },

    pending: function () {
      return queue.length;
    },

    /* Exposed for the tests. */
    peek: function () {
      return queue.slice();
    },

    clear: function () {
      queue = [];
      save();
    }
  };

  global.Logbook = Logbook;
})(window);
