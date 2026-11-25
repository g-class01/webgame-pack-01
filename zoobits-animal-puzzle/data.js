// ============================================================================
// Zoobits — content.
//
// One source of truth: the CATALOG table below. Each row is a clip id and the
// two names shown for it. World, slot, scramble rule and file name are all
// derived from the row's position, so a level can never end up with a clip in
// one place and a name in another.
//
// Names are just the animal itself: they fill the header row beside the HINT /
// NEXT button, and a single short word fits there at a comfortable size.
//
// Loaded as a classic <script> before game.js so the game runs straight from
// file:// with no server and no build step.
// ============================================================================

(function () {
  "use strict";

  // Six levels per world, five worlds.
  var PER_WORLD = 6;

  // Rule by slot inside a world (mirrors modeFor() in game.js).
  //   1, 2  exchange only    3, 4  quarter turns only    5, 6  both
  function ruleForSlot(slot) {
    if (slot <= 2) return "exchange";
    if (slot <= 4) return "turn";
    return "both";
  }

  // [id, English name, Vietnamese name] — in play order.
  var CATALOG = [
    // World 1 — Grassland
    ["corgi_camp", "Corgi", "Corgi"],
    ["raccoon_bakery", "Raccoon", "Gấu Mèo"],
    ["hedgehog_skate", "Hedgehog", "Nhím"],
    ["giraffe_fire", "Giraffe", "Hươu Cao Cổ"],
    ["kangaroo_hoop", "Kangaroo", "Chuột Túi"],
    ["lion_singer", "Lion", "Sư Tử"],

    // World 2 — Underground
    ["mole_miner", "Mole", "Chuột Chũi"],
    ["badger_soup", "Badger", "Lửng"],
    ["meerkat_lantern", "Meerkat", "Cầy Meerkat"],
    ["bunny_burrow", "Bunny", "Thỏ"],
    ["salamander_chimes", "Salamander", "Kỳ Nhông"],
    ["mouse_library", "Mouse", "Chuột"],

    // World 3 — Mountain
    ["goat_climber", "Goat", "Dê Núi"],
    ["leopard_cocoa", "Leopard", "Báo Tuyết"],
    ["marmot_accordion", "Marmot", "Chuột Núi"],
    ["macaque_hotspring", "Macaque", "Khỉ Tuyết"],
    ["yak_bell", "Yak", "Bò Yak"],
    ["alpaca_ukulele", "Alpaca", "Lạc Đà"],

    // World 4 — Sky
    ["owl_pilot", "Owl", "Cú Mèo"],
    ["bee_star", "Bee", "Ong"],
    ["toucan_station", "Toucan", "Toucan"],
    ["parrot_balloon", "Parrot", "Vẹt"],
    ["flamingo_teahouse", "Flamingo", "Hồng Hạc"],
    ["hummingbird_star", "Hummingbird", "Chim Ruồi"],

    // World 5 — Undersea
    ["octopus_painter", "Octopus", "Bạch Tuộc"],
    ["turtle_explorer", "Turtle", "Rùa Biển"],
    ["clownfish_bubbles", "Clownfish", "Cá Hề"],
    ["seal_pearl", "Seal", "Hải Cẩu"],
    ["seahorse_maracas", "Seahorse", "Cá Ngựa"],
    ["crab_treasure", "Crab", "Cua"]
  ];

  var levels = [];
  var animals = {};

  for (var i = 0; i < CATALOG.length; i++) {
    var row = CATALOG[i];
    var id = row[0];
    var world = Math.floor(i / PER_WORLD) + 1;
    var slot = (i % PER_WORLD) + 1;
    var rule = ruleForSlot(slot);

    var level = {
      id: id,
      world: world,
      src: id + ".mp4",
      // Board side is world + 2 (3x3 through 7x7); recorded for reference only.
      size: world + 2
    };
    if (rule === "turn") level.bonus = true;
    if (rule === "both") level.hard = true;
    levels.push(level);

    animals[id] = { en: row[1], vi: row[2] };
  }

  window.ZOOBITS_DATA = {

    // Only text the player reads during play is translated. The display font has
    // no accented glyphs, so accented words fall back to the 900-weight system
    // font (see @font-face in styles.css). Language comes from ?lang=, else
    // navigator.language, else English.
    STRINGS: {
      en: {
        next: "NEXT", hint: "HINT", play: "PLAY", soon: "SOON",
        hardLevel: "COMBO LEVEL", bonusLevel: "BONUS LEVEL"
      },
      fr: {
        next: "SUIVANT", hint: "INDICE", play: "JOUER", soon: "BIENTÔT",
        hardLevel: "COMBO LEVEL", bonusLevel: "NIVEAU BONUS"
      },
      es: {
        next: "SIGUIENTE", hint: "PISTA", play: "JUGAR", soon: "PRONTO",
        hardLevel: "COMBO LEVEL", bonusLevel: "NIVEL BONUS"
      },
      pt: {
        next: "PRÓXIMO", hint: "DICA", play: "JOGAR", soon: "EM BREVE",
        hardLevel: "COMBO LEVEL", bonusLevel: "NÍVEL BÔNUS"
      },
      de: {
        next: "WEITER", hint: "TIPP", play: "SPIELEN", soon: "BALD",
        hardLevel: "COMBO LEVEL", bonusLevel: "BONUSLEVEL"
      },
      it: {
        next: "AVANTI", hint: "AIUTO", play: "GIOCA", soon: "PRESTO",
        hardLevel: "COMBO LEVEL", bonusLevel: "LIVELLO BONUS"
      },
      nl: {
        next: "VERDER", hint: "HINT", play: "SPELEN", soon: "BINNENKORT",
        hardLevel: "COMBO LEVEL", bonusLevel: "BONUSLEVEL"
      }
    },

    WORLDS: [
      { n: 1, en: "Grassland", vi: "Đồng Cỏ", art: "ui/tab_island_1.png" },
      { n: 2, en: "Underground", vi: "Lòng Đất", art: "ui/tab_island_2.png" },
      { n: 3, en: "Mountain", vi: "Núi Cao", art: "ui/tab_island_3.png" },
      { n: 4, en: "Sky", vi: "Bầu Trời", art: "ui/tab_island_4.png" },
      { n: 5, en: "Undersea", vi: "Đáy Biển", art: "ui/tab_island_5.png" }
    ],

    LEVELS: levels,
    ANIMAL_INFO: animals,

    VIDEO_DIR: "tapwap_videos/",
    THUMB_DIR: "tapwap_thumb_videos/"
  };
})();
