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
   queue once Firestore has actually acknowledged them.

   Uploading goes straight to Firestore's REST API - no server, no endpoint to
   stand up, and no Firebase SDK, which would be a hundred kilobytes of
   dependency used once a round by a game that is otherwise entirely offline.
   The only thing that ever ships is this file, through the same build as the
   rest of the site.

   Nothing in here may ever break the game. Every entry point swallows its
   own errors: a full disk or a blocked cookie jar costs a log line, not a
   round.
   ========================================================================== */

(function (global) {
  "use strict";

  var QUEUE_KEY = "cooper.logbook.v1";
  var DEVICE_KEY = "cooper.logbook.device";

  /* Counts every record this device has ever made. It has to outlive the
     queue, because the queue drains: device + n is what makes a re-sent batch
     land on the documents it already wrote instead of duplicating them. */
  var SEQ_KEY = "cooper.logbook.seq";

  /* ----------------------------------------------------------------------
     Where the logs go. Both of these are safe to have in a public repository:
     Google documents the browser config as non-secret. They name the project;
     they do not grant anything. The security boundary is entirely the
     Firestore rules, which are in firestore.rules next to this file - create
     and update only, shape checked, no reading anything back.

     Empty either one and nothing is ever uploaded - the log still collects
     locally and the download button still works, which is how this behaves
     for anyone who clones the repo and points it at their own project.
     ---------------------------------------------------------------------- */
  var PROJECT_ID = "cooper-spelling";
  var API_KEY = "AIzaSyCFabIJPnpzG8ZxGqtE5xK851i5em5gzCc";
  var COLLECTION = "logs";

  /* About 300 KB of records at roughly 250 bytes each, well inside the 5 MB
     localStorage gives us, and months of play. Oldest go first if it ever
     fills: recent history is the interesting history. */
  var MAX_RECORDS = 1200;

  /* Upload in batches so one bad round cannot wedge the whole queue. */
  var BATCH = 60;

  var queue = [];
  var device = "";
  var seq = 0;
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
    record.n = ++seq;
    write(SEQ_KEY, String(seq));

    queue.push(record);
    save();
  }

  /* Firestore does not take plain JSON. Every value has to say what type it
     is - {"stringValue": "cat"} rather than "cat" - so this walks a record
     and puts the labels on. */
  function encode(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };

    if (typeof v === "number") {
      if (!isFinite(v)) return { nullValue: null };
      // Integers go as strings: Firestore's integerValue is a 64 bit type and
      // JSON numbers cannot carry one safely.
      return v % 1 === 0
        ? { integerValue: String(v) }
        : { doubleValue: v };
    }

    if (Array.isArray(v)) {
      var values = [];
      for (var i = 0; i < v.length; i++) values.push(encode(v[i]));
      return { arrayValue: { values: values } };
    }

    if (typeof v === "object") return { mapValue: { fields: encodeFields(v) } };
    return { stringValue: String(v) };
  }

  function encodeFields(obj) {
    var out = {};
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        out[key] = encode(obj[key]);
      }
    }
    return out;
  }

  /* The document a record belongs in. Deterministic on purpose: if an upload
     lands but the reply is lost on the way back, the retry writes over the
     same documents rather than a second copy of them. */
  function documentPath(record) {
    return "projects/" + PROJECT_ID + "/databases/(default)/documents/" +
           COLLECTION + "/" + record.d + "_" + record.n;
  }

  function makeId(prefix) {
    return prefix + Math.random().toString(36).slice(2, 10);
  }

  var Logbook = {
    /* Recording happens whatever: it is local, it is small, and it is what
       the download button has to offer. Uploading is the part with a switch
       on it, under Settings. */
    enabled: true,
    uploading: true,

    init: function () {
      try {
        queue = JSON.parse(read(QUEUE_KEY) || "[]");
        if (!Array.isArray(queue)) queue = [];
      } catch (err) {
        queue = [];
      }

      seq = parseInt(read(SEQ_KEY), 10) || 0;
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

    /* Send what we can, as one atomic commit. Records stay in the queue until
       Firestore has said it has them, so a failed upload costs a retry and
       nothing else. */
    flush: function () {
      if (!this.uploading || !PROJECT_ID || !API_KEY) return;
      if (sending || !queue.length) return;
      if (global.navigator && global.navigator.onLine === false) return;
      if (typeof global.fetch !== "function") return;

      sending = true;
      var batch = queue.slice(0, BATCH);

      var writes = [];
      for (var i = 0; i < batch.length; i++) {
        writes.push({
          update: {
            name: documentPath(batch[i]),
            fields: encodeFields(batch[i])
          }
        });
      }

      // One commit for the whole batch: it either all lands or none of it
      // does, so there is never a half-written batch to reason about.
      global.fetch(
        "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID +
        "/databases/(default)/documents:commit?key=" + encodeURIComponent(API_KEY),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ writes: writes })
        }
      ).then(function (response) {
        sending = false;
        if (!response || !response.ok) return;

        queue = queue.slice(batch.length);
        save();
        if (queue.length) Logbook.flush();
      })["catch"](function () {
        // Offline, blocked, or misconfigured. Try again next time.
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

    /* Exposed for the tests, and for checking a fresh install is pointed
       somewhere before wondering why nothing is arriving. */
    target: function () {
      return PROJECT_ID ? PROJECT_ID + "/" + COLLECTION : "";
    },

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
