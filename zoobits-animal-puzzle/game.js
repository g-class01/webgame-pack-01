/* ============================================================================
 * Zoobits — puzzle engine.
 *
 * Layout and chrome live in index.html + styles.css and are not touched here.
 * This file owns everything behind the board: the grid model, the move rules
 * (exchange / turn / both), the canvas painter, the hint solver, the level
 * flow, the level picker and the boot progress screen.
 *
 * Vocabulary used throughout:
 *   cell   — a fixed seat on the grid, numbered 0..n*n-1 in reading order
 *   part   — one square of the picture, same numbering as the seats it belongs to
 *   group  — a set of adjacent cells whose parts sit correctly next to each other
 *   turn   — quarter turns applied to the part in a cell, 0..3, clockwise
 * ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. Content and tuning
   * ------------------------------------------------------------------ */

  var DATA = window.ZOOBITS_DATA;
  var LEVELS = DATA.LEVELS;
  var ANIMALS = DATA.ANIMAL_INFO;

  var VIDEO_DIR = "tapwap_videos/";
  var THUMB_DIR = "tapwap_thumb_videos/";

  var INK = {
    grout: "#d7c6a0",
    slot: "#ece1c4",
    back: "#c9b489",
    glow: "255, 248, 214",
    seam: "rgba(20,12,4,0.5)"
  };

  var T = {
    swap: 260,
    link: 520,
    bump: 260,
    shake: 320,
    celebrate: 1600,
    hold: 1200,
    turn: 220,
    fade: 320
  };

  var LIMIT = {
    cellBase: 256,
    backing: 1280,
    canvas: 4096,
    render: 2.0
  };

  var TOUCH = {
    dragScale: 1.08,
    tiltSmooth: 0.10,
    tiltMaxDeg: 10,
    tiltGain: 0.012,
    tiltFocal: 2.2,
    tiltStrips: 24,
    selectScale: 1.06,
    selectMs: 130,
    shadowBlur: 0.16,
    dragThreshold: 12
  };

  var PARTY = {
    seedCount: 42,
    gravity: 2.5,
    starInk: ["#ffd23f", "#ff6b9d", "#4be3ac", "#57c7ff", "#b983ff", "#ff9a5a"],
    confettiInk: ["#ff6b9d", "#ffd23f", "#4be3ac", "#57c7ff", "#b983ff", "#ff8c5a", "#ff7eb6"],
    stickers: ["win_star.png", "win_heart.png", "win_flower.png", "win_paw.png", "win_candy.png", "win_bow.png"]
  };

  var HINT = {
    revealMs: 15000,
    startMs: 700,
    liftMs: 850,
    popMs: 300,
    moveMs: 950,
    turnMs: 900,
    stepGapMs: 250,
    popScale: 1.14,
    dimAlpha: 0.5,
    dimFadeMs: 250
  };

  var TUTOR = {
    levelSwap: 0,
    levelTurn: 2,
    levelBoth: 4,
    fadeMs: 320
  };

  // World titles and tab art come from data.js so there is one place to edit them.
  var WORLD_TITLE = {};
  var WORLD_TITLE_VI = {};
  var WORLD_ART = {};
  (function () {
    var list = DATA.WORLDS || [];
    for (var i = 0; i < list.length; i++) {
      WORLD_TITLE[list[i].n] = list[i].en;
      WORLD_TITLE_VI[list[i].n] = list[i].vi;
      WORLD_ART[list[i].n] = list[i].art;
    }
  })();

  // Name shown for a world in the current language.
  function worldName(n) {
    if (LANG === "vi" && WORLD_TITLE_VI[n]) return WORLD_TITLE_VI[n];
    return WORLD_TITLE[n] || ("World " + n);
  }

  var HALF_PI = Math.PI / 2;

  /* ------------------------------------------------------------------ *
   * 2. Small helpers
   * ------------------------------------------------------------------ */

  function colOf(cell, n) { return cell % n; }
  function rowOf(cell, n) { return (cell / n) | 0; }
  function cellAt(c, r, n) { return r * n + c; }

  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t); }
  function easeBack(t) {
    var c1 = 1.45, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function shuffled(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = list[i];
      list[i] = list[j];
      list[j] = t;
    }
    return list;
  }

  function shuffleUntil(build, reject, tries) {
    for (var attempt = 0; attempt < tries; attempt++) {
      var candidate = build();
      if (!reject(candidate)) return candidate;
    }
    return build();
  }

  /* ------------------------------------------------------------------ *
   * 3. Copy
   * ------------------------------------------------------------------ */

  var STRINGS = DATA.STRINGS;
  var LANG = (function () {
    try {
      var asked = new URLSearchParams(location.search).get("lang");
      var tag = (asked || navigator.language || "en").toLowerCase().slice(0, 2);
      return STRINGS[tag] ? tag : "en";
    } catch (err) {
      return "en";
    }
  })();

  function say(key) {
    var table = STRINGS[LANG] || {};
    return table[key] || STRINGS.en[key] || "";
  }

  // Shrink a label until it fits, so no translation ever spills out of its button.
  // Always restarts from the CSS size so a resize can re-fit it.
  function squeeze(el, maxWidth) {
    if (!el || !(maxWidth > 0)) return;
    el.style.fontSize = "";
    var px = parseFloat(getComputedStyle(el).fontSize) || 16;
    var guard = 80;
    while (el.scrollWidth > maxWidth && px > 7 && guard-- > 0) {
      px -= 1;
      el.style.fontSize = px + "px";
    }
  }

  /* ------------------------------------------------------------------ *
   * 4. Sprite sheet
   * ------------------------------------------------------------------ */

  var SHEET = { src: "ui/ui_sheet.png", w: 1599, h: 1621 };
  var BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  var ATLAS = {
    "tab_island_1.png": { x: 6, y: 6, w: 512, h: 512 },
    "tab_island_2.png": { x: 524, y: 6, w: 512, h: 512 },
    "tab_island_3.png": { x: 1042, y: 6, w: 512, h: 512 },
    "tab_island_4.png": { x: 6, y: 524, w: 512, h: 512 },
    "tab_island_5.png": { x: 524, y: 524, w: 512, h: 512 },
    "logo_zoobits.png": { x: 6, y: 1042, w: 800, h: 273 },
    "Checkmark.png": { x: 812, y: 1042, w: 256, h: 256 },
    "Hand.png": { x: 1074, y: 1042, w: 256, h: 256 },
    "lock_cute.png": { x: 1336, y: 1042, w: 256, h: 256 },
    "next_btn_cute.png": { x: 6, y: 1321, w: 354, h: 160 },
    "hint_btn_cute.png": { x: 366, y: 1321, w: 317, h: 160 },
    "play_btn_cute.png": { x: 689, y: 1321, w: 234, h: 160 },
    "PictoIcon_Setting_1.Png": { x: 929, y: 1321, w: 128, h: 128 },
    "PictoIcon_Sound_Off.Png": { x: 1063, y: 1321, w: 128, h: 128 },
    "PictoIcon_Sound_On.Png": { x: 1197, y: 1321, w: 128, h: 128 },
    "win_bow.png": { x: 1331, y: 1321, w: 128, h: 128 },
    "win_candy.png": { x: 1465, y: 1321, w: 128, h: 128 },
    "win_flower.png": { x: 6, y: 1487, w: 128, h: 128 },
    "win_heart.png": { x: 140, y: 1487, w: 128, h: 128 },
    "win_paw.png": { x: 274, y: 1487, w: 128, h: 128 },
    "win_star.png": { x: 408, y: 1487, w: 128, h: 128 }
  };

  var sheetImg = new Image();
  var sheetReady = false;

  // Crop a region out of the sheet with CSS only: no canvas slicing at boot, which
  // used to stall the loader while 21 PNGs were decoded and re-encoded.
  function paintSprite(el, key) {
    if (!el || !key) return;
    el.dataset.uiSprite = key;
    var box = ATLAS[key];
    if (!(sheetReady && box)) {
      el.src = BLANK;
      return;
    }
    el.src = BLANK;
    el.style.aspectRatio = box.w + " / " + box.h;
    el.style.backgroundImage = 'url("' + SHEET.src + '")';
    el.style.backgroundRepeat = "no-repeat";
    el.style.backgroundSize = (SHEET.w / box.w * 100) + "% " + (SHEET.h / box.h * 100) + "%";
    el.style.backgroundPosition =
      (box.x / (SHEET.w - box.w) * 100) + "% " + (box.y / (SHEET.h - box.h) * 100) + "%";
  }

  function setImage(el, path) {
    if (!el) return;
    if (!path) {
      el.removeAttribute("data-ui-sprite");
      el.src = "";
      return;
    }
    var key = path.indexOf("ui/") === 0 ? path.slice(3) : path;
    if (ATLAS[key]) {
      paintSprite(el, key);
    } else {
      el.removeAttribute("data-ui-sprite");
      el.style.backgroundImage = "";
      el.style.aspectRatio = "";
      el.src = path;
    }
  }

  sheetImg.onload = function () {
    sheetReady = true;
    var marked = document.querySelectorAll("img[data-ui-sprite]");
    for (var i = 0; i < marked.length; i++) paintSprite(marked[i], marked[i].dataset.uiSprite);
  };
  sheetImg.src = SHEET.src;

  /* ------------------------------------------------------------------ *
   * 5. Elements
   * ------------------------------------------------------------------ */

  function el(id) { return document.getElementById(id); }

  var dom = {
    video: el("hidden-video"),
    board: el("board"),
    input: el("board-input"),
    wrap: el("board-wrap"),
    worldProgress: el("world-progress"),
    titleRow: el("title-row"),
    ctaSlot: el("cta-slot"),
    hintBtn: el("hint-btn"),
    hintText: el("hint-text"),
    nextBtn: el("next-btn"),
    nextText: el("next-text"),
    tutor: el("tutor-hand"),
    newWorld: el("new-world"),
    newWorldIcon: el("new-world-icon"),
    newWorldText: el("new-world-text"),
    app: el("app"),
    logo: el("lm-logo"),
    gear: el("lm-settings"),
    settings: el("settings-modal"),
    settingsClose: el("settings-close"),
    settingsBack: el("settings-backdrop"),
    mute: el("mute-btn"),
    soundIcon: el("sound-icon"),
    menu: el("level-menu"),
    menuBody: el("level-menu-inner"),
    menuTabs: el("lm-tabs"),
    bgm: el("bgm"),
    winSfx: el("sfx-victory")
  };

  var boardCtx = dom.board.getContext("2d", { alpha: true });
  var HAS_FILTER = "filter" in boardCtx;

  /* ------------------------------------------------------------------ *
   * 6. Audio
   * ------------------------------------------------------------------ */

  var music = {
    started: false,
    muted: false,
    volume: 0.5,
    duckTimer: null,
    sfxArmed: false,
    armedGesture: true
  };

  function refreshSoundIcon() {
    setImage(dom.soundIcon, music.muted ? "ui/PictoIcon_Sound_Off.Png" : "ui/PictoIcon_Sound_On.Png");
    dom.mute.classList.toggle("muted", music.muted);
    dom.mute.setAttribute("aria-pressed", music.muted ? "true" : "false");
  }

  // The mute choice is part of the saved profile, so it survives a reload.
  function setMuted(value) {
    music.muted = !!value;
    dom.bgm.muted = music.muted;
    refreshSoundIcon();
    persist();
  }

  dom.bgm.muted = music.muted;
  refreshSoundIcon();

  function playMusic() {
    if (music.started) { settleMusic(); return; }
    dom.bgm.volume = music.volume;
    var p = dom.bgm.play();
    if (p && p.then) {
      p.then(function () { music.started = true; settleMusic(); }, function () { });
    }
  }

  // One rule governs the track: it runs only when it was started, sound is on and
  // the tab is visible. Re-applied on every change instead of tracking crossed flags.
  function settleMusic() {
    if (music.started && !music.muted && !document.hidden) {
      if (dom.bgm.paused) {
        var p = dom.bgm.play();
        if (p && p.catch) p.catch(function () { });
      }
    } else if (!dom.bgm.paused) {
      try { dom.bgm.pause(); } catch (err) { /* already stopped */ }
    }
  }

  function armSfx() {
    if (music.sfxArmed) return;
    music.sfxArmed = true;
    dom.winSfx.muted = true;
    var p = dom.winSfx.play();
    if (p && p.then) {
      p.then(function () {
        if (dom.winSfx.muted) {
          dom.winSfx.pause();
          dom.winSfx.currentTime = 0;
          dom.winSfx.muted = false;
        }
      }, function () {
        dom.winSfx.muted = false;
        music.sfxArmed = false;
      });
    }
  }

  function firstGesture() {
    if (!music.armedGesture) return;
    music.armedGesture = false;
    window.removeEventListener("pointerdown", firstGesture, true);
    window.removeEventListener("keydown", firstGesture, true);
    window.removeEventListener("touchstart", firstGesture, true);
    armSfx();
    playMusic();
  }
  window.addEventListener("pointerdown", firstGesture, true);
  window.addEventListener("keydown", firstGesture, true);
  window.addEventListener("touchstart", firstGesture, true);

  function chimeWin() {
    if (music.muted || document.hidden) return;
    dom.winSfx.muted = false;
    try { dom.winSfx.currentTime = 0; } catch (err) { /* not seekable yet */ }
    var p = dom.winSfx.play();
    if (p && p.catch) p.catch(function () { });
    dom.bgm.volume = music.volume * 0.3;
    clearTimeout(music.duckTimer);
    music.duckTimer = setTimeout(function () { dom.bgm.volume = music.volume; }, 1900);
  }

  /* ------------------------------------------------------------------ *
   * 7. Progress
   * ------------------------------------------------------------------ */

  var store = window.ZooSave || {
    load: function () { return { found: false, cleared: [], resume: 0 }; },
    save: function () { return false; },
    wipe: function () { }
  };

  var cleared = new Set();
  var seenWorlds = new Set([1]);
  var resumeAt = 0;

  function persist() {
    store.save({
      cleared: Array.from(cleared),
      resume: resumeAt,
      muted: music.muted
    });
  }

  function restoreProgress() {
    var saved = store.load();
    var list = saved.cleared || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] < LEVELS.length && !LEVELS[i].pending) cleared.add(list[i]);
    }
    resumeAt = Math.min(Math.max(0, saved.resume || 0), LEVELS.length - 1);
    setMuted(saved.muted === true);
    return resumeAt;
  }

  function markCleared(i) { cleared.add(i); persist(); }

  function firstOpenLevel() {
    for (var i = 0; i < LEVELS.length; i++) {
      if (!LEVELS[i].pending && !cleared.has(i)) return i;
    }
    return LEVELS.length;
  }

  function noteWorld(w) {
    if (seenWorlds.has(w)) return;
    seenWorlds.add(w);
    persist();
  }

  /* ------------------------------------------------------------------ *
   * 8. Board state
   * ------------------------------------------------------------------ */

  var S = {
    level: 0,
    n: 3,
    mode: "swap",
    part: [],        // cell -> part index
    turn: [],        // cell -> quarter turns applied to that part
    group: [],       // cell -> group id
    groups: [],      // group id -> array of cells
    selected: -1,
    solved: false,
    busy: false,
    drag: null,
    dragOver: -1,
    countdown: null,
    swapFx: null,
    shakeFx: null,
    winFx: null,
    linkFx: null,
    replay: false
  };

  // Per-cell turn animation bookkeeping
  var turnBase = [];
  var turnStart = [];
  var turnAnchor = -1;      // cell currently being turned by a hint (slower)
  var pressCell = -1;
  var pressPointer = null;

  // Geometry, recomputed on layout
  var geo = {
    cell: LIMIT.cellBase,
    gap: 0,
    radius: 0,
    depth: 0,
    inset: 0,
    slotRadius: 0,
    bleed: 0,
    selectWidth: 6,
    side: 0,
    scale: 1
  };

  var frameCanvas = null, frameCtx = null;
  var tiltCanvas = null, tiltCtx = null;
  var glowCanvas = null, glowCtx = null;
  var shadowCanvas = null, shadowCtx = null;
  var scratchCanvas = null, scratchCtx = null;
  var bgCanvas = null, bgCtx = null, bgStale = true;
  var selectGlowA = null, selectGlowB = null;
  var tiltKey = null, tiltMargin = 0, tiltW = 0, tiltH = 0;
  var tiltActive = false, tiltVX = 0, tiltVY = 0, tiltPrevX = 0, tiltPrevY = 0;
  var select = { key: null, cells: null, at: 0, fade: null };
  var hintAnim = null, hintDim = 0, hintDimMark = 0, hintDimOn = false;
  var hintBusy = false;
  var hintTimer = null;
  var nextRevealTimer = null;
  var newWorldTimer = null;
  var menuOpen = false;
  var menuPreviewEl = null;
  var repaint = false;
  var winSeen = true;
  var sfxTick = null;
  var stars = [];
  var starsEnd = 0;
  var sparkles = [];
  var winBurst = null;
  // Pre-scaled copies of the win stickers, keyed by sprite, so the celebration
  // does not redraw from the 1.6MB sheet on every frame.
  var stickerCache = {};

  /* ------------------------------------------------------------------ *
   * 9. Group topology
   * ------------------------------------------------------------------ */

  function partUpright(cell) {
    if (S.turn[cell] % 4 !== 0) return false;
    if (turnStart[cell] !== null && (performance.now() - turnStart[cell]) < turnDelay(cell)) return false;
    return true;
  }

  // Two neighbouring cells belong together when their parts are also neighbours,
  // in the same direction. In "both" mode a turned part breaks the bond.
  function bonded(a, b, n) {
    var pa = S.part[a], pb = S.part[b];
    var ca = colOf(a, n), ra = rowOf(a, n);
    var cb = colOf(b, n), rb = rowOf(b, n);
    if (Math.abs(ca - cb) + Math.abs(ra - rb) !== 1) return false;
    var paC = colOf(pa, n), paR = rowOf(pa, n);
    var pbC = colOf(pb, n), pbR = rowOf(pb, n);
    if (paC + (cb - ca) !== pbC || paR + (rb - ra) !== pbR) return false;
    if (S.mode === "both" && (!partUpright(a) || !partUpright(b))) return false;
    return true;
  }

  function rebuildGroups() {
    var n = S.n, total = n * n;
    S.group = new Array(total).fill(-1);
    S.groups = [];
    for (var seed = 0; seed < total; seed++) {
      if (S.group[seed] !== -1) continue;
      var id = S.groups.length;
      var members = [];
      var stack = [seed];
      S.group[seed] = id;
      while (stack.length) {
        var cell = stack.pop();
        members.push(cell);
        var c = colOf(cell, n), r = rowOf(cell, n);
        if (c > 0 && S.group[cell - 1] === -1 && bonded(cell, cell - 1, n)) {
          S.group[cell - 1] = id; stack.push(cell - 1);
        }
        if (c < n - 1 && S.group[cell + 1] === -1 && bonded(cell, cell + 1, n)) {
          S.group[cell + 1] = id; stack.push(cell + 1);
        }
        if (r > 0 && S.group[cell - n] === -1 && bonded(cell, cell - n, n)) {
          S.group[cell - n] = id; stack.push(cell - n);
        }
        if (r < n - 1 && S.group[cell + n] === -1 && bonded(cell, cell + n, n)) {
          S.group[cell + n] = id; stack.push(cell + n);
        }
      }
      S.groups.push(members);
    }
  }

  function singletons() {
    var total = S.n * S.n;
    S.group = new Array(total);
    S.groups = [];
    for (var i = 0; i < total; i++) {
      S.group[i] = i;
      S.groups.push([i]);
    }
  }

  function isFinished() {
    if (S.countdown) return false;
    for (var i = 0; i < S.part.length; i++) if (S.part[i] !== i) return false;
    if (S.mode !== "swap") {
      for (var k = 0; k < S.turn.length; k++) if (S.turn[k] % 4 !== 0) return false;
    }
    return true;
  }

  function isFinishedWith(parts, turns) {
    for (var i = 0; i < parts.length; i++) if (parts[i] !== i) return false;
    if (S.mode !== "swap") {
      for (var k = 0; k < turns.length; k++) if (turns[k] % 4 !== 0) return false;
    }
    return true;
  }

  function anyBond(parts, n) {
    for (var cell = 0; cell < parts.length; cell++) {
      var piece = parts[cell];
      var pc = colOf(piece, n), pr = rowOf(piece, n);
      var c = colOf(cell, n), r = rowOf(cell, n);
      if (c < n - 1) {
        var right = parts[cell + 1];
        if (rowOf(right, n) === pr && colOf(right, n) === pc + 1) return true;
      }
      if (r < n - 1) {
        var down = parts[cell + n];
        if (colOf(down, n) === pc && rowOf(down, n) === pr + 1) return true;
      }
    }
    return false;
  }

  function allUpright() {
    for (var i = 0; i < S.turn.length; i++) if (S.turn[i] % 4 !== 0) return false;
    return true;
  }

  function turnDelay(cell) { return cell === turnAnchor ? HINT.turnMs : T.turn; }

  function currentTurn(cell, now) {
    var target = S.turn[cell] * HALF_PI;
    var from = turnStart[cell];
    if (from === null) return target;
    var t = (now - from) / turnDelay(cell);
    if (t >= 1) return target;
    if (t <= 0) return turnBase[cell];
    return turnBase[cell] + (target - turnBase[cell]) * easeOut(t);
  }

  function isUprightAt(cell, now) {
    if (S.turn[cell] % 4 !== 0) return false;
    if (turnStart[cell] !== null && (now - turnStart[cell]) < turnDelay(cell)) return false;
    return true;
  }

  // Pairs of neighbouring cells that are currently joined, keyed by "<axis><cell>".
  function bondsByPart() {
    var n = S.n, total = n * n;
    var cellOfPart = new Array(total);
    for (var cell = 0; cell < total; cell++) cellOfPart[S.part[cell]] = cell;

    var keys = new Set();
    for (var part = 0; part < total; part++) {
      var pc = colOf(part, n), pr = rowOf(part, n);
      var at = cellOfPart[part];
      var cc = colOf(at, n), cr = rowOf(at, n);
      if (S.mode === "both" && !partUpright(at)) continue;
      if (pc < n - 1 && cc < n - 1 && cellOfPart[part + 1] === at + 1) {
        if (S.mode !== "both" || partUpright(at + 1)) keys.add("h" + part);
      }
      if (pr < n - 1 && cr < n - 1 && cellOfPart[part + n] === at + n) {
        if (S.mode !== "both" || partUpright(at + n)) keys.add("v" + part);
      }
    }
    return keys;
  }

  // In turn mode the picture is already in place; what joins cells is simply
  // "both neighbours are upright".
  function uprightBonds() {
    var n = S.n, keys = new Set();
    for (var cell = 0; cell < n * n; cell++) {
      if (S.turn[cell] % 4 !== 0) continue;
      var c = colOf(cell, n), r = rowOf(cell, n);
      if (c < n - 1 && S.turn[cell + 1] % 4 === 0) keys.add(cell * 2);
      if (r < n - 1 && S.turn[cell + n] % 4 === 0) keys.add(cell * 2 + 1);
    }
    return keys;
  }

  function uprightNeighbourhood(seed) {
    var now = performance.now(), n = S.n;
    var found = new Set(), stack = [seed];
    while (stack.length) {
      var cell = stack.pop();
      if (found.has(cell) || !isUprightAt(cell, now)) continue;
      found.add(cell);
      var c = colOf(cell, n), r = rowOf(cell, n);
      if (c < n - 1) stack.push(cell + 1);
      if (c > 0) stack.push(cell - 1);
      if (r < n - 1) stack.push(cell + n);
      if (r > 0) stack.push(cell - n);
    }
    return Array.from(found);
  }

  /* ------------------------------------------------------------------ *
   * 10. Moves
   * ------------------------------------------------------------------ */

  // Slide a whole group so that `from` lands on `to`. Whatever the group covers
  // gets pushed into the holes it leaves behind, in reading order.
  function planSwap(from, to) {
    var n = S.n;
    var members = S.groups[S.group[from]];
    var sc = colOf(from, n), sr = rowOf(from, n);
    var dc = colOf(to, n), dr = rowOf(to, n);
    var dcOff = dc - sc, drOff = dr - sr;
    if (dcOff === 0 && drOff === 0) return null;

    var landing = [];
    for (var i = 0; i < members.length; i++) {
      var c = colOf(members[i], n) + dcOff;
      var r = rowOf(members[i], n) + drOff;
      if (c < 0 || c >= n || r < 0 || r >= n) return null;
      landing.push(cellAt(c, r, n));
    }

    var srcSet = new Set(members), dstSet = new Set(landing);
    var pushedOut = landing.filter(function (cell) { return !srcSet.has(cell); }).sort(function (a, b) { return a - b; });
    var holes = members.filter(function (cell) { return !dstSet.has(cell); }).sort(function (a, b) { return a - b; });

    var next = S.part.slice();
    for (var k = 0; k < members.length; k++) next[landing[k]] = S.part[members[k]];
    for (var m = 0; m < pushedOut.length; m++) next[holes[m]] = S.part[pushedOut[m]];
    return next;
  }

  function commitSwap(next, dragInfo, done, duration) {
    S.busy = true;
    var dur = duration || T.swap;
    var fromHint = !!hintAnim;
    if (tutorActive) showTutor(false);

    var wasAt = new Array(S.n * S.n);
    for (var cell = 0; cell < S.n * S.n; cell++) wasAt[S.part[cell]] = cell;
    var beforeBonds = bondsByPart();

    // Turns follow their part, not their seat.
    if (S.mode === "both") {
      var nextTurn = new Array(S.n * S.n);
      var nextBase = new Array(S.n * S.n);
      var nextStart = new Array(S.n * S.n);
      for (var p = 0; p < S.n * S.n; p++) {
        var origin = wasAt[next[p]];
        nextTurn[p] = S.turn[origin];
        nextBase[p] = turnBase[origin];
        nextStart[p] = turnStart[origin];
      }
      S.turn = nextTurn;
      turnBase = nextBase;
      turnStart = nextStart;
    }

    S.part = next;
    rebuildGroups();
    S.swapFx = {
      at: performance.now(),
      dur: dur,
      hint: fromHint,
      wasAt: wasAt,
      // The move that completes the picture is allowed to spill past the white
      // frame, like the link burst does; every other slide stays clipped.
      final: isFinished(),
      dragCells: dragInfo ? dragInfo.parts : null,
      dragX: dragInfo ? dragInfo.dx : 0,
      dragY: dragInfo ? dragInfo.dy : 0
    };
    clearTimeout(sfxTick);
    sfxTick = setTimeout(function () {
      sfxTick = null;
      S.swapFx = null;
      S.busy = false;
      if (fromHint) hintAnim = null;
      var won = isFinished();
      if (won) finishLevel();
      celebrateNewBonds(beforeBonds);
      if (done && !won) done();
    }, dur + 20);
  }

  function returnDrag(parts, dxCss, dyCss) {
    if (!parts || !parts.size) return;
    S.busy = true;
    var wasAt = new Array(S.n * S.n);
    for (var cell = 0; cell < S.n * S.n; cell++) wasAt[S.part[cell]] = cell;
    S.swapFx = {
      at: performance.now(),
      dur: T.swap,
      hint: false,
      wasAt: wasAt,
      dragCells: parts,
      dragX: dxCss,
      dragY: dyCss
    };
    clearTimeout(sfxTick);
    sfxTick = setTimeout(function () {
      sfxTick = null;
      S.swapFx = null;
      S.busy = false;
    }, T.swap + 20);
  }

  function celebrateNewBonds(before) {
    var after = bondsByPart();
    var n = S.n;
    var cellOfPart = new Array(n * n);
    for (var cell = 0; cell < n * n; cell++) cellOfPart[S.part[cell]] = cell;

    var touched = new Set();
    after.forEach(function (key) {
      if (before.has(key)) return;
      touched.add(S.group[cellOfPart[parseInt(key.slice(1), 10)]]);
    });
    if (!touched.size) return;
    progressMade();

    var cells = [];
    for (var pos = 0; pos < n * n; pos++) {
      if (touched.has(S.group[pos])) cells.push(pos);
    }
    startLinkFx(cells);
  }

  function startLinkFx(cells, bumpOnly) {
    var minC = S.n, maxC = -1, minR = S.n, maxR = -1;
    for (var i = 0; i < cells.length; i++) {
      var c = colOf(cells[i], S.n), r = rowOf(cells[i], S.n);
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
    var cx = ((minC + maxC + 1) / 2) * geo.cell;
    var cy = ((minR + maxR + 1) / 2) * geo.cell;
    var reach = Math.max(maxC - minC + 1, maxR - minR + 1) * geo.cell * 0.5;

    var motes = [];
    if (!bumpOnly) {
      var count = 8 + Math.min(12, cells.length * 2);
      for (var k = 0; k < count; k++) {
        var angle = (Math.PI * 2 * k) / count + (Math.random() - 0.5) * 0.7;
        var dist = reach * (0.45 + Math.random() * 0.4);
        var speed = geo.cell * (0.6 + Math.random() * 0.9);
        motes.push({
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: geo.cell * (0.07 + Math.random() * 0.06),
          spin: Math.random() * Math.PI * 2,
          spinRate: (Math.random() - 0.5) * 5,
          delay: Math.random() * 90
        });
      }
    }

    S.linkFx = {
      at: performance.now(),
      cells: new Set(cells),
      cx: cx,
      cy: cy,
      motes: motes,
      bumpOnly: !!bumpOnly,
      dur: bumpOnly ? T.bump : T.link
    };
  }

  function bumpFactor(t) { return 1 + 0.12 * Math.sin(t * Math.PI); }

  /* ------------------------------------------------------------------ *
   * 11. Canvas geometry
   * ------------------------------------------------------------------ */

  function roundRect(g, x, y, w, h, r) {
    if (g.roundRect) { g.beginPath(); g.roundRect(x, y, w, h, r); return; }
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // Outline of one tile. Linked sides bleed outward so neighbours melt together
  // instead of showing a seam; where two linked sides meet, the corner either
  // stays rounded (diagonal also free) or folds inward (diagonal linked too).
  function tileOutline(g, x, y, span, edges, gaps, radius, bleed) {
    var L = x + (edges.left ? -bleed : gaps.left);
    var R = x + span - (edges.right ? -bleed : gaps.right);
    var Tp = y + (edges.top ? -bleed : gaps.top);
    var B = y + span - (edges.bottom ? -bleed : gaps.bottom);

    function corner(outward, inward, x0, y0) {
      if (outward) return { round: true };
      if (inward) return { round: false, notch: true };
      return { round: false, notch: false };
    }

    var tl = corner(!edges.top && !edges.left, edges.top && edges.left && !edges.diagTL);
    var tr = corner(!edges.top && !edges.right, edges.top && edges.right && !edges.diagTR);
    var br = corner(!edges.bottom && !edges.right, edges.bottom && edges.right && !edges.diagBR);
    var bl = corner(!edges.bottom && !edges.left, edges.bottom && edges.left && !edges.diagBL);

    g.moveTo(L + (tl.round ? radius : (tl.notch ? gaps.left : 0)), Tp);

    // top edge, left -> right
    if (tr.round) {
      g.lineTo(R - radius, Tp);
      g.arcTo(R, Tp, R, Tp + radius, radius);
    } else if (tr.notch) {
      g.lineTo(R - gaps.right, Tp);
      g.lineTo(R - gaps.right, Tp + gaps.top);
      g.lineTo(R, Tp + gaps.top);
    } else {
      g.lineTo(R, Tp);
    }

    // right edge, top -> bottom
    if (br.round) {
      g.lineTo(R, B - radius);
      g.arcTo(R, B, R - radius, B, radius);
    } else if (br.notch) {
      g.lineTo(R, B - gaps.bottom);
      g.lineTo(R - gaps.right, B - gaps.bottom);
      g.lineTo(R - gaps.right, B);
    } else {
      g.lineTo(R, B);
    }

    // bottom edge, right -> left
    if (bl.round) {
      g.lineTo(L + radius, B);
      g.arcTo(L, B, L, B - radius, radius);
    } else if (bl.notch) {
      g.lineTo(L + gaps.left, B);
      g.lineTo(L + gaps.left, B - gaps.bottom);
      g.lineTo(L, B - gaps.bottom);
    } else {
      g.lineTo(L, B);
    }

    // left edge, bottom -> top
    if (tl.round) {
      g.lineTo(L, Tp + radius);
      g.arcTo(L, Tp, L + radius, Tp, radius);
    } else if (tl.notch) {
      g.lineTo(L, Tp + gaps.top);
      g.lineTo(L + gaps.left, Tp + gaps.top);
      g.lineTo(L + gaps.left, Tp);
    } else {
      g.lineTo(L, Tp);
    }

    g.closePath();
  }

  function defaultGaps() {
    return { top: geo.gap, right: geo.gap, bottom: geo.gap, left: geo.gap };
  }

  // Which sides of `cell` are fused with a neighbour.
  function edgesOf(cell, now) {
    var n = S.n, c = colOf(cell, n), r = rowOf(cell, n);
    var id = S.group[cell];
    if (S.mode === "turn") {
      var up = isUprightAt(cell, now);
      return {
        top: up && r > 0 && isUprightAt(cell - n, now),
        bottom: up && r < n - 1 && isUprightAt(cell + n, now),
        left: up && c > 0 && isUprightAt(cell - 1, now),
        right: up && c < n - 1 && isUprightAt(cell + 1, now),
        diagTL: r > 0 && c > 0 && isUprightAt(cell - n - 1, now),
        diagTR: r > 0 && c < n - 1 && isUprightAt(cell - n + 1, now),
        diagBR: r < n - 1 && c < n - 1 && isUprightAt(cell + n + 1, now),
        diagBL: r < n - 1 && c > 0 && isUprightAt(cell + n - 1, now)
      };
    }
    return {
      top: r > 0 && S.group[cell - n] === id,
      bottom: r < n - 1 && S.group[cell + n] === id,
      left: c > 0 && S.group[cell - 1] === id,
      right: c < n - 1 && S.group[cell + 1] === id,
      diagTL: r > 0 && c > 0 && S.group[cell - n - 1] === id,
      diagTR: r > 0 && c < n - 1 && S.group[cell - n + 1] === id,
      diagBR: r < n - 1 && c < n - 1 && S.group[cell + n + 1] === id,
      diagBL: r < n - 1 && c > 0 && S.group[cell + n - 1] === id
    };
  }

  function edgesFromSet(cell, set) {
    var n = S.n, c = colOf(cell, n), r = rowOf(cell, n);
    return {
      top: r > 0 && set.has(cell - n),
      bottom: r < n - 1 && set.has(cell + n),
      left: c > 0 && set.has(cell - 1),
      right: c < n - 1 && set.has(cell + 1),
      diagTL: r > 0 && c > 0 && set.has(cell - n - 1),
      diagTR: r > 0 && c < n - 1 && set.has(cell - n + 1),
      diagBR: r < n - 1 && c < n - 1 && set.has(cell + n + 1),
      diagBL: r < n - 1 && c > 0 && set.has(cell + n - 1)
    };
  }

  function groupOutline(g, cells, dx, dy, now, set) {
    g.beginPath();
    var gaps = defaultGaps();
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var e = set ? edgesFromSet(cell, set) : edgesOf(cell, now);
      tileOutline(g, colOf(cell, S.n) * geo.cell + dx, rowOf(cell, S.n) * geo.cell + dy,
        geo.cell, e, gaps, geo.radius, geo.bleed);
    }
  }

  function groupCentre(cells) {
    var sc = 0, sr = 0;
    for (var i = 0; i < cells.length; i++) {
      sc += colOf(cells[i], S.n);
      sr += rowOf(cells[i], S.n);
    }
    var n = cells.length || 1;
    return { x: (sc / n + 0.5) * geo.cell, y: (sr / n + 0.5) * geo.cell };
  }

  /* ------------------------------------------------------------------ *
   * 12. Layout
   * ------------------------------------------------------------------ */

  function layout() {
    var dpr = window.devicePixelRatio || 1;
    var cssW = dom.input.clientWidth || 600;
    var vw = window.innerWidth, vh = window.innerHeight;

    var backing = Math.min(Math.round(cssW * dpr), LIMIT.backing);
    geo.cell = Math.min(LIMIT.cellBase, Math.max(96, Math.round(backing / S.n)));
    geo.side = S.n * geo.cell;
    geo.scale = geo.side / cssW;

    var ceiling = Math.min(LIMIT.render, LIMIT.canvas / Math.max(vw, vh));
    if (geo.scale > ceiling) {
      geo.cell = Math.max(1, Math.floor(cssW * ceiling / S.n));
      geo.side = S.n * geo.cell;
      geo.scale = geo.side / cssW;
    }

    if (!frameCanvas) {
      frameCanvas = document.createElement("canvas");
      frameCtx = frameCanvas.getContext("2d", { alpha: false });
    }
    if (frameCanvas.width !== geo.side) {
      frameCanvas.width = geo.side;
      frameCanvas.height = geo.side;
    }

    var cw = Math.round(vw * geo.scale);
    var ch = Math.round(vh * geo.scale);
    if (dom.board.width !== cw || dom.board.height !== ch) {
      dom.board.width = cw;
      dom.board.height = ch;
    }

    geo.gap = Math.max(2, Math.round(geo.cell * 0.014));
    geo.radius = Math.max(3, Math.round(geo.cell * 0.05));
    geo.depth = Math.max(3, Math.round(geo.cell * 0.06));
    geo.inset = Math.max(1, Math.round(geo.cell * 0.006));
    geo.slotRadius = Math.max(2, geo.radius + geo.gap - geo.inset);
    geo.bleed = Math.max(0.5, geo.cell * 0.004);

    bgStale = true;
    tiltKey = null;
    if (selectGlowA) selectGlowA.key = null;
    if (selectGlowB) selectGlowB.key = null;
  }

  function bgLayer() {
    if (!bgCanvas) {
      bgCanvas = document.createElement("canvas");
      bgCtx = bgCanvas.getContext("2d");
    }
    if (bgCanvas.width !== geo.side) {
      bgCanvas.width = geo.side;
      bgCanvas.height = geo.side;
      bgStale = true;
    }
    if (!bgStale) return;
    bgStale = false;

    var g = bgCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, geo.side, geo.side);
    g.fillStyle = INK.grout;
    g.fillRect(0, 0, geo.side, geo.side);

    for (var r = 0; r < S.n; r++) {
      for (var c = 0; c < S.n; c++) {
        var sx = c * geo.cell + geo.inset;
        var sy = r * geo.cell + geo.inset;
        var sw = geo.cell - 2 * geo.inset;
        var sh = geo.cell - 2 * geo.inset;
        roundRect(g, sx, sy, sw, sh, geo.slotRadius);
        g.fillStyle = INK.slot;
        g.fill();
        g.save();
        roundRect(g, sx, sy, sw, sh, geo.slotRadius);
        g.clip();
        var shade = g.createLinearGradient(0, sy, 0, sy + geo.depth);
        shade.addColorStop(0, "rgba(120,96,54,0.13)");
        shade.addColorStop(1, "rgba(120,96,54,0)");
        g.fillStyle = shade;
        g.fillRect(sx, sy, sw, geo.depth);
        g.restore();
      }
    }
  }

  function resizeCanvas(cv, w, h) {
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
  }

  /* ------------------------------------------------------------------ *
   * 13. Painter
   * ------------------------------------------------------------------ */

  function paintFace(g, px, py, x, y, bleed, pad) {
    var sx = Math.max(0, px * geo.cell - bleed.left);
    var sy = Math.max(0, py * geo.cell - bleed.top);
    var sw = Math.min(geo.side - sx, geo.cell + (px * geo.cell - sx) + bleed.right);
    var sh = Math.min(geo.side - sy, geo.cell + (py * geo.cell - sy) + bleed.bottom);
    g.drawImage(frameCanvas,
      sx, sy, sw, sh,
      x - pad.left, y - pad.top,
      geo.cell + pad.left + pad.right, geo.cell + pad.top + pad.bottom);
  }

  // A soft dark band under an open edge plus a light lip on top, which is what
  // gives the tiles their thickness.
  function paintThickness(g, linkedTop, linkedBottom, tx, ty, tw, th) {
    if (!linkedBottom) {
      var h = geo.depth * 1.5;
      var bottomGrad = g.createLinearGradient(0, ty + th - h, 0, ty + th);
      bottomGrad.addColorStop(0, "rgba(34,20,6,0)");
      bottomGrad.addColorStop(1, "rgba(34,20,6,0.42)");
      g.fillStyle = bottomGrad;
      g.fillRect(tx, ty + th - h, tw, h);
      g.fillStyle = INK.seam;
      g.fillRect(tx, ty + th - Math.max(2, geo.depth * 0.28), tw, Math.max(2, geo.depth * 0.28));
    }
    if (!linkedTop) {
      var hh = geo.depth * 0.85;
      var topGrad = g.createLinearGradient(0, ty, 0, ty + hh);
      topGrad.addColorStop(0, "rgba(255,255,255,0.20)");
      topGrad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = topGrad;
      g.fillRect(tx, ty, tw, hh);
    }
  }

  function paintTile(cell, g, flat, phase) {
    g = g || boardCtx;
    var now = performance.now();
    var n = S.n;
    var part = S.part[cell];
    var px = colOf(part, n), py = rowOf(part, n);
    var destC = colOf(cell, n), destR = rowOf(cell, n);
    var x = destC * geo.cell, y = destR * geo.cell;

    var dragging = dragCells ? dragCells.has(cell) : false;

    // Progress of the slide animation for this piece; 1 when nothing is moving.
    var k = swapProgress(now);

    if (S.swapFx) {
      var was = S.swapFx.wasAt[part];
      var wasC = colOf(was, n), wasR = rowOf(was, n);
      x = (wasC + (destC - wasC) * k) * geo.cell;
      y = (wasR + (destR - wasR) * k) * geo.cell;
      if (S.swapFx.dragCells && S.swapFx.dragCells.has(part)) {
        x += S.swapFx.dragX * geo.scale * (1 - k);
        y += S.swapFx.dragY * geo.scale * (1 - k);
      }
    }
    if (dragging && !flat) { x += dragX; y += dragY; }
    if (S.shakeFx && S.shakeFx.cell === cell) x += shakeOffset(now);

    var scale = 1, pivotX = x + geo.cell / 2, pivotY = y + geo.cell / 2;
    var draggedAnim = S.swapFx && S.swapFx.dragCells && S.swapFx.dragCells.has(part);
    if (draggedAnim) {
      scale = 1 + (TOUCH.dragScale - 1) * (1 - k);
      if (settle) { pivotX = settle.x; pivotY = settle.y; }
    } else if (hintScale !== 1 && hintAnim && (hintAnim.movers.has(part) || hintAnim.others.has(part))) {
      scale = hintScale;
      if (hintAnim.movers.has(part)) { pivotX = hintMoverCentre.x; pivotY = hintMoverCentre.y; }
      else { pivotX = hintOtherCentre.x; pivotY = hintOtherCentre.y; }
    } else if (selSet && selSet.has(cell) && selCentre) {
      scale = selScale; pivotX = selCentre.x; pivotY = selCentre.y;
    } else if (fadeSet && fadeSet.has(cell) && fadeCentre) {
      scale = fadeScale; pivotX = fadeCentre.x; pivotY = fadeCentre.y;
    } else if (S.linkFx && !S.winFx && S.linkFx.cells.has(cell)) {
      var bt = (now - S.linkFx.at) / T.bump;
      if (bt > 0 && bt < 1) { scale = bumpFactor(bt); pivotX = S.linkFx.cx; pivotY = S.linkFx.cy; }
    }

    var scaling = scale !== 1;
    if (scaling) {
      g.save();
      g.translate(pivotX, pivotY);
      g.scale(scale, scale);
      g.translate(-pivotX, -pivotY);
    }

    var e = selSet && selSet.has(cell) ? edgesFromSet(cell, selSet)
      : fadeSet && fadeSet.has(cell) ? edgesFromSet(cell, fadeSet)
        : edgesOf(cell, now);
    if (hintAnim && S.mode !== "turn") filterHintEdges(e, cell);

    // A tile sitting against the panel border stretches out to meet the frame so
    // no background strip shows along the outer edge.
    //
    // The stretch is keyed on the cell the tile belongs to, never on whether it
    // is currently animating. Keying it on the animation made an edge tile grow
    // by a few pixels on the very frame the slide ended, which read as a flash.
    // While a tile is still travelling, the outward overhang is trimmed by the
    // panel clip in render(), so it is never visible.
    var resting = !dragging && !(S.shakeFx && S.shakeFx.cell === cell) && !scaling
      && !(hintAnim && hintAnim.movers && hintAnim.movers.has(S.part[cell]));
    var reach = outerOverlap + 3;
    var gaps = {
      left: (resting && destC === 0) ? -reach : geo.gap,
      right: (resting && destC === n - 1) ? -reach : geo.gap,
      top: (resting && destR === 0) ? -reach : geo.gap,
      bottom: (resting && destR === n - 1) ? -reach : geo.gap
    };

    var iL = e.left ? 0 : gaps.left;
    var iR = e.right ? 0 : gaps.right;
    var iT = e.top ? 0 : gaps.top;
    var iB = e.bottom ? 0 : gaps.bottom;
    var tx = x + iL, ty = y + iT;
    var tw = geo.cell - iL - iR, th = geo.cell - iT - iB;

    var bleed = {
      left: e.left ? geo.bleed : 0,
      right: e.right ? geo.bleed : 0,
      top: e.top ? geo.bleed : 0,
      bottom: e.bottom ? geo.bleed : 0
    };
    var pad = {
      left: e.left ? geo.bleed : (gaps.left < 0 ? reach : 0),
      right: e.right ? geo.bleed : (gaps.right < 0 ? reach : 0),
      top: e.top ? geo.bleed : (gaps.top < 0 ? reach : 0),
      bottom: e.bottom ? geo.bleed : (gaps.bottom < 0 ? reach : 0)
    };

    if (phase === "outline") {
      tileOutline(g, x, y, geo.cell, e, gaps, geo.radius, geo.bleed);
      return;
    }
    if (phase === "face") {
      paintFace(g, px, py, x, y, bleed, pad);
      paintThickness(g, e.top, e.bottom, tx, ty, tw, th);
      return;
    }

    if (S.mode === "turn" || S.mode === "both") {
      g.save();
      g.beginPath();
      tileOutline(g, x, y, geo.cell, e, gaps, geo.radius, geo.bleed);
      g.clip();
      g.fillStyle = INK.back;
      g.fillRect(x + iL, y + iT, tw, th);

      var spinning = (turnStart[cell] !== null && (now - turnStart[cell]) < turnDelay(cell)) || cell === turnAnchor;
      if (spinning || S.turn[cell] % 4 !== 0) {
        var cx = x + geo.cell / 2, cy = y + geo.cell / 2;
        g.save();
        g.translate(cx, cy);
        g.rotate(currentTurn(cell, now));
        g.drawImage(frameCanvas, px * geo.cell, py * geo.cell, geo.cell, geo.cell,
          -geo.cell / 2, -geo.cell / 2, geo.cell, geo.cell);
        g.restore();
      } else {
        paintFace(g, px, py, x, y, bleed, pad);
      }
      paintThickness(g, e.top, e.bottom, tx, ty, tw, th);
      g.restore();
    } else if (!scaling && e.top && e.bottom && e.left && e.right
      && e.diagTL && e.diagTR && e.diagBR && e.diagBL) {
      // Fully boxed in by neighbours: no clipping needed.
      paintFace(g, px, py, x, y, bleed, pad);
    } else {
      g.save();
      g.beginPath();
      tileOutline(g, x, y, geo.cell, e, gaps, geo.radius, geo.bleed);
      g.clip();
      paintFace(g, px, py, x, y, bleed, pad);
      paintThickness(g, e.top, e.bottom, tx, ty, tw, th);
      g.restore();
    }

    if (scaling) g.restore();
  }

  // Drop bonds in the hint's dimmed layers so the highlighted pieces read as
  // their own silhouette while the step animates.
  function filterHintEdges(e, cell) {
    var n = S.n;
    var mine = hintClassOf(S.part[cell]);
    if (e.top && hintClassOf(S.part[cell - n]) !== mine) e.top = false;
    if (e.bottom && hintClassOf(S.part[cell + n]) !== mine) e.bottom = false;
    if (e.left && hintClassOf(S.part[cell - 1]) !== mine) e.left = false;
    if (e.right && hintClassOf(S.part[cell + 1]) !== mine) e.right = false;
    if (e.diagTL && hintClassOf(S.part[cell - n - 1]) !== mine) e.diagTL = false;
    if (e.diagTR && hintClassOf(S.part[cell - n + 1]) !== mine) e.diagTR = false;
    if (e.diagBR && hintClassOf(S.part[cell + n + 1]) !== mine) e.diagBR = false;
    if (e.diagBL && hintClassOf(S.part[cell + n - 1]) !== mine) e.diagBL = false;
  }

  function hintClassOf(part) {
    return hintAnim.movers.has(part) ? 1 : (hintAnim.others.has(part) ? 2 : 0);
  }

  function swapProgress(now) {
    if (!S.swapFx) return 1;
    var t = clamp01((now - S.swapFx.at) / S.swapFx.dur);
    return S.swapFx.hint ? easeInOut(t) : easeBack(t);
  }

  function shakeOffset(now) {
    var t = (now - S.shakeFx.at) / T.shake;
    if (t >= 1) { S.shakeFx = null; return 0; }
    return Math.sin(t * Math.PI * 5) * 7 * (1 - t);
  }

  // Render state shared between paintTile calls in one pass.
  var dragCells = null, dragX = 0, dragY = 0, dragQuad = null;
  var settle = null, hintScale = 1;
  var hintMoverCentre = { x: 0, y: 0 }, hintOtherCentre = { x: 0, y: 0 };
  var selSet = null, selScale = 1, selCentre = null;
  var fadeSet = null, fadeScale = 1, fadeCentre = null;
  var outerOverlap = 2;

  function render() {
    if (!dom.video.videoWidth || !frameCtx) return;
    var now = performance.now();
    var boot = bootState;

    if (S.countdown && !S.countdown.started) {
      if (!boot.done) return;
      if (dom.video.readyState < 2) {
        if (!S.countdown.armedAt) S.countdown.armedAt = now;
        if (now - S.countdown.armedAt < 1500) {
          boardCtx.clearRect(0, 0, dom.board.width, dom.board.height);
          return;
        }
      }
      if (dom.newWorld.classList.contains("show")) {
        boardCtx.clearRect(0, 0, dom.board.width, dom.board.height);
        return;
      }
      S.countdown.started = true;
      S.countdown.at = now;
    }

    if (pendingBump) {
      startLinkFx(pendingBump, true);
      pendingBump = null;
    }

    var vw = dom.video.videoWidth, vh = dom.video.videoHeight;
    var side = Math.min(vw, vh);
    frameCtx.drawImage(dom.video, (vw - side) / 2, (vh - side) / 2, side, side,
      0, 0, geo.side, geo.side);

    boardCtx.clearRect(0, 0, dom.board.width, dom.board.height);
    var rect = dom.input.getBoundingClientRect();
    var offX = Math.round(rect.left * geo.scale);
    var offY = Math.round(rect.top * geo.scale);
    boardCtx.save();
    boardCtx.translate(offX, offY);

    outerOverlap = Math.max(2, Math.round(1.5 * geo.scale));
    var padX = Math.floor(rect.left * geo.scale) - offX - outerOverlap;
    var padY = Math.floor(rect.top * geo.scale) - offY - outerOverlap;
    var padR = Math.ceil(rect.right * geo.scale) - offX + outerOverlap;
    var padB = Math.ceil(rect.bottom * geo.scale) - offY + outerOverlap;
    var padW = padR - padX, padH = padB - padY;
    var innerR = Math.round(22 * geo.scale) + outerOverlap;

    if (S.countdown) {
      if (S.countdown.phase === "count") {
        var elapsed = now - S.countdown.at;
        if (elapsed >= S.countdown.dur) {
          S.countdown.phase = "shuffle";
          S.countdown.shuffleAt = now;
        } else {
          boardCtx.save();
          roundRect(boardCtx, padX, padY, padW, padH, innerR);
          boardCtx.clip();
          boardCtx.drawImage(frameCanvas, padX, padY, padW, padH);
          boardCtx.restore();
          paintCountdown(elapsed);
          boardCtx.restore();
          return;
        }
      }
      if (S.countdown.phase === "shuffle") {
        var st = (now - S.countdown.shuffleAt) / S.countdown.shuffleDur;
        if (st >= 1) {
          S.part = S.countdown.targetParts.slice();
          S.turn = S.countdown.targetTurns.slice();
          for (var i = 0; i < S.part.length; i++) {
            turnBase[i] = S.turn[i] * HALF_PI;
            turnStart[i] = null;
          }
          S.countdown = null;
          if (S.mode === "turn") singletons();
          else rebuildGroups();
          if (S.level === TUTOR.levelSwap) showTutor(true, "slide");
          else if (S.level === TUTOR.levelTurn) showTutor(true, "tap");
          else if (S.level === TUTOR.levelBoth) startBothTutor();
          resetHintClock();
        } else {
          paintShuffle(st, padX, padY, padW, padH, innerR);
          boardCtx.restore();
          return;
        }
      }
    }

    var selGroup = S.selected === -1 ? -1 : S.group[S.selected];

    var k = swapProgress(now);
    hintScale = 1;
    hintMoverCentre = { x: 0, y: 0 };
    hintOtherCentre = { x: 0, y: 0 };

    if (hintAnim) {
      hintScale = 1 + (HINT.popScale - 1) * easeBack(Math.min(1, (now - hintAnim.at) / HINT.popMs));
      var mk = (now - hintAnim.moveAt) / hintAnim.moveDur;
      if (mk > 0.45) hintScale = 1 + (hintScale - 1) * (1 - easeOut(Math.min(1, (mk - 0.45) / 0.55)));
      var mx = 0, my = 0, mc = 0, ox = 0, oy = 0, oc = 0;
      for (var pos = 0; pos < S.part.length; pos++) {
        var pc = S.part[pos];
        var isMover = hintAnim.movers.has(pc);
        if (!isMover && !hintAnim.others.has(pc)) continue;
        var cc = colOf(pos, S.n), cr = rowOf(pos, S.n);
        if (S.swapFx) {
          var was2 = S.swapFx.wasAt[pc];
          var wc = colOf(was2, S.n), wr = rowOf(was2, S.n);
          cc = wc + (cc - wc) * k;
          cr = wr + (cr - wr) * k;
        }
        var cx = (cc + 0.5) * geo.cell, cy = (cr + 0.5) * geo.cell;
        if (isMover) { mx += cx; my += cy; mc++; } else { ox += cx; oy += cy; oc++; }
      }
      if (mc) hintMoverCentre = { x: mx / mc, y: my / mc };
      if (oc) hintOtherCentre = { x: ox / oc, y: oy / oc };
    }

    settle = null;
    if (S.swapFx && S.swapFx.dragCells) {
      var sx = 0, sy = 0, sn = 0;
      for (var q = 0; q < S.part.length; q++) {
        var piece = S.part[q];
        if (!S.swapFx.dragCells.has(piece)) continue;
        var prev = S.swapFx.wasAt[piece];
        var pcv = colOf(prev, S.n), prv = rowOf(prev, S.n);
        var dcv = colOf(q, S.n), drv = rowOf(q, S.n);
        sx += (pcv + (dcv - pcv) * k + 0.5) * geo.cell + S.swapFx.dragX * geo.scale * (1 - k);
        sy += (prv + (drv - prv) * k + 0.5) * geo.cell + S.swapFx.dragY * geo.scale * (1 - k);
        sn++;
      }
      if (sn) settle = { x: sx / sn, y: sy / sn };
    }

    dragCells = null; dragX = 0; dragY = 0; dragQuad = null;
    if (S.drag && S.drag.moved) {
      dragCells = new Set(S.groups[S.group[S.drag.from]]);
      dragX = S.drag.dx * geo.scale;
      dragY = S.drag.dy * geo.scale;
      dragQuad = projectDrag(dragCells, dragX, dragY);
    } else {
      tiltActive = false;
      tiltKey = null;
    }

    // Selection halo bookkeeping
    var wantCells = null, wantKey = null;
    if (S.dragOver !== -1) { wantCells = [S.dragOver]; wantKey = "t" + S.dragOver; }
    else if (selGroup !== -1) { wantCells = S.groups[selGroup]; wantKey = "b" + selGroup; }
    if (wantKey !== select.key) {
      if (select.key !== null) {
        var fromScale = 1 + (TOUCH.selectScale - 1) * easeOut(Math.min(1, (now - select.at) / TOUCH.selectMs));
        select.fade = { cells: select.cells, key: select.key, from: fromScale, at: now };
        var spare = selectGlowB;
        selectGlowB = selectGlowA;
        selectGlowA = spare;
        if (selectGlowA) selectGlowA.key = null;
      }
      select.key = wantKey;
      select.cells = wantCells;
      select.at = now;
      if (select.fade && select.fade.key === select.key) {
        select.fade = null;
        var swapBuf = selectGlowA;
        selectGlowA = selectGlowB;
        selectGlowB = swapBuf;
      }
    }

    selCentre = select.cells ? groupCentre(select.cells) : null;
    selScale = select.cells
      ? 1 + (TOUCH.selectScale - 1) * easeOut(Math.min(1, (now - select.at) / TOUCH.selectMs))
      : 1;
    selSet = select.cells ? new Set(select.cells) : null;

    fadeSet = null; fadeScale = 1; fadeCentre = null;
    if (select.fade) {
      var ft = (now - select.fade.at) / TOUCH.selectMs;
      if (ft >= 1) {
        select.fade = null;
      } else {
        fadeCentre = groupCentre(select.fade.cells);
        fadeScale = 1 + (select.fade.from - 1) * (1 - easeOut(ft));
        fadeSet = new Set(select.fade.cells);
      }
    }
    var fadeAlpha = select.fade ? 1 - (now - select.fade.at) / TOUCH.selectMs : 0;

    if (S.winFx && now - S.winFx.at > T.celebrate) S.winFx = null;

    function floating(cell, part) {
      if (dragCells && dragCells.has(cell)) return true;
      if (S.swapFx && S.swapFx.wasAt[part] !== cell) return true;
      if (S.swapFx && S.swapFx.dragCells && S.swapFx.dragCells.has(part)) return true;
      if (hintAnim && (hintAnim.movers.has(part) || hintAnim.others.has(part))) return true;
      if (S.linkFx && S.linkFx.cells.has(cell)) return true;
      if (selSet && selSet.has(cell)) return true;
      if (fadeSet && fadeSet.has(cell)) return true;
      return false;
    }

    boardCtx.save();
    roundRect(boardCtx, padX, padY, padW, padH, innerR);
    boardCtx.clip();
    bgLayer();
    boardCtx.drawImage(bgCanvas, padX, padY, padW, padH);

    // A solved board is one uninterrupted picture: every part is in its home
    // cell and every edge is joined, so the per-tile clip + drawImage work
    // collapses into a single blit. This keeps the clip playing and removes the
    // 49-tile rebuild that made the victory animation stutter.
    var solvedStill = S.solved && !S.swapFx && !dragCells && !selSet && !fadeSet && !hintAnim;

    if (solvedStill) {
      var bleed = outerOverlap + 3;
      boardCtx.drawImage(frameCanvas, 0, 0, geo.side, geo.side,
        -bleed, -bleed, geo.side + bleed * 2, geo.side + bleed * 2);
    } else if (S.mode === "turn" || S.mode === "both") {
      for (var a = 0; a < S.part.length; a++) {
        if (!floating(a, S.part[a])) paintTile(a);
      }
    } else {
      boardCtx.save();
      boardCtx.beginPath();
      var any = false;
      for (var b = 0; b < S.part.length; b++) {
        if (!floating(b, S.part[b])) { paintTile(b, boardCtx, false, "outline"); any = true; }
      }
      if (any) {
        // One clip for the whole settled board: neighbouring faces merge into a
        // single picture instead of showing tile seams.
        boardCtx.clip();
        for (var c2 = 0; c2 < S.part.length; c2++) {
          if (!floating(c2, S.part[c2])) paintTile(c2, boardCtx, false, "face");
        }
      }
      boardCtx.restore();
    }
    boardCtx.restore();

    if (dragCells && dragQuad) {
      if (!tiltCanvas) {
        tiltCanvas = document.createElement("canvas");
        tiltCtx = tiltCanvas.getContext("2d");
      }
      if (tiltCanvas.width !== dragQuad.w) tiltCanvas.width = dragQuad.w;
      if (tiltCanvas.height !== dragQuad.h) tiltCanvas.height = dragQuad.h;
      tiltCtx.setTransform(1, 0, 0, 1, 0, 0);
      tiltCtx.clearRect(0, 0, dragQuad.w, dragQuad.h);
      tiltCtx.setTransform(1, 0, 0, 1, -dragQuad.bx, -dragQuad.by);
      for (var d = 0; d < S.part.length; d++) {
        if (dragCells.has(d)) paintTile(d, tiltCtx, true);
      }
      tiltCtx.setTransform(1, 0, 0, 1, 0, 0);
    }

    underlays(now, dragQuad, fadeAlpha);

    var dimStep = hintDimMark ? Math.min(100, now - hintDimMark) / HINT.dimFadeMs : 0;
    hintDimMark = now;
    if (hintDimOn) hintDim = Math.min(1, hintDim + dimStep);
    else hintDim = Math.max(0, hintDim - dimStep);
    if (hintDim > 0) {
      boardCtx.save();
      boardCtx.setTransform(1, 0, 0, 1, 0, 0);
      boardCtx.fillStyle = "rgba(12, 18, 28, " + (HINT.dimAlpha * hintDim).toFixed(3) + ")";
      boardCtx.fillRect(0, 0, dom.board.width, dom.board.height);
      boardCtx.restore();
    }

    // Tiles in motion are painted above the settled board, in two groups:
    //
    //   travelling - the piece is sliding to another cell. The slide easing
    //                overshoots its target, so a corner piece would poke past
    //                the white frame; these are clipped to the panel.
    //   in place   - the piece only grows (link burst, selection halo, hint
    //                pop). Growing past the frame is the intended look, so
    //                these are deliberately left unclipped.
    //
    // The dragged block is handled separately below and may leave the board.
    var hintTop = hintAnim ? hintAnim.movers : null;

    // The opening bump (linkFx flagged bumpOnly) shows which pieces already sit
    // together. It fires the moment the scramble settles, so letting it grow
    // past the frame looks like the board overflowing. It stays clipped.
    // Link bursts during play, by contrast, are meant to spill over.
    function isTravelling(cell, part) {
      if (S.linkFx && S.linkFx.bumpOnly && S.linkFx.cells.has(cell)) return true;
      if (!S.swapFx) return false;
      // The winning slide is treated like an in-place burst so the last piece
      // can overshoot the frame.
      if (S.swapFx.final) return false;
      return S.swapFx.wasAt[part] !== cell;
    }

    var sliding = [], swelling = [];
    for (var m0 = 0; m0 < S.part.length; m0++) {
      var pm0 = S.part[m0];
      if (!floating(m0, pm0)) continue;
      if (dragCells && dragCells.has(m0)) continue;
      if (hintTop && hintTop.has(pm0)) continue;
      if (isTravelling(m0, pm0)) sliding.push(m0); else swelling.push(m0);
    }

    function paintList(list) {
      for (var i = 0; i < list.length; i++) paintTile(list[i]);
    }

    if (sliding.length) {
      boardCtx.save();
      roundRect(boardCtx, padX, padY, padW, padH, innerR);
      boardCtx.clip();
      paintList(sliding);
      boardCtx.restore();
    }
    paintList(swelling);
    if (hintTop) {
      for (var h = 0; h < S.part.length; h++) if (hintTop.has(S.part[h])) paintTile(h);
    }
    if (dragCells && dragQuad && !window.__noFaces) {
      projectImage(boardCtx, tiltCanvas, 0, 0, dragQuad.w, dragQuad.h,
        dragQuad.tl, dragQuad.tr, dragQuad.bl, dragQuad.br, TOUCH.tiltStrips);
    }

    if (S.linkFx || S.winFx) {
      boardCtx.save();
      roundRect(boardCtx, padX, padY, padW, padH, innerR);
      boardCtx.clip();
      if (S.linkFx) paintLinkFx(now);
      if (S.winFx) paintWin(now - S.winFx.at);
      boardCtx.restore();
    }

    if (stars.length) {
      if (now > starsEnd) stars = [];
      else paintStars(now, dom.board.height - offY);
    }

    boardCtx.restore();
  }

  function underlays(now, quad, fadeAlpha) {
    // Dragged block: soft shadow underneath, warm rim on top.
    if (HAS_FILTER && dragCells && quad && tiltCanvas) {
      var lift = Math.min(1, Math.hypot(dragX, dragY) / (geo.cell * 1.4));
      var cx = (quad.tl.x + quad.tr.x + quad.bl.x + quad.br.x) / 4;
      var cy = (quad.tl.y + quad.tr.y + quad.bl.y + quad.br.y) / 4;
      var key = S.drag.from + ":" + tiltCanvas.width + "x" + tiltCanvas.height;
      if (tiltKey !== key) { buildDragFx(); tiltKey = key; }
      var m = tiltMargin;
      var bw = (tiltW + 2 * m) * TOUCH.dragScale;
      var bh = (tiltH + 2 * m) * TOUCH.dragScale;
      var bx = cx - bw / 2, by = cy - bh / 2;
      if (!window.__noShadow) {
        boardCtx.save();
        boardCtx.globalAlpha = 0.24 + 0.26 * lift;
        boardCtx.drawImage(shadowCanvas, bx, by + geo.cell * (0.05 + 0.16 * lift), bw, bh);
        boardCtx.restore();
      }
      if (!window.__noGlow) blitAdditive(glowCanvas, bx, by, bw, bh, 0.85 + 0.15 * lift);
    }

    if (S.mode === "turn") return;

    var glowFor = function (which, cells, key) {
      var buf = which === "cur" ? selectGlowA : selectGlowB;
      if (!buf) {
        buf = { canvas: document.createElement("canvas"), ctx: null, key: null, bx: 0, by: 0, m: 0 };
        buf.ctx = buf.canvas.getContext("2d");
        if (which === "cur") selectGlowA = buf; else selectGlowB = buf;
      }
      if (buf.key !== key) { buildSelectionGlow(buf, cells, now); buf.key = key; }
      return buf;
    };
    var blit = function (buf, centre, scale, alpha) {
      if (!buf || !centre || alpha <= 0) return;
      boardCtx.save();
      boardCtx.translate(centre.x, centre.y);
      boardCtx.scale(scale, scale);
      boardCtx.translate(-centre.x, -centre.y);
      blitAdditive(buf.canvas, buf.bx - buf.m, buf.by - buf.m,
        buf.canvas.width, buf.canvas.height, alpha);
      boardCtx.restore();
    };

    if (select.fade && fadeSet && fadeCentre && fadeAlpha > 0) {
      blit(glowFor("out", select.fade.cells, select.fade.key), fadeCentre, fadeScale, fadeAlpha);
    }
    if (select.cells && selCentre) {
      blit(glowFor("cur", select.cells, select.key), selCentre, selScale, 1);
    }
  }

  // Light a halo buffer up additively so the warm rim reads as light on top of the
  // picture rather than a grey overlay.
  function blitAdditive(canvas, x, y, w, h, alpha) {
    boardCtx.save();
    boardCtx.globalCompositeOperation = "lighter";
    boardCtx.globalAlpha = alpha;
    boardCtx.drawImage(canvas, x, y, w, h);
    boardCtx.restore();
  }

  function buildSelectionGlow(buf, cells, now) {
    var minC = S.n, maxC = -1, minR = S.n, maxR = -1;
    for (var i = 0; i < cells.length; i++) {
      var c = colOf(cells[i], S.n), r = rowOf(cells[i], S.n);
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
    var blur = geo.cell * 0.20;
    var m = Math.ceil(blur * 2.2 + geo.selectWidth * 2 + 4);
    var bx = minC * geo.cell, by = minR * geo.cell;
    var bw = (maxC - minC + 1) * geo.cell, bh = (maxR - minR + 1) * geo.cell;
    resizeCanvas(buf.canvas, bw + 2 * m, bh + 2 * m);
    buf.bx = bx; buf.by = by; buf.m = m;

    var g = buf.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, bw + 2 * m, bh + 2 * m);
    g.setTransform(1, 0, 0, 1, m - bx, m - by);
    groupOutline(g, cells, 0, 0, now, new Set(cells));
    g.shadowColor = "rgba(" + INK.glow + ", 0.95)";
    g.shadowBlur = blur;
    g.strokeStyle = "rgba(" + INK.glow + ", 0.9)";
    g.lineWidth = 2 * geo.selectWidth;
    g.lineJoin = "round";
    g.stroke();
    g.stroke();
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function buildDragFx() {
    if (!glowCanvas) {
      glowCanvas = document.createElement("canvas");
      glowCtx = glowCanvas.getContext("2d");
    }
    if (!shadowCanvas) {
      shadowCanvas = document.createElement("canvas");
      shadowCtx = shadowCanvas.getContext("2d");
    }
    if (!scratchCanvas) {
      scratchCanvas = document.createElement("canvas");
      scratchCtx = scratchCanvas.getContext("2d");
    }
    tiltW = tiltCanvas.width;
    tiltH = tiltCanvas.height;
    var glowR = geo.cell * 0.055;
    var shadowR = geo.cell * TOUCH.shadowBlur;
    var m = Math.ceil(Math.max(glowR, shadowR) * 2.2 + 4);
    tiltMargin = m;
    var W = tiltW + 2 * m, H = tiltH + 2 * m;
    resizeCanvas(scratchCanvas, W, H);
    resizeCanvas(glowCanvas, W, H);
    resizeCanvas(shadowCanvas, W, H);

    var s = scratchCtx;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = "source-over";
    s.clearRect(0, 0, W, H);
    s.drawImage(tiltCanvas, m, m);
    s.globalCompositeOperation = "source-in";
    s.fillStyle = "rgb(" + INK.glow + ")";
    s.fillRect(0, 0, W, H);
    s.globalCompositeOperation = "source-over";

    glowCtx.setTransform(1, 0, 0, 1, 0, 0);
    glowCtx.clearRect(0, 0, W, H);
    glowCtx.filter = "blur(" + glowR.toFixed(1) + "px)";
    glowCtx.drawImage(scratchCanvas, 0, 0);
    glowCtx.filter = "none";

    s.clearRect(0, 0, W, H);
    s.drawImage(tiltCanvas, m, m);
    s.globalCompositeOperation = "source-in";
    s.fillStyle = "rgb(26,18,6)";
    s.fillRect(0, 0, W, H);
    s.globalCompositeOperation = "source-over";

    shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
    shadowCtx.clearRect(0, 0, W, H);
    shadowCtx.filter = "blur(" + shadowR.toFixed(1) + "px)";
    shadowCtx.drawImage(scratchCanvas, 0, 0);
    shadowCtx.filter = "none";
  }

  // The dragged block leans while it moves. A single 2D transform can only shear,
  // so the block is rendered flat into tiltCanvas and then projected strip by
  // strip, which yields real perspective.
  function projectDrag(cells, offX, offY) {
    if (!tiltActive) {
      tiltActive = true; tiltVX = 0; tiltVY = 0;
      tiltPrevX = S.drag.dx; tiltPrevY = S.drag.dy;
    }
    var instX = S.drag.dx - tiltPrevX, instY = S.drag.dy - tiltPrevY;
    tiltPrevX = S.drag.dx;
    tiltPrevY = S.drag.dy;
    tiltVX += (instX - tiltVX) * TOUCH.tiltSmooth;
    tiltVY += (instY - tiltVY) * TOUCH.tiltSmooth;

    var yaw = tiltVX * TOUCH.tiltGain;
    var pitch = tiltVY * TOUCH.tiltGain;
    var cap = TOUCH.tiltMaxDeg * Math.PI / 180;
    var mag = Math.hypot(yaw, pitch);
    if (mag > cap) { var f = cap / mag; yaw *= f; pitch *= f; }

    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);

    var minC = S.n, maxC = -1, minR = S.n, maxR = -1;
    cells.forEach(function (cell) {
      var c = colOf(cell, S.n), r = rowOf(cell, S.n);
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    });

    var pad = Math.max(2, Math.ceil(geo.cell * 0.04));
    var bx = minC * geo.cell - pad;
    var by = minR * geo.cell - pad;
    var bw = (maxC - minC + 1) * geo.cell + 2 * pad;
    var bh = (maxR - minR + 1) * geo.cell + 2 * pad;
    var hw = bw / 2, hh = bh / 2;
    var pcx = bx + hw + offX;
    var pcy = by + hh + offY;
    var focal = TOUCH.tiltFocal * Math.max(hw, hh);
    var scale = TOUCH.dragScale;

    function corner(sx, sy2) {
      var lx = sx < 0 ? -hw : hw;
      var ly = sy2 < 0 ? -hh : hh;
      var x1 = lx * cy, zy = lx * sy;
      var y1 = ly * cp, zp = ly * sp;
      var z = zy + zp;
      var denom = focal - z;
      var k = focal / (denom > 1e-3 ? denom : 1e-3);
      return { x: pcx + x1 * k * scale, y: pcy + y1 * k * scale };
    }

    return {
      tl: corner(-1, -1), tr: corner(1, -1), bl: corner(-1, 1), br: corner(1, 1),
      bx: bx, by: by, w: Math.ceil(bw), h: Math.ceil(bh)
    };
  }

  // Draw `img` as a quad by slicing it into horizontal strips and giving each a
  // local affine transform. Bilinear edges are bled by a fraction of a pixel so
  // the strips do not show hairline gaps.
  function projectImage(g, img, sx, sy, sw, sh, tl, tr, bl, br, strips) {
    var stripH = sh / strips;
    var perSrc = Math.hypot(bl.x - tl.x, bl.y - tl.y) / sh || 1;
    var bleed = Math.max(1, 1 / (perSrc || 1));
    for (var i = 0; i < strips; i++) {
      var topPad = i > 0 ? bleed : 0;
      var botPad = i < strips - 1 ? bleed : 0;
      var ssy = Math.max(sy, sy + i * stripH - topPad);
      var sBot = Math.min(sy + sh, sy + (i + 1) * stripH + botPad);
      var ssh = sBot - ssy;
      if (ssh <= 0) continue;
      var va = (ssy - sy) / sh;
      var vb = (ssy + ssh - sy) / sh;
      var lx0 = tl.x + (bl.x - tl.x) * va, ly0 = tl.y + (bl.y - tl.y) * va;
      var rx0 = tr.x + (br.x - tr.x) * va, ry0 = tr.y + (br.y - tr.y) * va;
      var lx1 = tl.x + (bl.x - tl.x) * vb, ly1 = tl.y + (bl.y - tl.y) * vb;
      var m11 = (rx0 - lx0) / sw, m12 = (ry0 - ly0) / sw;
      var m21 = (lx1 - lx0) / ssh, m22 = (ly1 - ly0) / ssh;
      var dx = lx0 - m11 * sx - m21 * ssy;
      var dy = ly0 - m12 * sx - m22 * ssy;
      g.save();
      g.transform(m11, m12, m21, m22, dx, dy);
      g.drawImage(img, sx, ssy, sw, ssh, sx, ssy, sw, ssh);
      g.restore();
    }
  }

  function paintCountdown(elapsed) {
    var sec = Math.min(2, Math.floor(elapsed / 1000));
    var digit = 3 - sec;
    var frac = (elapsed % 1000) / 1000;

    var s = 1;
    if (frac < 0.35) s = 0.45 + 0.55 * easeBack(frac / 0.35);
    else if (frac > 0.88) s = 1 - 0.15 * ((frac - 0.88) / 0.12);

    var cx = geo.side / 2, cy = geo.side / 2;
    var r = Math.round(geo.side * 0.15);

    boardCtx.save();
    boardCtx.translate(cx, cy);
    boardCtx.scale(s, s);
    boardCtx.shadowColor = "rgba(0,0,0,0.3)";
    boardCtx.shadowBlur = Math.round(r * 0.4);
    boardCtx.shadowOffsetY = Math.round(r * 0.15);

    boardCtx.save();
    boardCtx.globalAlpha = 0.7;
    var disc = boardCtx.createRadialGradient(0, -r * 0.3, r * 0.1, 0, 0, r);
    disc.addColorStop(0, "#ffffff");
    disc.addColorStop(0.8, "#fffaf0");
    disc.addColorStop(1, "#ffeeda");
    boardCtx.fillStyle = disc;
    boardCtx.beginPath();
    boardCtx.arc(0, 0, r, 0, Math.PI * 2);
    boardCtx.fill();
    boardCtx.shadowColor = "transparent";
    boardCtx.strokeStyle = "#ffffff";
    boardCtx.lineWidth = Math.max(3, Math.round(r * 0.08));
    boardCtx.stroke();
    boardCtx.restore();

    boardCtx.shadowColor = "transparent";
    boardCtx.font = "900 " + Math.round(r * 1.35) + "px \"Nunito\", system-ui, -apple-system, sans-serif";
    boardCtx.textAlign = "center";
    boardCtx.textBaseline = "middle";
    boardCtx.fillStyle = "rgba(180,70,15,0.25)";
    boardCtx.fillText(String(digit), 0, r * 0.08);
    var ink = boardCtx.createLinearGradient(0, -r * 0.6, 0, r * 0.6);
    ink.addColorStop(0, "#ff9534");
    ink.addColorStop(1, "#f25a1b");
    boardCtx.fillStyle = ink;
    boardCtx.fillText(String(digit), 0, 0);
    boardCtx.restore();
  }

  function paintShuffle(t, padX, padY, padW, padH, innerR) {
    bgLayer();
    var k = easeInOut(t);
    var n = S.n;
    var total = n * n;
    var targetCell = S.countdown.targetCell;
    var targetTurn = S.countdown.targetTurns;

    boardCtx.save();
    roundRect(boardCtx, padX, padY, padW, padH, innerR);
    boardCtx.clip();
    boardCtx.drawImage(bgCanvas, padX, padY, padW, padH);

    for (var p = 0; p < total; p++) {
      var fromC = colOf(p, n), fromR = rowOf(p, n);
      var to = targetCell[p];
      var toC = colOf(to, n), toR = rowOf(to, n);
      var curC = fromC + (toC - fromC) * k;
      var curR = fromR + (toR - fromR) * k;
      var x = curC * geo.cell, y = curR * geo.cell;
      var cx = x + geo.cell / 2, cy = y + geo.cell / 2;
      var angle = (targetTurn[to] * HALF_PI) * k;

      boardCtx.save();
      boardCtx.translate(cx, cy);
      if (angle !== 0) boardCtx.rotate(angle);

      var hw = (geo.cell - geo.gap) / 2;
      var hh = hw;
      var rr = Math.min(geo.radius, hw);
      roundRect(boardCtx, -hw, -hh, hw * 2, hh * 2, rr);
      boardCtx.clip();
      boardCtx.fillStyle = INK.back;
      boardCtx.fillRect(-hw, -hh, hw * 2, hh * 2);
      boardCtx.drawImage(frameCanvas, fromC * geo.cell, fromR * geo.cell, geo.cell, geo.cell,
        -hw, -hh, hw * 2, hh * 2);
      boardCtx.fillStyle = "rgba(0,0,0,0.15)";
      boardCtx.fillRect(-hw, hh - geo.depth, hw * 2, geo.depth);
      boardCtx.restore();
    }
    boardCtx.restore();
  }

  function paintStars(now, bottom) {
    var g = boardCtx;
    var grav = PARTY.gravity * geo.side;
    g.lineJoin = "round";
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var age = now - s.at;
      if (age <= 0 || age >= s.life) continue;
      var t = age / 1000;
      var x = s.x + s.vx * t;
      var y = s.y + s.vy * t + 0.5 * grav * t * t;
      if (y - s.r > bottom) continue;
      var r = s.r * (age < 190 ? easeBack(age / 190) : 1);
      var fadeFrom = s.life * 0.72;
      g.globalAlpha = age > fadeFrom ? 1 - (age - fadeFrom) / (s.life - fadeFrom) : 1;

      if (s.kind === "confetti") {
        var th = s.spin + s.spinRate * t;
        var flutter = Math.cos(t * 9 + s.wobble);
        g.save();
        g.translate(x, y);
        g.rotate(th);
        g.scale(1, Math.max(0.25, Math.abs(flutter)));
        g.fillStyle = s.ink;
        g.strokeStyle = "rgba(78,42,24,0.35)";
        g.lineWidth = Math.max(1, r * 0.14);
        var cw = r * 1.4, chh = r * 0.65;
        roundRect(g, -cw / 2, -chh / 2, cw, chh, chh * 0.45);
        g.fill();
        g.stroke();
        g.restore();
        continue;
      }

      var art = sheetReady && ATLAS[PARTY.stickers[s.spriteIdx]];
      if (art) {
        // Draw from a small cached bitmap at roughly on-screen size instead of
        // sampling the full sprite sheet at an arbitrary scale every frame.
        var px = Math.max(8, Math.round(r * 2));
        var key = s.spriteIdx + ":" + px;
        var cached = stickerCache[key];
        if (!cached) {
          cached = document.createElement("canvas");
          cached.width = px;
          cached.height = px;
          var cg = cached.getContext("2d");
          cg.drawImage(sheetImg, art.x, art.y, art.w, art.h, 0, 0, px, px);
          stickerCache[key] = cached;
        }
        var rot = s.spin + s.spinRate * t + Math.sin(t * 5 + s.wobble) * 0.18;
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        g.drawImage(cached, -px / 2, -px / 2);
        g.restore();
      } else {
        var ang = s.spin + s.spinRate * t;
        var co = Math.cos(ang), si = Math.sin(ang);
        g.beginPath();
        for (var k = 0; k < 20; k += 2) {
          var ux = STAR_UNIT[k], uy = STAR_UNIT[k + 1];
          var px = x + (ux * co - uy * si) * r;
          var py = y + (ux * si + uy * co) * r;
          if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
        g.lineWidth = r * 0.22;
        g.strokeStyle = "rgba(201,104,0,0.75)";
        g.stroke();
        g.fillStyle = s.ink;
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  var STAR_UNIT = (function () {
    var out = [];
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var k = (i % 2) ? 0.47 : 1;
      out.push(Math.cos(a) * k, Math.sin(a) * k);
    }
    return out;
  })();

  function paintWin(elapsed) {
    // The radial burst and the two sweeps are gradients that only change while
    // they are fading. Building them once per frame was the main cost of the
    // first 900ms of the celebration, so they are cached and only rebuilt when
    // the alpha that drives them actually moves a step.
    if (elapsed < 280) {
      var k = 1 - elapsed / 280;
      var c = geo.side * 0.5;
      if (!winBurst || Math.abs(winBurst.k - k) > 0.02) {
        var burst = boardCtx.createRadialGradient(c, c, geo.side * 0.05, c, c, geo.side * 0.75);
        burst.addColorStop(0, "rgba(255,250,225,0.58)");
        burst.addColorStop(0.55, "rgba(255,210,235,0.34)");
        burst.addColorStop(1, "rgba(180,248,220,0.22)");
        winBurst = { grad: burst, k: k };
      }
      boardCtx.save();
      boardCtx.globalAlpha = winBurst.k;
      boardCtx.fillStyle = winBurst.grad;
      boardCtx.fillRect(0, 0, geo.side, geo.side);
      boardCtx.restore();
    }

    for (var pass = 0; pass < 2; pass++) {
      var sweep = (elapsed - pass * 220) / 640;
      if (sweep < 0 || sweep > 1.12) continue;
      var w = 0.12;
      var c0 = clamp01(sweep - w);
      var cm1 = clamp01(sweep - w * 0.35);
      var c1 = clamp01(sweep);
      var cm2 = clamp01(sweep + w * 0.35);
      var c2 = clamp01(sweep + w);
      var grad = boardCtx.createLinearGradient(0, 0, geo.side, geo.side);
      var alpha = pass === 0 ? 0.76 : 0.52;
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(c0, "rgba(255,255,255,0)");
      grad.addColorStop(cm1, "rgba(255,215,240," + (alpha * 0.75).toFixed(3) + ")");
      grad.addColorStop(c1, "rgba(255,253,232," + alpha + ")");
      grad.addColorStop(cm2, "rgba(190,250,235," + (alpha * 0.75).toFixed(3) + ")");
      grad.addColorStop(c2, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      boardCtx.fillStyle = grad;
      boardCtx.fillRect(0, 0, geo.side, geo.side);
    }

    for (var i = 0; i < sparkles.length; i++) {
      var s = sparkles[i];
      var st = (elapsed - s.delay) / s.dur;
      if (st <= 0 || st >= 1) continue;
      var a = Math.sin(st * Math.PI);
      sparkle(s.x, s.y, s.r * (0.35 + 0.65 * a), s.spin, a, s.ink);
    }
  }

  function sparkle(cx, cy, r, rot, alpha, ink, g) {
    // No shadowBlur here. A blurred shadow on every sparkle costs a full
    // off-screen pass per particle, and on the win burst there are dozens of
    // them per frame. The soft look comes from the pre-rendered sprite instead.
    g = g || boardCtx;
    g.save();
    g.translate(cx, cy);
    g.rotate(rot);
    g.globalAlpha = alpha;
    g.fillStyle = ink;
    g.beginPath();
    var inner = r * 0.16;
    for (var i = 0; i < 4; i++) {
      var a = i * Math.PI / 2;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      var a2 = a + Math.PI / 4;
      g.lineTo(Math.cos(a2) * inner, Math.sin(a2) * inner);
    }
    g.closePath();
    g.fill();
    g.restore();
  }

  function paintLinkFx(now) {
    var t = (now - S.linkFx.at) / S.linkFx.dur;
    if (t >= 1) { S.linkFx = null; return; }
    if (S.linkFx.bumpOnly) return;
    var fade = 1 - t;

    boardCtx.save();
    var bt = (now - S.linkFx.at) / T.bump;
    if (bt > 0 && bt < 1) {
      var s = bumpFactor(bt);
      boardCtx.translate(S.linkFx.cx, S.linkFx.cy);
      boardCtx.scale(s, s);
      boardCtx.translate(-S.linkFx.cx, -S.linkFx.cy);
    }
    boardCtx.globalAlpha = fade;
    boardCtx.strokeStyle = "rgba(255,208,90,0.95)";
    boardCtx.lineWidth = geo.selectWidth * 1.2;
    boardCtx.lineJoin = "round";
    boardCtx.lineCap = "round";
    boardCtx.shadowColor = "rgba(255,190,60,0.95)";
    boardCtx.shadowBlur = geo.cell * (0.16 + 0.12 * Math.sin(t * Math.PI));
    groupOutline(boardCtx, Array.from(S.linkFx.cells), 0, 0, now);
    boardCtx.stroke();
    boardCtx.restore();

    for (var i = 0; i < S.linkFx.motes.length; i++) {
      var m = S.linkFx.motes[i];
      var age = now - S.linkFx.at - m.delay;
      if (age <= 0) continue;
      var mt = age / (S.linkFx.dur - m.delay);
      if (mt >= 1) continue;
      var sec = age / 1000;
      var x = m.x + m.vx * sec;
      var y = m.y + m.vy * sec + 0.5 * (geo.cell * 0.5) * sec * sec;
      var a = Math.sin(mt * Math.PI);
      sparkle(x, y, m.r * (0.5 + 0.5 * a), m.spin + m.spinRate * sec, a, "#fff7d6");
    }
  }

  /* ------------------------------------------------------------------ *
   * 14. Input
   * ------------------------------------------------------------------ */

  function cellAtPoint(clientX, clientY) {
    var rect = dom.input.getBoundingClientRect();
    var x = clientX - rect.left, y = clientY - rect.top;
    var outside = x < 0 || y < 0 || x >= rect.width || y >= rect.height;
    if (outside) return -1;
    var c = Math.min(S.n - 1, (x / (rect.width / S.n)) | 0);
    var r = Math.min(S.n - 1, (y / (rect.height / S.n)) | 0);
    return cellAt(c, r, S.n);
  }

  function onDown(e) {
    if (S.solved || hintBusy || S.countdown) return;
    if (S.busy) {
      // A new press while a swap settles simply fast-forwards it.
      if (S.swapFx && !S.winFx && !isFinished()) {
        clearTimeout(sfxTick);
        sfxTick = null;
        S.swapFx = null;
        S.busy = false;
      } else {
        return;
      }
    }
    var cell = cellAtPoint(e.clientX, e.clientY);
    if (cell === -1) return;

    armSfx();
    playMusic();
    resumeVideo();

    if (S.mode === "turn") {
      pressCell = cell;
      pressPointer = e.pointerId;
      try { dom.input.setPointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
      e.preventDefault();
      return;
    }

    if (S.linkFx && !S.linkFx.bumpOnly) S.linkFx = null;
    S.drag = {
      pointerId: e.pointerId,
      from: cell,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      moved: false
    };
    try { dom.input.setPointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
    e.preventDefault();
  }

  function onMove(e) {
    if (!S.drag || e.pointerId !== S.drag.pointerId) return;
    var dx = e.clientX - S.drag.startX;
    var dy = e.clientY - S.drag.startY;
    if (!S.drag.moved) {
      if (Math.abs(dx) + Math.abs(dy) <= TOUCH.dragThreshold) return;
      S.drag.moved = true;
      S.selected = -1;
      dom.input.classList.add("drag-active");
    }
    S.drag.dx = dx;
    S.drag.dy = dy;
    var over = cellAtPoint(e.clientX, e.clientY);
    S.dragOver = (over !== -1 && S.group[over] !== S.group[S.drag.from]) ? over : -1;
  }

  function onUp(e) {
    if (S.mode === "turn") {
      if (e.pointerId !== pressPointer) return;
      var cell = pressCell;
      pressCell = -1;
      pressPointer = null;
      try { dom.input.releasePointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
      if (cell !== -1 && !S.solved && !S.busy) turnCell(cell);
      return;
    }

    if (!S.drag || e.pointerId !== S.drag.pointerId) return;
    var moved = S.drag.moved;
    var from = S.drag.from;
    var dragDx = S.drag.dx, dragDy = S.drag.dy;
    var dragParts = new Set(S.groups[S.group[from]].map(function (cell) { return S.part[cell]; }));
    S.drag = null;
    try { dom.input.releasePointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
    dom.input.classList.remove("drag-active");
    S.dragOver = -1;

    if (moved) {
      var to = cellAtPoint(e.clientX, e.clientY);
      S.selected = -1;
      var valid = to !== -1 && to !== from;
      var next = valid ? planSwap(from, to) : null;
      if (next) commitSwap(next, { parts: dragParts, dx: dragDx, dy: dragDy });
      else {
        if (valid) S.shakeFx = { cell: to, at: performance.now() };
        returnDrag(dragParts, dragDx, dragDy);
      }
      return;
    }

    if (S.mode === "both") turnCell(from);
    else tapCell(from);
  }

  function onCancel(e) {
    if (S.mode === "turn") {
      if (e.pointerId === pressPointer) { pressCell = -1; pressPointer = null; }
      return;
    }
    if (!S.drag || e.pointerId !== S.drag.pointerId) return;
    var moved = S.drag.moved;
    var from = S.drag.from;
    var dx = S.drag.dx, dy = S.drag.dy;
    var parts = new Set(S.groups[S.group[from]].map(function (cell) { return S.part[cell]; }));
    S.drag = null;
    dom.input.classList.remove("drag-active");
    S.dragOver = -1;
    S.selected = -1;
    if (moved) returnDrag(parts, dx, dy);
  }

  // Swap mode: first tap arms a group, second tap exchanges the two.
  function tapCell(cell) {
    if (S.selected === -1) { S.selected = cell; return; }
    if (S.group[cell] === S.group[S.selected]) { S.selected = -1; return; }
    var next = planSwap(S.selected, cell);
    S.selected = -1;
    if (!next) { S.shakeFx = { cell: cell, at: performance.now() }; return; }
    commitSwap(next);
  }

  function turnCell(cell) {
    // A joined group must not be split by turning one of its tiles.
    if (S.mode === "both" && S.groups[S.group[cell]] && S.groups[S.group[cell]].length > 1) {
      S.shakeFx = { cell: cell, at: performance.now() };
      return;
    }
    var part = S.part[cell];
    var now = performance.now();
    if (tutorActive) showTutor(false);

    var before = S.mode === "both" ? bondsByPart() : uprightBonds();
    var wasUpright = S.turn[cell] % 4 === 0;
    turnBase[cell] = currentTurn(cell, now);
    S.turn[cell] += 1;
    var nowUpright = !wasUpright && S.turn[cell] % 4 === 0;
    turnStart[cell] = now;

    var after = S.mode === "both" ? bondsByPart() : uprightBonds();
    var gained = false;
    after.forEach(function (key) { if (!before.has(key)) gained = true; });
    var won = S.mode === "both" ? isFinished() : allUpright();
    if (won) S.busy = true;

    setTimeout(function () {
      if (S.solved) return;
      if (gained || nowUpright) progressMade();
      if (S.mode === "both") {
        var at = S.part.indexOf(part);
        if (at === -1) return;
        if (turnStart[at] !== null && (performance.now() - turnStart[at]) < T.turn - 20) return;
        turnStart[at] = null;
        rebuildGroups();
        celebrateNewBonds(before);
        if (isFinished()) finishLevel();
      } else {
        if (won) finishLevel();
        if (gained && (won || !S.solved)) {
          var cells = uprightNeighbourhood(cell);
          if (cells.length > 1) startLinkFx(cells);
        }
      }
    }, T.turn);
  }

  /* ------------------------------------------------------------------ *
   * 15. Hint
   * ------------------------------------------------------------------ */

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function hideHint() {
    clearTimeout(hintTimer);
    dom.hintBtn.classList.remove("reveal");
    dom.hintBtn.classList.add("hidden");
  }

  function showHint() {
    if (S.solved || menuOpen || hintBusy || S.countdown) return;
    dom.hintBtn.classList.remove("hidden");
    dom.hintBtn.classList.add("reveal");
  }

  function resetHintClock() {
    clearTimeout(hintTimer);
    if (!dom.hintBtn.classList.contains("hidden")) hideHint();
    if (S.solved || menuOpen || hintBusy || S.countdown) return;
    hintTimer = setTimeout(showHint, HINT.revealMs);
  }

  function progressMade() { resetHintClock(); }

  function endHint() {
    hintBusy = false;
    hintDimOn = false;
    resetHintClock();
  }

  function requestHint() {
    if (S.solved || hintBusy || S.countdown) return;
    hintBusy = true;
    S.drag = null;
    S.dragOver = -1;
    S.selected = -1;
    pressCell = -1;
    pressPointer = null;
    dom.input.classList.remove("drag-active");
    S.shakeFx = null;
    if (tutorActive) showTutor(false);

    setTimeout(function () {
      if (!hintBusy || S.solved) return;
      var started = false;
      if (S.mode === "turn") started = hintTurn();
      else if (S.mode === "both") started = hintBoth();
      else started = hintExchange();
      if (!started) endHint();
    }, HINT.startMs);
  }

  // Pick the most promising group to grow: biggest, then best placed, then lowest part.
  function bestGroup(uprightOnly) {
    var best = -1, bestPlaced = -1, bestMin = Infinity;
    for (var id = 0; id < S.groups.length; id++) {
      var members = S.groups[id];
      var placed = 0, min = Infinity;
      for (var i = 0; i < members.length; i++) {
        var cell = members[i];
        if (S.part[cell] === cell && (!uprightOnly || partUpright(cell))) placed++;
        if (S.part[cell] < min) min = S.part[cell];
      }
      if (best === -1 || members.length > S.groups[best].length ||
        (members.length === S.groups[best].length &&
          (placed > bestPlaced || (placed === bestPlaced && min < bestMin)))) {
        best = id; bestPlaced = placed; bestMin = min;
      }
    }
    return best;
  }

  function attachMove(part, anchor, dc, dr) {
    var aPos = S.part.indexOf(anchor);
    var bPos = S.part.indexOf(part);
    var tc = colOf(aPos, S.n) + dc, tr = rowOf(aPos, S.n) + dr;
    if (tc < 0 || tc >= S.n || tr < 0 || tr >= S.n) return null;
    var target = cellAt(tc, tr, S.n);
    if (target === bPos) return null;
    var whole = planSwap(bPos, target);
    if (whole) return moveInfo(whole, S.groups[S.group[bPos]]);
    var next = S.part.slice();
    next[bPos] = S.part[target];
    next[target] = part;
    return moveInfo(next, [bPos]);
  }

  function moveInfo(next, moverCells) {
    var movers = new Set(moverCells.map(function (c) { return S.part[c]; }));
    var others = new Set();
    var hit = 0;
    for (var i = 0; i < S.part.length; i++) {
      if (next[i] === S.part[i] || movers.has(S.part[i])) continue;
      others.add(S.part[i]);
      hit = Math.max(hit, S.groups[S.group[i]].length);
    }
    return { next: next, movers: movers, others: others, whole: moverCells.length > 1, hit: hit };
  }

  function scoreMove(part, anchor, dc, dr, groupSize) {
    var move = attachMove(part, anchor, dc, dr);
    return {
      part: part, anchor: anchor, dc: dc, dr: dr, move: move,
      key: [groupSize, move ? 0 : 1, (groupSize > 1 && !(move && move.whole)) ? 1 : 0,
        move ? move.hit : Infinity, part]
    };
  }

  function betterKey(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  }

  // Everything a swap could do next, in preference order.
  function bestAttach(groupId) {
    var best = null;
    var members = S.groups[groupId];
    for (var i = 0; i < members.length; i++) {
      var anchor = S.part[members[i]];
      var ac = colOf(anchor, S.n), ar = rowOf(anchor, S.n);
      for (var d = 0; d < DIRS.length; d++) {
        var nc = ac + DIRS[d][0], nr = ar + DIRS[d][1];
        if (nc < 0 || nc >= S.n || nr < 0 || nr >= S.n) continue;
        var part = cellAt(nc, nr, S.n);
        var owner = S.group[S.part.indexOf(part)];
        if (owner === groupId) continue;
        var cand = scoreMove(part, anchor, DIRS[d][0], DIRS[d][1], S.groups[owner].length);
        if (!best || betterKey(cand.key, best.key)) best = cand;
      }
    }
    return best;
  }

  function playHintMove(move, done) {
    var now = performance.now();
    hintAnim = {
      at: now, moveAt: now + HINT.liftMs, moveDur: HINT.moveMs,
      movers: move.movers, others: move.others
    };
    hintDimOn = true;
    S.busy = true;
    setTimeout(function () {
      if (!hintAnim || hintAnim.movers !== move.movers) return;
      hintAnim.moveAt = performance.now();
      commitSwap(move.next, null, done, HINT.moveMs);
    }, HINT.liftMs);
  }

  function hintExchange() {
    if (isFinished()) return false;
    var n = S.n;
    var gid = bestGroup(false);
    if (gid === -1) return false;
    var shift = bestAttach(gid);
    if (!shift) return false;

    hintBusy = true;
    var done = endHint;
    if (shift.move) { playHintMove(shift.move, done); return true; }

    var aPos = S.part.indexOf(shift.anchor);
    var shifted = planSwap(aPos,
      cellAt(colOf(aPos, n) - shift.dc, rowOf(aPos, n) - shift.dr, n));
    if (!shifted) return false;

    playHintMove(moveInfo(shifted, S.groups[gid]), function () {
      setTimeout(function () {
        if (!hintBusy || S.solved) return;
        var m = attachMove(shift.part, shift.anchor, shift.dc, shift.dr);
        if (!m || !m.next) { endHint(); return; }
        playHintMove(m, done);
      }, HINT.stepGapMs);
    });
    return true;
  }

  function hintTurn() {
    var n = S.n, now = performance.now();
    var straight = function (cell) { return S.turn[cell] % 4 === 0; };

    // Largest already-correct area, so the hint keeps building on the picture.
    var seen = new Array(n * n).fill(false);
    var biggest = null;
    for (var seed = 0; seed < n * n; seed++) {
      if (seen[seed] || !straight(seed)) continue;
      var cells = new Set(), stack = [seed];
      seen[seed] = true;
      while (stack.length) {
        var cell = stack.pop();
        cells.add(cell);
        var c = colOf(cell, n), r = rowOf(cell, n);
        for (var d = 0; d < DIRS.length; d++) {
          var nc = c + DIRS[d][0], nr = r + DIRS[d][1];
          if (nc < 0 || nc >= n || nr < 0 || nr >= n) continue;
          var q = cellAt(nc, nr, n);
          if (!seen[q] && straight(q)) { seen[q] = true; stack.push(q); }
        }
      }
      if (!biggest || cells.size > biggest.size) biggest = cells;
    }

    var mid = (n - 1) / 2;
    var target = -1, bestScore = -Infinity;
    for (var p = 0; p < n * n; p++) {
      if (straight(p)) continue;
      var pc = colOf(p, n), pr = rowOf(p, n);
      var score = 0;
      if (biggest) {
        for (var k = 0; k < DIRS.length; k++) {
          var qc = pc + DIRS[k][0], qr = pr + DIRS[k][1];
          if (qc >= 0 && qc < n && qr >= 0 && qr < n && biggest.has(cellAt(qc, qr, n))) score++;
        }
        if (!score) continue;
      } else {
        score = -(Math.abs(pc - mid) + Math.abs(pr - mid));
      }
      if (score > bestScore) { bestScore = score; target = p; }
    }
    if (target === -1) {
      for (var q2 = 0; q2 < n * n; q2++) {
        if (straight(q2)) continue;
        var c2 = colOf(q2, n), r2 = rowOf(q2, n);
        var sc = -(Math.abs(c2 - mid) + Math.abs(r2 - mid));
        if (sc > bestScore) { bestScore = sc; target = q2; }
      }
    }
    if (target === -1) return false;

    hintBusy = true;
    S.busy = true;
    hintAnim = {
      at: now, moveAt: now + HINT.liftMs, moveDur: HINT.turnMs,
      movers: new Set([S.part[target]]), others: new Set()
    };
    hintDimOn = true;
    turnAnchor = target;
    turnBase[target] = currentTurn(target, now);
    S.turn[target] = Math.ceil(S.turn[target] / 4) * 4;
    turnStart[target] = now + HINT.liftMs;
    var won = allUpright();

    setTimeout(function () {
      hintAnim = null;
      turnStart[target] = null;
      singletons();
      if (won) finishLevel();
      else { S.busy = false; endHint(); }
      var cells = uprightNeighbourhood(target);
      turnAnchor = -1;
      startLinkFx(cells.length > 1 ? cells : [target], cells.length < 2);
    }, HINT.liftMs + HINT.turnMs + 20);
    return true;
  }

  function hintBoth() {
    if (isFinished()) return false;
    var n = S.n, now = performance.now();
    var upright = function (cell) { return S.turn[cell] % 4 === 0; };

    function playTurnHint(target, done) {
      hintBusy = true;
      S.busy = true;
      hintAnim = {
        at: now, moveAt: now + HINT.liftMs, moveDur: HINT.turnMs,
        movers: new Set([S.part[target]]), others: new Set()
      };
      hintDimOn = true;
      turnAnchor = target;
      turnBase[target] = currentTurn(target, now);
      S.turn[target] = Math.ceil(S.turn[target] / 4) * 4;
      turnStart[target] = now + HINT.liftMs;
      setTimeout(function () {
        hintAnim = null;
        turnStart[target] = null;
        turnAnchor = -1;
        rebuildGroups();
        var won = isFinished();
        if (won) finishLevel();
        else { S.busy = false; endHint(); }
        if (done) done();
        var g = S.groups[S.group[target]];
        if (g && g.length > 1) startLinkFx(g, false);
        else startLinkFx([target], true);
      }, HINT.liftMs + HINT.turnMs + 20);
    }

    // First look for a pair that only needs one of them straightened.
    for (var cell = 0; cell < n * n; cell++) {
      var part = S.part[cell];
      var pc = colOf(part, n), pr = rowOf(part, n);
      var c = colOf(cell, n), r = rowOf(cell, n);
      for (var d = 0; d < DIRS.length; d++) {
        var nc = c + DIRS[d][0], nr = r + DIRS[d][1];
        if (nc < 0 || nc >= n || nr < 0 || nr >= n) continue;
        var other = cellAt(nc, nr, n);
        var op = S.part[other];
        if (pc + DIRS[d][0] === colOf(op, n) && pr + DIRS[d][1] === rowOf(op, n)) {
          if (S.group[cell] !== S.group[other]) {
            var pick = !upright(cell) ? cell : (!upright(other) ? other : -1);
            if (pick !== -1) { playTurnHint(pick); return true; }
          }
        }
      }
    }

    var gid = bestGroup(true);
    var best = gid === -1 ? null : bestAttach(gid);
    if (!best) {
      for (var t = 0; t < n * n; t++) {
        if (!upright(t)) { playTurnHint(t); return true; }
      }
      return false;
    }

    var moverPart = best.part;
    var anchorPart = best.anchor;

    function playBothMove(move, done) {
      var aPos = S.part.indexOf(anchorPart);
      if (aPos !== -1 && !upright(aPos)) {
        S.turn[aPos] = 0; turnBase[aPos] = 0; turnStart[aPos] = null;
      }
      playHintMove(move, function () {
        var p = S.part.indexOf(moverPart);
        if (p !== -1 && !upright(p)) {
          S.turn[p] = 0; turnBase[p] = 0; turnStart[p] = null;
        }
        rebuildGroups();
        if (isFinished()) finishLevel();
        if (done) done();
      });
    }

    hintBusy = true;
    if (best.move) {
      var bPos = S.part.indexOf(best.part);
      if (!upright(bPos)) {
        S.turn[bPos] = Math.ceil(S.turn[bPos] / 4) * 4;
        turnBase[bPos] = currentTurn(bPos, now);
        turnStart[bPos] = now + HINT.liftMs;
      }
      playBothMove(best.move, endHint);
      return true;
    }

    var aPos2 = S.part.indexOf(best.anchor);
    var shifted = planSwap(aPos2,
      cellAt(colOf(aPos2, n) - best.dc, rowOf(aPos2, n) - best.dr, n));
    if (!shifted) return false;

    playHintMove(moveInfo(shifted, S.groups[gid]), function () {
      setTimeout(function () {
        if (!hintBusy || S.solved) return;
        var m = attachMove(best.part, best.anchor, best.dc, best.dr);
        if (!m || !m.next) { endHint(); return; }
        var at = S.part.indexOf(best.part);
        if (at !== -1 && !upright(at)) {
          S.turn[at] = Math.ceil(S.turn[at] / 4) * 4;
          var now2 = performance.now();
          turnBase[at] = currentTurn(at, now2);
          turnStart[at] = now2;
        }
        playBothMove(m, endHint);
      }, HINT.stepGapMs);
    });
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 16. Level flow
   * ------------------------------------------------------------------ */

  var pendingBump = null;

  function modeFor(level) {
    if (level.hard) return "both";
    if (level.bonus) return "turn";
    return "swap";
  }

  function buildBoard() {
    var n = S.n;
    var total = n * n;
    var level = LEVELS[S.level];
    S.mode = modeFor(level);

    var parts = [];
    for (var i = 0; i < total; i++) parts.push(i);
    var turns = new Array(total).fill(0);

    if (S.mode === "both") {
      if (S.level === TUTOR.levelBoth) {
        var tail = [];
        for (var t = 2; t < total; t++) tail.push(t);
        for (var try1 = 0; try1 < 500; try1++) {
          shuffled(tail);
          parts[0] = 1;
          parts[1] = 0;
          for (var k = 0; k < tail.length; k++) parts[2 + k] = tail[k];
          if (!anyBond(parts, n)) break;
        }
        turns[1] = 3;
      } else {
        for (var try2 = 0; try2 < 500; try2++) {
          shuffled(parts);
          if (!isFinishedWith(parts, turns)) break;
        }
        for (var r1 = 0; r1 < total; r1++) turns[r1] = 1 + Math.floor(Math.random() * 3);
      }
    } else if (S.mode === "turn") {
      for (var r2 = 0; r2 < total; r2++) turns[r2] = 1 + Math.floor(Math.random() * 3);
      if (S.level === TUTOR.levelTurn) {
        var mid = (n / 2) | 0;
        var centre = cellAt(mid, mid, n);
        turns[centre] = 0;
        turns[centre - n] = 3;
      }
    } else if (S.level === TUTOR.levelSwap) {
      var rest = [];
      for (var q = 2; q < total; q++) rest.push(q);
      for (var try3 = 0; try3 < 500; try3++) {
        shuffled(rest);
        parts[0] = 1;
        parts[1] = 0;
        for (var m = 0; m < rest.length; m++) parts[2 + m] = rest[m];
        if (!anyBond(parts, n)) break;
      }
    } else {
      for (var try4 = 0; try4 < 500; try4++) {
        shuffled(parts);
        if (!isFinishedWith(parts, turns)) break;
      }
    }

    S.part = [];
    for (var s = 0; s < total; s++) S.part.push(s);
    S.turn = new Array(total).fill(0);
    turnBase = new Array(total).fill(0);
    turnStart = new Array(total).fill(null);

    var targetCellOfPart = new Array(total);
    for (var p = 0; p < total; p++) targetCellOfPart[parts[p]] = p;

    S.countdown = {
      at: 0,
      started: false,
      armedAt: 0,
      dur: 3000,
      phase: "count",
      shuffleDur: 750,
      shuffleAt: 0,
      targetParts: parts,
      targetTurns: turns,
      targetCell: targetCellOfPart
    };

    S.selected = -1;
    S.solved = false;
    S.busy = false;
    S.drag = null;
    S.dragOver = -1;
    pressCell = -1;
    pressPointer = null;
    clearTimeout(sfxTick);
    sfxTick = null;
    S.swapFx = null;
    S.shakeFx = null;
    S.winFx = null;
    S.linkFx = null;
    pendingBump = null;
    sparkles = [];
    stars = [];
    hintBusy = false;
    hintAnim = null;
    turnAnchor = -1;
    hintDimOn = false;
    hintDim = 0;
    clearTimeout(nextRevealTimer);
    dom.nextBtn.classList.remove("reveal");
    dom.nextBtn.classList.add("hidden");
    dom.input.classList.remove("drag-active");

    layout();

    if (S.mode === "turn") {
      singletons();
    } else {
      rebuildGroups();
      var pre = [];
      for (var pos = 0; pos < total; pos++) {
        if (S.groups[S.group[pos]].length > 1) pre.push(pos);
      }
      pendingBump = pre.length ? pre : null;
    }
    resumeVideo();
  }

  function finishLevel() {
    if (S.solved) return;
    S.solved = true;
    endHint();
    hideHint();
    markCleared(S.level);
    var next = firstOpenLevel();
    resumeAt = next < LEVELS.length ? next : 0;
    persist();
    winSeen = S.replay;
    startCelebration();
    chimeWin();
    clearTimeout(nextRevealTimer);
    nextRevealTimer = setTimeout(showWinBanner, T.celebrate + T.hold);
  }

  function startCelebration() {
    S.busy = true;
    var now = performance.now();
    S.winFx = { at: now };
    winBurst = null;
    sparkles = [];
    var count = Math.round(geo.side / 34);
    for (var i = 0; i < count; i++) {
      sparkles.push({
        x: Math.random() * geo.side,
        y: Math.random() * geo.side,
        r: 18 + Math.random() * 28,
        delay: Math.random() * 750,
        dur: 500 + Math.random() * 450,
        spin: Math.random() * Math.PI,
        ink: PARTY.confettiInk[(Math.random() * PARTY.confettiInk.length) | 0]
      });
    }

    var U = geo.side;
    stars = [];
    // Fewer particles on low-end devices; the burst reads the same.
    var dense = U >= 400;
    var total = (dense ? PARTY.seedCount : Math.round(PARTY.seedCount * 0.6)) + (dense ? 18 : 8);
    for (var s = 0; s < total; s++) {
      var confetti = s >= (dense ? PARTY.seedCount : Math.round(PARTY.seedCount * 0.6));
      var wave2 = !confetti && s >= PARTY.seedCount * 0.6;
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * (wave2 || confetti ? 1.45 : 1.05);
      var spd = U * (1.2 + Math.random() * 0.95);
      stars.push({
        at: now + (wave2 ? 140 + Math.random() * 140 : Math.random() * 90),
        x: U * (0.5 + (Math.random() - 0.5) * (wave2 || confetti ? 0.85 : 0.35)),
        y: U * (wave2 ? 0.7 + Math.random() * 0.2 : 0.5 + (Math.random() - 0.5) * 0.18),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        r: confetti ? U * (0.016 + Math.random() * 0.014) : U * (0.042 + Math.random() * 0.032),
        spin: (Math.random() - 0.5) * 0.9,
        spinRate: (Math.random() < 0.5 ? -1 : 1) * (confetti ? 4 + Math.random() * 5 : 1.2 + Math.random() * 2.2),
        wobble: Math.random() * Math.PI * 2,
        life: 2050 + Math.random() * 650,
        kind: confetti ? "confetti" : "sticker",
        spriteIdx: s % PARTY.stickers.length,
        ink: PARTY.confettiInk[(Math.random() * PARTY.confettiInk.length) | 0]
      });
    }
    starsEnd = now + 280 + 2750;
  }

  function showWinBanner() {
    nextRevealTimer = null;
    if (!S.solved) return;
    dom.nextBtn.classList.remove("hidden");
    dom.nextBtn.classList.add("reveal");
    // NEXT is wider than HINT, so the side columns and the name are re-measured.
    fitAnimalName();
  }

  function resumeVideo() {
    if (menuOpen) {
      if (menuPreviewEl) {
        var p = menuPreviewEl.play();
        if (p && p.catch) p.catch(function () { });
      }
      return;
    }
    dom.video.muted = true;
    var pp = dom.video.play();
    if (pp && pp.catch) pp.catch(function () { });
  }

  var blobUrls = {};
  var prefetchTimer = null;
  var PREFETCH_AHEAD = 3;

  function prefetch() {
    var done = 0;
    (function step(i) {
      if (i >= LEVELS.length || done >= PREFETCH_AHEAD) return;
      if (LEVELS[i].pending) { step(i + 1); return; }
      var src = LEVELS[i].video || LEVELS[i].src;
      if (blobUrls[src]) { done++; step(i + 1); return; }
      fetch(VIDEO_DIR + src)
        .then(function (r) { return r.ok ? r.blob() : Promise.reject(); })
        .then(function (blob) { blobUrls[src] = URL.createObjectURL(blob); })
        .catch(function () { })
        .then(function () { done++; step(i + 1); });
    })(S.level + 1);
  }

  function schedulePrefetch() {
    if (prefetchTimer) clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(prefetch, 1200);
  }

  function sourceOf(level) { return level.video || level.src; }

  // Entering a world announces the world itself: its icon and its name, rather
  // than a generic "new world" label.
  function showNewWorldBanner(world) {
    setImage(dom.newWorldIcon, WORLD_ART[world] || "");
    dom.newWorldText.textContent = worldName(world);
    squeeze(dom.newWorldText, window.innerWidth * 0.92);
    dom.newWorld.classList.remove("show");
    void dom.newWorld.offsetWidth;
    dom.newWorld.classList.add("show");
    if (newWorldTimer) clearTimeout(newWorldTimer);
    newWorldTimer = setTimeout(function () { dom.newWorld.classList.remove("show"); }, 2600);
  }

  // The header shows the animal in the clip once, in English.
  function paintHeader() {
    var level = LEVELS[S.level];
    var info = (ANIMALS && ANIMALS[level.id]) || { en: "Cute Animal", vi: "Con Vật Dễ Thương" };
    dom.worldProgress.innerHTML = '<span class="animal-name">' + (info.en || info.vi) + "</span>";
    fitAnimalName();
  }

  // Fits the header: the two side columns are sized to the real CTA button, and
  // the name in the middle column is scaled to whatever width that leaves.
  //
  // Text width is linear in font size, so one measurement gives the exact size.
  function fitAnimalName() {
    // Match the side columns to the button, so those columns hold it and nothing
    // more; the name gets everything left over.
    var ctaW = 0;
    if (dom.ctaSlot) {
      var btn = dom.ctaSlot.querySelector("button:not(.hidden)") || dom.ctaSlot.querySelector("button");
      if (btn) ctaW = Math.ceil(btn.getBoundingClientRect().width);
    }
    if (ctaW > 0) dom.titleRow.style.setProperty("--cta-col", ctaW + "px");
    else dom.titleRow.style.removeProperty("--cta-col");

    var name = dom.worldProgress.firstElementChild;
    if (!name) return;

    name.style.fontSize = "";
    var room = dom.worldProgress.clientWidth;
    if (!(room > 0)) return;

    var base = parseFloat(getComputedStyle(name).fontSize) || 20;
    var natural = name.getBoundingClientRect().width;
    if (!(natural > 0)) return;

    var rowH = dom.titleRow.clientHeight || 0;
    var min = 12;
    var max = rowH > 0 ? rowH * 0.86 : base * 1.15;
    var size = Math.max(min, Math.min(max, base * (room / natural)));
    name.style.fontSize = size.toFixed(2) + "px";
  }

  function fitHeader() {
    dom.titleRow.classList.remove("two-line");
    document.documentElement.classList.remove("hdr-2l");
  }

  function loadLevel(index) {
    if (index < 0) index = 0;
    if (index >= LEVELS.length) index = 0;
    if (LEVELS[index].pending) {
      var open = firstOpenLevel();
      index = open < LEVELS.length ? open : 0;
    }
    S.level = index;
    S.replay = cleared.has(index);
    resumeAt = S.level;
    persist();

    var level = LEVELS[index];
    S.n = level.world + 2;
    dom.video.src = blobUrls[sourceOf(level)] || (VIDEO_DIR + sourceOf(level));
    document.body.dataset.world = level.world;
    paintHeader();
    fitHeader();
    hideHint();
    resetHintClock();
    resumeVideo();
    buildBoard();
    // The row has its final width after layout(), so fit the name again here.
    fitAnimalName();

    var freshWorld = !seenWorlds.has(level.world);
    noteWorld(level.world);
    if (freshWorld) showNewWorldBanner(level.world);

    tutorSticky = false;
    if (S.countdown) {
      showTutor(false);
    } else {
      if (index === TUTOR.levelSwap) showTutor(true, "slide");
      else if (index === TUTOR.levelTurn) showTutor(true, "tap");
      else if (index === TUTOR.levelBoth) startBothTutor();
      else showTutor(false);
    }
    schedulePrefetch();
  }

  /* ------------------------------------------------------------------ *
   * 17. Tutorial hand
   * ------------------------------------------------------------------ */

  var tutorActive = false, tutorSticky = false;
  var tutorHideTimer = null, tutorCycleTimer = null;

  function resetTutorInline() {
    var s = dom.tutor.style;
    s.animation = ""; s.transition = ""; s.opacity = "";
    s.transform = ""; s.left = ""; s.top = "";
  }

  function showTutor(on, kind) {
    if (!on) {
      // The "both" tutorial has to show two gestures before it may leave.
      if (tutorSticky && !S.solved) return;
      tutorSticky = false;
      stopTutorCycle();
    }
    if (tutorHideTimer) {
      clearTimeout(tutorHideTimer);
      tutorHideTimer = null;
    }

    if (on) {
      tutorActive = true;
      resetTutorInline();
      dom.tutor.classList.remove("slide", "tap");
      dom.tutor.classList.add("show", kind === "tap" ? "tap" : "slide");
      return;
    }

    if (!tutorActive) return;
    tutorActive = false;
    var cs = getComputedStyle(dom.tutor);
    dom.tutor.style.animation = "none";
    dom.tutor.style.left = cs.left;
    dom.tutor.style.top = cs.top;
    dom.tutor.style.transform = cs.transform;
    dom.tutor.style.opacity = cs.opacity;
    void dom.tutor.offsetWidth;
    dom.tutor.style.transition = "opacity " + TUTOR.fadeMs + "ms ease";
    dom.tutor.style.opacity = "0";
    tutorHideTimer = setTimeout(function () {
      dom.tutor.classList.remove("show", "slide", "tap");
      resetTutorInline();
      tutorHideTimer = null;
    }, TUTOR.fadeMs + 30);
  }

  function parkTutor(cell) {
    var step = 100 / S.n;
    dom.tutor.style.left = (9.5 + colOf(cell, S.n) * step).toFixed(2) + "%";
    dom.tutor.style.top = (14.5 + rowOf(cell, S.n) * step).toFixed(2) + "%";
  }

  function stopTutorCycle() {
    if (tutorCycleTimer) { clearTimeout(tutorCycleTimer); tutorCycleTimer = null; }
  }

  function startBothTutor() {
    stopTutorCycle();
    tutorSticky = true;
    var shownKind = "", shownCell = -1;

    function nextGesture() {
      for (var cell = 0; cell < S.turn.length; cell++) {
        if (S.turn[cell] % 4 !== 0) return { kind: "tap", cell: cell };
      }
      if (S.part[0] !== 0 || S.part[1] !== 1) return { kind: "slide", cell: -1 };
      return null;
    }

    function apply() {
      var g = nextGesture();
      if (!g) { tutorSticky = false; showTutor(false); return false; }
      if (g.kind !== shownKind || g.cell !== shownCell) {
        showTutor(true, g.kind);
        if (g.kind === "tap") parkTutor(g.cell);
        shownKind = g.kind;
        shownCell = g.cell;
      }
      return true;
    }

    if (!apply()) return;
    (function step() {
      if (S.solved) { stopTutorCycle(); return; }
      if (!apply()) return;
      tutorCycleTimer = setTimeout(step, 400);
    })();
  }

  /* ------------------------------------------------------------------ *
   * 18. Render loop
   * ------------------------------------------------------------------ */

  var VIDEO_FPS = 24;

  function loop() {
    var lastPaint = 0, lastFrame = -1;
    var idleMs = 1000 / 30, busyMs = 1000 / 62;

    function tick(now) {
      requestAnimationFrame(tick);
      if (menuOpen) return;

      var turning = S.mode === "turn" && turnStart &&
        turnStart.some(function (s) { return s !== null && (now - s) < T.turn; });
      var moving = !!S.countdown || S.swapFx || S.shakeFx || S.winFx || S.linkFx ||
        stars.length || hintAnim ||
        (hintDimOn ? hintDim < 1 : hintDim > 0) ||
        (S.drag && S.drag.moved) || turning ||
        (select.key !== null && (now - select.at) < TOUCH.selectMs) ||
        (select.fade !== null && (now - select.fade.at) < TOUCH.selectMs);

      if (!moving) {
        if ((now - lastPaint) < idleMs) return;
        var vf = (dom.video.currentTime * VIDEO_FPS) | 0;
        if (vf === lastFrame && !repaint) return;
        lastFrame = vf;
        repaint = false;
      } else if ((now - lastPaint) < busyMs) {
        return;
      }
      lastPaint = now;
      render();
    }
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------ *
   * 19. Level picker
   * ------------------------------------------------------------------ */

  var ICON_CHECK = "ui/Checkmark.png";
  var ICON_LOCK = "ui/lock_cute.png";
  var MENU_FADE_MS = 240;

  var cards = [];
  var worldSections = {};
  var worldTabs = {};
  var activeWorld = 0;
  var menuTimers = [];
  var previewIdx = -1;
  var playIdx = 0;
  var celebrating = false;
  var menuDrag = null;
  var menuMomentum = 0;
  var swallowClick = false;

  function make(tag, cls, art) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (art) { setImage(node, art); node.alt = ""; node.draggable = false; }
    return node;
  }

  function thumbOf(i) { return THUMB_DIR + LEVELS[i].id + ".jpg"; }

  function later(ms, fn) { menuTimers.push(setTimeout(fn, ms)); }
  function clearMenuTimers() {
    for (var i = 0; i < menuTimers.length; i++) clearTimeout(menuTimers[i]);
    menuTimers.length = 0;
  }

  function pulse(node, cls, ms) {
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    setTimeout(function () { node.classList.remove(cls); }, ms);
  }

  function menuCursor() {
    if (!S.solved) return { cur: S.level, play: S.level };
    var n = firstOpenLevel();
    if (n >= LEVELS.length) return { cur: LEVELS.length, play: 0 };
    return { cur: n, play: n };
  }

  function buildMenu(cursor, hideDone) {
    detachPreview();
    dom.menuBody.innerHTML = "";
    dom.menuTabs.innerHTML = "";
    cards = [];
    worldSections = {};
    worldTabs = {};
    previewIdx = -1;

    var grid = null, slot = 0;
    for (var i = 0; i < LEVELS.length; i++) {
      var level = LEVELS[i];
      if (!worldSections[level.world]) {
        slot = 0;
        var section = make("section", "lm-world");
        section.dataset.world = level.world;
        var header = make("div", "lm-header");
        var title = make("div", "lm-title");
        var name = make("span", "lm-world-name");
        name.textContent = worldName(level.world);
        title.appendChild(name);
        header.appendChild(title);
        grid = make("div", "lm-grid");
        section.appendChild(header);
        section.appendChild(grid);
        dom.menuBody.appendChild(section);
        worldSections[level.world] = { node: section };

        var tab = make("button", "lm-tab");
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", "false");
        tab.setAttribute("aria-label", worldName(level.world));
        tab.appendChild(make("img", "", WORLD_ART[level.world] || ""));
        (function (world) {
          tab.addEventListener("click", function (e) { e.stopPropagation(); tab.blur(); activateWorld(world); });
        })(level.world);
        dom.menuTabs.appendChild(tab);
        worldTabs[level.world] = tab;
      }

      slot++;
      var dist = Math.abs(i - cursor);
      var card = make("button", "lm-card enter");
      card.style.setProperty("--d", Math.min(dist, 8) * 45 + "ms");
      card.setAttribute("aria-label", "Level " + (i + 1));

      var frame = make("span", "lm-frame");
      var num = make("span", "lm-num");
      num.textContent = slot;

      if (level.pending) {
        card.classList.add("pending");
        var soon = make("span", "lm-soon");
        soon.textContent = "?";
        frame.appendChild(soon);
        var soonLabel = make("span", "lm-soon-label");
        soonLabel.textContent = say("soon");
        frame.appendChild(soonLabel);
        card.appendChild(frame);
        card.appendChild(num);
      } else {
        var ill = make("img", "lm-ill", thumbOf(i));
        ill.loading = dist <= 8 ? "eager" : "lazy";
        ill.decoding = "async";
        frame.appendChild(ill);
        card.appendChild(frame);
        card.appendChild(num);

        var middle = make("span", "lm-mid");
        middle.setAttribute("aria-hidden", "true");
        middle.appendChild(make("img", "lm-play", "ui/play_btn_cute.png"));
        middle.appendChild(make("img", "lm-clap", ICON_LOCK));
        card.appendChild(middle);
        card.appendChild(make("img", "lm-check", ICON_CHECK));
      }

      (function (index) {
        card.addEventListener("click", function (e) { e.stopPropagation(); onCard(index); });
      })(i);

      grid.appendChild(card);
      cards.push(card);
    }

    applyMenuState(cursor, hideDone);
    activateWorld(LEVELS[Math.min(cursor, LEVELS.length - 1)].world, true);
  }

  function activateWorld(world, keepScroll) {
    activeWorld = world;
    dom.menu.dataset.world = world;
    for (var key in worldSections) {
      var on = +key === world;
      var node = worldSections[key].node;
      node.classList.toggle("active", on);
      if (on) node.removeAttribute("aria-hidden");
      else node.setAttribute("aria-hidden", "true");
      var tab = worldTabs[key];
      if (tab) {
        tab.classList.toggle("active", on);
        tab.setAttribute("aria-selected", on ? "true" : "false");
      }
    }
    if (!keepScroll) dom.menu.scrollTop = 0;
    if (menuPreviewEl) {
      var level = LEVELS[previewIdx];
      if (level && level.world === world) {
        var p = menuPreviewEl.play();
        if (p && p.catch) p.catch(function () { });
      } else {
        menuPreviewEl.pause();
      }
    }
    fitMenuText();
  }

  function setCardState(i, state) {
    var card = cards[i];
    if (!card) return;
    var states = ["done", "current", "locked", "unlocked"];
    for (var s = 0; s < states.length; s++) card.classList.remove(states[s]);
    card.classList.add(state);
    card.setAttribute("aria-disabled", state === "locked" ? "true" : "false");
  }

  function applyMenuState(cursor, hideDone) {
    var frontier = LEVELS.length;
    for (var i = 0; i < LEVELS.length; i++) {
      if (LEVELS[i].pending) continue;
      if (!cleared.has(i) || i === hideDone) { frontier = i; break; }
    }
    for (var k = 0; k < cards.length; k++) {
      var state;
      if (LEVELS[k].pending) state = "locked";
      else if (k === cursor) state = "current";
      else if (cleared.has(k) && k !== hideDone) state = "done";
      else if (k === frontier) state = "unlocked";
      else state = "locked";
      setCardState(k, state);
    }
  }

  function fitMenuText() {
    var labels = dom.menuBody.querySelectorAll(".lm-card.current .lm-play, .lm-card.unlocked .lm-play");
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].tagName !== "IMG") squeeze(labels[i], labels[i].clientWidth);
    }
  }

  function attachPreview(i) {
    if (previewIdx === i && menuPreviewEl) return;
    detachPreview();
    var card = cards[i];
    if (!card) return;
    var level = LEVELS[i];
    var v = document.createElement("video");
    v.className = "lm-vid";
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.preload = "auto";
    v.addEventListener("playing", function () { v.classList.add("on"); }, { once: true });
    v.src = blobUrls[sourceOf(level)] || (VIDEO_DIR + sourceOf(level));
    var frame = card.querySelector(".lm-frame");
    if (frame) frame.appendChild(v);
    menuPreviewEl = v;
    previewIdx = i;
    var p = v.play();
    if (p && p.catch) p.catch(function () { });
  }

  function detachPreview() {
    if (!menuPreviewEl) return;
    var v = menuPreviewEl;
    menuPreviewEl = null;
    previewIdx = -1;
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch (err) { /* already gone */ }
    v.remove();
  }

  function burst(card, count) {
    var reach = card.offsetWidth * 0.62;
    card.classList.add("lift");
    for (var k = 0; k < count; k++) {
      var spark = make("span", "lm-spark");
      var a = (k / count) * Math.PI * 2 + Math.random() * 0.5;
      var d = reach * (0.7 + Math.random() * 0.45);
      spark.style.setProperty("--dx", (Math.cos(a) * d).toFixed(1) + "px");
      spark.style.setProperty("--dy", (Math.sin(a) * d).toFixed(1) + "px");
      spark.style.animationDelay = ((Math.random() * 80) | 0) + "ms";
      card.appendChild(spark);
      (function (node) { setTimeout(function () { node.remove(); }, 800); })(spark);
    }
    setTimeout(function () { card.classList.remove("lift"); }, 800);
  }

  function fullyVisible(card) {
    var top = card.offsetTop - dom.menu.scrollTop;
    return top >= 0 && top + card.offsetHeight <= dom.menu.clientHeight;
  }

  function scrollMenuTo(i, smooth) {
    var card = cards[i];
    if (!card) return;
    var visible = dom.menu.clientHeight - 18;
    var bottom = card.offsetTop + card.offsetHeight;
    var top = bottom > visible ? bottom - visible : 0;
    top = Math.max(0, top);
    if (smooth) dom.menu.scrollTo({ top: top, behavior: "smooth" });
    else dom.menu.scrollTop = top;
  }

  function celebrateMenu(doneIdx, cursor) {
    celebrating = true;
    var doneCard = cards[doneIdx];
    var doneWorld = LEVELS[doneIdx].world;
    var nextIdx = cursor < LEVELS.length ? cursor : -1;
    var nextCard = nextIdx >= 0 ? cards[nextIdx] : null;

    later(450, function () {
      setCardState(doneIdx, "done");
      pulse(doneCard, "stamp", 600);
      burst(doneCard, 10);
    });

    if (!nextCard) {
      later(1250, function () { celebrating = false; });
      return;
    }

    var nextWorld = LEVELS[nextIdx].world;
    later(1250, function () {
      activateWorld(nextWorld, true);
      if (!fullyVisible(nextCard)) scrollMenuTo(nextIdx, true);
      nextCard.classList.add("unlocking");
      if (nextWorld !== doneWorld) pulse(worldSections[nextWorld].node, "wake", 720);
    });
    later(1250 + 860, function () {
      nextCard.classList.remove("unlocking");
      setCardState(nextIdx, "current");
      burst(nextCard, 12);
      attachPreview(nextIdx);
      fitMenuText();
      celebrating = false;
    });
  }

  function settleCelebration() {
    celebrating = false;
    clearMenuTimers();
    var cursor = menuCursor();
    cards.forEach(function (c) { c.classList.remove("unlocking", "enter"); });
    if (cursor.cur < LEVELS.length) activateWorld(LEVELS[cursor.cur].world, true);
    applyMenuState(cursor.cur);
    if (cursor.cur < LEVELS.length) attachPreview(cursor.cur);
    fitMenuText();
    if (menuOpen) document.body.classList.add("menu-open");
  }

  function onCard(i) {
    if (celebrating) { settleCelebration(); return; }
    var card = cards[i];
    if (card && card.classList.contains("unlocking")) return;
    if (isLocked(i)) { if (card) pulse(card, "nudge", 420); return; }
    playFromMenu(i);
  }

  function isLocked(i) {
    var card = cards[i];
    return !!(card && card.classList.contains("locked"));
  }

  function playFromMenu(i) {
    if (isLocked(i)) {
      var card = cards[i];
      if (card) pulse(card, "nudge", 420);
      return;
    }
    closeMenu();
    if (i !== S.level || S.solved) loadLevel(i);
  }

  function openMenu() {
    if (menuOpen) return;
    menuOpen = true;
    if (S.countdown && S.countdown.phase === "count") S.countdown.started = false;
    hideHint();
    try { dom.video.pause(); } catch (err) { /* not playing */ }

    var cursor = menuCursor();
    playIdx = cursor.play;
    var justWon = S.solved && !winSeen;
    winSeen = true;
    var crossedWorld = justWon && cursor.cur < LEVELS.length &&
      LEVELS[cursor.cur].world !== LEVELS[S.level].world;
    var celebrate = justWon && !crossedWorld;
    var shown = celebrate ? S.level : cursor.cur;

    buildMenu(shown, celebrate ? S.level : undefined);
    dom.menu.classList.add("show");
    dom.menu.setAttribute("aria-hidden", "false");
    scrollMenuTo(Math.min(shown, LEVELS.length - 1), false);
    fitMenuText();
    if (!celebrate && cursor.cur < LEVELS.length) attachPreview(cursor.cur);
    later(MENU_FADE_MS, function () { document.body.classList.add("menu-open"); });
    later(1000, function () { cards.forEach(function (c) { c.classList.remove("enter"); }); });
    if (celebrate) celebrateMenu(S.level, cursor.cur);
  }

  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    celebrating = false;
    clearMenuTimers();
    stopMomentum();
    menuDrag = null;
    dom.menu.classList.remove("dragging");
    detachPreview();
    document.body.classList.remove("menu-open");
    dom.menu.classList.remove("show");
    dom.menu.setAttribute("aria-hidden", "true");
    repaint = true;
    resumeVideo();
    resetHintClock();
  }

  function stopMomentum() {
    if (menuMomentum) {
      cancelAnimationFrame(menuMomentum);
      menuMomentum = 0;
    }
  }

  dom.menu.addEventListener("pointerdown", function (e) {
    stopMomentum();
    if (e.pointerType === "touch" || e.button !== 0) return;
    var now = performance.now();
    menuDrag = { id: e.pointerId, y: e.clientY, top: dom.menu.scrollTop, moved: false, lastY: e.clientY, lastT: now, v: 0 };
  });

  dom.menu.addEventListener("pointermove", function (e) {
    var d = menuDrag;
    if (!d || e.pointerId !== d.id) return;
    var dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.abs(dy) < 6) return;
      d.moved = true;
      try { dom.menu.setPointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
      dom.menu.classList.add("dragging");
    }
    var now = performance.now();
    var dt = Math.max(1, now - d.lastT);
    d.v = 0.8 * ((d.lastY - e.clientY) / dt) + 0.2 * d.v;
    d.lastY = e.clientY;
    d.lastT = now;
    dom.menu.scrollTop = d.top - dy;
  });

  function endMenuDrag(e) {
    var d = menuDrag;
    if (!d || e.pointerId !== d.id) return;
    menuDrag = null;
    if (!d.moved) return;
    dom.menu.classList.remove("dragging");
    try { dom.menu.releasePointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
    swallowClick = true;
    setTimeout(function () { swallowClick = false; }, 0);

    var v = (performance.now() - d.lastT) > 90 ? 0 : d.v;
    var last = performance.now();
    function glide(now) {
      var dt = now - last;
      last = now;
      dom.menu.scrollTop += v * dt;
      v *= Math.pow(0.95, dt / 16);
      menuMomentum = Math.abs(v) > 0.02 ? requestAnimationFrame(glide) : 0;
    }
    if (Math.abs(v) > 0.05) menuMomentum = requestAnimationFrame(glide);
  }

  dom.menu.addEventListener("pointerup", endMenuDrag);
  dom.menu.addEventListener("pointercancel", endMenuDrag);
  dom.menu.addEventListener("click", function (e) {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  dom.menu.addEventListener("wheel", stopMomentum, { passive: true });

  /* ------------------------------------------------------------------ *
   * 20. Chrome wiring
   * ------------------------------------------------------------------ */

  function openSettings(e) {
    if (e) e.stopPropagation();
    if (hintBusy) return;
    if (dom.settings.classList.contains("show")) return;
    dom.settings.classList.add("show");
    if (!music.started && !music.muted) playMusic();
  }

  function closeSettings(e) {
    if (e) e.stopPropagation();
    if (!dom.settings.classList.contains("show")) return;
    dom.settings.classList.remove("show");
    if (!menuOpen && !S.solved) resumeVideo();
  }

  dom.gear.addEventListener("click", openSettings);
  dom.settingsClose.addEventListener("click", closeSettings);
  dom.settingsBack.addEventListener("click", closeSettings);

  dom.mute.addEventListener("click", function (e) {
    e.stopPropagation();
    setMuted(!music.muted);
    if (music.muted) {
      try { dom.winSfx.pause(); } catch (err) { /* not playing */ }
    }
    playMusic();
  });

  // NEXT goes straight into the following level instead of returning to the
  // picker. Crossing into a new world is announced by the interstitial that
  // loadLevel() already triggers, and the board fades in behind it.
  dom.nextBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!S.solved) return;
    var next = S.level + 1;
    if (next >= LEVELS.length) next = 0;
    loadLevel(next);
  });

  dom.hintBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (S.solved || hintBusy) return;
    armSfx();
    requestHint();
  });

  function goHome(e) {
    if (e) e.stopPropagation();
    if (hintBusy || menuOpen) return;
    openMenu();
  }
  dom.logo.addEventListener("click", goHome);
  dom.logo.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goHome(e); }
  });

  window.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !menuOpen || celebrating) return;
    if (dom.settings.classList.contains("show")) return;
    closeMenu();
  });

  dom.input.addEventListener("pointerdown", onDown);
  dom.input.addEventListener("pointermove", onMove);
  dom.input.addEventListener("pointerup", onUp);
  dom.input.addEventListener("pointercancel", onCancel);

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) resumeVideo();
    settleMusic();
  });

  dom.video.addEventListener("error", function () {
    var level = LEVELS[S.level];
    if (!level) return;
    var src = sourceOf(level);
    if (typeof dom.video.src === "string" && dom.video.src.slice(0, 5) === "blob:") {
      delete blobUrls[src];
      dom.video.src = VIDEO_DIR + src;
      resumeVideo();
    }
  });

  window.addEventListener("keydown", function (ev) {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === " ") ev.preventDefault();
  });
  window.addEventListener("wheel", function (ev) {
    if (ev.target && ev.target.closest && ev.target.closest("#level-menu")) return;
    ev.preventDefault();
  }, { passive: false });

  function applyStaticText() {
    document.documentElement.lang = LANG;
    dom.nextText.textContent = say("next");
    dom.hintText.textContent = say("hint");
    squeeze(dom.nextText, dom.nextText.clientWidth);
    squeeze(dom.hintText, dom.hintText.clientWidth);
  }

  var resizeQueued = false;
  window.addEventListener("resize", function () {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(function () {
      resizeQueued = false;
      fitHeader();
      if (frameCanvas) layout();
      applyStaticText();
      fitAnimalName();
    });
  });

  function showUnsupported() {
    var note = document.createElement("div");
    note.style.cssText = "position:fixed;inset:0;z-index:200;display:flex;align-items:center;" +
      "justify-content:center;text-align:center;padding:24px;" +
      "background:radial-gradient(circle at 50% 30%,#fff3c0,#f5b81e);color:#3a2a1e;" +
      "font:700 clamp(16px,4.5vmin,24px)/1.4 'Nunito','Segoe UI',system-ui,sans-serif;";
    note.textContent = "Please update your browser to play this game.";
    document.body.appendChild(note);
  }

  /* ------------------------------------------------------------------ *
   * 21. Boot
   * ------------------------------------------------------------------ */

  var bootState = { done: false };

  // The first celebration used to stutter because the browser was meeting the
  // particle code, the sticker downsizing and the gradient builders for the
  // first time. Doing that work once during the loading screen means the very
  // first win animates as smoothly as every later one.
  function warmUp() {
    if (!sheetReady) return;

    // Build the sticker bitmaps at the sizes the burst actually asks for. The
    // cache key is "<sprite>:<pixel size>", and the size comes from the board
    // side, so the same formula is used here.
    var side = geo.side || Math.min(window.innerWidth, window.innerHeight);
    var base = side * (0.042 + 0.032);
    for (var i = 0; i < PARTY.stickers.length; i++) {
      var art = ATLAS[PARTY.stickers[i]];
      if (!art) continue;
      for (var s = 0; s < 4; s++) {
        var px = Math.max(8, Math.round(base * (1 - s * 0.2)));
        var key = i + ":" + px;
        if (stickerCache[key]) continue;
        var cv = document.createElement("canvas");
        cv.width = px;
        cv.height = px;
        cv.getContext("2d").drawImage(sheetImg, art.x, art.y, art.w, art.h, 0, 0, px, px);
        stickerCache[key] = cv;
      }
    }

    // Compile the celebration path once so the first run is not the slow one.
    var probe = document.createElement("canvas");
    probe.width = 64;
    probe.height = 64;
    var pg = probe.getContext("2d");
    var grad = pg.createLinearGradient(0, 0, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(255,255,255,0.4)");
    pg.fillStyle = grad;
    pg.fillRect(0, 0, 64, 64);
    var rad = pg.createRadialGradient(32, 32, 2, 32, 32, 40);
    rad.addColorStop(0, "rgba(255,255,255,0.4)");
    rad.addColorStop(1, "rgba(255,255,255,0)");
    pg.fillStyle = rad;
    pg.fillRect(0, 0, 64, 64);

    // A few frames of the real particle maths, off-screen.
    for (var k = 0; k < 6; k++) {
      sparkle(20, 20, 8, k, 0.5, "#fff7d6", pg);
    }
  }

  function startGame() {
    if (!("PointerEvent" in window)) { showUnsupported(); return; }
    applyStaticText();

    function refit() {
      applyStaticText();
      fitHeader();
      if (frameCanvas) layout();
    }
    if (document.fonts && document.fonts.ready) {
      var onFonts = function () {
        if (bootState.done) refit();
        else document.addEventListener("bootloader:done", refit, { once: true });
      };
      document.fonts.ready.then(onFonts, onFonts);
    }

    var start = restoreProgress();
    var frontier = firstOpenLevel();
    if (frontier < LEVELS.length && (start > frontier || cleared.has(start))) start = frontier;
    for (var w = 1; w <= LEVELS[start].world; w++) noteWorld(w);

    loadLevel(start);
    loop();
    playMusic();

    if (bootState.done) openMenu();
    else document.addEventListener("bootloader:done", function () { openMenu(); }, { once: true });

    // Test/debug handle: read the model and drive a level without the UI.
    window.__game = {
      get mode() { return S.mode; },
      get size() { return S.n; },
      get tiles() { return S.part; },
      get rot() { return S.turn; },
      get rotStart() { return turnStart; },
      get blockOf() { return S.group; },
      get blocks() { return S.groups; },
      get countdownState() { return S.countdown; },
      rotateTile: turnCell,
      trySwap: planSwap,
      animateAndCommit: commitSwap,
      recomputeBlocks: rebuildGroups,
      isSolvedState: isFinished,
      loadLevel: loadLevel,
      applyHint: requestHint,
      hintSwap: hintExchange,
      hintRotate: hintTurn,
      resetHintIdleTimer: resetHintClock,
      hideHintBtn: hideHint,
      showHintBtn: showHint,
      closeLevelMenu: closeMenu,
      openLevelMenu: openMenu
    };
  }

  function runBoot() {
    var loader = el("boot-loader");
    var bar = el("bl-bar-fill");
    var pct = el("bl-pct");

    if (!loader) { bootState.done = true; startGame(); return; }

    var t0 = performance.now();
    var MIN_SHOW = 1100;
    var MAX_WAIT = 3600;

    var resume = Math.max(0, Math.min(store.load().resume || 0, LEVELS.length - 1));
    var world = (LEVELS[resume] && LEVELS[resume].world) || 1;

    // The loader wears the backdrop of the world the player is resuming into,
    // read from the saved profile, so the first paint already matches the level.
    var portraitQuery = window.matchMedia && window.matchMedia("(max-aspect-ratio: 1/1)");
    var isPortrait = !!(portraitQuery && portraitQuery.matches);
    loader.style.backgroundImage =
      'url("ui/bg_world_' + world + (isPortrait ? "_mobile.jpg" : ".jpg") + '")';
    loader.style.backgroundPosition = isPortrait ? "center center" : "center bottom";

    var sheetDone = sheetReady;
    var fontsDone = !(document.fonts && document.fonts.ready);
    var bgDone = false;
    var videoDone = dom.video.readyState >= 2;
    var booted = false;
    var finished = false;

    if (!sheetDone) {
      sheetImg.addEventListener("load", function () { sheetDone = true; }, { once: true });
      sheetImg.addEventListener("error", function () { sheetDone = true; }, { once: true });
    }
    if (!fontsDone) {
      document.fonts.ready.then(function () { fontsDone = true; }, function () { fontsDone = true; });
    }

    // Prime the celebration while the bar is still filling, so the first win
    // is as smooth as the rest. Runs after the sheet exists; harmless if not.
    var warm = function () {
      try { warmUp(); } catch (err) { /* warm-up is optional */ }
    };
    if (sheetReady) warm();
    else sheetImg.addEventListener("load", warm, { once: true });

    var bg = new Image();
    bg.onload = bg.onerror = function () { bgDone = true; };
    bg.src = "ui/bg_world_" + world + (isPortrait ? "_mobile.jpg" : ".jpg");
    if (bg.complete) bgDone = true;

    if (!videoDone) {
      var markVideo = function () { videoDone = true; };
      dom.video.addEventListener("loadeddata", markVideo, { once: true });
      dom.video.addEventListener("canplay", markVideo, { once: true });
      dom.video.addEventListener("error", markVideo, { once: true });
    }

    var painted = 0;
    (function afterPaint() {
      if (booted) return;
      if (++painted < 2) { requestAnimationFrame(afterPaint); return; }
      booted = true;
      setTimeout(startGame, 0);
    })();

    function target(now) {
      var t = now - t0;
      var p = 8 + Math.min(1, t / MIN_SHOW) * 62;
      if (sheetDone) p += 8;
      if (fontsDone) p += 6;
      if (bgDone) p += 6;
      if (videoDone) p += 6;
      if (booted) p += 4;
      var ready = sheetDone && fontsDone && bgDone && videoDone && booted;
      if ((ready && t >= MIN_SHOW) || t >= MAX_WAIT) return 100;
      return Math.min(99, p);
    }

    var shown = 0, shownInt = -1, lastT = t0;
    (function step(now) {
      if (finished) return;
      var dt = Math.max(0, Math.min(80, now - lastT));
      lastT = now;
      var goal = target(now);
      shown += (goal - shown) * (1 - Math.exp(-dt / 90));
      if (goal >= 100 && shown > 99.4) shown = 100;
      var value = Math.min(100, Math.round(shown));
      if (value !== shownInt) {
        shownInt = value;
        if (bar) bar.style.width = value + "%";
        if (pct) pct.textContent = value + "%";
      }
      if (value >= 100) {
        finished = true;
        bootState.done = true;
        document.dispatchEvent(new Event("bootloader:done"));
        loader.classList.add("done");
        setTimeout(function () { loader.style.display = "none"; }, 460);
        return;
      }
      requestAnimationFrame(step);
    })(t0);
  }

  runBoot();
})();
