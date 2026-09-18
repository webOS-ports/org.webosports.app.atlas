/* Phone or tablet?
 *
 * Atlas descends from the webOS 3.0.5 TouchPad browser, so its chrome is a tablet's: one 54px row
 * carrying eight controls and a 320px drawer. That is wrong on a phone, where the app lays out at
 * ~450 css px, so the phone gets its own chrome (source/phone/) built in the spirit of the 2.2.4
 * phone browser. This file is the single place that decides which one is in play.
 *
 *   window.__atlasPhone           true on a phone (mirrors window.__atlasChromium in AtlasHost.js)
 *   <html class="atlas-phone">    what css/phone.css keys off
 *   AtlasFormFactor.isPhone()     the same answer, for JS
 *   AtlasFormFactor.onChange(fn)  fired if a resize ever changes the answer
 *
 * The rule, deliberately an OR rather than a fallback chain:
 *
 *     phone = (TabletUi === false) || (min(innerWidth, innerHeight) < PHONE_MAX_DIP)
 *
 * TabletUi comes from /etc/palm/luna-platform.conf, which the platform already maintains per device
 * (sargo/mp01 false; tenderloin, pinetab2, opal, raspberrypi true) — the same flag LunaSysMgr reads
 * (Settings.cpp, KEY_BOOLEAN("UI", "TabletUi")). It is the authoritative signal on LuneOS, but it
 * cannot be the only one: on legacy webOS the Pre 3's own 2.2.4 rootfs says TabletUi=true on a
 * 320x400 phone. Hence the size term, which can override it, and which also covers the file being
 * absent or unreadable.
 *
 * The size term uses the SMALLER dimension, not the width: sargo in landscape is 810 css px wide, so
 * a width test would flip the whole UI on every rotation. The smaller dimension of a phone stays a
 * phone's in both orientations.
 *
 * Load this from index.html after ShellPalmSystem.js and before enyo.js: the class has to be on
 * <html> before the framework renders, and PalmSystem (real or shimmed) has to exist for the file
 * read. Packaging or a test can pin the answer with window.__atlasUiForce = "phone" | "tablet", and
 * ?atlasUi=<form> in the URL overrides both — the same override story as AtlasHost.js. */
(function () {
    var CONF = "/etc/palm/luna-platform.conf";
    // A phone is anything whose shorter edge is under this, in css px. The TouchPad's is 768 and the
    // widest phone viewport we ship is 450, so the exact value is not delicate.
    var PHONE_MAX_DIP = 600;

    var listeners = [];
    var isPhone = false;

    function fromQuery() {
        try {
            var m = /[?&]atlasUi=([a-z]+)/.exec(window.location.search || "");
            return m ? m[1] : null;
        } catch (e) { return null; }
    }

    /* Synchronous local-file read. PalmSystem.getResource is the host's own reader (the browser_shell
     * shim implements it over XHR; legacy webOS implements it natively); the XHR path is the fallback
     * for a host that has neither. file:// XHR reports status 0 on success, so treat that as OK. */
    function readFile(path) {
        try {
            if (window.PalmSystem && PalmSystem.getResource) {
                var r = PalmSystem.getResource(path);
                if (typeof r === "string" && r) { return r; }
            }
        } catch (e) {}
        try {
            var x = new XMLHttpRequest();
            x.open("GET", "file://" + path, false);
            x.send(null);
            if (x.status === 0 || (x.status >= 200 && x.status < 300)) { return x.responseText; }
        } catch (e2) {}
        return null;
    }

    /* true / false as configured, or null when the file cannot be read or says nothing. */
    function tabletUi() {
        var text = readFile(CONF);
        if (!text) { return null; }
        var m = /^[ \t]*TabletUi[ \t]*=[ \t]*(true|false)/im.exec(text);
        return m ? (m[1].toLowerCase() === "true") : null;
    }

    function smallerEdge() {
        var w = window.innerWidth || 0, h = window.innerHeight || 0;
        if (w <= 0 || h <= 0) { return 0; }        // too early to tell — let the flag decide alone
        return Math.min(w, h);
    }

    function decide() {
        var forced = fromQuery() || window.__atlasUiForce;
        if (forced === "phone") { return true; }
        if (forced === "tablet") { return false; }
        var flag = tabletUi();
        var edge = smallerEdge();
        return (flag === false) || (edge > 0 && edge < PHONE_MAX_DIP);
    }

    function publish() {
        window.__atlasPhone = isPhone;
        window.__atlasTablet = !isPhone;
        var el = document.documentElement;          // NOT the app root: enyo popups render outside it
        if (el) {
            var cls = (el.className || "").replace(/\batlas-(phone|tablet)\b/g, "").trim();
            el.className = (cls ? cls + " " : "") + (isPhone ? "atlas-phone" : "atlas-tablet");
        }
    }

    isPhone = decide();
    publish();
    try {
        console.log("[Atlas] form factor = " + (isPhone ? "phone" : "tablet") +
                    " (TabletUi=" + tabletUi() + ", " + window.innerWidth + "x" + window.innerHeight + ")");
    } catch (e) {}

    /* Re-evaluate on resize. On a device the answer cannot change — the conf file decides and the size
     * term is orientation-stable — so this is here for two cases only: a debug override, and a boot
     * where the host applies its UI zoom after the first layout (innerWidth would have been read
     * pre-zoom, with the conf file unreadable). A change is therefore rare and structural, and the
     * layout is chosen at kind-creation time, so the honest response is a reload rather than a live
     * re-layout. Callers can opt out by registering their own onChange handler. */
    var timer = null;
    function onResize() {
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(function () {
            timer = null;
            var now = decide();
            if (now === isPhone) { return; }
            isPhone = now;
            publish();
            try { console.log("[Atlas] form factor changed to " + (isPhone ? "phone" : "tablet")); } catch (e) {}
            for (var i = 0; i < listeners.length; i++) {
                try { listeners[i](isPhone); } catch (e2) {}
            }
        }, 100);
    }
    try { window.addEventListener("resize", onResize, false); } catch (e) {}

    window.AtlasFormFactor = {
        isPhone: function () { return isPhone; },
        onChange: function (fn) { if (typeof fn === "function") { listeners.push(fn); } },
        // Exposed for the console: re-read everything now and report whether it changed.
        refresh: function () {
            var before = isPhone;
            isPhone = decide();
            publish();
            return isPhone !== before;
        }
    };
})();
