/* ==========================================================================
   livelog.js — reading the practice log straight out of Firestore.

   The game writes with a public key that firestore.rules refuses reads to,
   which is the whole reason the log is not readable by anyone who views
   source on the game. So reading it back needs somebody signed in, and
   `readers()` in firestore.rules says who that may be.

   Signing in uses Firebase Auth; reading uses the plain REST API with the
   resulting token. The Auth SDK is loaded from Google's CDN because doing
   the OAuth dance by hand is a lot of fiddly code to get subtly wrong, and
   this page - unlike the games - is only ever used online by a grown-up. The
   Firestore SDK is not loaded at all: a GET with a bearer token is a GET.

   Nothing here writes. There is no code path in this file that can modify
   the log, which is the point of it being a separate file from the one the
   game ships.
   ========================================================================== */

(function (global) {
  "use strict";

  var SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  var PAGE = 300;

  /* The same public config the game writes with. Safe in a public repo:
     Google documents it as non-secret, and firestore.rules is the boundary. */
  var CONFIG = {
    apiKey: "AIzaSyCFabIJPnpzG8ZxGqtE5xK851i5em5gzCc",
    authDomain: "cooper-spelling.firebaseapp.com",
    projectId: "cooper-spelling"
  };

  /* Overridable so the tests can point the whole thing at an emulator. */
  var host = "https://firestore.googleapis.com";

  var ready = null;

  function loadScript(src) {
    return new global.Promise(function (resolve, reject) {
      var tag = document.createElement("script");
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = function () { reject(new Error("could not load " + src)); };
      document.head.appendChild(tag);
    });
  }

  /* Loaded on demand rather than in the page head: somebody who only wants to
     open a downloaded file should not be made to wait for Google's CDN, or be
     stopped by it being unreachable. */
  function loadSdk() {
    if (ready) return ready;
    if (global.firebase && global.firebase.auth) {
      ready = global.Promise.resolve();
      return ready;
    }

    ready = loadScript(SDK + "firebase-app-compat.js")
      .then(function () { return loadScript(SDK + "firebase-auth-compat.js"); })
      .then(function () {
        if (!global.firebase.apps.length) global.firebase.initializeApp(CONFIG);
      });
    return ready;
  }

  /* Has anybody ever signed in on this browser? The compat SDK keeps the
     session in localStorage under a predictable key, so this can be answered
     without loading the SDK at all.

     Worth the small ugliness: without it, every visit fetches a couple of
     hundred kilobytes from Google's CDN before anything appears, including
     the visits where somebody only wants to drop a file on the page. And when
     the CDN is unreachable - offline, or on a network that blocks it - that
     fetch fails noisily for no reason. */
  function seenBefore() {
    try {
      for (var i = 0; i < global.localStorage.length; i++) {
        if (global.localStorage.key(i).indexOf("firebase:authUser:") === 0) {
          return true;
        }
      }
    } catch (err) { /* no storage; assume not */ }
    return false;
  }

  function currentUser() {
    return global.firebase && global.firebase.apps.length
      ? global.firebase.auth().currentUser : null;
  }

  var LiveLog = {
    /* Whether this build knows where to look at all. */
    configured: function () {
      return !!(CONFIG.projectId && CONFIG.apiKey);
    },

    project: function () { return CONFIG.projectId; },

    /* Point at an emulator instead. Tests only. */
    useHost: function (url, project) {
      host = url;
      if (project) CONFIG.projectId = project;
    },

    /* Resolves to a user, or rejects with something worth showing. */
    signIn: function () {
      return loadSdk()["catch"](function () {
        throw new Error("Could not load Google sign-in. Check the connection, "
          + "or open a downloaded log file instead.");
      }).then(function () {
        var auth = global.firebase.auth();
        var provider = new global.firebase.auth.GoogleAuthProvider();

        /* Popup rather than redirect: a redirect would lose any file already
           open on the page, and this is a desktop-shaped tool. */
        return auth.signInWithPopup(provider).then(function (result) {
          return result.user;
        });
      });
    },

    signOut: function () {
      return loadSdk().then(function () { return global.firebase.auth().signOut(); });
    },

    /* Whoever is already signed in from last time, or null. Firebase restores
       the session asynchronously, so this waits for the first answer rather
       than reporting a premature no. */
    whoever: function () {
      if (!this.configured()) return global.Promise.resolve(null);
      if (!seenBefore()) return global.Promise.resolve(null);

      return loadSdk().then(function () {
        return new global.Promise(function (resolve) {
          var stop = global.firebase.auth().onAuthStateChanged(function (user) {
            stop();
            resolve(user || null);
          });
        });
      })["catch"](function () { return null; });
    },

    /* Every record in the collection, oldest first.

       Paged, because a year of practice is a few thousand documents and
       Firestore will not hand them over in one go. `onPage` is called as each
       page lands so the page can count up rather than sit blank. */
    fetchAll: function (onPage) {
      var user = currentUser();
      if (!user) return global.Promise.reject(new Error("not signed in"));

      var base = host + "/v1/projects/" + CONFIG.projectId +
                 "/databases/(default)/documents/logs";
      var records = [];

      function page(token, idToken) {
        var url = base + "?pageSize=" + PAGE + (token ? "&pageToken=" + encodeURIComponent(token) : "");

        return global.fetch(url, {
          headers: { Authorization: "Bearer " + idToken }
        }).then(function (response) {
          return response.text().then(function (body) {
            return { response: response, body: body };
          });
        }).then(function (result) {
          if (!result.response.ok) throw describe(result.response.status, result.body, user);

          var parsed = JSON.parse(result.body || "{}");
          (parsed.documents || []).forEach(function (doc) {
            records.push(global.Analysis.decode([doc])[0]);
          });

          if (onPage) onPage(records.length);
          if (parsed.nextPageToken) return page(parsed.nextPageToken, idToken);

          records.sort(function (a, b) {
            return (a.t || 0) - (b.t || 0) || (a.n || 0) - (b.n || 0);
          });
          return records;
        });
      }

      return user.getIdToken().then(function (idToken) {
        return page("", idToken);
      });
    }
  };

  /* Errors worth reading. The one that will actually happen is the first:
     signing in works, and then the rules say no because nobody has been added
     to readers() yet. Telling somebody exactly what to paste where turns a
     dead end into a thirty second job. */
  function describe(code, body, user) {
    var message = "";
    try {
      message = (JSON.parse(body).error || {}).message || "";
    } catch (err) { /* not JSON */ }

    if (code === 403 || code === 401) {
      var err = new Error("Signed in, but the rules do not allow this account "
        + "to read the log yet.");
      err.needsReader = true;
      err.uid = user ? user.uid : "";
      err.email = user ? user.email : "";
      return err;
    }
    if (code === 404) {
      return new Error("No logs collection in " + CONFIG.projectId
        + " yet — nothing has been uploaded.");
    }
    return new Error("Firestore answered " + code + ". " + message);
  }

  global.LiveLog = LiveLog;
})(window);
