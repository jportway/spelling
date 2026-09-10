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

  /* What happened last time we tried to send, kept so that Settings can show
     it. Uploading used to fail in complete silence: the queue simply grew and
     there was no way, short of a laptop and a debugger, to tell whether
     anything was arriving. On a child's iPad that is not a diagnosis anybody
     is going to make. */
  var STATUS_KEY = "cooper.logbook.status";

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

  /* A round ending is the main trigger. This is the safety net: without it a
     failure at the end of a round would sit until the end of the next one. */
  var RETRY_MS = 4 * 60 * 1000;

  var queue = [];
  var device = "";
  var seq = 0;
  var round = null;
  var current = null;   // the word in progress
  var lastAt = 0;
  var sending = false;
  var lastTry = null;
  var repaired = 0;
  var dropped = 0;

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

  function noteTry(result) {
    result.at = Date.now();
    lastTry = result;
    write(STATUS_KEY, JSON.stringify(result));
    return result;
  }

  /* Firestore's own words are accurate but not much help on a tablet, so each
     failure gets a sentence saying what to do about it. */
  function describe(code, body) {
    var detail = "";
    try {
      var parsed = JSON.parse(body);
      detail = (parsed.error && parsed.error.message) || "";
    } catch (err) { /* not JSON; the code alone will have to do */ }

    if (code === 0)   return "Could not reach Firestore - no network, or something is blocking it.";
    if (code === 403) return "Firestore refused it. Usually the rules: check firestore.rules is published.";
    if (code === 401) return "The key was rejected.";
    if (code === 400) return "Firestore rejected the shape of a record. " + detail;
    if (code === 429) return "Over the free daily quota. It will go through tomorrow.";
    return "Firestore answered " + code + ". " + detail;
  }

  function settled(value) {
    return global.Promise ? global.Promise.resolve(value) : null;
  }

  /* Does this record stand a chance of being accepted?

     A local echo of the essentials in firestore.rules. It exists because the
     commit is atomic: one record the rules will not have poisons the whole
     batch, and if that record is at the head of the queue it poisons every
     batch after it too, for ever. Being able to tell which record is the
     problem is what turns a permanently wedged queue into a dropped line. */
  function sendable(record) {
    if (!record || typeof record !== "object") return false;
    if (typeof record.d !== "string" || record.d.length < 3 || record.d.length > 24) return false;
    if (typeof record.n !== "number" || record.n % 1 !== 0 || record.n <= 0) return false;
    if (typeof record.t !== "number" || !isFinite(record.t)) return false;
    if (typeof record.k !== "string" || record.k.length > 24) return false;

    var keys = 0;
    for (var key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) keys++;
    }
    if (keys > 16) return false;

    if ("w" in record && (typeof record.w !== "string" || record.w.length > 32)) return false;
    if ("h" in record && (!Array.isArray(record.h) || record.h.length > 16)) return false;
    if ("p" in record && (!Array.isArray(record.p) || record.p.length > 16)) return false;
    if ("tries" in record && (!Array.isArray(record.tries) || record.tries.length > 200)) return false;
    return true;
  }

  /* Records written before sequence numbers existed have no `n`, so they can
     never satisfy the rules and - because the commit is atomic - they stop
     everything behind them getting out too. Anybody who played the version
     before this one has a queue with some of these at the front of it.

     Giving them a number now costs nothing: they are the oldest records this
     device has, so numbering them below whatever comes next keeps the order
     right and cannot collide. */
  function migrate() {
    var repaired = 0;

    for (var i = 0; i < queue.length; i++) {
      var record = queue[i];
      if (!record || typeof record !== "object") continue;

      if (!record.d) record.d = device;
      if (typeof record.n !== "number" || record.n <= 0) {
        record.n = ++seq;
        repaired++;
      }
    }

    if (repaired) {
      write(SEQ_KEY, String(seq));
      save();
    }
    return repaired;
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

      repaired = migrate();

      try {
        lastTry = JSON.parse(read(STATUS_KEY) || "null");
      } catch (err) {
        lastTry = null;
      }

      // Anything left over from last time goes as soon as there is a network.
      global.addEventListener("online", function () { Logbook.flush(); });

      /* And keep trying while the page is open, so a blip at the end of one
         round does not wait for the end of the next. */
      global.setInterval(function () { Logbook.flush(); }, RETRY_MS);

      this.flush();
    },

    startRound: function (meta) {
      if (!this.enabled) return;
      round = makeId("r_");
      current = null;
      push({ k: "round-start", minutes: meta.minutes, game: "missing" });
    },

    /* A word has appeared and the clock on her thinking starts now.

       `p` is the letters she was offered. Without it a count of "she put d
       where a b belonged" measures the game as much as it measures her: the
       generator puts the partner in the pool about nine times in ten when the
       missing letter is tricky, so a raw substitution rate is conditional on
       an offer that is not always made. With the pool recorded, the rate can
       be worked out over the times the wrong letter was actually there to
       pick. */
    word: function (info) {
      if (!this.enabled) return;
      current = {
        k: "word",
        w: info.word,
        g: info.grade,
        lv: info.level,
        h: info.holes.slice(),
        p: (info.pool || []).slice(),
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
       nothing else.

       Returns a promise describing what happened, so that Settings can show
       it and the "Send now" button can report a result rather than leaving
       somebody watching a number that does not move. */
    flush: function () {
      if (!this.uploading)
        return settled({ ok: null, why: "Uploading is switched off." });
      if (!PROJECT_ID || !API_KEY)
        return settled({ ok: null, why: "No Firestore project is configured." });
      if (sending)
        return settled({ ok: null, why: "Already sending." });
      if (!queue.length)
        return settled({ ok: null, why: "Nothing waiting to send." });
      if (global.navigator && global.navigator.onLine === false)
        return settled({ ok: null, why: "This device says it is offline." });
      if (typeof global.fetch !== "function")
        return settled({ ok: null, why: "This browser cannot upload." });

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
      return global.fetch(
        "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID +
        "/databases/(default)/documents:commit?key=" + encodeURIComponent(API_KEY),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ writes: writes })
        }
      ).then(function (response) {
        return response.text().then(function (body) {
          return { response: response, body: body };
        }, function () {
          return { response: response, body: "" };
        });
      }).then(function (result) {
        sending = false;

        if (!result.response.ok) {
          /* Refused. If some of this batch could never have been accepted,
             take those out and go again, so one bad record cannot hold the
             whole queue hostage. Only records the local check can prove are
             unsendable get dropped - anything else is a problem with the
             rules or the configuration, and dropping data over that would be
             hiding the fault rather than fixing it. */
          if (result.response.status === 400 || result.response.status === 403) {
            var bad = batch.filter(function (record) { return !sendable(record); });

            if (bad.length) {
              queue = queue.filter(function (record) {
                return bad.indexOf(record) < 0;
              });
              dropped += bad.length;
              save();
              return Logbook.flush();
            }
          }

          return noteTry({
            ok: false, sent: 0, code: result.response.status,
            why: describe(result.response.status, result.body)
          });
        }

        queue = queue.slice(batch.length);
        save();
        var done = noteTry({
          ok: true, sent: batch.length, code: 200, why: "",
          repaired: repaired, dropped: dropped
        });

        // More waiting? Keep going, and report the last outcome.
        return queue.length ? Logbook.flush() : done;
      })["catch"](function (err) {
        sending = false;
        return noteTry({
          ok: false, sent: 0, code: 0,
          why: describe(0, ""),
          detail: String((err && err.message) || err)
        });
      });
    },

    /* Everything Settings needs to say whether this is working. */
    status: function () {
      return {
        pending: queue.length,
        uploading: this.uploading,
        target: PROJECT_ID ? PROJECT_ID + "/" + COLLECTION : "",
        device: device,
        repaired: repaired,
        dropped: dropped,
        last: lastTry
      };
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
