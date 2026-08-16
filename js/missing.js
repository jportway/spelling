/* ==========================================================================
   missing.js — the round, for the missing-letters game.

   A word appears with a hole in it and gets read out, meaning and all. She
   drags the letter that belongs in the hole. The right one locks in and goes
   green; the wrong one tips over and falls back into the pile.

   Most of the time the hole wants one of b, d, p, q, n or m, and most of the
   time the letter it is muddled with is sitting right there in the pile — so
   the game keeps asking the one question that is actually hard, over and
   over, in a form where getting it wrong costs nothing.
   ========================================================================== */

(function (global) {
  "use strict";

  var PLAYER = "Cooper";
  var NAMES = [PLAYER, "Meeps", "Meepsie"];
  var NAME_CHANCE = 0.45;

  /* Points by word length, plus what she earns for the hard parts. Getting
     it first go is worth as much as two extra letters: this game is about
     stopping to look, not about speed. */
  var POINTS = [0, 0, 0, 10, 14, 20, 28, 38, 50];
  var TRICKY_BONUS = 8;
  var CLEAN_BONUS = 10;

  /* How long the finished word stays up before the next one, in
     milliseconds. Long enough to enjoy, short enough not to lose her. */
  var ADVANCE_MS = 1750;
  var ADVANCE_BIG_MS = 2200;

  /* How long the wrong letter sits in the hole before it falls out. Dragging
     is off for exactly this long, so a tile cannot be grabbed halfway
     through being put back. */
  var SETTLE_MS = 440;

  /* How far the writing line pokes out past each end of the word. Matches
     the offset in missing.css, and has to be allowed for when working out
     whether the word fits. */
  var RULE_OVERHANG = 10;

  var PRAISE = [
    "Yes!", "Brilliant!", "Nice one!", "Great work!", "You got it!",
    "Lovely!", "Clever!", "Spot on!", "Well looked!", "That's the one!",
    "Perfect!", "Clever girl!"
  ];
  var BIG_PRAISE = [
    "Wow!", "Amazing!", "Incredible!", "Look at that!", "Brilliant work!",
    "What a word!"
  ];

  var STORE_KEY = "missingletters.v1";
  var SETTINGS_KEY = "cooper.settings.v1";

  var DEFAULT_SETTINGS = {
    autoSay: true,
    speakDefinitions: true,
    letterHelper: true,
    kitten: true,
    sound: true,
    calm: false
  };

  var dom = {};
  var settings = Object.assign({}, DEFAULT_SETTINGS);
  var records = { best: 0, collection: [] };

  var state = {
    running: false,
    paused: false,
    minutes: 5,
    secondsLeft: 0,
    score: 0,

    level: 0,        // 0-5, see puzzle.js
    cleanRun: 0,     // consecutive first-go answers, for the ladder

    puzzle: null,
    holes: [],       // [{ at, letter, el, filled }]
    pool: [],        // [{ id, letter, el, slotEl, used }]
    picked: 0,       // which hole a tapped letter goes into
    misses: 0,       // wrong letters tried on this word

    solved: [],
    used: null,      // words already asked this round
    firstTime: 0,
    trickyFixed: 0,
    wobbly: null,    // "bd" -> how many times that pair went wrong

    ticker: null,
    advance: null,
    settleTimer: null,
    settling: false
  };

  // ------------------------------------------------------------------------
  // storage
  // ------------------------------------------------------------------------

  function loadStore() {
    try {
      var saved = JSON.parse(global.localStorage.getItem(STORE_KEY) || "{}");
      if (saved.records) {
        records.best = saved.records.best || 0;
        records.collection = saved.records.collection || [];
      }
      // Settings are shared with the word game, so the sound switch is the
      // same switch on both pages.
      var shared = global.localStorage.getItem(SETTINGS_KEY);
      if (shared) Object.assign(settings, JSON.parse(shared));
    } catch (err) {
      /* A blocked or corrupt localStorage must not stop her playing. */
    }
    if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      settings.calm = true;
    }
  }

  function saveStore() {
    try {
      global.localStorage.setItem(STORE_KEY, JSON.stringify({ records: records }));

      // Merge rather than overwrite: the word game keeps its own switches in
      // here too, and they are none of this page's business.
      var shared = {};
      try {
        shared = JSON.parse(global.localStorage.getItem(SETTINGS_KEY) || "{}");
      } catch (err) {
        shared = {};
      }
      global.localStorage.setItem(SETTINGS_KEY,
        JSON.stringify(Object.assign(shared, settings)));
    } catch (err) {
      /* Not worth interrupting the game over. */
    }
  }

  // ------------------------------------------------------------------------
  // small helpers
  // ------------------------------------------------------------------------

  function byId(id) {
    return document.getElementById(id);
  }

  function pick(list) {
    return list[(Math.random() * list.length) | 0];
  }

  function cap(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function overlayOpen() {
    return !!document.querySelector(".overlay.is-open");
  }

  function coloured(letter) {
    var cls = global.Letters.colourClass(letter);
    return "<strong" + (cls ? " class=\"" + cls + "\"" : "") + ">" + letter + "</strong>";
  }

  function spoken(letter) {
    return global.Letters.spokenName(letter);
  }

  // ------------------------------------------------------------------------
  // tiles
  // ------------------------------------------------------------------------

  function makeTile(letter, id) {
    var el = document.createElement("div");
    el.className = "tile";
    el.setAttribute("data-id", String(id));
    el.setAttribute("data-letter", letter);
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "-1");
    el.setAttribute("aria-label", "letter " + letter);

    var glyph = document.createElement("span");
    glyph.className = "tile-letter";
    glyph.textContent = letter;
    el.appendChild(glyph);

    if (global.Letters.isTricky(letter)) {
      el.classList.add("is-tricky", global.Letters.colourClass(letter));
    }
    return el;
  }

  function applyLetterHelper() {
    for (var i = 0; i < state.pool.length; i++) {
      var tile = state.pool[i];
      if (!global.Letters.isTricky(tile.letter)) continue;

      var existing = tile.el.querySelector(".tile-cue");
      if (settings.letterHelper && !existing) {
        tile.el.appendChild(global.Letters.cue(tile.letter));
        tile.el.classList.add("has-helper");
      } else if (!settings.letterHelper && existing) {
        existing.remove();
        tile.el.classList.remove("has-helper");
      }
    }
  }

  function poolById(id) {
    for (var i = 0; i < state.pool.length; i++) {
      if (state.pool[i].id === id) return state.pool[i];
    }
    return null;
  }

  // ------------------------------------------------------------------------
  // drawing the word and the pile
  // ------------------------------------------------------------------------

  function renderWord() {
    var word = state.puzzle.word;
    var i;

    dom.wordLine.innerHTML = "";
    state.holes = [];

    // Shrink-wrapped around the word so the writing line drawn under it is
    // the width of the word, not the width of the box.
    var inner = document.createElement("span");
    inner.className = "word-inner";

    for (i = 0; i < word.length; i++) {
      var letter = word[i];
      var cell = document.createElement("span");
      cell.className = "wcell";

      if (state.puzzle.holes.indexOf(i) === -1) {
        // A letter she can already see. The six keep their colour, so the
        // word on screen and the tiles in the pile speak the same language.
        if (global.Letters.isTricky(letter)) {
          cell.classList.add("is-tricky", global.Letters.colourClass(letter));
        }
        cell.textContent = letter;
      } else {
        var hole = document.createElement("span");
        // The index is the hole's place in the queue, not in the word:
        // dragdrop hands this straight back and state.holes is in the same
        // order.
        hole.setAttribute("data-index", String(state.holes.length));
        hole.className = "hole";
        cell.appendChild(hole);
        state.holes.push({ at: i, letter: letter, el: hole, filled: false });
      }

      inner.appendChild(cell);
    }
    dom.wordLine.appendChild(inner);

    dom.wordLine.setAttribute("aria-label",
      "Finish the word: " + word.split("").map(function (ch, at) {
        return state.puzzle.holes.indexOf(at) === -1 ? ch : "blank";
      }).join(" "));

    paintPicked();
    fitWord();
  }

  /* Shrink the word until it fits on one line.

     Eight letters at full size do not fit across a phone held upright, and a
     word split over two lines has nowhere sensible to draw the writing line
     — which is the one piece of furniture the b/d/p/q lesson depends on.
     Measuring is exact rather than a guess: a cell is one --word-tile wide
     and the gap between them is knowable, so this never lays out twice. */
  function fitWord() {
    var inner = dom.wordLine.querySelector(".word-inner");
    if (!inner || !state.puzzle) return;

    dom.wordLine.style.removeProperty("--word-tile");

    // Measured off a real cell rather than read from --word-tile: a custom
    // property holding a clamp() computes to the clamp() itself, and only
    // turns into pixels where it is finally used.
    var cell = inner.querySelector(".wcell");
    var full = cell ? cell.getBoundingClientRect().width : 0;

    var rowStyle = global.getComputedStyle(dom.wordLine);
    var gap = parseFloat(global.getComputedStyle(inner).columnGap) || 0;
    var count = state.puzzle.word.length;
    if (!full || !count) return;

    var room = dom.wordLine.clientWidth -
               parseFloat(rowStyle.paddingLeft) -
               parseFloat(rowStyle.paddingRight) -
               RULE_OVERHANG * 2;
    var wanted = count * full + (count - 1) * gap;

    if (room > 0 && wanted > room) {
      var scaled = (room - (count - 1) * gap) / count;
      dom.wordLine.style.setProperty("--word-tile", Math.max(scaled, 20) + "px");
    }
    checkWrap();
  }

  /* Belt and braces. fitWord should have made this impossible, but a font
     that loads late or a stylesheet that does not could still wrap the word,
     and a writing line drawn under half of it looks broken. */
  function checkWrap() {
    var cells = dom.wordLine.querySelectorAll(".wcell");
    var wrapped = false;

    if (cells.length > 1) {
      var top = cells[0].getBoundingClientRect().top;
      for (var i = 1; i < cells.length; i++) {
        if (Math.abs(cells[i].getBoundingClientRect().top - top) > 2) {
          wrapped = true;
          break;
        }
      }
    }
    dom.wordLine.classList.toggle("is-wrapped", wrapped);
  }

  function renderPool() {
    dom.pool.innerHTML = "";
    state.pool = [];

    for (var i = 0; i < state.puzzle.pool.length; i++) {
      var letter = state.puzzle.pool[i];

      var slot = document.createElement("div");
      slot.className = "slot";

      var el = makeTile(letter, i);
      slot.appendChild(el);
      dom.pool.appendChild(slot);

      state.pool.push({ id: i, letter: letter, el: el, slotEl: slot, used: false });
    }
    applyLetterHelper();
  }

  function openHoles() {
    var open = [];
    for (var i = 0; i < state.holes.length; i++) {
      if (!state.holes[i].filled) open.push(i);
    }
    return open;
  }

  /* Which hole a tapped letter drops into. Only worth showing when there is
     more than one to choose between. */
  function paintPicked() {
    var open = openHoles();
    if (open.indexOf(state.picked) === -1) state.picked = open.length ? open[0] : 0;

    for (var i = 0; i < state.holes.length; i++) {
      state.holes[i].el.classList.toggle(
        "is-picked", open.length > 1 && i === state.picked
      );
    }
  }

  // ------------------------------------------------------------------------
  // messages
  // ------------------------------------------------------------------------

  function showMessage(html, tone) {
    dom.message.innerHTML = html;
    dom.message.className = "message is-shown" + (tone ? " is-" + tone : "");
    void dom.message.offsetWidth;
    dom.message.classList.add("is-shown");
  }

  function clearMessage() {
    if (dom.message.textContent) {
      dom.message.textContent = "";
      dom.message.className = "message";
    }
  }

  // ------------------------------------------------------------------------
  // putting a letter in a hole
  // ------------------------------------------------------------------------

  function finishSettle() {
    if (!state.settling) return;
    global.clearTimeout(state.settleTimer);
    state.settling = false;

    // Whichever tile was mid-fall goes home now, wherever it had got to.
    for (var i = 0; i < state.pool.length; i++) {
      var item = state.pool[i];
      if (item.used || item.el.parentElement === item.slotEl) continue;
      item.el.classList.remove("is-rejected");
      item.slotEl.appendChild(item.el);
    }
  }

  function sendHome(item, ghostRect) {
    if (item.el.parentElement !== item.slotEl) {
      item.slotEl.appendChild(item.el);
    }
    global.DragDrop.flyFrom(item.el, ghostRect);
  }

  function lockIn(item, hole, ghostRect) {
    hole.filled = true;
    hole.el.classList.add("is-filled");
    hole.el.classList.remove("is-picked", "is-active");
    hole.el.appendChild(item.el);
    item.el.classList.add("is-right");

    item.used = true;
    item.slotEl.classList.add("is-used");

    global.DragDrop.flyFrom(item.el, ghostRect);
    global.Sound.place();
    global.Kitten.watch(hole.el);

    clearHints();
    paintPicked();

    if (!openHoles().length) {
      solve();
      return;
    }

    global.Kitten.setState("close");
    showMessage("Yes! One more to find…", "good");
  }

  /* The word her choice would have spelled, with the other holes assumed
     right. Used to tell her when a wrong letter is still a real word, which
     happens constantly with b and d and is worth saying out loud. */
  function wordWith(hole, letter) {
    var word = state.puzzle.word;
    return word.slice(0, hole.at) + letter + word.slice(hole.at + 1);
  }

  function noteWobble(right, wrong) {
    var key = [right, wrong].sort().join("");
    state.wobbly.set(key, (state.wobbly.get(key) || 0) + 1);
  }

  /* Document-wide, not just the pile: a hinted tile she then drops into a
     hole takes the class with it, and a locked-in answer that carries on
     pulsing looks like the game is still asking. */
  function clearHints() {
    var hinted = document.querySelectorAll(".tile.is-hinted");
    for (var i = 0; i < hinted.length; i++) hinted[i].classList.remove("is-hinted");
  }

  /* After a second miss, lift the right letter and the one it is muddled
     with out of the pile — without saying which is which. Narrowing six
     choices to two is a scaffold; telling her the answer is not. */
  function highlightCandidates(hole) {
    var wanted = [hole.letter];
    var partner = global.Letters.partnerOf(hole.letter);
    if (partner) wanted.push(partner);

    clearHints();
    for (var i = 0; i < state.pool.length; i++) {
      var item = state.pool[i];
      if (item.used || wanted.indexOf(item.letter) === -1) continue;
      void item.el.offsetWidth;
      item.el.classList.add("is-hinted");
    }
    global.setTimeout(clearHints, 3400);
  }

  /* The heart of it. She has picked the wrong letter — which wrong letter,
     and why, is the whole lesson. */
  function explainMiss(wrong, hole) {
    var right = hole.letter;
    var word = state.puzzle.word;

    if (global.Letters.partnerOf(right) === wrong) {
      // The exact mix-up this game exists for. Name the shape she chose,
      // then ask the question that separates the two — never which one is
      // right, or there is nothing left for her to work out.
      var info = global.Letters.info(wrong);
      var question = info.humps
        ? "how many humps does this one need?"
        : "which side should the ball be on?";

      noteWobble(right, wrong);
      showMessage(
        "That one's a " + coloured(wrong) + " &mdash; " + info.hint +
        ". Listen again: <strong>" + word + "</strong>. " + cap(question),
        "nudge"
      );
      global.Speech.say(
        "That's a " + spoken(wrong) + ". " + cap(info.hint) + ". " +
        "Listen again. " + word + ". " + cap(question),
        { rate: 0.9 }
      );
      return;
    }

    var attempt = wordWith(hole, wrong);
    if (global.Dictionary.has(attempt) && attempt !== word) {
      showMessage(
        "That spells <strong>" + attempt + "</strong> &mdash; a real word! " +
        "But we want <strong>" + word + "</strong>.",
        "nudge"
      );
      global.Speech.say(
        "That spells " + attempt + ". A real word, but we want " + word + ".",
        { rate: 0.92 }
      );
      return;
    }

    showMessage(
      "Not that one. The word is <strong>" + word + "</strong> &mdash; have another go!",
      "nudge"
    );
    global.Speech.say("Not that one. The word is " + word + ".", { rate: 0.92 });
  }

  function rejectDrop(item, hole) {
    state.misses++;

    // Show it sitting in the hole first: she needs to see the letter she
    // actually chose, in place, before it goes anywhere.
    hole.el.appendChild(item.el);
    item.el.classList.remove("is-rejected");
    void item.el.offsetWidth;
    item.el.classList.add("is-rejected");

    global.Sound.nudge();
    global.Kitten.react("nudge");
    explainMiss(item.letter, hole);

    if (state.misses === 2) highlightCandidates(hole);
    if (state.misses === 5) {
      showMessage(
        "Still tricky? Tap <strong>Skip</strong> and we'll find you another one.",
        "nudge"
      );
    }

    state.settling = true;
    global.clearTimeout(state.settleTimer);
    state.settleTimer = global.setTimeout(function () {
      state.settling = false;
      if (item.used) return;

      var box = item.el.getBoundingClientRect();
      item.el.classList.remove("is-rejected");
      item.slotEl.appendChild(item.el);
      global.DragDrop.flyFrom(item.el, box);
    }, SETTLE_MS);
  }

  function tryDrop(item, holeIndex, ghostRect) {
    var hole = state.holes[holeIndex];
    if (!hole || hole.filled || item.used) {
      sendHome(item, ghostRect);
      return;
    }

    if (item.letter === hole.letter) lockIn(item, hole, ghostRect);
    else rejectDrop(item, hole);
  }

  // ------------------------------------------------------------------------
  // finishing a word
  // ------------------------------------------------------------------------

  function cheerFor(big) {
    var cheer = pick(big ? BIG_PRAISE : PRAISE);
    if (Math.random() > NAME_CHANCE) return cheer;
    return cheer.replace(/[!.]+$/, "") + ", " + pick(NAMES) + "!";
  }

  function updateScore() {
    dom.scoreValue.textContent = state.score;
    dom.scoreValue.classList.remove("is-bumped");
    void dom.scoreValue.offsetWidth;
    dom.scoreValue.classList.add("is-bumped");
  }

  function addSolvedChip(word, points) {
    dom.foundCount.textContent = String(state.solved.length);

    var item = document.createElement("li");
    var button = document.createElement("button");
    button.type = "button";
    button.className = "found-word is-new";
    button.innerHTML = word + " <span class=\"pts\">+" + points + "</span>";
    button.addEventListener("click", function () { speakWord(word); });

    item.appendChild(button);
    dom.foundList.insertBefore(item, dom.foundList.firstChild);
  }

  function speakWord(word) {
    var entry = global.Dictionary.lookup(word);
    var phrases = [{ text: word, rate: 0.8, pitch: 1.05 }];
    if (settings.speakDefinitions && entry && entry.definition) {
      phrases.push({ text: entry.definition + ".", rate: 0.92 });
    }
    global.Speech.sayAll(phrases);
  }

  function solve() {
    var puzzle = state.puzzle;
    var word = puzzle.word;
    var clean = state.misses === 0;
    var big = word.length >= 6 || puzzle.holes.length > 1;
    var i;

    var tricky = 0;
    for (i = 0; i < puzzle.holes.length; i++) {
      if (global.Letters.isTricky(word[puzzle.holes[i]])) tricky++;
    }

    var points = (POINTS[word.length] || POINTS[POINTS.length - 1]) +
                 tricky * TRICKY_BONUS + (clean ? CLEAN_BONUS : 0);

    state.score += points;
    state.trickyFixed += tricky;
    if (clean) state.firstTime++;
    state.solved.unshift({ word: word, points: points, clean: clean });
    if (records.collection.indexOf(word) === -1) records.collection.push(word);

    // The ladder. Two clean answers in a row and the words get longer and
    // less common; a word that took a few goes drops her back a rung. She
    // should be working, never drowning.
    if (clean) {
      state.cleanRun++;
      if (state.cleanRun >= 2) {
        state.level = Math.min(state.level + 1, global.Puzzle.levelCount - 1);
        state.cleanRun = 0;
      }
    } else {
      state.cleanRun = 0;
      if (state.misses >= 2) state.level = Math.max(state.level - 1, 0);
    }

    var praise = cheerFor(big);
    dom.wordLine.classList.add("is-solved");
    clearHints();

    showMessage(
      praise + " <strong>" + word + "</strong> <span class=\"pts\">+" + points + "</span>" +
      (clean ? " &nbsp;<em>first go!</em>" : ""),
      "good"
    );

    global.Sound.success(word.length);
    global.Kitten.react(big ? "bigcheer" : "cheer");
    global.Confetti.burstFrom(dom.wordLine, big ? 1.4 : 1);
    global.Speech.sayAll([
      { text: praise, rate: 1.02, pitch: 1.15 },
      { text: word, rate: 0.82, pitch: 1.1 }
    ]);

    updateScore();
    addSolvedChip(word, points);

    global.clearTimeout(state.advance);
    state.advance = global.setTimeout(function () {
      nextPuzzle(null);
    }, big ? ADVANCE_BIG_MS : ADVANCE_MS);
  }

  function skipWord() {
    if (!state.running || state.paused || !state.puzzle) return;

    var word = state.puzzle.word;
    state.cleanRun = 0;
    state.level = Math.max(state.level - 1, 0);

    global.Sound.remove();
    nextPuzzle("That one was " + word + ".");
    showMessage(
      "That one was <strong>" + word + "</strong>. Here's another, " + PLAYER + "!",
      "nudge"
    );
  }

  // ------------------------------------------------------------------------
  // the next word
  // ------------------------------------------------------------------------

  /* The definitions arrive in the background, so a word chosen in the first
     second of a round may have picked up a meaning by the time she asks for
     it. Always look again before speaking. */
  function currentEntry() {
    if (!state.puzzle) return null;
    var entry = state.puzzle.entry;
    if (entry && entry.definition) return entry;

    var fresh = global.Dictionary.lookup(state.puzzle.word);
    if (fresh && fresh.definition) {
      state.puzzle.entry = fresh;
      return fresh;
    }
    return entry;
  }

  function sayPuzzle(lead) {
    var entry = currentEntry();
    var phrases = [];

    if (lead) phrases.push({ text: lead, rate: 0.95 });
    phrases.push({ text: state.puzzle.word, rate: 0.78, pitch: 1.06 });

    if (settings.speakDefinitions && entry && entry.definition) {
      var from = entry.base && entry.base !== entry.word
        ? "From " + entry.base + ". " : "";
      phrases.push({ text: from + entry.definition + ".", rate: 0.92 });
    }
    global.Speech.sayAll(phrases);
  }

  function nextPuzzle(lead) {
    global.clearTimeout(state.advance);
    finishSettle();
    clearHints();
    if (!state.running || state.paused) return;

    var puzzle = global.Puzzle.make(state.level, state.used);
    if (!puzzle) {
      // Only reachable if she has exhausted every word at every level, which
      // would be a remarkable five minutes.
      endRound(true);
      return;
    }

    state.puzzle = puzzle;
    state.used.add(puzzle.word);
    state.misses = 0;
    state.picked = 0;

    dom.wordLine.classList.remove("is-solved", "is-wrapped");
    clearMessage();
    renderWord();
    renderPool();

    global.Kitten.setState("watching");
    if (settings.autoSay) sayPuzzle(lead);
  }

  // ------------------------------------------------------------------------
  // the clock
  // ------------------------------------------------------------------------

  var RING = 2 * Math.PI * 19;

  function paintClock() {
    var total = state.minutes * 60;
    var left = Math.max(0, state.secondsLeft);
    var minutes = Math.floor(left / 60);
    var seconds = left % 60;

    dom.timerText.textContent = minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
    dom.timerFill.style.strokeDashoffset = String(RING * (1 - left / total));

    dom.timer.classList.toggle("is-low", left <= 60 && left > 15);
    dom.timer.classList.toggle("is-final", left <= 15);
  }

  function tick() {
    state.secondsLeft--;
    paintClock();

    if (state.secondsLeft <= 5 && state.secondsLeft > 0) global.Sound.tick();
    if (state.secondsLeft <= 0) endRound(false);
  }

  function startClock() {
    global.clearInterval(state.ticker);
    state.ticker = global.setInterval(tick, 1000);
  }

  function stopClock() {
    global.clearInterval(state.ticker);
    state.ticker = null;
  }

  // ------------------------------------------------------------------------
  // rounds
  // ------------------------------------------------------------------------

  function startRound() {
    state.running = true;
    state.paused = false;
    state.score = 0;
    state.level = 0;
    state.cleanRun = 0;
    state.solved = [];
    state.used = new Set();
    state.firstTime = 0;
    state.trickyFixed = 0;
    state.wobbly = new Map();
    state.secondsLeft = state.minutes * 60;

    dom.foundList.innerHTML = "";
    dom.foundCount.textContent = "0";
    dom.scoreValue.textContent = "0";
    dom.app.classList.remove("is-paused");

    global.Kitten.reset();
    paintClock();
    startClock();
    global.Sound.start();

    nextPuzzle(null);
  }

  function pauseRound() {
    if (!state.running || state.paused) return;
    state.paused = true;
    stopClock();
    global.clearTimeout(state.advance);
    global.Speech.stop();
    global.Kitten.setState("sleep");
    dom.app.classList.add("is-paused");
    openOverlay(dom.pauseScreen);
  }

  function resumeRound() {
    if (!state.running || !state.paused) return;
    state.paused = false;
    global.Kitten.setState("idle");
    dom.app.classList.remove("is-paused");
    closeOverlay(dom.pauseScreen);
    startClock();
  }

  function endRound(quit) {
    if (!state.running) return;

    state.running = false;
    state.paused = false;
    stopClock();
    global.clearTimeout(state.advance);
    finishSettle();
    global.Speech.stop();
    dom.app.classList.remove("is-paused");
    closeOverlay(dom.pauseScreen);

    if (!quit) global.Sound.timeUp();

    if (state.score > records.best) records.best = state.score;
    saveStore();

    showResults(quit);
  }

  /* The pairs that went wrong, worst first. This is the one thing on the
     results screen that is really for whoever is sitting next to her. */
  function renderWobbly() {
    var pairs = [];
    state.wobbly.forEach(function (count, key) {
      pairs.push({ key: key, count: count });
    });
    pairs.sort(function (a, b) { return b.count - a.count; });

    dom.wobblyList.innerHTML = "";
    for (var i = 0; i < pairs.length; i++) {
      (function (pair) {
        var a = pair.key[0];
        var b = pair.key[1];

        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "wobbly-pair";
        chip.innerHTML =
          "<b class=\"" + global.Letters.colourClass(a) + "\">" + a + "</b>" +
          "<b class=\"" + global.Letters.colourClass(b) + "\">" + b + "</b>" +
          "<span class=\"times\">" + pair.count +
          (pair.count === 1 ? " time" : " times") + "</span>";

        chip.addEventListener("click", function () {
          global.Speech.sayAll([
            { text: spoken(a) + ". " + global.Letters.describe(a) + ".", rate: 0.85 },
            { text: spoken(b) + ". " + global.Letters.describe(b) + ".", rate: 0.85 }
          ]);
        });
        dom.wobblyList.appendChild(chip);
      })(pairs[i]);
    }
    dom.wobblyBlock.hidden = pairs.length === 0;
  }

  function renderSolvedList() {
    dom.missedList.innerHTML = "";

    for (var i = 0; i < state.solved.length; i++) {
      (function (word) {
        var item = document.createElement("li");
        var button = document.createElement("button");
        button.type = "button";
        button.className = "found-word";
        button.textContent = word;
        button.addEventListener("click", function () { speakWord(word); });
        item.appendChild(button);
        dom.missedList.appendChild(item);
      })(state.solved[i].word);
    }
    dom.missedBlock.hidden = state.solved.length === 0;
  }

  function showResults(quit) {
    dom.endTitle.textContent = quit
      ? "Round finished, " + PLAYER
      : "Time's up, " + PLAYER + "!";
    dom.endScore.textContent = state.score;
    dom.endWords.textContent = state.solved.length;
    dom.endFirstTime.textContent = state.firstTime;
    dom.endTricky.textContent = state.trickyFixed;

    var note;
    if (state.score >= records.best && state.score > 0) {
      note = "A new best score, " + PLAYER + "! 🏆";
    } else if (state.solved.length && state.firstTime === state.solved.length) {
      note = "Every single one first go. That is properly good.";
    } else if (state.trickyFixed >= 6) {
      note = state.trickyFixed + " tricky letters put right. That's the hard bit!";
    } else if (state.solved.length > 0) {
      note = "Well played, " + PLAYER + "!";
    } else {
      note = "Have another go, " + PLAYER + " — you'll get one!";
    }
    dom.endNote.textContent = note;

    renderWobbly();
    renderSolvedList();

    if (state.solved.length) {
      global.Confetti.celebrate();
      global.Kitten.react("bigcheer");
    } else {
      global.Kitten.setState("sleep");
    }
    openOverlay(dom.endScreen);
  }

  // ------------------------------------------------------------------------
  // overlays
  // ------------------------------------------------------------------------

  function openOverlay(overlay) {
    overlay.classList.add("is-open");
  }

  function closeOverlay(overlay) {
    overlay.classList.remove("is-open");
  }

  function buildHelpCards() {
    dom.helpCards.innerHTML = "";
    var letters = global.Letters.all();

    for (var i = 0; i < letters.length; i++) {
      var letter = letters[i];
      var info = global.Letters.info(letter);

      var card = document.createElement("div");
      card.className = "help-card " + global.Letters.colourClass(letter);

      var tile = makeTile(letter, "help-" + letter);
      tile.classList.add("has-helper");
      tile.appendChild(global.Letters.cue(letter));
      card.appendChild(tile);

      var text = document.createElement("p");
      text.className = "help-card-text";
      text.innerHTML = info.hint + "<br><b>" + letter + "</b> like in <b>" +
                       info.word + "</b>";
      card.appendChild(text);

      (function (l) {
        card.addEventListener("click", function () {
          global.Speech.say(
            spoken(l) + ". " + global.Letters.describe(l), { rate: 0.85 }
          );
        });
      })(letter);

      dom.helpCards.appendChild(card);
    }
  }

  // ------------------------------------------------------------------------
  // settings
  // ------------------------------------------------------------------------

  var SETTING_INPUTS = {
    autoSay: "setAutoSay",
    speakDefinitions: "setSpeakDefinitions",
    letterHelper: "setLetterHelper",
    kitten: "setKitten",
    sound: "setSound",
    calm: "setCalm"
  };

  function applySettings() {
    global.Sound.enabled = settings.sound;
    global.Kitten.setEnabled(settings.kitten);
    global.Confetti.calm = settings.calm;
    document.body.classList.toggle("calm", settings.calm);
    applyLetterHelper();
  }

  function wireSettings() {
    Object.keys(SETTING_INPUTS).forEach(function (key) {
      var input = byId(SETTING_INPUTS[key]);
      input.checked = !!settings[key];
      input.addEventListener("change", function () {
        settings[key] = input.checked;
        applySettings();
        saveStore();
        if (key === "sound" && input.checked) global.Sound.place();
        if (key === "kitten" && input.checked) global.Kitten.react("cheer");
      });
    });
  }

  // ------------------------------------------------------------------------
  // keyboard
  // ------------------------------------------------------------------------

  function freePoolTile(letter) {
    for (var i = 0; i < state.pool.length; i++) {
      if (state.pool[i].letter === letter && !state.pool[i].used) return state.pool[i];
    }
    return null;
  }

  function movePicked(step) {
    var open = openHoles();
    if (open.length < 2) return;

    var at = open.indexOf(state.picked);
    state.picked = open[(at + step + open.length) % open.length];
    paintPicked();
  }

  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "Escape") {
      if (dom.helpScreen.classList.contains("is-open")) closeOverlay(dom.helpScreen);
      else if (dom.settingsScreen.classList.contains("is-open")) closeOverlay(dom.settingsScreen);
      else if (state.running && !state.paused) pauseRound();
      return;
    }

    if (!state.running || state.paused || overlayOpen()) return;

    if (event.key === " ") {
      event.preventDefault();
      pauseRound();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      movePicked(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }

    if (/^[a-zA-Z]$/.test(event.key)) {
      var item = freePoolTile(event.key.toLowerCase());
      if (!item) return;

      event.preventDefault();
      tryDrop(item, state.picked, item.el.getBoundingClientRect());
    }
  }

  // ------------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------------

  function wireDragDrop() {
    global.DragDrop.init({
      lineEl: dom.wordLine,
      gapSelector: ".hole",

      // A hole that already has its letter is not a target any more.
      gapFilter: function (holeEl) {
        return !holeEl.classList.contains("is-filled");
      },

      // Every tile in this game lives in the pile and is on loan to a hole,
      // so where it started never changes what letting go of it means.
      fromFor: function () { return "pool"; },

      enabled: function () {
        return state.running && !state.paused && !state.settling && !overlayOpen();
      },

      onPick: function (element) {
        global.Kitten.watch(element);
        global.Sound.pick();
        global.Speech.letter(element.getAttribute("data-letter"));
      },

      onTap: function (element) {
        var item = poolById(parseInt(element.getAttribute("data-id"), 10));
        if (!item || item.used) return;

        global.Sound.pick();
        global.Speech.letter(item.letter);
        tryDrop(item, state.picked, element.getBoundingClientRect());
      },

      onDrop: function (element, index, from, ghostRect) {
        var item = poolById(parseInt(element.getAttribute("data-id"), 10));
        if (!item) return;

        if (index === null) sendHome(item, ghostRect);
        else tryDrop(item, index, ghostRect);
      },

      onGapTap: function (index) {
        var hole = state.holes[index];
        if (!hole || hole.filled) return;
        state.picked = index;
        paintPicked();
      }
    });
  }

  function wireButtons() {
    dom.playBtn.addEventListener("click", function () {
      global.Sound.unlock();
      global.Speech.init();
      closeOverlay(dom.startScreen);
      startRound();
    });

    dom.againBtn.addEventListener("click", function () {
      closeOverlay(dom.endScreen);
      global.Confetti.clear();
      startRound();
    });

    dom.homeBtn.addEventListener("click", function () {
      closeOverlay(dom.endScreen);
      global.Confetti.clear();
      refreshRecords();
      openOverlay(dom.startScreen);
    });

    dom.sayWordBtn.addEventListener("click", function () {
      if (!state.puzzle) return;
      global.Speech.say(state.puzzle.word, { rate: 0.78, pitch: 1.06 });
    });

    dom.sayMeaningBtn.addEventListener("click", function () {
      if (!state.puzzle) return;
      var entry = currentEntry();
      if (entry && entry.definition) {
        var from = entry.base && entry.base !== entry.word
          ? "From " + entry.base + ". " : "";
        global.Speech.say(from + entry.definition + ".", { rate: 0.92 });
      } else {
        showMessage("No meaning for that one, sorry! Here's the word again.", "nudge");
        global.Speech.say(state.puzzle.word, { rate: 0.78, pitch: 1.06 });
      }
    });

    dom.skipBtn.addEventListener("click", skipWord);

    dom.pauseBtn.addEventListener("click", function () {
      if (!state.running) return;
      if (state.paused) resumeRound();
      else pauseRound();
    });

    dom.resumeBtn.addEventListener("click", resumeRound);
    dom.quitBtn.addEventListener("click", function () { endRound(true); });

    dom.helpBtn.addEventListener("click", function () {
      if (state.running && !state.paused) pauseRound();
      openOverlay(dom.helpScreen);
    });
    dom.startHelpBtn.addEventListener("click", function () {
      openOverlay(dom.helpScreen);
    });
    dom.startSettingsBtn.addEventListener("click", function () {
      openOverlay(dom.settingsScreen);
    });
    dom.helpCloseBtn.addEventListener("click", function () {
      closeOverlay(dom.helpScreen);
    });

    dom.settingsBtn.addEventListener("click", function () {
      if (state.running && !state.paused) pauseRound();
      openOverlay(dom.settingsScreen);
    });
    dom.settingsCloseBtn.addEventListener("click", function () {
      closeOverlay(dom.settingsScreen);
    });

    dom.durationChips.addEventListener("click", function (event) {
      var chip = event.target.closest(".chip");
      if (!chip) return;
      state.minutes = parseInt(chip.getAttribute("data-minutes"), 10) || 5;

      var chips = dom.durationChips.querySelectorAll(".chip");
      for (var i = 0; i < chips.length; i++) {
        chips[i].classList.toggle("is-on", chips[i] === chip);
      }
    });

    // Wandering off mid-round pauses rather than burning the clock.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && state.running && !state.paused) pauseRound();
    });

    global.addEventListener("resize", function () {
      if (state.puzzle) fitWord();
    });

    document.addEventListener("keydown", onKeyDown);
  }

  function refreshRecords() {
    dom.bestScore.textContent = records.best;
    dom.collectionCount.textContent = records.collection.length;
  }

  // ------------------------------------------------------------------------
  // start up
  // ------------------------------------------------------------------------

  function collectDom() {
    [
      "app", "pool", "wordLine", "message", "sayWordBtn", "sayMeaningBtn",
      "skipBtn", "foundList", "foundCount", "scoreValue", "timer",
      "timerText", "timerFill", "pauseBtn", "helpBtn", "settingsBtn",
      "startScreen", "startBody", "loadingRow", "playBtn", "durationChips",
      "bestScore", "collectionCount", "startHelpBtn", "startSettingsBtn",
      "pauseScreen", "resumeBtn", "quitBtn", "endScreen", "endTitle",
      "endScore", "endWords", "endFirstTime", "endTricky", "endNote",
      "wobblyBlock", "wobblyList", "missedBlock", "missedList", "againBtn",
      "homeBtn", "helpScreen", "helpCards", "helpCloseBtn", "settingsScreen",
      "settingsCloseBtn"
    ].forEach(function (id) {
      dom[id] = byId(id);
    });
  }

  /* The meanings are seven times the size of the word list, so they are
     fetched only once she can already play. Until they land, words are still
     read out - they just are not explained. */
  function fetchDefinitions() {
    if (global.SPELLING_DEFINITIONS_RAW) {
      global.Dictionary.loadDefinitions();
      return;
    }

    var script = document.createElement("script");
    script.src = "data/definitions.js";
    script.async = true;
    script.addEventListener("load", function () {
      global.Dictionary.loadDefinitions();
    });
    document.head.appendChild(script);
  }

  function showBoard() {
    dom.loadingRow.hidden = true;
    dom.startBody.hidden = false;
    dom.app.classList.remove("is-loading");
    refreshRecords();
  }

  function boot() {
    collectDom();
    loadStore();

    global.Confetti.init(byId("confetti"));
    global.Kitten.init(byId("kitten"));

    wireSettings();
    wireButtons();
    wireDragDrop();
    buildHelpCards();
    applySettings();

    // A plain timeout rather than requestAnimationFrame: rAF never fires in a
    // background tab, which would leave the game stuck on "getting the words
    // ready" until she came back to it.
    global.setTimeout(function () {
      try {
        global.Dictionary.load();
        global.Puzzle.prepare();
      } catch (err) {
        dom.loadingRow.textContent =
          "Could not load the word list. Please check your connection and reload.";
        return;
      }

      showBoard();
      fetchDefinitions();
    }, 30);
  }

  /* Exposed for the tests, which have to know the answer before they can
     check that the right letter is taken and the wrong one is not. Same
     reason kitten.js hands out its list of animations. */
  global.MissingGame = {
    puzzle: function () { return state.puzzle; },
    level: function () { return state.level; },
    misses: function () { return state.misses; },
    solvedCount: function () { return state.solved.length; },
    score: function () { return state.score; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
