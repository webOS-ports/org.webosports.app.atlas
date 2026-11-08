/* PalmSystem shim for the LuneOS browser_shell host.
 *
 * Enyo 1 and Atlas both assume the legacy webOS window object `PalmSystem` exists — the framework
 * touches ~30 members of it while it boots (launchParams, identifier, stageReady, banners, keyboard,
 * clipboard paste, locale...), and Atlas reads deviceInfo, paste, enableFullScreenMode, hasAlphaHole.
 * WAM injects that object; browser_shell does NOT (measured on LuneOS 2026-08-08: PalmSystem and
 * webOSSystem are undefined in a "native_browsershell" page, though PalmServiceBridge IS present, so
 * db8/luna keep working untouched).
 *
 * This file supplies the missing object on top of what the shell actually gives us:
 *   window.shell.launchArgs                 -> launchParams / identifier
 *   window.shell.shellWindow                -> activate / visibility
 *   window.screen                           -> deviceInfo
 *   navigator.clipboard                     -> paste
 * Everything the shell has no equivalent for is an explicit, silent no-op — listed below rather than
 * left undefined, so the framework's feature checks take a consistent path instead of throwing.
 *
 * No-op on every other host: if PalmSystem already exists (legacy webOS, LuneOS WAM) this file returns
 * immediately and changes nothing. Load it after AtlasHost.js and before enyo.js. */
(function () {
    if (!window.__atlasChromium) { return; }          // wpe host: the real PalmSystem is already there
    if (window.PalmSystem) { return; }                // belt and braces — never shadow a real one

    var shell = window.shell || {};
    var launchArgs = shell.launchArgs || {};

    function shellWindow() { return shell.shellWindow || null; }

    function rootPageContents() {
        var w = shellWindow();
        return (w && w.pageView && w.pageView.pageContents) ? w.pageView.pageContents : null;
    }

    /* deviceInfo is a JSON *string* in the legacy API (callers run it through enyo.json.parse).
     * screenWidth/screenHeight matter most: Atlas sizes its chrome from them, and the low-memory
     * profile keys off the smaller dimension. */
    function deviceInfo() {
        var w = (window.screen && window.screen.width) || window.innerWidth || 1024;
        var h = (window.screen && window.screen.height) || window.innerHeight || 768;
        return JSON.stringify({
            modelName: "LuneOS",
            modelNameAscii: "LuneOS",
            platformVersion: "chromium-shell",
            screenWidth: w,
            screenHeight: h,
            maximumCardWidth: w,
            maximumCardHeight: h,
            minimumCardWidth: w,
            minimumCardHeight: h,
            keyboardAvailable: false,
            wifiAvailable: true,
            carrierAvailable: false,
            coreNaviButton: false
        });
    }

    /* Banners: the shell has no system notification surface reachable from JS. Route them to a hook the
     * UI layer can own (an in-app toast), and fall back to the log so nothing is silently swallowed. */
    var bannerId = 0;
    function banner(message) {
        try {
            if (typeof window.__atlasBanner === "function") { window.__atlasBanner(message); }
            else { console.log("[Atlas][banner] " + message); }
        } catch (e) {}
        return ++bannerId;
    }

    /* The legacy paste() pastes the SYSTEM clipboard into whatever is focused, asynchronously and with
     * no callback — enyo.dom.getClipboard selects a scratch textarea and calls it. execCommand("paste")
     * is blocked in Chromium, so read the clipboard and insert at the cursor ourselves. */
    function paste() {
        var el = document.activeElement;
        function insert(text) {
            if (!text || !el) { return; }
            if (typeof el.selectionStart === "number") {
                var s = el.selectionStart, e = el.selectionEnd, v = el.value || "";
                el.value = v.substring(0, s) + text + v.substring(e);
                el.selectionStart = el.selectionEnd = s + text.length;
            } else if (el.isContentEditable) {
                document.execCommand("insertText", false, text);
            }
            try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e2) {}
        }
        try {
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(insert, function () {});
                return;
            }
        } catch (e) {}
        try { document.execCommand("paste"); } catch (e3) {}
    }

    /* Synchronous local-file read. Two things about the legacy contract matter:
     *   - asked for "const json" it returns a PARSED OBJECT, not text (enyo's g11n loader and
     *     enyo.getResource only JSON.parse the result when it comes back as a string — hand them ""
     *     for a missing file and they throw "Unexpected end of JSON input" during boot);
     *   - a missing resource must come back undefined, not empty string.
     * file:// XHR reports status 0 on success, so treat that as OK. */
    function getResource(path, type) {
        var text = null;
        try {
            var x = new XMLHttpRequest();
            x.open("GET", path, false);
            x.send(null);
            if (x.status === 0 || (x.status >= 200 && x.status < 300)) { text = x.responseText; }
        } catch (e) {}
        if (!text) { return undefined; }
        if (type && String(type).indexOf("json") >= 0) {
            try { return JSON.parse(text); } catch (e2) { return undefined; }
        }
        return text;
    }

    function noop() {}

    /* Which element counts as "typing target" — used by the keyboard show/hide mapping below. */
    function isEditable(el) {
        if (!el) { return false; }
        if (el.isContentEditable) { return true; }
        var tag = (el.tagName || "").toUpperCase();
        if (tag === "TEXTAREA") { return true; }
        return tag === "INPUT" &&
            /^(text|search|url|email|tel|password|number|)$/i.test(el.type || "");
    }
    function firstVisibleEditable() {
        var els = document.querySelectorAll("input, textarea, [contenteditable]");
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (!isEditable(el) || el.disabled || el.readOnly) { continue; }
            if (el.offsetParent === null) { continue; }
            var r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { return el; }
        }
        return null;
    }
    var lastEditable = null;
    /* KEY EVENTS FOLLOW THE SHELL'S FOCUS, NOT THE DOM'S. The shell hands keyboard focus to the tab's
     * native page view, so anything typed goes to the web page and Atlas's own fields stay empty — the
     * address bar accepts no letters and Enter never reaches it. Whenever the user puts the caret in a
     * UI field, take shell focus back for the UI page (the counterpart lives in ChromiumWebView: a tap
     * inside the page gives focus back to the page). */
    function focusUiPage() {
        var pc = rootPageContents();
        try { if (pc && pc.setFocus) { pc.setFocus(); } } catch (e) {}
    }
    document.addEventListener("focusin", function (ev) {
        if (isEditable(ev.target)) {
            lastEditable = ev.target;
            focusUiPage();
        }
    }, true);
    // A click anywhere in the app chrome is also UI interaction, not page interaction.
    document.addEventListener("mousedown", function () { focusUiPage(); }, true);
    // And start with the UI holding focus, so the very first keystroke goes to the address bar rather
    // than into whatever page the launch target loaded.
    setTimeout(focusUiPage, 1200);

    function guessedLocale() {
        return (navigator.language || "en-US").replace(/-/g, "_").toLowerCase();
    }

    /* The system's language and regions from systemservice's preferences, as WAM gives them to a web
     * app: locale "en_us" (the language, and the country it is spoken in), localeRegion "nl" (the
     * region the formats follow - dates, numbers, and the paper a document is printed on) and
     * phoneRegion. The two regions need not be the language's country: English with Dutch formats
     * prints on A4. null when the reply has no language. */
    function systemLocale(inPrefs) {
        var l = inPrefs && inPrefs.locale, r = inPrefs && inPrefs.region;
        var lang = l && typeof l.languageCode === "string" ? l.languageCode.toLowerCase() : "";
        if (!lang) { return null; }
        var country = typeof l.countryCode === "string" ? l.countryCode.toLowerCase() : "";
        var region = r && typeof r.countryCode === "string" && r.countryCode ? r.countryCode.toLowerCase() : country;
        var phone = l.phoneRegion && typeof l.phoneRegion.countryCode === "string" && l.phoneRegion.countryCode ?
            l.phoneRegion.countryCode.toLowerCase() : region;
        return { locale: country ? lang + "_" + country : lang, localeRegion: region, phoneRegion: phone };
    }

    /* Puts the system's locale in place, and into Enyo's g11n if it has already read the guess (it
     * reads PalmSystem once, when first asked). Follows changes made in Settings. */
    var localeBridge = null;
    function followSystemLocale() {
        if (!window.PalmServiceBridge) { return; }
        localeBridge = new window.PalmServiceBridge();
        localeBridge.onservicecallback = function (inReply) {
            var loc = null;
            try { loc = systemLocale(JSON.parse(inReply)); } catch (e) {}
            if (!loc) { return; }
            if (loc.locale === PalmSystem.locale && loc.localeRegion === PalmSystem.localeRegion &&
                    loc.phoneRegion === PalmSystem.phoneRegion) { return; }
            PalmSystem.locale = loc.locale;
            PalmSystem.localeRegion = loc.localeRegion;
            PalmSystem.phoneRegion = loc.phoneRegion;
            var g = window.enyo && window.enyo.g11n;
            if (g && g._initialized && typeof g.setLocale === "function") {
                var lang = loc.locale.split("_")[0];
                try {
                    g.setLocale({ uiLocale: loc.locale, formatLocale: lang + "_" + loc.localeRegion,
                                  phoneLocale: lang + "_" + loc.phoneRegion });
                } catch (e2) {}
            }
        };
        try {
            localeBridge.call("luna://com.webos.service.systemservice/getPreferences",
                JSON.stringify({ keys: ["locale", "region"], subscribe: true }));
        } catch (e3) {}
    }

    var PalmSystem = {
        // --- identity / launch -------------------------------------------------------------------
        identifier: launchArgs.appId || launchArgs.nid || "org.webosports.app.atlas",
        getIdentifier: function () { return PalmSystem.identifier; },
        launchParams: JSON.stringify(launchArgs.params || launchArgs || {}),
        deviceInfo: deviceInfo(),
        version: "chromium-shell",

        // --- window lifecycle --------------------------------------------------------------------
        // The shell owns the window and shows it itself, so stageReady has nothing to do. activate()
        // is the one that matters: Enyo calls it to pull the app forward and restore focus.
        stageReady: noop,
        isActivated: true,
        activate: function () {
            var w = shellWindow();
            try { if (w && w.setVisible) { w.setVisible(true); } } catch (e) {}
            var pc = rootPageContents();
            try { if (pc && pc.setFocus) { pc.setFocus(); } } catch (e2) {}
            PalmSystem.isActivated = true;
        },
        deactivate: function () { PalmSystem.isActivated = false; },
        // A browsershell app is already fullscreen and has no alpha hole; keep the state so callers
        // that read it back stay consistent.
        enableFullScreenMode: function (on) { PalmSystem.__fullScreen = !!on; },
        hasAlphaHole: false,
        setWindowProperties: noop,
        setWindowOrientation: noop,
        screenOrientation: "free",
        allowResizeOnPositiveSpaceChange: noop,

        // --- clipboard ---------------------------------------------------------------------------
        paste: paste,

        // --- notifications -----------------------------------------------------------------------
        addBannerMessage: function (message) { return banner(message); },
        removeBannerMessage: noop,
        addNewContentIndicator: function () { return ++bannerId; },
        removeNewContentIndicator: noop,

        // --- input / IME -------------------------------------------------------------------------
        /* There is no API to raise Maliit: Chromium's IME follows FOCUS, so the keyboard appears when
         * an editable element is focused and goes away when it is blurred. Atlas's keyboard button
         * routes through enyo.keyboard -> these two, so map them onto focus and blur — showing the
         * keyboard puts the caret back in the field the user was last typing in. */
        keyboardShow: function () {
            var el = document.activeElement;
            if (el && isEditable(el)) {
                try { el.blur(); el.focus(); } catch (e) {}     // nudge the IME for an already-focused field
                return;
            }
            var last = lastEditable;
            if (!last || !document.body || !document.body.contains(last)) {
                // Nothing focused yet this session (the user pressed the keyboard button first):
                // fall back to the first visible editable field, which is the address bar.
                last = firstVisibleEditable();
            }
            if (last) { try { last.focus(); } catch (e2) {} }
            focusUiPage();
        },
        keyboardHide: function () {
            var el = document.activeElement;
            try { if (el && el.blur) { el.blur(); } } catch (e) {}
        },
        setManualKeyboardEnabled: noop,
        editorFocused: noop,
        useSimulatedMouseClicks: noop,
        simulateMouseClick: noop,

        // --- locale / misc -----------------------------------------------------------------------
        // In WAM's form ("en_us", "nl"). Only a first guess from the engine's language: the system's
        // own are asked for below (systemLocale).
        locale: guessedLocale(),
        localeRegion: guessedLocale().split("_")[1] || "us",
        phoneRegion: guessedLocale().split("_")[1] || "us",
        timeFormat: "HH12",
        TZ: (function () {
            try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
        })(),
        runTextIndexer: noop,
        getResource: getResource
    };

    /* Relaunch. On webOS, LunaSysMgr calls Mojo.relaunch(), which makes enyo re-read
     * PalmSystem.launchParams, push them onto the root window and dispatch applicationRelaunch.
     * browser_shell instead fires a DOM "webOSRelaunch" event carrying the new launch args (this is
     * what enactbrowser listens for). Translate one into the other so Atlas's own relaunch handler
     * runs with the new params, exactly as it does on a device. */
    document.addEventListener("webOSRelaunch", function (ev) {
        var detail = (ev && ev.detail) || {};
        PalmSystem.launchParams = JSON.stringify(detail);
        try { if (window.shell) { window.shell.launchArgs = detail; } } catch (e) {}
        try {
            if (window.Mojo && window.Mojo.relaunch) { window.Mojo.relaunch(); }
            else if (window.enyo && enyo.windows && enyo.windows.events) { enyo.windows.events.handleRelaunch(); }
        } catch (e2) {
            try { console.log("[Atlas] relaunch dispatch failed: " + e2); } catch (e3) {}
        }
    }, false);

    window.PalmSystem = PalmSystem;
    followSystemLocale();
    // WAM injects both names and some framework/app code reads the modern one; keep them the same
    // object so a write through either is visible to the other.
    if (!window.webOSSystem) { window.webOSSystem = PalmSystem; }

    try { console.log("[Atlas] PalmSystem shim installed for browser_shell (appId " + PalmSystem.identifier + ")"); } catch (e) {}
})();
