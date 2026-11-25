/**
 * Universal Offline Poki SDK & Sitelock Immunizer v2.1 (Full Proxy Safe)
 */
(function() {
    'use strict';
    var origAtob = window.atob;
    window.atob = function(str) {
        if (typeof str === 'string' && (str.indexOf('aHR0cHM6Ly9wb2tpLmNvbS9zaXRlbG9jaw') !== -1 || str.indexOf('sitelock') !== -1)) {
            return 'javascript:void(0)';
        }
        return origAtob.apply(this, arguments);
    };
    var origEval = window.eval;
    window.eval = function(str) {
        if (typeof str === 'string' && (str.indexOf('aHR0cHM6Ly9wb2tpLmNvbS9zaXRlbG9jaw') !== -1 || str.indexOf('sitelock') !== -1)) {
            return;
        }
        return origEval.apply(this, arguments);
    };
    var origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
            url = '.' + url;
        }
        return origXhrOpen.apply(this, [method, url].concat(Array.prototype.slice.call(arguments, 2)));
    };
    if (window.fetch) {
        var origFetch = window.fetch;
        window.fetch = function(input, init) {
            if (typeof input === 'string' && input.startsWith('/') && !input.startsWith('//')) {
                input = '.' + input;
            }
            return origFetch.apply(this, arguments);
        };
    }
    var bridgeName = null;
    window.initPokiBridge = function(e) {
        bridgeName = e;
        function sendReady() {
            var g = window.unityInstance || window.unityGame;
            if (g) {
                try { g.SendMessage(e, 'ready'); } catch(err) {}
            } else {
                setTimeout(sendReady, 50);
            }
        }
        sendReady();
    };
    window.commercialBreak = function() {
        var g = window.unityInstance || window.unityGame;
        if (g && bridgeName) {
            try { g.SendMessage(bridgeName, 'commercialBreakCompleted'); } catch(e) {}
        }
    };
    window.rewardedBreak = function() {
        var g = window.unityInstance || window.unityGame;
        if (g && bridgeName) {
            try { g.SendMessage(bridgeName, 'rewardedBreakCompleted', 'true'); } catch(e) {}
        }
    };
    var basePoki = {
        init: function() { return Promise.resolve(true); },
        initWithVideoHB: function() { return Promise.resolve(true); },
        customEvent: function() {},
        commercialBreak: function() { return Promise.resolve(); },
        rewardedBreak: function() { return Promise.resolve(true); },
        displayAd: function() {},
        destroyAd: function() {},
        getLeaderboard: function() { return Promise.resolve(); },
        getLanguage: function() { return (navigator.language || 'en').substring(0, 2); },
        getURLParam: function(p) { return ''; },
        gameplayStart: function() {},
        gameplayStop: function() {},
        gameLoadingStart: function() {},
        gameLoadingFinished: function() {},
        gameLoadingProgress: function(p) {},
        happyTime: function(scale) {},
        isAdBlocked: function() { return false; },
        setDebug: function() {},
        captureError: function() {},
        logError: function() {},
        roundEnd: function() {},
        roundStart: function() {},
        movePill: function() {},
        openExternalLink: function() {},
        login: function() { return Promise.resolve(); },
        getUser: function() { return Promise.resolve(null); },
        getToken: function() { return Promise.resolve(''); },
        measure: function() {},
        shareableURL: function() { return Promise.resolve(window.location.href); }
    };
    window.PokiSDK = new Proxy(basePoki, {
        get: function(target, prop) {
            if (prop in target) return target[prop];
            return function() { return Promise.resolve(); };
        }
    });
    window.pokiSDK = window.PokiSDK;
})();
