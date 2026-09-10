/* ==========================================================================
   analytics.js — drawing what analysis.js worked out.

   All the thinking is next door in analysis.js; this file only decides how to
   show it. The division matters, because it means the numbers can be tested
   in node without a browser anywhere near them.

   Two rules run through the drawing.

   Every rate is drawn with its uncertainty. A bar with no interval on it is a
   claim; a bar with an interval is a measurement. At the sample sizes a child
   generates over a term, the intervals are most of the story, and a chart
   that hides them is worse than no chart.

   Anything too thin is drawn hollow rather than left out. A gap in a line
   invites the eye to join it up. A hollow marker says "this point exists and
   you should not lean on it", which is the truth.
   ========================================================================== */

(function (global) {
  "use strict";

  var A = global.Analysis;
  var SVG = "http://www.w3.org/2000/svg";

  var dom = {};
  var model = null;

  var LETTER_COLOUR = {
    b: "#4d9bff", d: "#ff9838", p: "#c07bff",
    q: "#3ddc84", n: "#ff7bac", m: "#2fd8d8"
  };
  var GO = "#34d399";
  var WARN = "#fb8a5c";
  var NUDGE = "#a5b4fc";
  var FAINT = "#8590bd";

  // ------------------------------------------------------------------------
  // little builders
  // ------------------------------------------------------------------------

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    apply(node, attrs, kids);
    return node;
  }

  function s(tag, attrs, kids) {
    var node = document.createElementNS(SVG, tag);
    apply(node, attrs, kids, true);
    return node;
  }

  function apply(node, attrs, kids, isSvg) {
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "text") { node.textContent = value; return; }
        if (key === "html") { node.innerHTML = value; return; }
        if (key === "class" || isSvg) node.setAttribute(key, value);
        else if (key in node) node[key] = value;
        else node.setAttribute(key, value);
      });
    }
    (kids || []).forEach(function (kid) {
      if (kid) node.appendChild(typeof kid === "string"
        ? document.createTextNode(kid) : kid);
    });
  }

  function pct(rate) { return A.pct(rate); }

  function secs(ms) {
    if (ms === null || ms === undefined) return "–";
    return (Math.round(ms / 100) / 10) + "s";
  }

  function when(at) {
    if (!at) return "–";
    return new Date(at).toLocaleDateString(undefined,
      { day: "numeric", month: "short", year: "numeric" });
  }

  function colourFor(letter) { return LETTER_COLOUR[letter] || NUDGE; }

  // ------------------------------------------------------------------------
  // charts
  // ------------------------------------------------------------------------

  /* A rate over rounds, with its interval as a band behind it.

     The band is the point of the chart. Draw these series without one and a
     run of six rounds looks like a story; with one it usually looks like what
     it is, which is not enough rounds yet. */
  function rateChart(series, options) {
    options = options || {};
    var W = 680, H = options.height || 190;
    var pad = { l: 38, r: 12, t: 12, b: 26 };
    var colour = options.colour || NUDGE;

    var svg = s("svg", {
      "class": "chart", viewBox: "0 0 " + W + " " + H,
      preserveAspectRatio: "none", role: "img",
      "aria-label": options.label || "accuracy over time"
    });

    if (!series.length) {
      svg.appendChild(s("text", {
        x: W / 2, y: H / 2, "class": "label", "text-anchor": "middle",
        text: "Nothing to plot yet"
      }));
      return svg;
    }

    var x = function (i) {
      return pad.l + (series.length === 1 ? (W - pad.l - pad.r) / 2
        : i * (W - pad.l - pad.r) / (series.length - 1));
    };
    var y = function (v) { return pad.t + (1 - v) * (H - pad.t - pad.b); };

    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      svg.appendChild(s("line", {
        "class": "grid", x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v)
      }));
      svg.appendChild(s("text", {
        x: pad.l - 7, y: y(v) + 4, "class": "tick", "text-anchor": "end",
        text: Math.round(v * 100) + "%"
      }));
    });

    // The interval band, as one filled shape over the top edge and back along
    // the bottom.
    var top = series.map(function (p, i) { return x(i) + "," + y(p.hi); });
    var bottom = series.map(function (p, i) { return x(i) + "," + y(p.lo); }).reverse();
    svg.appendChild(s("polygon", {
      "class": "band", fill: colour, points: top.concat(bottom).join(" ")
    }));

    svg.appendChild(s("polyline", {
      "class": "line", stroke: colour,
      points: series.map(function (p, i) { return x(i) + "," + y(p.rate); }).join(" ")
    }));

    series.forEach(function (p, i) {
      svg.appendChild(s("circle", {
        "class": "dot" + (p.thin ? " is-thin" : ""),
        cx: x(i), cy: y(p.rate), r: p.thin ? 3 : 4,
        fill: p.thin ? "none" : colour, stroke: colour
      }));
    });

    axisEnds(svg, series, x, H - pad.b + 16);
    return svg;
  }

  /* Milliseconds over rounds. Two series: how long she took on the ones she
     got right, and on the ones she did not. */
  function paceChart(series) {
    var W = 680, H = 200;
    var pad = { l: 46, r: 12, t: 12, b: 26 };

    var svg = s("svg", {
      "class": "chart", viewBox: "0 0 " + W + " " + H,
      preserveAspectRatio: "none", role: "img",
      "aria-label": "time to first move, over rounds"
    });

    var all = [];
    series.forEach(function (p) {
      if (p.right !== null) all.push(p.right);
      if (p.wrong !== null) all.push(p.wrong);
    });
    if (!all.length) {
      svg.appendChild(s("text", { x: W / 2, y: H / 2, "class": "label",
        "text-anchor": "middle", text: "Nothing to plot yet" }));
      return svg;
    }

    /* Scaled to a robust upper bound, not the maximum. One round where she
       wandered off mid-word puts an eleven second median in the series, and
       scaling to that squashes every other point into the floor. Anything
       above the bound is drawn clamped at the top edge as a hollow triangle,
       so it is visibly off the scale rather than quietly missing. */
    var sorted = all.slice().sort(function (a, b) { return a - b; });
    var p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    var top = Math.max(1200, p90 * 1.25);
    var clipped = 0;
    var x = function (i) {
      return pad.l + (series.length === 1 ? (W - pad.l - pad.r) / 2
        : i * (W - pad.l - pad.r) / (series.length - 1));
    };
    var y = function (v) { return pad.t + (1 - v / top) * (H - pad.t - pad.b); };

    [0, top / 2, top].forEach(function (v) {
      svg.appendChild(s("line", { "class": "grid", x1: pad.l, x2: W - pad.r,
        y1: y(v), y2: y(v) }));
      svg.appendChild(s("text", { x: pad.l - 7, y: y(v) + 4, "class": "tick",
        "text-anchor": "end", text: secs(v) }));
    });

    [
      { key: "right", nKey: "rightN", colour: GO },
      { key: "wrong", nKey: "wrongN", colour: WARN }
    ].forEach(function (line) {
      var points = [];
      series.forEach(function (p, i) {
        if (p[line.key] === null) return;
        points.push({ i: i, v: p[line.key], n: p[line.nKey] });
      });
      if (points.length > 1) {
        svg.appendChild(s("polyline", {
          "class": "line", stroke: line.colour, "stroke-opacity": .85,
          points: points.map(function (p) {
            return x(p.i) + "," + y(Math.min(p.v, top));
          }).join(" ")
        }));
      }
      points.forEach(function (p) {
        if (p.v > top) {
          clipped += 1;
          var at = x(p.i);
          svg.appendChild(s("polygon", {
            points: (at - 5) + "," + (pad.t + 8) + " " + (at + 5) + ","
                    + (pad.t + 8) + " " + at + "," + pad.t,
            fill: "none", stroke: line.colour, "stroke-width": 1.5
          }));
          return;
        }
        svg.appendChild(s("circle", {
          "class": "dot" + (p.n < A.MIN_FOR_TREND ? " is-thin" : ""),
          cx: x(p.i), cy: y(p.v), r: p.n < A.MIN_FOR_TREND ? 3 : 4,
          fill: p.n < A.MIN_FOR_TREND ? "none" : line.colour, stroke: line.colour
        }));
      });
    });

    if (clipped) {
      svg.appendChild(s("text", {
        x: W - pad.r, y: pad.t + 20, "class": "label", "text-anchor": "end",
        text: clipped + " round" + (clipped > 1 ? "s" : "") + " off the top"
      }));
    }

    axisEnds(svg, series, x, H - pad.b + 16);
    return svg;
  }

  /* Only the first and last round get a label. Numbering every one turns the
     axis into a ruler nobody reads. */
  function axisEnds(svg, series, x, yAt) {
    if (!series.length) return;
    svg.appendChild(s("text", {
      x: x(0), y: yAt, "class": "tick", "text-anchor": "start",
      text: when(series[0].at)
    }));
    if (series.length > 1) {
      svg.appendChild(s("text", {
        x: x(series.length - 1), y: yAt, "class": "tick", "text-anchor": "end",
        text: when(series[series.length - 1].at)
      }));
    }
  }

  /* One bar per letter: the interval as the bar, the point estimate as a
     notch in it. Reading it as "the answer is somewhere in the bar" is
     exactly right, which is why it is drawn this way round. */
  function masteryBar(score, colour) {
    var W = 300, H = 22;
    var svg = s("svg", { "class": "chart", viewBox: "0 0 " + W + " " + H,
      preserveAspectRatio: "none", role: "img",
      "aria-label": pct(score.rate) + ", between " + pct(score.lo)
        + " and " + pct(score.hi) });

    svg.appendChild(s("rect", { x: 0, y: 7, width: W, height: 8, rx: 4,
      fill: "#232c50" }));

    if (score.n) {
      svg.appendChild(s("rect", {
        x: score.lo * W, y: 7, width: Math.max(2, (score.hi - score.lo) * W),
        height: 8, rx: 4, fill: colour, "fill-opacity": .32
      }));
      svg.appendChild(s("rect", {
        x: Math.min(W - 3, score.rate * W - 1.5), y: 3, width: 3, height: 16,
        rx: 1.5, fill: colour
      }));
    }
    return svg;
  }

  function sparkline(series, colour) {
    var W = 150, H = 44;
    var svg = s("svg", { "class": "chart", viewBox: "0 0 " + W + " " + H,
      preserveAspectRatio: "none" });

    if (!series.length) {
      svg.appendChild(s("text", { x: W / 2, y: H / 2 + 4, "class": "label",
        "text-anchor": "middle", "font-size": 11, text: "no data" }));
      return svg;
    }

    var x = function (i) {
      return series.length === 1 ? W / 2 : i * W / (series.length - 1);
    };
    var y = function (v) { return 5 + (1 - v) * (H - 12); };

    svg.appendChild(s("line", { "class": "grid", x1: 0, x2: W,
      y1: y(1), y2: y(1) }));

    if (series.length > 1) {
      svg.appendChild(s("polyline", {
        "class": "line", stroke: colour, "stroke-width": 2,
        points: series.map(function (p, i) { return x(i) + "," + y(p.rate); }).join(" ")
      }));
    }
    series.forEach(function (p, i) {
      svg.appendChild(s("circle", {
        cx: x(i), cy: y(p.rate), r: p.thin ? 2 : 3,
        fill: p.thin ? "none" : colour, stroke: colour, "stroke-width": 1.5
      }));
    });
    return svg;
  }

  // ------------------------------------------------------------------------
  // sections
  // ------------------------------------------------------------------------

  function tile(value, label, sub) {
    return el("div", { "class": "tile" }, [
      el("div", { "class": "value", text: value }),
      el("div", { "class": "label", text: label }),
      sub ? el("div", { "class": "sub", text: sub }) : null
    ]);
  }

  function renderSummary() {
    var span = model.span;
    var overall = model.overall;
    var pace = model.pace;

    dom.tiles.innerHTML = "";
    [
      tile(pct(overall.rate), "right first go",
           overall.n + " first tries, " + pct(overall.lo) + "–" + pct(overall.hi)),
      tile(String(span.rounds), "rounds played",
           span.words + " words, " + model.attempts.length + " letters placed"),
      tile(secs(pace.opening && pace.opening.median), "typical first move",
           "includes hearing the word read out"),
      tile(when(span.from) === when(span.to) ? when(span.from)
             : when(span.from) + " – " + when(span.to), "practice logged",
           span.devices > 1 ? span.devices + " devices" : null)
    ].forEach(function (t) { dom.tiles.appendChild(t); });

    if (span.withPool < model.firsts.length) {
      dom.poolNote.hidden = false;
      dom.poolNote.textContent =
        (model.firsts.length - span.withPool) + " of " + model.firsts.length
        + " attempts predate the change that records which letters were on "
        + "offer. Those sit out of the “took the partner” figures, which is "
        + "why some counts there are smaller than the error counts.";
    } else {
      dom.poolNote.hidden = true;
    }
  }

  function renderFocus() {
    dom.focus.innerHTML = "";
    model.focus.forEach(function (item) {
      dom.focus.appendChild(el("div", { "class": "focus-item is-" + item.kind }, [
        el("h3", { text: item.headline }),
        el("p", { text: item.detail })
      ]));
    });
  }

  function renderLetters() {
    dom.letters.innerHTML = "";

    var tricky = model.listed.filter(function (l) { return l.tricky; });
    var others = model.listed.filter(function (l) { return !l.tricky; });
    var shown = tricky.concat(others.slice(0, 8)).sort(function (a, b) {
      if (a.n < A.MIN_FOR_RATE && b.n >= A.MIN_FOR_RATE) return 1;
      if (b.n < A.MIN_FOR_RATE && a.n >= A.MIN_FOR_RATE) return -1;
      return a.score.rate - b.score.rate;
    });
    var alsoRan = others.slice(8);

    shown.forEach(function (l) {
      var thin = l.n < A.MIN_FOR_RATE;
      var colour = colourFor(l.letter);

      var pull = "";
      if (l.tricky) {
        pull = l.partnerPull
          ? "took “" + A.PARTNER[l.letter] + "” " + l.partnerTaken + "/" + l.partnerPull.n
          : "no pool recorded";
      }

      dom.letters.appendChild(el("div", {
        "class": "letter-row" + (thin ? " is-thin" : "")
      }, [
        el("div", { "class": "glyph", "data-letter": l.letter, text: l.letter }),
        el("div", {}, [
          el("div", { "class": "figure", text: thin ? "–" : pct(l.score.rate) }),
          el("div", { "class": "count", text: l.right + "/" + l.n })
        ]),
        masteryBar(l.score, colour),
        el("div", { "class": "note-inline", text: thin ? "too few to rank" : pull })
      ]));
    });

    if (alsoRan.length) {
      dom.letters.appendChild(el("p", { "class": "footnote",
        text: alsoRan.length + " further letters she gets right more often "
          + "than these are left off: " + alsoRan.map(function (l) {
            return l.letter + " " + pct(l.score.rate);
          }).join(", ") + "." }));
    }

    if (model.unlisted.length) {
      var seen = model.unlisted.reduce(function (n, l) { return n + l.n; }, 0);
      dom.letters.appendChild(el("p", { "class": "footnote",
        text: model.unlisted.length + " other letters (" + seen + " attempts "
          + "between them) have come up too few times each to say anything "
          + "about: " + model.unlisted.map(function (l) { return l.letter; })
            .sort().join(" ") + "." }));
    }
  }

  function renderConfusion() {
    var conf = model.confusion;

    // Rows are letters she was asked for and got wrong; columns what she put.
    var rows = Object.keys(conf.matrix).sort();
    var cols = {};
    rows.forEach(function (r) {
      Object.keys(conf.matrix[r]).forEach(function (c) { cols[c] = true; });
    });
    var colList = Object.keys(cols).sort();

    dom.matrixWrap.innerHTML = "";
    if (!rows.length) {
      dom.matrixWrap.appendChild(el("p", { "class": "footnote",
        text: "No wrong first tries logged yet — nothing to put in a grid." }));
    } else {
      var most = 0;
      rows.forEach(function (r) {
        colList.forEach(function (c) { most = Math.max(most, conf.matrix[r][c] || 0); });
      });

      var head = el("tr", {}, [el("th", { text: "" })].concat(
        colList.map(function (c) { return el("th", { text: c }); })));

      var body = rows.map(function (r) {
        return el("tr", {}, [el("th", { "class": "row-head", text: r })].concat(
          colList.map(function (c) {
            var n = conf.matrix[r][c] || 0;
            if (r === c) return el("td", {}, [el("div", { "class": "cell is-self", text: "·" })]);
            var partner = A.PARTNER[r] === c;
            var cell = el("div", {
              "class": "cell" + (n ? "" : " is-empty") + (partner ? " is-partner" : ""),
              text: n ? String(n) : "·"
            });
            if (n) {
              cell.style.background = "rgba(251, 138, 92, " +
                (0.16 + 0.62 * (n / most)).toFixed(2) + ")";
            }
            return el("td", {}, [cell]);
          })));
      });

      dom.matrixWrap.appendChild(el("div", { "class": "scroller" }, [
        el("table", { "class": "matrix" }, [
          el("thead", {}, [head]),
          el("tbody", {}, body)
        ])
      ]));
      dom.matrixWrap.appendChild(el("p", { "class": "footnote",
        text: "Rows are the letter that belonged there; columns are what she "
          + "put instead. Ringed cells are the confusable partner." }));
    }

    // The pairs, with the denominator that matters.
    dom.pairs.innerHTML = "";
    if (!conf.pairs.length) {
      dom.pairs.appendChild(el("p", { "class": "footnote", text: "Nothing yet." }));
      return;
    }

    var trendFor = {};
    model.pairTrends.forEach(function (t) { trendFor[t.pair.key] = t; });

    var rowsOut = conf.pairs.slice(0, 12).map(function (p) {
      var trend = trendFor[p.key];
      var say = trend ? trend.progress.say : null;
      return el("tr", {}, [
        el("td", { "class": "swap" }, [
          el("span", { "class": "glyph", "data-letter": p.want,
            style: "font-size:16px;display:inline" , text: p.want }),
          " → ",
          el("span", { "class": "glyph", "data-letter": p.got,
            style: "font-size:16px;display:inline", text: p.got })
        ]),
        el("td", {}, [p.partner ? el("span", { "class": "tag is-partner",
          text: "partner" }) : null]),
        el("td", { "class": "num", text: String(p.n) }),
        el("td", { "class": "num",
          text: p.rate ? pct(p.rate.rate) + " of " + p.rate.n : "–" }),
        el("td", {}, [say ? el("span", {
          "class": "tag" + (say.direction < 0 && say.sure ? " is-better"
                  : say.direction > 0 && say.sure ? " is-worse" : ""),
          text: say.say
        }) : el("span", { "class": "note-inline", text: "–" })])
      ]);
    });

    dom.pairs.appendChild(el("div", { "class": "scroller" }, [
      el("table", {}, [
        el("thead", {}, [el("tr", {}, [
          el("th", { text: "swap" }),
          el("th", { text: "" }),
          el("th", { "class": "num", text: "times" }),
          el("th", { "class": "num", text: "when offered" }),
          el("th", { text: "trend" })
        ])]),
        el("tbody", {}, rowsOut)
      ])
    ]));
    dom.pairs.appendChild(el("p", { "class": "footnote",
      text: "“When offered” is the honest denominator: she can only put a “d” "
        + "where a “b” belongs if a “d” was on the table. A falling swap rate "
        + "is an improvement, so those trends read the other way round." }));
  }

  function renderTrends() {
    dom.overallTrend.innerHTML = "";
    var series = model.accuracyOverTime;
    dom.overallTrend.appendChild(rateChart(series, {
      colour: GO, label: "first-try accuracy per round"
    }));

    var grouped = series.length && series[0].rounds > 1;
    if (grouped) {
      dom.overallTrend.appendChild(el("p", { "class": "footnote",
        text: "Rounds are grouped " + series[0].rounds + " at a time — there "
          + "are more of them than fit as a readable line, and grouping puts "
          + "more attempts behind each point." }));
    }

    var p = model.overallProgress;
    var ends = model.sinceTheStart;
    dom.overallVerdict.innerHTML = "";

    dom.overallVerdict.appendChild(el("div", {
      text: p.cmp && p.cmp.delta !== null
        ? "Across the halves: " + pct(p.cmp.before.rate) + " over her first "
          + p.cmp.before.n + " tries, " + pct(p.cmp.after.rate) + " over her "
          + "last " + p.cmp.after.n + ". " + capitalise(p.say.moved) + "."
        : "Not enough attempts to compare a before and an after yet."
    }));

    if (ends.enough) {
      var agree = ends.say.sure === p.say.sure;
      dom.overallVerdict.appendChild(el("div", { style: "margin-top:6px", text:
        "At the ends: " + pct(ends.cmp.before.rate) + " over her first "
        + ends.span + " rounds, " + pct(ends.cmp.after.rate) + " over her last "
        + ends.span + ". " + capitalise(ends.say.moved) + "."
        + (agree ? ""
           : ends.say.sure
             ? " The ends have moved while the halves have not, which is what "
               + "learning early and then holding steady looks like."
             : " The halves have moved while the ends have not — so the gain "
               + "is spread through the middle rather than sitting at the "
               + "start.")
      }));
    }

    dom.smalls.innerHTML = "";
    model.letterTrends.forEach(function (t) {
      var colour = colourFor(t.letter);
      var cmp = t.progress.cmp;
      dom.smalls.appendChild(el("div", { "class": "small" }, [
        el("header", {}, [
          el("span", { "class": "glyph", "data-letter": t.letter, text: t.letter }),
          el("span", { "class": "count",
            text: cmp && cmp.delta !== null
              ? pct(cmp.before.rate) + " → " + pct(cmp.after.rate) : "–" })
        ]),
        sparkline(t.series, colour),
        el("div", { "class": "note-inline", text:
          t.progress.say.sure ? t.progress.say.say
          : t.bookends.enough && t.bookends.say.sure
            ? t.bookends.say.say + " at the ends"
            : t.progress.say.say })
      ]));
    });
  }

  function renderPace() {
    var pace = model.pace;

    dom.paceChart.innerHTML = "";
    dom.paceChart.appendChild(paceChart(pace.series));

    dom.paceLegend.innerHTML = "";
    [["got it right", GO], ["got it wrong", WARN]].forEach(function (pair) {
      dom.paceLegend.appendChild(el("span", {}, [
        el("i", { style: "background:" + pair[1] }),
        pair[0]
      ]));
    });

    var faster = pace.faster;
    dom.paceVerdict.textContent = faster.enough
      ? "On the ones she gets right: " + secs(faster.before) + " in her first "
        + faster.n / 2 + " attempts, " + secs(faster.after) + " in her last. "
        + (Math.abs(faster.shift) < 0.05
            ? "Effectively unchanged — but remember most of this is the word "
              + "being read aloud, which does not get shorter."
            : (faster.shift < 0 ? "About " + Math.abs(Math.round(faster.shift * 100))
                + "% quicker." : "About " + Math.round(faster.shift * 100)
                + "% slower."))
      : "Not enough timed attempts to compare a before and an after yet.";

    var rush = pace.rushing;
    dom.rushing.innerHTML = "";
    if (!rush.enough) {
      dom.rushing.appendChild(el("p", { "class": "footnote",
        text: "Needs at least " + (A.MIN_FOR_RATE * 2) + " timed first tries "
          + "before her quick answers can be compared with her slow ones. "
          + "There are " + rush.n + "." }));
    } else {
      var real = rush.cmp && rush.cmp.lo > 0;
      dom.rushing.appendChild(el("div", { "class": "cards two" }, [
        el("div", { "class": "card" }, [
          el("div", { "class": "value figure", style: "font-size:24px;font-weight:700",
            text: pct(rush.fast.rate) }),
          el("div", { "class": "label", style: "color:var(--ink-faint);font-size:12.5px",
            text: "when she answers fastest" }),
          el("div", { "class": "sub",
            text: rush.fast.k + "/" + rush.fast.n + " — her quickest quarter, "
              + "under " + secs(rush.fastUnder) })
        ]),
        el("div", { "class": "card" }, [
          el("div", { "class": "value figure", style: "font-size:24px;font-weight:700",
            text: pct(rush.slow.rate) }),
          el("div", { "class": "label", style: "color:var(--ink-faint);font-size:12.5px",
            text: "when she takes her time" }),
          el("div", { "class": "sub",
            text: rush.slow.k + "/" + rush.slow.n + " — her slowest quarter, "
              + "over " + secs(rush.slowOver) })
        ])
      ]));
      dom.rushing.appendChild(el("p", { "class": "footnote",
        text: real
          ? "The gap holds up once the small numbers are allowed for. Slowing "
            + "her down would be worth more than more practice."
          : "The two overlap once the small numbers are allowed for, so there "
            + "is no evidence here that hurrying costs her accuracy." }));
    }
  }

  function renderWords() {
    dom.words.innerHTML = "";
    var list = model.problemWords.slice(0, 25);
    var repeats = model.problemWords.filter(function (w) { return w.recurring; }).length;

    if (!list.length) {
      dom.words.appendChild(el("p", { "class": "footnote",
        text: "She has not got a word wrong yet in this log." }));
      return;
    }

    dom.words.appendChild(el("div", { "class": "scroller" }, [
      el("table", {}, [
        el("thead", {}, [el("tr", {}, [
          el("th", { text: "word" }),
          el("th", { "class": "num", text: "right" }),
          el("th", { "class": "num", text: "rounds" }),
          el("th", { text: "usual slip" }),
          el("th", { "class": "num", text: "grade" }),
          el("th", { text: "" })
        ])]),
        el("tbody", {}, list.map(function (w) {
          return el("tr", {}, [
            el("td", { "class": "word-cell", text: w.word }),
            el("td", { "class": "num", text: w.right + "/" + w.n }),
            el("td", { "class": "num", text: String(w.rounds) }),
            el("td", { "class": "swap", text: w.worst || "–" }),
            el("td", { "class": "num", text: w.grade === null ? "–" : String(w.grade) }),
            el("td", {}, [w.recurring
              ? el("span", { "class": "tag is-worse", text: "keeps catching" })
              : null])
          ]);
        }))
      ])
    ]));

    dom.words.appendChild(el("p", { "class": "footnote",
      text: repeats
        ? repeats + " of these have caught her in more than one round — those "
          + "are the ones worth drilling. The rest went wrong once and may "
          + "simply have been a bad moment."
        : "None of these has come round a second time yet, so none of them has "
          + "shown itself to be a difficult word rather than a difficult "
          + "moment. Words she meets again will sort themselves out of this "
          + "list or to the top of it." }));
  }

  function bandTable(rows, headings, nameOf) {
    return el("div", { "class": "scroller" }, [
      el("table", {}, [
        el("thead", {}, [el("tr", {}, [
          el("th", { text: headings[0] }),
          el("th", { "class": "num", text: "right" }),
          el("th", { "class": "num", text: "of" }),
          el("th", { text: "" })
        ])]),
        el("tbody", {}, rows.map(function (r) {
          return el("tr", {}, [
            el("td", { text: nameOf(r) }),
            el("td", { "class": "num",
              text: r.n < A.MIN_FOR_RATE ? "–" : pct(r.score.rate) }),
            el("td", { "class": "num", text: String(r.n) }),
            el("td", {}, [masteryBar(r.score, NUDGE)])
          ]);
        }))
      ])
    ]);
  }

  function renderShape() {
    dom.positions.innerHTML = "";
    dom.positions.appendChild(model.positions.length
      ? bandTable(model.positions, ["where in the word"], function (r) { return r.band; })
      : el("p", { "class": "footnote", text: "Nothing yet." }));

    dom.stamina.innerHTML = "";
    dom.stamina.appendChild(model.stamina.length
      ? bandTable(model.stamina, ["word in the round"], function (r) { return r.band; })
      : el("p", { "class": "footnote", text: "Nothing yet." }));

    dom.grades.innerHTML = "";
    dom.grades.appendChild(model.grades.length
      ? bandTable(model.grades, ["word difficulty"], function (r) {
          return "grade " + r.grade;
        })
      : el("p", { "class": "footnote", text: "Nothing yet." }));
  }

  function capitalise(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  // ------------------------------------------------------------------------
  // loading
  // ------------------------------------------------------------------------

  function show(records) {
    try {
      model = A.build(records);
    } catch (err) {
      fail("That file did not parse as a practice log: " + err.message);
      return;
    }

    if (!model.attempts.length) {
      fail("No attempts in that file. It parsed, but there are no “word” "
         + "records with tries in it — check it is the logs collection and "
         + "not something else.");
      return;
    }

    dom.error.hidden = true;
    dom.dropzone.hidden = true;
    dom.report.hidden = false;

    renderSummary();
    renderFocus();
    renderLetters();
    renderConfusion();
    renderTrends();
    renderPace();
    renderWords();
    renderShape();

    global.ANALYTICS_MODEL = model;      // for the tests, and for a console poke
    document.title = "Practice log — " + model.span.rounds + " rounds";
  }

  function fail(message) {
    dom.error.hidden = false;
    dom.error.textContent = message;
    dom.report.hidden = true;
    dom.dropzone.hidden = false;
  }

  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        show(JSON.parse(String(reader.result)));
      } catch (err) {
        fail("Could not read " + file.name + ": " + err.message);
      }
    };
    reader.onerror = function () { fail("Could not read " + file.name + "."); };
    reader.readAsText(file);
  }

  function wire() {
    dom.pick.addEventListener("change", function () {
      if (dom.pick.files && dom.pick.files[0]) readFile(dom.pick.files[0]);
    });
    dom.pickBtn.addEventListener("click", function () { dom.pick.click(); });

    ["dragenter", "dragover"].forEach(function (name) {
      document.addEventListener(name, function (event) {
        event.preventDefault();
        dom.dropzone.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      document.addEventListener(name, function (event) {
        event.preventDefault();
        if (name === "dragleave" && event.relatedTarget) return;
        dom.dropzone.classList.remove("is-over");
      });
    });
    document.addEventListener("drop", function (event) {
      var file = event.dataTransfer && event.dataTransfer.files[0];
      if (file) readFile(file);
    });
  }

  function boot() {
    ["tiles", "poolNote", "focus", "letters", "matrixWrap", "pairs",
     "overallTrend", "overallVerdict", "smalls", "paceChart", "paceLegend",
     "paceVerdict", "rushing", "words", "positions", "stamina", "grades",
     "report", "dropzone", "error", "pick", "pickBtn"].forEach(function (id) {
      dom[id] = document.getElementById(id);
    });
    wire();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /* The tests drive this directly rather than going through a file picker. */
  global.Analytics = { show: show, model: function () { return model; } };
})(window);
