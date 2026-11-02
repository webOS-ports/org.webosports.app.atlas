/* A page playing video, on the Chromium host: what the videoplayer app does for its own player.
 *
 *  - The screen stays on while the active tab's video plays and the card is in front, and only then.
 *    Without it the display timeout turns the screen off under a film, sound still going.
 *  - A fullscreen video covers the whole screen, status bar and gesture area too, through the card
 *    shell's "LuneOS_fullscreen" window property (see ChromiumWebView.setPageFullscreen).
 *  - The screen lock, as in Netflix's app: the lock at the top right turns every tap off, for a phone
 *    held in a hand or passed around. A tap then only shows "Screen locked"; tapping that asks
 *    "Unlock controls?", and a second tap unlocks.
 *
 * A page view is a native view above the UI page, so nothing in Atlas's DOM can be drawn over a page
 * or catch a tap on it. The lock is therefore a page view of its own, screen-lock.html, on top of the
 * tab: small while it is only the button, the size of the window while it holds the taps. Nothing is
 * injected in the site, which could undo it. Inert on the WPE host. */
if (window.__atlasChromium) {

window.AtlasPlayback = (function () {
    var APP_ID = "org.webosports.app.atlas";
    var HOLD_URI = "luna://com.palm.display/control/setProperty";
    var FOREGROUND_URI = "luna://com.webos.service.applicationManager/getForegroundAppInfo";
    var CHANNEL = "atlas_screen_lock";
    var BUTTON_SIZE = 64;
    // The button sits 8 inside its view, so 36 from the top and from the right edge alike;
    // body.locked #button in screen-lock.html stays in step.
    var BUTTON_INSET = 28;
    // A video stopping for a moment (the next episode, a seek) must not take the lock away.
    var UNLOCK_DELAY_MS = 3000;

    var inFront = true;
    var foregroundWatch = null;
    var hold = null;            // the bridge whose subscription keeps the screen on
    var lockView = null;
    var lockContents = null;
    var lockReady = false;
    var lockIpc = null;
    var locked = false;
    var unlockTimer = null;

    function activeWebView() {
        var app = window.__atlasApp;
        var view = app && app.atlasActiveView && app.atlasActiveView();
        return (view && view.$) ? view.$.view : null;
    }

    /* Not document.hidden: a fullscreen page view covers the UI page, and Chromium then calls this page
     * hidden with the card in front. */
    function watchForeground() {
        foregroundWatch = new window.PalmServiceBridge();
        foregroundWatch.onservicecallback = function (message) {
            var reply;
            try { reply = JSON.parse(message); } catch (e) { return; }
            if (reply && typeof reply.appId === "string") {
                inFront = reply.appId === APP_ID;
                update();
            }
        };
        foregroundWatch.call(FOREGROUND_URI, JSON.stringify({ subscribe: true }));
    }

    function updateHold(wanted) {
        if (wanted && !hold) {
            hold = new window.PalmServiceBridge();
            hold.onservicecallback = function () {};
            // The display manager keeps the block for as long as this subscription lives.
            hold.call(HOLD_URI, JSON.stringify({ requestBlock: true, client: APP_ID, subscribe: true }));
        } else if (!wanted && hold) {
            try { hold.cancel(); } catch (e) {}
            hold = null;
        }
    }

    function lockCall(js) {
        if (lockReady) {
            try { lockContents.executeJavaScriptInMainFrame(js); } catch (e) {}
        }
    }

    function placeLock() {
        if (!lockView) { return; }
        var w = window.innerWidth || 0, h = window.innerHeight || 0;
        try {
            if (locked) { lockView.setBounds(0, 0, w, h); }
            else { lockView.setBounds(w - BUTTON_SIZE - BUTTON_INSET, BUTTON_INSET, BUTTON_SIZE, BUTTON_SIZE); }
        } catch (e) {}
    }

    function setLocked(on) {
        if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = null; }
        locked = !!on;
        placeLock();
        lockCall("setLocked(" + locked + ")");
    }

    function createLock() {
        var shellWin = window.shell && window.shell.shellWindow;
        if (lockView || !shellWin || typeof window.PageView !== "function") { return; }
        lockView = new window.PageView({ "page-contents-params": {
            partition: "atlas-screen-lock", api: ["v8/browser_shell_ipc"] } });
        lockContents = lockView.pageContents;
        shellWin.pageView.addChildView(lockView);
        lockContents.setPageBaseBackgroundColor("#00000000");
        lockIpc = new window.ShellIpc(CHANNEL);
        lockIpc.on("lock", function () { setLocked(true); });
        lockIpc.on("unlock", function () { setLocked(false); });
        lockContents.on("dom-ready", function () {
            lockReady = true;
            lockCall("setLocked(" + locked + ")");
        });
        lockContents.loadURL(window.location.href.replace(/[^\/]*$/, "") + "source/engine/screen-lock.html");
    }

    function showLock(on) {
        if (on) { createLock(); }
        if (!lockView) { return; }
        var shellWin = window.shell && window.shell.shellWindow;
        try {
            lockView.setVisible(on);
            if (on) {
                placeLock();
                if (shellWin) { shellWin.pageView.bringToFront(lockView); }
            }
        } catch (e) {}
    }

    /* Everything follows from the same few facts, so everything is worked out again whenever one of
     * them changes: a video starting or stopping, fullscreen, a tab or the card coming or going. */
    function update() {
        var view = activeWebView();
        var playing = !!(view && view._videoPlaying);
        var fullscreen = !!(view && view._fullscreen);
        updateHold(playing && inFront);
        if (!fullscreen || !inFront) {
            setLocked(false);
        } else if (locked && !playing && !unlockTimer) {
            unlockTimer = setTimeout(function () { unlockTimer = null; setLocked(false); showLock(false); },
                                     UNLOCK_DELAY_MS);
        } else if (playing && unlockTimer) {
            clearTimeout(unlockTimer);
            unlockTimer = null;
        }
        showLock(fullscreen && inFront && (playing || locked));
    }

    window.addEventListener("resize", placeLock, false);
    watchForeground();

    return { update: update };
})();

}
