/* ==========================================================================
   game.js — the round itself.

   Build words from sixteen letters against the clock. Everything that could
   discourage a child who finds spelling hard has been taken out: no penalty
   for a wrong guess, no red, no buzzer, and the letters never disappear.
   ========================================================================== */

(function (global) {
  "use strict";

  /* Whose game this is. Used everywhere the game speaks to her by name.
     Changing this covers the generated messages; the headings and the
     dedication are written into index.html. */
  var PLAYER = "Cooper";

  var GRID_SIZE = 16;
  var MIN_WORD = 3;
  var MAX_WORD = 8; // the longest word in the dictionary

  /* Points by word length. The jump from five letters to six is deliberate:
     it is worth the effort of hunting for a long one. */
  var POINTS = [0, 0, 0, 10, 25, 50, 90, 140, 200];
  var TRICKY_BONUS = 5;

  /* Her name lands in roughly a third of these on purpose. Every single time
     would stop meaning anything. */
  var PRAISE = [
    "Yes!", "Brilliant!", "Nice one!", "Great work!", "You got it!",
    "Lovely!", "Clever!", "Superb!", "Well spotted!",
    "Nice one, " + PLAYER + "!", "Go " + PLAYER + "!",
    "That's it, " + PLAYER + "!", "Clever girl!"
  ];
  var BIG_PRAISE = [
    "Wow!", "Amazing!", "Incredible!", "What a word!",
    "Look at that, " + PLAYER + "!", PLAYER + ", that's enormous!"
  ];

  var STORE_KEY = "wordbuilder.v1";

  var DEFAULT_SETTINGS = {
    letterHelper: true,
    speakLetters: true,
    speakDefinitions: true,
    wordGlow: true,
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
    tiles: [],
    line: [],
    caret: 0,
    found: [],
    foundSet: null,
    gridWords: [],
    trickyUsed: 0,
    ticker: null,
    praiseAt: 0
  };

  // ------------------------------------------------------------------------
  // storage
  // ------------------------------------------------------------------------

  function loadStore() {
    try {
      var saved = JSON.parse(global.localStorage.getItem(STORE_KEY) || "{}");
      if (saved.settings) Object.assign(settings, saved.settings);
      if (saved.records) {
        records.best = saved.records.best || 0;
        records.collection = saved.records.collection || [];
      }
    } catch (err) {
      /* A blocked or corrupt localStorage must not stop her playing. */
    }
    // Someone who has asked the whole system to calm down gets calm mode.
    if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      settings.calm = true;
    }
  }

  function saveStore() {
    try {
      global.localStorage.setItem(STORE_KEY, JSON.stringify({
        settings: settings,
        records: records
      }));
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

  function tileById(id) {
    for (var i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i].id === id) return state.tiles[i];
    }
    return null;
  }

  function currentWord() {
    var word = "";
    for (var i = 0; i < state.line.length; i++) {
      word += tileById(state.line[i]).letter;
    }
    return word;
  }

  function allLetters() {
    var letters = "";
    for (var i = 0; i < state.tiles.length; i++) {
      letters += state.tiles[i].letter;
    }
    return letters;
  }

  function trickyCount(word) {
    var n = 0;
    for (var i = 0; i < word.length; i++) {
      if (global.Letters.isTricky(word[i])) n++;
    }
    return n;
  }

  function overlayOpen() {
    return !!document.querySelector(".overlay.is-open");
  }

  function pick(list) {
    return list[(Math.random() * list.length) | 0];
  }

  // ------------------------------------------------------------------------
  // tiles and the grid
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

  /* Add or remove the ball-and-stick cue on every tricky tile. */
  function applyLetterHelper() {
    for (var i = 0; i < state.tiles.length; i++) {
      var tile = state.tiles[i];
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

  function buildGrid(letters) {
    dom.grid.innerHTML = "";
    state.tiles = [];

    for (var i = 0; i < letters.length; i++) {
      var slot = document.createElement("div");
      slot.className = "slot";

      var el = makeTile(letters[i], i);
      slot.appendChild(el);
      dom.grid.appendChild(slot);

      state.tiles.push({ id: i, letter: letters[i], el: el, slotEl: slot });
    }
    applyLetterHelper();
  }

  /* Same letters, new places. Only tiles still in the grid move. */
  function shuffleGrid() {
    var homeSlots = [];
    var homeTiles = [];

    for (var i = 0; i < state.tiles.length; i++) {
      var tile = state.tiles[i];
      if (tile.el.parentElement === tile.slotEl) {
        homeSlots.push(tile.slotEl);
        homeTiles.push(tile);
      }
    }
    if (homeTiles.length < 2) return;

    global.Grid.shuffle(homeTiles);
    for (var j = 0; j < homeSlots.length; j++) {
      var box = homeTiles[j].el.getBoundingClientRect();
      homeSlots[j].appendChild(homeTiles[j].el);
      homeTiles[j].slotEl = homeSlots[j];
      global.DragDrop.flyFrom(homeTiles[j].el, box);
    }
    global.Sound.shuffle();
  }

  // ------------------------------------------------------------------------
  // the word line
  // ------------------------------------------------------------------------

  function makeGap(index) {
    var gap = document.createElement("div");
    gap.className = "gap";
    gap.setAttribute("data-index", String(index));
    if (index === state.caret && state.line.length) gap.classList.add("is-caret");
    return gap;
  }

  function renderLine() {
    if (state.caret > state.line.length) state.caret = state.line.length;

    var fragment = document.createDocumentFragment();
    fragment.appendChild(makeGap(0));

    for (var i = 0; i < state.line.length; i++) {
      fragment.appendChild(tileById(state.line[i]).el);
      fragment.appendChild(makeGap(i + 1));
    }

    // Detaches the tiles, which are immediately put back by the fragment.
    dom.wordLine.textContent = "";
    dom.wordLine.appendChild(dom.wordLineEmpty);
    dom.wordLine.appendChild(fragment);
    dom.wordLine.classList.toggle("has-letters", state.line.length > 0);

    refreshCheckButton();
  }

  function refreshCheckButton() {
    var word = currentWord();
    var isWord = word.length >= MIN_WORD &&
                 global.Dictionary.has(word) &&
                 !state.foundSet.has(word);

    dom.checkBtn.disabled = word.length < MIN_WORD;
    dom.checkBtn.classList.toggle("is-glowing", isWord && settings.wordGlow);
    dom.wordLine.classList.toggle("is-word", isWord && settings.wordGlow);
    dom.soundOutBtn.disabled = word.length === 0;
  }

  function removeFromLine(id) {
    var at = state.line.indexOf(id);
    if (at === -1) return -1;
    state.line.splice(at, 1);
    if (state.caret > at) state.caret--;
    return at;
  }

  function placeInLine(tile, index, ghostRect) {
    var previous = removeFromLine(tile.id);
    if (previous !== -1 && previous < index) index--;

    index = Math.max(0, Math.min(index, state.line.length));
    state.line.splice(index, 0, tile.id);
    state.caret = index + 1;

    renderLine();
    global.DragDrop.flyFrom(tile.el, ghostRect);
    global.Sound.place();
    clearMessage();
  }

  function sendHome(tile, ghostRect) {
    removeFromLine(tile.id);
    tile.slotEl.appendChild(tile.el);
    renderLine();
    global.DragDrop.flyFrom(tile.el, ghostRect);
    global.Sound.remove();
    clearMessage();
  }

  function clearLine() {
    if (!state.line.length) return;

    for (var i = 0; i < state.line.length; i++) {
      var tile = tileById(state.line[i]);
      var box = tile.el.getBoundingClientRect();
      tile.slotEl.appendChild(tile.el);
      global.DragDrop.flyFrom(tile.el, box);
    }
    state.line = [];
    state.caret = 0;
    renderLine();
    global.Sound.remove();
    clearMessage();
  }

  // ------------------------------------------------------------------------
  // messages
  // ------------------------------------------------------------------------

  function showMessage(html, tone) {
    dom.message.innerHTML = html;
    dom.message.className = "message is-shown" + (tone ? " is-" + tone : "");
    // Restart the pop animation even when the same message repeats.
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
  // checking a word
  // ------------------------------------------------------------------------

  function wobble(indexes) {
    for (var i = 0; i < indexes.length; i++) {
      var tile = tileById(state.line[indexes[i]]);
      if (!tile) continue;
      tile.el.classList.remove("is-nudged");
      void tile.el.offsetWidth;
      tile.el.classList.add("is-nudged");
    }
    global.setTimeout(function () {
      var all = document.querySelectorAll(".tile.is-nudged");
      for (var j = 0; j < all.length; j++) all[j].classList.remove("is-nudged");
    }, 1700);
  }

  function rejectLine() {
    dom.wordLine.classList.remove("is-wrong");
    void dom.wordLine.offsetWidth;
    dom.wordLine.classList.add("is-wrong");
    global.setTimeout(function () {
      dom.wordLine.classList.remove("is-wrong");
    }, 450);
  }

  function checkWord() {
    if (!state.running || state.paused) return;

    var word = currentWord();
    if (word.length < MIN_WORD) {
      showMessage("Words need at least " + MIN_WORD + " letters", "nudge");
      global.Sound.nudge();
      return;
    }

    if (word.length > MAX_WORD) {
      showMessage("That's longer than any word in our dictionary! Try a shorter one", "nudge");
      global.Sound.nudge();
      rejectLine();
      return;
    }

    if (state.foundSet.has(word)) {
      showMessage("You already found <strong>" + word + "</strong>! Try another one", "nudge");
      global.Sound.repeat();
      rejectLine();
      return;
    }

    if (global.Dictionary.has(word)) {
      acceptWord(word);
    } else {
      rejectWord(word);
    }
  }

  /* The heart of it: when a word fails, is it only failing because a b is
     really a d, or an n is really an m? */
  function rejectWord(word) {
    rejectLine();
    global.Sound.nudge();

    var available = global.Dictionary.countLetters(allLetters());
    var confusion = global.Dictionary.confusionMiss(word, available);

    if (confusion) {
      // Usually one letter is to blame, but sometimes two are, and the hint
      // has to name every tile it is about to wobble.
      var shown = [];
      var spoken = [];
      var humps = false;
      var balls = false;

      for (var i = 0; i < confusion.swaps.length; i++) {
        var letter = word[confusion.swaps[i]];
        shown.push("<strong class=\"" + global.Letters.colourClass(letter) + "\">" +
                   letter + "</strong>");
        spoken.push(global.Letters.spokenName(letter));
        if (global.Letters.info(letter).humps) humps = true;
        else balls = true;
      }

      var question = humps && balls
        ? "have they got it the right way round?"
        : (humps ? "how many humps should it have?"
                 : "which side should the ball be on?");

      var joined = shown.length > 1
        ? shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1]
        : shown[0];
      var joinedSpoken = spoken.length > 1
        ? spoken.slice(0, -1).join(", ") + " and " + spoken[spoken.length - 1]
        : spoken[0];

      showMessage(
        "So close, " + PLAYER + "! Look hard at the " + joined +
        " &mdash; " + question,
        "nudge"
      );
      wobble(confusion.swaps);

      global.Speech.say(
        "Ooh, so close. Look carefully at the " + joinedSpoken + ". " +
        question.charAt(0).toUpperCase() + question.slice(1),
        { rate: 0.92 }
      );
      return;
    }

    var near = global.Dictionary.nearMiss(word, available);
    if (near) {
      var nudgeText = {
        add: "one letter is missing",
        remove: "there is one letter too many",
        change: "one letter needs changing",
        swap: "two letters are the wrong way round"
      }[near.kind];

      showMessage(
        "Nearly! <strong>" + word + "</strong> isn't a word, but " + nudgeText,
        "nudge"
      );
      global.Speech.say("Nearly. " + nudgeText + ".", { rate: 0.92 });
      return;
    }

    showMessage("<strong>" + word + "</strong> isn't in our dictionary. Have another go!", "nudge");
    global.Speech.say("Not quite. Have another go.", { rate: 0.95 });
  }

  function acceptWord(word) {
    var entry = global.Dictionary.lookup(word);
    var tricky = trickyCount(word);
    var points = (POINTS[word.length] || POINTS[POINTS.length - 1]) + tricky * TRICKY_BONUS;

    state.score += points;
    state.trickyUsed += tricky;
    state.foundSet.add(word);
    state.found.unshift({ word: word, points: points, entry: entry });

    if (records.collection.indexOf(word) === -1) records.collection.push(word);

    celebrate(word, points, tricky, entry);
    returnLineToGrid();
    updateScore();
    addFoundChip(word, points);
  }

  function celebrate(word, points, tricky, entry) {
    var big = word.length >= 6;
    var praise = pick(big ? BIG_PRAISE : PRAISE);

    var extra = tricky
      ? " <span class=\"pts\">+" + points + "</span> &nbsp;<em>tricky letter bonus!</em>"
      : " <span class=\"pts\">+" + points + "</span>";
    showMessage(praise + " <strong>" + word + "</strong>" + extra, "good");

    global.Sound.success(word.length);
    global.Confetti.burstFrom(dom.wordLine, big ? 1.4 : 1);
    flyWordToList(word);

    global.Speech.foundWord(entry, praise, settings.speakDefinitions);
  }

  /* A ghost of the word arcs from the line over to the found list. */
  function flyWordToList(word) {
    if (settings.calm) return;

    var from = dom.wordLine.getBoundingClientRect();
    var target = dom.foundCount.getBoundingClientRect();

    var ghost = document.createElement("div");
    ghost.className = "flying-word";
    ghost.textContent = word;
    ghost.style.left = (from.left + from.width / 2) + "px";
    ghost.style.top = (from.top + from.height / 2) + "px";
    document.body.appendChild(ghost);

    var dx = (target.left + target.width / 2) - (from.left + from.width / 2);
    var dy = (target.top + target.height / 2) - (from.top + from.height / 2);

    global.requestAnimationFrame(function () {
      ghost.style.transform = "translate(-50%,-50%) translate(" + dx + "px," + dy + "px) scale(.28)";
      ghost.style.opacity = "0";
    });
    global.setTimeout(function () { ghost.remove(); }, 760);
  }

  function returnLineToGrid() {
    for (var i = 0; i < state.line.length; i++) {
      var tile = tileById(state.line[i]);
      var box = tile.el.getBoundingClientRect();

      tile.slotEl.appendChild(tile.el);
      global.DragDrop.flyFrom(tile.el, box);

      tile.el.classList.add("is-landing");
      /* jshint loopfunc: true */
      (function (element) {
        global.setTimeout(function () { element.classList.remove("is-landing"); }, 340);
      })(tile.el);
    }
    state.line = [];
    state.caret = 0;
    renderLine();
  }

  function updateScore() {
    dom.scoreValue.textContent = state.score;
    dom.scoreValue.classList.remove("is-bumped");
    void dom.scoreValue.offsetWidth;
    dom.scoreValue.classList.add("is-bumped");
  }

  function addFoundChip(word, points) {
    var chip = document.createElement("li");

    var button = document.createElement("button");
    button.type = "button";
    button.className = "found-word is-new";
    button.appendChild(document.createTextNode(word));

    var pts = document.createElement("span");
    pts.className = "pts";
    pts.textContent = "+" + points;
    button.appendChild(pts);

    button.addEventListener("click", function () {
      speakEntry(word);
    });

    chip.appendChild(button);
    dom.foundList.insertBefore(chip, dom.foundList.firstChild);
    dom.foundCount.textContent = state.found.length;
  }

  function speakEntry(word) {
    var entry = global.Dictionary.lookup(word);
    if (entry) global.Speech.foundWord(entry, "", true);
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
    var grid = global.Grid.generate(GRID_SIZE);

    state.running = true;
    state.paused = false;
    state.score = 0;
    state.line = [];
    state.caret = 0;
    state.found = [];
    state.foundSet = new Set();
    state.trickyUsed = 0;
    state.gridWords = grid.words;
    state.secondsLeft = state.minutes * 60;

    buildGrid(grid.letters);
    renderLine();

    dom.foundList.innerHTML = "";
    dom.foundCount.textContent = "0";
    dom.scoreValue.textContent = "0";
    clearMessage();
    dom.app.classList.remove("is-paused");

    paintClock();
    startClock();

    global.Sound.start();
  }

  function pauseRound() {
    if (!state.running || state.paused) return;
    state.paused = true;
    stopClock();
    global.Speech.stop();
    dom.app.classList.add("is-paused");
    openOverlay(dom.pauseScreen);
  }

  function resumeRound() {
    if (!state.running || !state.paused) return;
    state.paused = false;
    dom.app.classList.remove("is-paused");
    closeOverlay(dom.pauseScreen);
    startClock();
  }

  function endRound(quit) {
    if (!state.running) return;

    state.running = false;
    state.paused = false;
    stopClock();
    global.Speech.stop();
    dom.app.classList.remove("is-paused");
    closeOverlay(dom.pauseScreen);

    if (!quit) global.Sound.timeUp();

    if (state.score > records.best) records.best = state.score;
    saveStore();

    showResults(quit);
  }

  function longestFound() {
    var longest = "";
    for (var i = 0; i < state.found.length; i++) {
      if (state.found[i].word.length > longest.length) longest = state.found[i].word;
    }
    return longest;
  }

  function showResults(quit) {
    dom.endTitle.textContent = quit
      ? "Round finished, " + PLAYER
      : "Time's up, " + PLAYER + "!";
    dom.endScore.textContent = state.score;
    dom.endWords.textContent = state.found.length;
    dom.endLongest.textContent = longestFound() || "–";
    dom.endTricky.textContent = state.trickyUsed;

    var note = "";
    if (state.score >= records.best && state.score > 0) {
      note = "A new best score, " + PLAYER + "! 🏆";
    } else if (state.found.length >= 10) {
      note = "Ten words or more. Brilliant work!";
    } else if (state.trickyUsed >= 4) {
      note = state.trickyUsed + " tricky letters used. That's the hard bit!";
    } else if (state.found.length > 0) {
      note = "Well played, " + PLAYER + "!";
    } else {
      note = "Have another go, " + PLAYER + " — you'll find one!";
    }
    dom.endNote.textContent = note;

    renderMissed();

    if (state.found.length) global.Confetti.celebrate();
    openOverlay(dom.endScreen);
  }

  /* A short, achievable set of words she did not find.

     Sampled across lengths and shuffled, because the grid word list is
     alphabetical and a screen full of words starting with "a" looks broken.
     Everyday words come first and words with a definition next, so this
     teaches something rather than showing off the dictionary. */
  function suggestionRank(word) {
    var entry = global.Dictionary.lookup(word);
    return global.Dictionary.familiarity(word) * 2 +
           (entry && entry.definition ? 0 : 1);
  }

  function renderMissed() {
    var buckets = { 3: [], 4: [], 5: [] };

    for (var i = 0; i < state.gridWords.length; i++) {
      var word = state.gridWords[i];
      if (state.foundSet.has(word) || !buckets[word.length]) continue;
      buckets[word.length].push(word);
    }

    var missed = [];
    [3, 4, 5].forEach(function (length) {
      var pool = buckets[length];
      // Sample rather than take the first few, which would all share a
      // starting letter.
      global.Grid.shuffle(pool);
      pool.sort(function (a, b) { return suggestionRank(a) - suggestionRank(b); });
      missed = missed.concat(pool.slice(0, 4));
    });

    missed.sort(function (a, b) { return a.length - b.length; });

    dom.missedList.innerHTML = "";
    for (var j = 0; j < missed.length; j++) {
      (function (word) {
        var item = document.createElement("li");
        var button = document.createElement("button");
        button.type = "button";
        button.className = "found-word";
        button.textContent = word;
        button.addEventListener("click", function () { speakEntry(word); });
        item.appendChild(button);
        dom.missedList.appendChild(item);
      })(missed[j]);
    }
    dom.missedBlock.hidden = missed.length === 0;
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
      tile.setAttribute("tabindex", "-1");
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
            global.Letters.spokenName(l) + ". " + global.Letters.describe(l),
            { rate: 0.85 }
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
    letterHelper: "setLetterHelper",
    speakLetters: "setSpeakLetters",
    speakDefinitions: "setSpeakDefinitions",
    wordGlow: "setWordGlow",
    sound: "setSound",
    calm: "setCalm"
  };

  function applySettings() {
    global.Sound.enabled = settings.sound;
    global.Confetti.calm = settings.calm;
    document.body.classList.toggle("calm", settings.calm);
    applyLetterHelper();
    refreshCheckButton();
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
      });
    });
  }

  // ------------------------------------------------------------------------
  // keyboard
  // ------------------------------------------------------------------------

  function freeTileFor(letter) {
    for (var i = 0; i < state.tiles.length; i++) {
      var tile = state.tiles[i];
      if (tile.letter === letter && state.line.indexOf(tile.id) === -1) return tile;
    }
    return null;
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

    if (event.key === "Enter") {
      event.preventDefault();
      checkWord();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      var at = state.caret - 1;
      if (at >= 0 && at < state.line.length) {
        var leaving = tileById(state.line[at]);
        sendHome(leaving, leaving.el.getBoundingClientRect());
      }
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      pauseRound();
      return;
    }

    if (/^[a-zA-Z]$/.test(event.key)) {
      var tile = freeTileFor(event.key.toLowerCase());
      if (!tile) {
        showMessage("No <strong>" + event.key.toLowerCase() + "</strong> left to use", "nudge");
        global.Sound.nudge();
        return;
      }
      event.preventDefault();
      var box = tile.el.getBoundingClientRect();
      placeInLine(tile, state.caret, box);
      if (settings.speakLetters) global.Speech.letter(tile.letter);
    }
  }

  // ------------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------------

  function wireDragDrop() {
    global.DragDrop.init({
      lineEl: dom.wordLine,

      enabled: function () {
        return state.running && !state.paused && !overlayOpen();
      },

      onPick: function (element) {
        global.Sound.pick();
        if (settings.speakLetters) {
          global.Speech.letter(element.getAttribute("data-letter"));
        }
      },

      onTap: function (element, from) {
        var tile = tileById(parseInt(element.getAttribute("data-id"), 10));
        if (!tile) return;

        var box = element.getBoundingClientRect();
        if (from === "line") {
          sendHome(tile, box);
        } else {
          placeInLine(tile, state.caret, box);
          global.Sound.pick();
          if (settings.speakLetters) global.Speech.letter(tile.letter);
        }
      },

      onDrop: function (element, index, from, ghostRect) {
        var tile = tileById(parseInt(element.getAttribute("data-id"), 10));
        if (!tile) return;

        if (index === null) {
          sendHome(tile, ghostRect);
        } else {
          placeInLine(tile, index, ghostRect);
        }
      },

      onGapTap: function (index) {
        state.caret = index;
        renderLine();
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

    dom.checkBtn.addEventListener("click", checkWord);
    dom.clearBtn.addEventListener("click", clearLine);
    dom.shuffleBtn.addEventListener("click", shuffleGrid);

    dom.soundOutBtn.addEventListener("click", function () {
      var word = currentWord();
      if (word) global.Speech.spellOut(word);
    });

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
      "app", "grid", "wordLine", "wordLineEmpty", "message", "checkBtn",
      "clearBtn", "soundOutBtn", "shuffleBtn", "foundList", "foundCount",
      "scoreValue", "timer", "timerText", "timerFill", "pauseBtn", "helpBtn",
      "settingsBtn", "startScreen", "startBody", "loadingRow", "playBtn",
      "durationChips", "bestScore", "collectionCount", "startHelpBtn",
      "startSettingsBtn",
      "pauseScreen", "resumeBtn", "quitBtn", "endScreen", "endTitle",
      "endScore", "endWords", "endLongest", "endTricky", "endNote",
      "missedBlock", "missedList", "againBtn", "homeBtn", "helpScreen",
      "helpCards", "helpCloseBtn", "settingsScreen", "settingsCloseBtn"
    ].forEach(function (id) {
      dom[id] = byId(id);
    });
  }

  /* The meanings are seven times the size of the word list, so they are
     fetched only once she can already play. If they never arrive, words are
     still found and celebrated - they just are not explained. */
  function fetchDefinitions() {
    if (global.SPELLING_DEFINITIONS_RAW) {
      // The standalone single-file build has them inline already.
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
    state.foundSet = new Set();

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
      } catch (err) {
        dom.loadingRow.textContent =
          "Could not load the word list. Please check your connection and reload.";
        return;
      }

      showBoard();
      fetchDefinitions();
    }, 30);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
