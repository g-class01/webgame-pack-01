// Fits the board into whatever space the page is given.
//
// The layout is built from fixed pixel sizes (a 500px board, 107px tiles), so it
// cannot reflow to an iframe of a different size on its own. Instead the whole
// game is scaled to fit the viewport, which keeps every proportion intact and
// works the same in a full window or a small embed.
(function () {
  "use strict";

  var container = document.querySelector(".container");
  if (!container) return;

  // Must match the body padding in main.css: the scale is computed against the
  // space left inside that padding, so the board never touches the frame edge.
  var PAD = 32;

  function fit() {
    // Measure the natural layout first. A scale already applied would otherwise
    // feed back into the next measurement.
    container.style.transform = "";

    var w = container.offsetWidth;
    var h = container.offsetHeight;
    if (!w || !h) return;

    var vw = document.documentElement.clientWidth || window.innerWidth;
    var vh = document.documentElement.clientHeight || window.innerHeight;
    if (!vw || !vh) return;

    var scale = Math.min((vw - PAD) / w, (vh - PAD) / h);

    // Only ever shrink. The layout is already designed at a comfortable size, so
    // scaling up on a large monitor just makes the game oversized and blurry;
    // 1 keeps it at its natural size there, while small screens still shrink.
    scale = Math.min(1, scale);

    // Floor so the board never becomes unreadably small in a tiny embed.
    scale = Math.max(0.2, scale);

    container.style.transform = "scale(" + scale + ")";
  }

  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
  // Fonts change the natural height, so measure again once they are ready.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fit, fit);
  }

  fit();
})();
