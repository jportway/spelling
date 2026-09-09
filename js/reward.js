/* ==========================================================================
   reward.js — what happens when the balloon goes.

   This is the only part of either game that touches the network, so it is
   built to be entirely optional. Nothing here loads until the balloon
   actually bursts, and every route through it ends in a celebration even
   when there is no connection, no configuration and no YouTube.

   Three sources, tried in order:

     1. VIDEOS below - a list you have watched yourself. Best option.
     2. CHANNEL_ID  - a random video from that channel's uploads. No API key
                      is involved, so there is no secret to leak out of a
                      public repository; the trade is that a random pick from
                      a whole back catalogue is sometimes an advert or a
                      two hour compilation.
     3. Neither, or the video will not load - a full screen party instead.
   ========================================================================== */

(function (global) {
  "use strict";

  /* ----------------------------------------------------------------------
     The knobs. Both are meant to be edited by hand.
     ---------------------------------------------------------------------- */

  /* Videos you have picked. Just the id - the part of a YouTube link after
     "v=" or after "youtu.be/". One per line. When this list has anything in
     it at all, it is used and the channel below is ignored.

       var VIDEOS = [
         "dQw4w9WgXcQ",
         "aAkMkVFwAoo"
       ]; */
  var VIDEOS = [];

  /* Otherwise, a random video from this channel. Needs the real channel id,
     which starts "UC" - the @name or /c/name in the address bar is not it.
     To find it: open the channel, view source, and search for "channelId".
     Leave it empty and the balloon bursts into a party instead. */
  var CHANNEL_ID = "";

  /* How long to wait for YouTube before giving up and throwing the party.
     She has just popped a balloon; she is not going to sit through a spinner. */
  var PATIENCE_MS = 6000;

  // ------------------------------------------------------------------------

  var dom = {};
  var onDone = null;
  var player = null;
  var settled = false;
  var patience = null;
  var partyTimer = null;

  function videoUrl() {
    var params =
      "?autoplay=1&playsinline=1&rel=0&modestbranding=1&fs=0&disablekb=1" +
      "&iv_load_policy=3&enablejsapi=1&origin=" +
      encodeURIComponent(global.location.origin);

    if (VIDEOS.length) {
      var id = VIDEOS[(Math.random() * VIDEOS.length) | 0];
      return "https://www.youtube-nocookie.com/embed/" + id + params;
    }

    if (/^UC[\w-]{20,24}$/.test(CHANNEL_ID)) {
      // Every channel's uploads live in a playlist whose id is the channel
      // id with UC swapped for UU. Picking an index into it gets a different
      // video each time without asking YouTube anything first.
      var uploads = "UU" + CHANNEL_ID.slice(2);
      var index = (Math.random() * 40) | 0;
      return "https://www.youtube-nocookie.com/embed/videoseries" + params +
             "&list=" + uploads + "&index=" + index;
    }

    return "";
  }

  /* No video, or no way to reach it. She still gets a moment. */
  function party() {
    if (dom.video) dom.video.innerHTML = "";
    if (dom.party) dom.party.hidden = false;
    if (dom.frame) dom.frame.hidden = true;

    global.Confetti.celebrate();
    global.Kitten.react("bigcheer");

    var bursts = 0;
    global.clearInterval(partyTimer);
    partyTimer = global.setInterval(function () {
      if (++bursts > 5) {
        global.clearInterval(partyTimer);
        return;
      }
      global.Confetti.burst(
        Math.random() * global.innerWidth,
        global.innerHeight * (0.3 + Math.random() * 0.4),
        1.3
      );
      global.Kitten.react("bigcheer");
    }, 900);
  }

  function settle(ok) {
    if (settled) return;
    settled = true;
    global.clearTimeout(patience);
    if (!ok) party();
  }

  /* The IFrame API, fetched only now and only if there is something to
     play. If it will not come, that is not an error - it is a party. */
  function withApi(then) {
    if (global.YT && global.YT.Player) {
      then(true);
      return;
    }

    var done = false;
    var finish = function (ok) {
      if (done) return;
      done = true;
      then(ok);
    };

    var previous = global.onYouTubeIframeAPIReady;
    global.onYouTubeIframeAPIReady = function () {
      if (typeof previous === "function") previous();
      finish(true);
    };

    var script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.addEventListener("error", function () { finish(false); });
    document.head.appendChild(script);

    global.setTimeout(function () { finish(false); }, PATIENCE_MS);
  }

  function playVideo(url) {
    dom.party.hidden = true;
    dom.frame.hidden = false;
    dom.frame.innerHTML = "";

    var frame = document.createElement("iframe");
    frame.className = "reward-frame";
    frame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.setAttribute("title", "Your reward video");
    frame.src = url;
    dom.frame.appendChild(frame);

    patience = global.setTimeout(function () { settle(false); }, PATIENCE_MS);

    withApi(function (ok) {
      if (!ok) {
        settle(false);
        return;
      }
      try {
        player = new global.YT.Player(frame, {
          events: {
            onReady: function () { settle(true); },
            onError: function () { settle(false); },
            onStateChange: function (event) {
              // Ended. Close on her behalf rather than leaving her sitting
              // in front of whatever YouTube decides to suggest next.
              if (event.data === 0) Reward.close();
            }
          }
        });
      } catch (err) {
        settle(false);
      }
    });
  }

  var Reward = {
    enabled: true,

    init: function (options) {
      dom = options;
      if (dom.doneBtn) {
        dom.doneBtn.addEventListener("click", function () { Reward.close(); });
      }
    },

    show: function (done) {
      onDone = done || null;
      settled = false;
      player = null;

      dom.screen.classList.add("is-open");

      var url = this.enabled ? videoUrl() : "";
      if (url) {
        playVideo(url);
      } else {
        settle(true);
        party();
      }
    },

    close: function () {
      global.clearTimeout(patience);
      global.clearInterval(partyTimer);

      if (player && typeof player.destroy === "function") {
        try {
          player.destroy();
        } catch (err) {
          /* Already gone. */
        }
      }
      player = null;

      // Emptying the container stops the audio dead, which matters more than
      // it sounds: a video still talking over the results screen is horrible.
      if (dom.frame) dom.frame.innerHTML = "";
      if (dom.screen) dom.screen.classList.remove("is-open");
      global.Confetti.clear();

      var finished = onDone;
      onDone = null;
      if (finished) finished();
    }
  };

  global.Reward = Reward;
})(window);
