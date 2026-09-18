/* In-app tabs for the Chromium host.
 *
 * On webOS a "card" is a whole extra window running index.html again, and the OS card switcher does the
 * rest — Atlas never needed tab UI. browser_shell gives an app exactly ONE window (shell.createWindow
 * is native, takes nothing and returns nothing usable), so every card has to become a tab inside the
 * single BrowserApp.
 *
 * The trick that keeps this small: BrowserApp already holds an enyo.Pane of views, one of which is the
 * Browser. A tab is just another Browser view in that pane, and `this.$.browser` is re-pointed at the
 * selected one — so the ~40 places that say this.$.browser keep working, unchanged, and always talk to
 * the active tab. New tabs are cloned from the kind's own "browser" config, so their event wiring can
 * never drift from the original.
 *
 * Loaded after BrowserApp.js (see depends.js) and inert on the WPE host, where real cards still win. */
if (window.__atlasChromium) {

// -------------------------------------------------------------------------------------------------
// The strip itself
// -------------------------------------------------------------------------------------------------
enyo.kind({
    name: "AtlasTabStrip",
    kind: enyo.Control,
    className: "atlas-tabstrip",
    published: { tabs: [], activeIndex: 0 },
    events: { onSelectTab: "", onCloseTab: "", onNewTab: "" },
    components: [
        { name: "row", className: "atlas-tabstrip-row" }
    ],
    tabsChanged: function () { this.renderTabs(); },
    activeIndexChanged: function () { this.renderTabs(); },
    renderTabs: function () {
        this.$.row.destroyControls();
        var tabs = this.tabs || [];
        for (var i = 0; i < tabs.length; i++) {
            var t = tabs[i];
            var item = this.$.row.createComponent({
                kind: enyo.Control,
                className: "atlas-tab" + (i === this.activeIndex ? " atlas-tab-active" : ""),
                _index: i,
                onclick: "tabClick",
                owner: this
            });
            item.createComponent({
                kind: enyo.Control,
                className: "atlas-tab-title",
                content: this.labelFor(t),
                allowHtml: false,
                _index: i,
                owner: this
            });
            item.createComponent({
                kind: enyo.Control,
                className: "atlas-tab-close",
                content: "×",
                _index: i,
                onclick: "closeClick",
                owner: this
            });
        }
        this.$.row.createComponent({
            kind: enyo.Control,
            className: "atlas-tab-new",
            content: "+",
            onclick: "newClick",
            owner: this
        });
        this.$.row.render();
    },
    labelFor: function (t) {
        var s = (t && (t.title || t.url)) || $L("New Tab");
        s = String(s).replace(/^https?:\/\//, "");
        return (s.length > 22) ? (s.substring(0, 21) + "…") : s;
    },
    tabClick: function (inSender) {
        this.doSelectTab(inSender._index);
        return true;
    },
    closeClick: function (inSender, inEvent) {
        this.doCloseTab(inSender._index);
        return true;                       // don't let the click fall through to tabClick
    },
    newClick: function () {
        this.doNewTab();
        return true;
    }
});

// -------------------------------------------------------------------------------------------------
// BrowserApp: tab management
// -------------------------------------------------------------------------------------------------
(function () {
    var proto = enyo.BrowserApp.prototype;

    // The strip is the app's first child so it sits above everything the Pane shows. Hidden until a
    // second tab exists — a single-tab session should look exactly like it does on webOS.
    proto.kindComponents.unshift({
        name: "tabStrip", kind: "AtlasTabStrip", showing: false,
        onSelectTab: "atlasSelectTab", onCloseTab: "atlasCloseTab", onNewTab: "atlasNewTab"
    });

    var origCreate = proto.create;
    proto.create = function () {
        this.atlasTabs = [];
        origCreate.apply(this, arguments);
        // The pane's views are LAZY — $.browser does not exist yet at create time — so a tab is tracked
        // by component NAME and the view is resolved on demand.
        this.atlasTabs = [{ name: "browser", title: "", url: "" }];
        this.atlasActive = 0;
        window.__atlasApp = this;
        // AtlasEngineOverride routes atlasOpenCard here on this host.
        var self = this;
        window.__atlasOpenTab = function (params) { self.atlasOpenTab(params || {}); };
        this.atlasPatchPane();
        this.atlasUpdateStrip();
    };

    /* Resolve a tab's view, caching the instance the first time. Name lookup alone is not enough: tab 0
     * is called "browser" and selecting another tab re-points this.$.browser at it, so a later lookup
     * by name would hand back the wrong view (both tabs then show the same title). */
    /* Atlas identifies the browser view BY NAME ("browser"): isBrowserShowing compares the pane's
     * current view name, and gotoView/selectViewByName("browser") switches to it. A tab is a different
     * component with a different name, so on any tab but the first, entering a URL looked dead — the
     * app decided the browser was not showing, switched the pane to tab 0, and loaded the URL into the
     * active tab that was no longer on screen. Teach both about tabs. */
    var TAB_PREFIX = "browserTab";
    proto.isBrowserShowing = function () {
        var n = this.$.pane.getViewName();
        return n === "browser" || String(n).indexOf(TAB_PREFIX) === 0;
    };
    proto.atlasPatchPane = function () {
        var pane = this.$.pane, self = this;
        if (!pane || pane._atlasPatched) { return; }
        pane._atlasPatched = true;
        var orig = pane.selectViewByName;
        pane.selectViewByName = function (inName, inSync) {
            if (inName === "browser") {
                var tab = (self.atlasTabs || [])[self.atlasActive || 0];
                if (tab && tab.name) { inName = tab.name; }      // "the browser" means the ACTIVE tab
            }
            return orig.call(this, inName, inSync);
        };
    };

    proto.atlasView = function (tab) {
        if (!tab) { return null; }
        if (tab.view) { return tab.view; }
        if (!tab.name) { return null; }
        /* The name "browser" identifies this tab ONLY while it is the active one. atlasSelectIndex
         * re-points this.$.browser at whichever tab is active, so resolving tab 0 by name at any other
         * time hands back a different tab's view — and the line below would then cache that wrong view
         * on tab 0 for good. It is easy to hit: the app opens on the start page, so tab 0's view is
         * still lazy when a second tab is created, and tab 0 ends up permanently bound to it. That
         * showed up as the tab list wearing the wrong favicons, one row off. */
        if (tab.name === "browser" &&
            (this.atlasTabs || [])[this.atlasActive || 0] !== tab) { return null; }
        var v = this.$[tab.name];
        if (v) { tab.view = v; }
        return v;
    };
    proto.atlasActiveView = function () {
        return this.atlasView((this.atlasTabs || [])[this.atlasActive || 0]);
    };

    /* Every tab is a clone of the kind's own browser view config, so handlers stay identical. */
    proto.atlasBrowserConfig = function () {
        if (this._atlasBrowserCfg) { return this._atlasBrowserCfg; }
        var found = null;
        (function walk(list) {
            for (var i = 0; list && i < list.length; i++) {
                var c = list[i];
                if (!c || found) { return; }
                if (c.name === "browser" && c.kind === "Browser") { found = c; return; }
                walk(c.components);
                walk(c.lazyViews);
            }
        })(proto.kindComponents);
        this._atlasBrowserCfg = found;
        return found;
    };

    proto.atlasOpenTab = function (params) {
        var cfg = this.atlasBrowserConfig();
        if (!cfg || !this.$.pane) {
            this.log("[Atlas] tab layer: no browser config / pane — cannot open tab");
            return null;
        }
        var name = "browserTab" + (new Date()).getTime();
        var c = enyo.mixin(enyo.clone(cfg), { name: name });
        var view = this.$.pane.createComponent(c, { owner: this });
        // enyo does not render a component created after its container is already rendered — without
        // this the view has no node, so its WebView never builds a page view and the tab comes up blank.
        view.render();
        var tab = { name: name, title: "", url: "" };
        this.atlasTabs.push(tab);

        // Private cards carry a "private"-prefixed webviewId; the engine turns that into its own
        // partition, so the tab must inherit it before anything loads.
        if (params.webviewId && view.$ && view.$.view && view.$.view.setIdentifier) {
            view.$.view.setIdentifier(params.webviewId);
        }
        this.atlasSelectIndex(this.atlasTabs.length - 1);

        var url = params.target || params.url;
        if (url && !this.isAtlasHome(url)) { view.setUrl(url); }
        this.atlasUpdateStrip();
        return tab;
    };

    proto.atlasSelectIndex = function (index) {
        var tabs = this.atlasTabs || [];
        if (index < 0 || index >= tabs.length) { return; }
        // Set the active index FIRST: the pane patch below resolves the name "browser" to the active
        // tab, and tab 0 is literally called "browser". Selecting it while the old index was still in
        // place bounced the pane back to the previous tab while $.browser moved to this one — the URL
        // then loaded into a tab that was not on screen.
        this.atlasActive = index;
        // Prefer the instance (immune to the name mapping); fall back to the name for a lazy view.
        var existing = this.atlasView(tabs[index]);
        if (existing) { this.$.pane.selectView(existing); }
        else { this.$.pane.selectViewByName(tabs[index].name); }
        for (var i = 0; i < tabs.length; i++) {
            this.atlasSetTabActive(tabs[i], i === index);
        }
        // Re-point the single-browser reference the rest of the app uses.
        var view = this.atlasView(tabs[index]);
        if (view) { this.$.browser = view; }
        this.atlasUpdateStrip();
    };

    /* Background tabs give their memory back: the page view is hidden and its DOM and media are
     * suspended. On a phone-class device this is the difference between a few tabs and an OOM. */
    proto.atlasSetTabActive = function (tab, active) {
        var view = this.atlasView(tab);
        var wv = view && view.$ && view.$.view;
        if (wv && wv.setEngineActive) { wv.setEngineActive(active); }
    };

    /* The native page view is positioned from its placeholder's rect, so any layout change the strip
     * causes (showing or hiding it moves everything below by its height) leaves those bounds stale and
     * the page ends up over the ActionBar. Re-push them once the new layout has actually been applied. */
    proto.atlasResyncBounds = function () {
        var self = this;
        enyo.asyncMethod(this, function () {
            var view = self.atlasActiveView();
            var wv = view && view.$ && view.$.view;
            if (wv && wv.setEngineActive) { wv.setEngineActive(true); }
        });
    };

    proto.atlasSelectTab = function (inSender, inIndex) {
        this.atlasSelectIndex(inIndex);
        return true;
    };

    proto.atlasCloseTab = function (inSender, inIndex) {
        var tabs = this.atlasTabs || [];
        if (inIndex < 0 || inIndex >= tabs.length) { return true; }
        var tab = tabs[inIndex];
        tabs.splice(inIndex, 1);
        try { tab.view.destroy(); } catch (e) {}          // WebView.destroy tears the page view down
        if (!tabs.length) {
            // Last tab closed: keep the app alive on the start page, the way closing the last card
            // would have left you at the launcher.
            this.atlasOpenTab({});
            return true;
        }
        this.atlasSelectIndex(Math.min(inIndex, tabs.length - 1));
        return true;
    };

    proto.atlasNewTab = function () {
        this.atlasOpenTab({});
        return true;
    };

    proto.atlasUpdateStrip = function () {
        if (!this.$ || !this.$.tabStrip) { return; }
        var tabs = this.atlasTabs || [];
        var items = [];
        for (var i = 0; i < tabs.length; i++) {
            var v = this.atlasView(tabs[i]);
            if (v) {                                   // remember the last known label for a lazy view
                tabs[i].title = v.title || tabs[i].title;
                tabs[i].url = v.url || tabs[i].url;
            }
            items.push({ title: tabs[i].title, url: tabs[i].url });
        }
        var wasShowing = this.$.tabStrip.showing;
        this.$.tabStrip.setTabs(items);
        this.$.tabStrip.setActiveIndex(this.atlasActive || 0);
        this.$.tabStrip.setShowing(tabs.length > 1);
        if (this.$.tabStrip.showing !== wasShowing) { this.atlasResyncBounds(); }
    };

    /* Relaunch with a URL. On webOS the handler reuses or opens a CARD; here the equivalent is a tab.
     * A blank tab is reused rather than piling up empties (the launcher tap that just brings the app
     * forward carries no URL and falls through to Atlas's own handler untouched). */
    var origRelaunch = proto.applicationRelaunchHandler;
    proto.applicationRelaunchHandler = function () {
        var params = enyo.windowParams || {};
        var url = params.target || params.url;
        if (url && !this.isAtlasHome(url)) {
            var wvId = params.webviewId;
            // atlas-private: is the WPE private-card marker; on this host it maps to a private tab,
            // which the adapter turns into a throwaway partition.
            if (!wvId && String(url).indexOf("atlas-private:") === 0) {
                wvId = "private-" + (new Date()).getTime();
            }
            var active = this.atlasActiveView();
            if (active && !active.url && !wvId) {
                active.setUrl(url);                       // empty tab: navigate it instead
            } else {
                this.atlasOpenTab({ target: url, webviewId: wvId });
            }
            return true;
        }
        return origRelaunch ? origRelaunch.apply(this, arguments) : true;
    };

    // Keep the strip's labels in step with whatever the active tab is showing.
    var origTitle = proto.pageTitleChanged;
    proto.pageTitleChanged = function () {
        var r = origTitle && origTitle.apply(this, arguments);
        this.atlasUpdateStrip();
        return r;
    };
})();

}
