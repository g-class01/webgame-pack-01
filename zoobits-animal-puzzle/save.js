// ============================================================================
// Zoobits — progress storage.
//
// Thin, defensive wrapper over localStorage. Everything is validated on read:
// the stored blob is user-editable, and a corrupt entry must never stop the
// game from starting.
//
// Exposes window.ZooSave with:
//   load() -> { found, cleared: [levelIndex...], resume: levelIndex }
//   save(state) -> boolean
//   wipe()
// ============================================================================

(function () {
  "use strict";

  var KEY = "zoobits.save.v4";
  var VERSION = 4;

  // Older builds wrote separate keys. They are read once, migrated, then dropped.
  var LEGACY = ["zoobits.save", "zoobits.progress", "zoobits.level", "zoobits.worlds"];

  var store = (function () {
    try {
      var probe = "__zoobits_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (err) {
      return null;
    }
  })();

  function isIndex(value) {
    return typeof value === "number" && isFinite(value) && value % 1 === 0 && value >= 0;
  }

  // Deduplicated, ascending list of level indexes.
  function levelList(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    for (var i = 0; i < value.length; i++) {
      if (isIndex(value[i]) && out.indexOf(value[i]) === -1) out.push(value[i]);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  function readJSON(raw) {
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  // Fold anything an older build might have left behind into the current shape.
  function readLegacy() {
    if (!store) return null;
    var found = false;
    var cleared = [];
    var resume = 0;
    var muted = false;

    for (var i = 0; i < LEGACY.length; i++) {
      var raw;
      try {
        raw = store.getItem(LEGACY[i]);
      } catch (err) {
        continue;
      }
      if (!raw) continue;

      var doc = readJSON(raw);
      if (doc) {
        if (doc.cleared || doc.done) {
          cleared = cleared.concat(levelList(doc.cleared || doc.done));
          found = true;
        }
        if (typeof doc.muted === "boolean") {
          muted = doc.muted;
          found = true;
        }
        if (isIndex(doc.level)) {
          resume = doc.level;
          found = true;
          // A resume index with no explicit list implies everything before it.
          if (!doc.done && !doc.cleared) {
            for (var n = 0; n < doc.level; n++) cleared.push(n);
          }
        }
        continue;
      }

      // Legacy plain value: a bare level index.
      var asNumber = parseInt(raw, 10);
      if (isFinite(asNumber) && asNumber >= 0) {
        if (LEGACY[i] === "zoobits.level") {
          resume = asNumber;
          for (var k = 0; k < asNumber; k++) cleared.push(k);
        }
        found = true;
      }
    }

    return found ? { cleared: levelList(cleared), resume: resume, muted: muted } : null;
  }

  function dropLegacy() {
    if (!store) return;
    for (var i = 0; i < LEGACY.length; i++) {
      try { store.removeItem(LEGACY[i]); } catch (err) { /* storage disabled */ }
    }
  }

  var api = {
    key: KEY,
    version: VERSION,
    supported: !!store,

    load: function () {
      var empty = { found: false, cleared: [], resume: 0, muted: false };
      if (!store) return empty;

      var raw;
      try {
        raw = store.getItem(KEY);
      } catch (err) {
        return empty;
      }

      var doc = readJSON(raw);
      if (doc && doc.v === VERSION) {
        return {
          found: true,
          cleared: levelList(doc.cleared),
          resume: isIndex(doc.resume) ? doc.resume : 0,
          muted: doc.muted === true
        };
      }

      var legacy = readLegacy();
      if (legacy) {
        api.save(legacy);
        dropLegacy();
        return {
          found: true,
          cleared: legacy.cleared,
          resume: legacy.resume,
          muted: legacy.muted === true
        };
      }

      return empty;
    },

    save: function (state) {
      if (!store) return false;
      var doc = {
        v: VERSION,
        cleared: levelList(state && state.cleared),
        resume: isIndex(state && state.resume) ? state.resume : 0,
        muted: !!(state && state.muted),
        at: Date.now()
      };
      try {
        store.setItem(KEY, JSON.stringify(doc));
        return true;
      } catch (err) {
        return false;
      }
    },

    wipe: function () {
      if (!store) return;
      try { store.removeItem(KEY); } catch (err) { /* storage disabled */ }
      dropLegacy();
    }
  };

  window.ZooSave = api;
})();
