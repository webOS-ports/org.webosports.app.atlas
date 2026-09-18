/* Phone layout, as patches on the shared kinds.
 *
 * Atlas has ONE UI tree, written for the TouchPad. Rather than fork it, the phone layout is applied
 * here as prototype patches, with this whole file behind a single guard — exactly the idiom
 * source/engine/TabLayer.js uses for the browser_shell host (`if (window.__atlasChromium)`).
 *
 * The guard is the point: on a tablet the body below never executes, so Browser, StartPage and
 * BrowserApp are provably the kinds they always were. A supported target (the TouchPad) does not have
 * to be re-tested against every phone change, and there is one obvious place to look for anything the
 * phone does differently.
 *
 * Load LAST in depends.js, after every kind it patches (notably source/engine/TabLayer.js).
 *
 * See source/engine/AtlasFormFactor.js for how phone-ness is decided, and css/phone.css for the
 * matching rules (all scoped to the atlas-phone class on <html>). */
if (window.__atlasPhone) {
(function () {
    var appProto = enyo.BrowserApp.prototype;
    var browserProto = window.Browser && Browser.prototype;

    // ---------------------------------------------------------------------------------------------
    // (b) the bottom bar, at app level
    // ---------------------------------------------------------------------------------------------
    /* App level rather than inside Browser, for three reasons: the tab count has exactly one owner,
     * the bar has to survive Pane switches (start page, reader, preferences), and BrowserApp already
     * reaches the active view through this.$.browser, which TabLayer keeps pointed at the right tab. */
    appProto.kindComponents.push({
        name: "phoneBottomBar", kind: "PhoneBottomBar",
        onBack: "phoneBack", onForward: "phoneForward",
        onTabs: "phoneShowTabs", onMenu: "phoneShowMenu"
    });

    /* The AppMenu is declared without a name (BrowserApp.js), so give it one: the phone's menu button
     * has to open it explicitly, where on the tablet the system gesture does. */
    for (var i = 0; i < appProto.kindComponents.length; i++) {
        if (appProto.kindComponents[i].kind === "AppMenu" && !appProto.kindComponents[i].name) {
            appProto.kindComponents[i].name = "appMenu";
            break;
        }
    }

    // ---------------------------------------------------------------------------------------------
    // (f) app wiring
    // ---------------------------------------------------------------------------------------------
    /* TabLayer sets __atlasApp only on the chromium host; the bottom bar needs it on both. Setting it
     * twice is harmless — it is the same object. */
    var origCreate = appProto.create;
    appProto.create = function () {
        origCreate.apply(this, arguments);
        window.__atlasApp = this;
    };

    var origRendered = appProto.rendered;
    appProto.rendered = function () {
        origRendered.apply(this, arguments);
        // The bar has just taken 48px off the bottom of the layout, and on the chromium host the
        // native page view is positioned from the placeholder's rect — so it has to be re-measured or
        // the page keeps the height it had without the bar and runs under it.
        if (this.atlasResyncBounds) { this.atlasResyncBounds(); }
        this.phoneSyncBottomBar();
    };

    appProto.phoneSyncBottomBar = function () {
        var bar = this.$ && this.$.phoneBottomBar;
        if (!bar) { return; }
        var view = this.atlasActiveView ? this.atlasActiveView() : (this.$ && this.$.browser);
        if (view && view.canGoBack !== undefined) { bar.setCanGoBack(!!view.canGoBack); }
        if (this.atlasTabs) { bar.setTabCount(this.atlasTabs.length); }
    };

    appProto.phoneBack = function () {
        var view = this.atlasActiveView ? this.atlasActiveView() : this.$.browser;
        if (view && view.goBack) { view.goBack(); }
        return true;
    };

    appProto.phoneForward = function () {
        var view = this.atlasActiveView ? this.atlasActiveView() : this.$.browser;
        if (view && view.goForward) { view.goForward(); }
        return true;
    };

    /* Stage 5 replaces this with the full-screen switcher; until then the button does the thing a
     * phone user needs most from it, which is to get a new tab (or card, off-shell). */
    appProto.phoneShowTabs = function () {
        if (this.atlasNewTab) { this.atlasNewTab(); }
        else { this.newCardClick(); }
        return true;
    };

    appProto.phoneShowMenu = function () {
        var menu = this.$ && this.$.appMenu;
        if (!menu) { return true; }
        /* open() is all that is needed, and calling toggleAppMenuItems() by hand first is actively
         * wrong: the menu's items are lazy, and BasicPopup.prepareOpen creates them
         * (validateComponents) BEFORE it fires onBeforeOpen — so open() runs toggleAppMenuItems at
         * the one moment $.printMenuItem & co. exist. Called any earlier it throws on undefined, and
         * because it is also what arms _menuArmed, a throw there would leave half the menu dead. */
        menu.open();
        return true;
    };

    // ---------------------------------------------------------------------------------------------
    // (f) back/forward state, from the page into the bar
    // ---------------------------------------------------------------------------------------------
    if (browserProto && browserProto.gotHistoryState) {
        var origHistoryState = browserProto.gotHistoryState;
        browserProto.gotHistoryState = function (inBack, inForward) {
            origHistoryState.apply(this, arguments);
            var app = window.__atlasApp;
            var bar = app && app.$ && app.$.phoneBottomBar;
            // Only the view the user is looking at may drive the bar; a background tab reporting its
            // own history must not.
            if (!bar) { return; }
            var active = app.atlasActiveView ? app.atlasActiveView() : (app.$ && app.$.browser);
            if (active && active !== this) { return; }
            bar.setCanGoBack(!!inBack);
            bar.setCanGoForward(!!inForward);
        };
    }

    // ---------------------------------------------------------------------------------------------
    // tab count / strip, chromium host only
    // ---------------------------------------------------------------------------------------------
    if (window.__atlasChromium && appProto.atlasUpdateStrip) {
        var origUpdateStrip = appProto.atlasUpdateStrip;
        appProto.atlasUpdateStrip = function () {
            origUpdateStrip.apply(this, arguments);
            // The 34px strip is the tablet's tab affordance; on a phone the count in the bottom bar
            // is, so take the height back.
            if (this.$ && this.$.tabStrip && this.$.tabStrip.showing) {
                this.$.tabStrip.setShowing(false);
                if (this.atlasResyncBounds) { this.atlasResyncBounds(); }
            }
            this.phoneSyncBottomBar();
        };
    }

    /* Switching tabs re-points $.browser, so the bar has to follow. */
    if (appProto.atlasSelectIndex) {
        var origSelectIndex = appProto.atlasSelectIndex;
        appProto.atlasSelectIndex = function () {
            origSelectIndex.apply(this, arguments);
            this.phoneSyncBottomBar();
        };
    }

    try { console.log("[Atlas] phone layout applied"); } catch (e) {}
})();
}
