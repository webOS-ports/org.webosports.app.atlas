/* enyo.WebView reimplemented on the LuneOS browser_shell PageView — the Chromium half of the engine seam.
 *
 * On the WPE host, enyo.WebView is an NPAPI plugin instance living in the DOM: the engine paints into
 * the plugin's rectangle and the framework talks to it through synchronous plugin calls. browser_shell
 * has nothing like that. Its page views are NATIVE views owned by the shell, composited BEHIND the UI
 * page and positioned in window coordinates — they are not DOM nodes and cannot be laid out by CSS.
 *
 * So this kind renders an ordinary empty div as a PLACEHOLDER and keeps the native view glued to that
 * div's rectangle (see syncBounds). Everything else is translation: Atlas's WebView API and events on
 * one side, pageContents on the other. Atlas is unchanged — it still says {kind: "WebView"}.
 *
 * Loaded from depends.js AFTER the framework, so this definition replaces the framework's enyo.WebView;
 * it self-gates and leaves the NPAPI kind alone on the WPE host. */
if (window.__atlasChromium) {

enyo.kind({
    name: "enyo.WebView",
    kind: enyo.Control,
    className: "enyo-webview atlas-chromium-webview",
    published: {
        identifier: "",
        url: "",
        minFontSize: 16,
        enableJavascript: true,
        blockPopups: true,
        acceptCookies: true,
        headerHeight: 0
    },
    // Same event set the NPAPI kind published, so Browser.js binds without changes. Events with no
    // browser_shell equivalent (onFileLoad, onDisconnected, onResized) simply never fire.
    events: {
        onMousehold: "",
        onResized: "",
        onPageTitleChanged: "",
        onUrlRedirected: "",
        onSingleTap: "",
        onLoadStarted: "",
        onLoadProgress: "",
        onLoadStopped: "",
        onLoadComplete: "",
        onFileLoad: "",
        onAlertDialog: "",
        onConfirmDialog: "",
        onPromptDialog: "",
        onSSLConfirmDialog: "",
        onUserPasswordDialog: "",
        onNewPage: "",
        onPrint: "",
        onEditorFocusChanged: "",
        onScrolledTo: "",
        onError: "",
        onDisconnected: ""
    },

    // ---------------------------------------------------------------------------------------------
    // lifecycle
    // ---------------------------------------------------------------------------------------------
    create: function () {
        this.inherited(arguments);
        this.pageView = null;
        this.pageContents = null;
        this.loading = false;
        this.title = "";
        this.canGoBack = false;
        this.canGoForward = false;
        this.pendingDialog = null;      // { ok: fn, cancel: fn } while a page dialog is up
        this.pendingUrl = null;         // setUrl() before the view exists
        this._bounds = "";
    },
    rendered: function () {
        this.inherited(arguments);
        if (!this.pageView) { this.createPageView(); }
        this.scheduleBoundsSync();
    },
    destroy: function () {
        this.teardownPageView();
        this.inherited(arguments);
    },

    createPageView: function () {
        var shellWin = window.shell && window.shell.shellWindow;
        if (!shellWin || typeof window.PageView !== "function") {
            this.error("[Atlas] no browser_shell PageView available");
            return;
        }
        // browser_shell_ipc gives the PAGE a ShellIpc constructor, which is how injected script talks
        // back to us (see installInputBridge).
        var params = { partition: this.getPartition(), api: ["v8/browser_shell_ipc"] };
        this.pageView = new window.PageView({ "page-contents-params": params });
        shellWin.pageView.addChildView(this.pageView);
        this.pageContents = this.pageView.pageContents;
        this.wireEvents();
        this.pageView.setVisible(true);
        this.scheduleBoundsSync();
        if (this.pendingUrl) {
            var u = this.pendingUrl;
            this.pendingUrl = null;
            this.loadUrl(u);
        }
    },
    teardownPageView: function () {
        if (!this.pageView) { return; }
        try { if (this._ipc && this._ipc.removeAllEventListeners) { this._ipc.removeAllEventListeners(); } } catch (e1) {}
        this._ipc = null;
        try {
            var shellWin = window.shell && window.shell.shellWindow;
            if (shellWin) { shellWin.pageView.removeChildView(this.pageView); }
            if (this.pageContents && this.pageContents.closeNow) { this.pageContents.closeNow(); }
        } catch (e) {}
        this.pageView = null;
        this.pageContents = null;
    },

    /* A card tagged private gets its own throwaway partition so its cookies and storage never touch
     * the normal profile — the Chromium equivalent of the WPE atlas-private: marker. */
    getPartition: function () {
        var id = this.identifier || "";
        return (id.indexOf("private") === 0) ? ("atlas-private-" + id) : "persist:atlas";
    },

    // ---------------------------------------------------------------------------------------------
    // geometry: keep the native view exactly over our placeholder div
    // ---------------------------------------------------------------------------------------------
    /* A view that has never been given bounds is drawn by the shell at full window size — which means
     * it covers Atlas's own toolbar. The placeholder usually measures 0x0 for a beat after the view is
     * created or re-shown (enyo lays out on the next frames), so a single sync attempt can silently do
     * nothing and leave the page over the chrome. Retry over a few frames and stop at the first
     * measurement that sticks. */
    scheduleBoundsSync: function () {
        var self = this, delays = [0, 40, 120, 300, 700], i = 0;
        var tick = function () {
            if (self.destroyed || !self.pageView) { return; }
            self.syncBounds();
            // Deliberately run EVERY tick rather than stopping at the first non-zero measurement: the
            // first one lands before sibling chrome (the ActionBar) has laid out, so it measures the
            // full area and the page ends up over the toolbar. Later ticks are no-ops once the rect
            // stops changing.
            if (++i < delays.length) { setTimeout(tick, delays[i]); }
        };
        setTimeout(tick, delays[0]);
    },
    syncBounds: function () {
        if (!this.pageView) { return; }
        /* Fullscreen is decided before the placeholder is measured: the chrome is being hidden around
         * us, so the placeholder's rect is mid-relayout and would fight the window rect we want. */
        if (this._fullscreen) {
            this.pushBounds(0, 0, window.innerWidth || 0, window.innerHeight || 0);
            return;
        }
        if (!this.hasNode()) { return; }
        var r = this.node.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) { return; }
        var left = r.left, top = r.top, right = r.right, bottom = r.bottom;
        // An edge overlay (the bookmarks / history / downloads drawer) does not have to blank the page:
        // give the view the part of the area nobody else is using. See ChromiumOverlay.
        var c = this._clip;
        if (c) {
            left = Math.max(left, c.left);
            top = Math.max(top, c.top);
            right = Math.min(right, c.left + c.width);
            bottom = Math.min(bottom, c.top + c.height);
            if (right - left <= 0 || bottom - top <= 0) { return; }
        }
        this.pushBounds(left, top, right - left, bottom - top);
    },
    pushBounds: function (left, top, width, height) {
        left = Math.round(left); top = Math.round(top);
        width = Math.round(width); height = Math.round(height);
        if (width <= 0 || height <= 0) { return; }
        var key = [left, top, width, height].join(",");
        this._rect = { left: left, top: top };        // for page -> app coords
        if (key === this._bounds) { return; }         // nothing moved — don't churn the compositor
        this._bounds = key;
        try { this.pageView.setBounds(left, top, width, height); } catch (e) {}
    },
    /* Shrink the page to the area an edge overlay leaves free (null = use the whole placeholder). */
    setOverlayClip: function (rect) {
        var a = this._clip, b = rect || null;
        var same = (!a && !b) || (a && b && a.left === b.left && a.top === b.top &&
                                  a.width === b.width && a.height === b.height);
        if (same) { return; }
        this._clip = b;
        this._bounds = "";                // geometry changed under us — force the next push through
        this.scheduleBoundsSync();
    },
    resize: function () {
        this.scheduleBoundsSync();
    },
    resizeHandler: function () {
        this.inherited(arguments);
        this.syncBounds();
    },
    showingChanged: function () {
        this.inherited(arguments);
        if (this.pageView) {
            try { this.pageView.setVisible(!!this.showing); } catch (e) {}
            if (this.showing) { this.scheduleBoundsSync(); }
        }
    },
    /* Yield the screen area to an Atlas popup: the native view is composited above the UI page, so a
     * popup drawn over the page is invisible until the view stops painting there (ChromiumOverlay.js).
     * The page keeps running — only its pixels go away. */
    setOverlayHidden: function (hidden) {
        this._overlayHidden = !!hidden;
        if (!this.pageView) { return; }
        try { this.pageView.setVisible(!hidden && !!this.showing); } catch (e) {}
        if (!hidden) { this.scheduleBoundsSync(); }
    },
    /* Foreground/background a whole tab (see TabLayer.js). Hiding alone would leave the page live and
     * costing memory, so a backgrounded view also suspends its DOM and media. */
    setEngineActive: function (active) {
        var pc = this.pageContents;
        try {
            if (this.pageView) { this.pageView.setVisible(!!active && !this._overlayHidden); }
            if (!pc) { return; }
            if (active) {
                pc.resumeDOM(); pc.resumeMedia(); pc.activate();
                var shellWin = window.shell && window.shell.shellWindow;
                if (shellWin && this.pageView) { shellWin.pageView.bringToFront(this.pageView); }
                this._bounds = "";              // force a re-push; layout may have moved while hidden
                this.scheduleBoundsSync();
                // Deliberately NOT calling pc.setFocus() here: the native view takes keyboard focus away
                // from the UI page, which makes Atlas's address bar impossible to type in. Chromium
                // focuses the page itself when the user taps it.
            } else {
                pc.suspendMedia(); pc.suspendDOM(); pc.deactivate();
            }
        } catch (e) {}
    },

    // ---------------------------------------------------------------------------------------------
    // engine events -> Atlas events
    // ---------------------------------------------------------------------------------------------
    wireEvents: function () {
        var pc = this.pageContents, self = this;
        function on(name, fn) { try { pc.on(name, fn); } catch (e) {} }

        on("dom-ready", function () { self.installInputBridge(); });
        on("did-start-loading", function () {
            self.loading = true;
            /* Deliberately NOT clearing the favicon here. did-start-loading fires for sub-frame loads
             * too - ad and tracker frames keep firing it long after the page itself is up - and each
             * one wiped a perfectly good icon: nu.nl announced its icon three times and the tab still
             * ended with none. The icon is tied to the page it belongs to instead (see onFavicons and
             * getFavicon), which handles the stale case without needing to guess when to clear. */
            self.doLoadStarted();
        });
        /* The event is "load-progress-changed" (browser_shell_page_contents.cc, both the 108 and 120
         * trees). Atlas used to listen for "laod-..." on the belief that the shell misspelled it, so the
         * progress bar never moved. The misspelling is kept as a second registration in case an older
         * webruntime really did emit it — a name nothing emits simply never fires. The payload has
         * varied by release, so accept a bare number, {progress}, or an event-ish object, and normalise
         * to 0-100. */
        var onProgress = function (ev) { self.doLoadProgress(self.readProgress(ev)); };
        on("load-progress-changed", onProgress);
        on("laod-progress-changed", onProgress);
        on("did-stop-loading", function () {
            self.loading = false;
            self.refreshNavState();
            self.doLoadStopped();
        });
        on("did-finish-load", function () {
            self.loading = false;
            self.refreshNavState();
            self.doLoadProgress(100);
            self.doLoadComplete();
            self.pushTitle();
        });
        on("page-title-updated", function (a) {
            self.title = self.readString(a) || self.title;
            self.pushTitle();
        });
        on("did-finish-navigation", function () {
            self.refreshNavState();
            var u = self.currentUrl();
            /* A newly created page view starts at about:blank, and that navigation can complete AFTER
             * our loadURL — clobbering the requested URL in Atlas's address bar and tab label, or even
             * leaving the tab blank if the early load was dropped. Ignore the blank state while a real
             * URL is outstanding, and re-issue the load once in case it never took. */
            if (self.isBlank(u) && !self.isBlank(self.requestedUrl)) {
                /* falls through to the re-issue below */
                if (!self._reissued) {
                    self._reissued = true;
                    var want = self.requestedUrl;
                    setTimeout(function () { if (self.pageContents) { try { self.pageContents.loadURL(want); } catch (e) {} } }, 0);
                }
                return;
            }
            // This view has now committed a real page of its own. Until that happens it is still on
            // the about:blank it was born with, and any icon announced in that window belongs to
            // whatever put it there - see onFavicons.
            if (!self.isBlank(u)) { self._navigated = true; }
            if (u && u !== self.url) {
                // NOT doUrlRedirected: BrowserApp maps that event to openResource, which asks the
                // system to open the URL in the default handler. On WPE it only fires for a scheme the
                // engine cannot load; firing it per navigation makes every page load launch the
                // platform's default browser (enactbrowser) alongside us. Atlas learns the new URL
                // from pageTitleChanged, which carries it.
                if (self.isExternalScheme(u)) { self.doUrlRedirected(u); }
            }
            // NB: the address bar is driven by onPageUrl (main frame only), not from here.
        });
        on("did-fail-load", function (url, isMainFrame, error, errorCode) {
            self.loading = false;
            if (isMainFrame === false) { return; }      // subresource failure is not a page error
            self.doError(errorCode, error, url);
        });
        /* The shell emits newwindow with TWO arguments: a PageContents handle for the popup it has
         * already created, and a windowInfo record. The URL lives on the SECOND one
         * (windowInfo.targetUrl); Atlas used to read targetUrl off the handle, where it does not exist,
         * so every popup and every target=_blank link opened a blank tab.
         *
         * The handle cannot be adopted: PageView always constructs its own pageContents (see
         * BrowserShellPageView::ConstructorCallback) and there is no way to hand it an existing one. So
         * the popup is closed and re-opened as a normal tab on its target URL. A popup that carries no
         * URL — window.open() then document.write() — cannot survive that, and is dropped rather than
         * left as an invisible live page costing memory. */
        on("newwindow", function (handle, info) {
            var target = self.readString(info && info.targetUrl) || "";
            var blocked = !!(info && info.popupBlocked) ||
                          (self.blockPopups && !(info && info.userGesture));
            try { if (handle && handle.closeNow) { handle.closeNow(); } } catch (e) {}
            if (blocked || !target) {
                if (!target) { self.unsupported("newwindow without a target URL"); }
                return;
            }
            self.openInNewTab(target);
        });
        /* target=_blank and window.open handled by the browser side rather than the renderer arrive
         * here instead of through newwindow. */
        on("open-url-from-tab", function (openUrlInfo) {
            var target = self.readString(openUrlInfo && openUrlInfo.targetUrl) || "";
            if (target) { self.openInNewTab(target); }
        });
        /* A hung renderer. This is a TOP-LEVEL event, not a dialog messageType — Atlas used to look for
         * it in the dialog switch, where it could never appear. Atlas has no "page is hung" UI, so just
         * note it; Chromium recovers on its own or the user closes the tab. */
        on("unresponsive", function () { self.log("[Atlas] renderer unresponsive: " + self.url); });
        on("responsive", function () { self.log("[Atlas] renderer responsive again: " + self.url); });
        on("dialog", function (messageType, messageText, controller, defaultPromptText) {
            self.onEngineDialog(messageType, messageText, controller, defaultPromptText);
        });
        on("login", function (e) {
            // HTTP auth: the shell hands back a response(login, password) callback.
            self.pendingDialog = {
                ok: function (user, pass) { try { e.response(user, pass); } catch (err) {} },
                cancel: function () {}
            };
            self.doUserPasswordDialog(self.readString(e && e.url) || self.url);
        });
        on("zoomchange", function () { /* zoomFactor is read back on demand */ });
        on("close", function () { self.doError(0, "closed", self.url); });

        /* A page going fullscreen (a video tapping the fullscreen button) only resizes ITS OWN layout —
         * the native view keeps the rectangle Atlas gave it, so "fullscreen" video stayed letterboxed
         * inside the area between the tab strip and the toolbar. Take over the whole window while it
         * lasts, and put the chrome back afterwards. */
        on("enter-html-fullscreen", function () { self.setPageFullscreen(true); });
        on("leave-html-fullscreen", function () { self.setPageFullscreen(false); });

        /* Favicons. The WPE host cannot fetch these itself — LunaSysMgr's ancient WebKit has no modern
         * TLS — so the backend downloads them into the app bundle and Atlas reads a relative path. Here
         * the UI page IS Chromium, so it can just load the remote URL the page advertises. */
        on("did-update-favicon-url", function (favicons) { self.onFavicons(favicons); });

        /* Only ever fires for getUserMedia, and only on an engine that actually reports it: in the
         * stock LuneOS webruntime PageContents::RequestMediaAccessPermission goes straight to the
         * capture dispatcher and never calls the delegate, so nothing emits this today. Wiring it now
         * costs nothing and makes camera/mic prompts work the moment the engine does — and note the
         * injection auto-DENIES when there is no listener, so having one is strictly better. */
        on("permissionrequest", function (req) { self.onPermissionRequest(req || {}); });

        /* Engine-side find results, on a patched webruntime. The engine reports progressively as it
         * scans, so only the final report carries a trustworthy total. */
        on("found-in-page", function (r) {
            if (!r || !r.finalUpdate) { return; }
            self.reportFindResult({
                count: r.numberOfMatches || 0,
                index: r.activeMatchOrdinal || 0,
                query: self._findQuery || ""
            });
        });
    },

    /* Atlas's chrome is DOM in the UI page; the page is a native view above it. Going fullscreen is
     * therefore not a CSS change but a bounds change, plus hiding the app's own furniture. */
    setPageFullscreen: function (on) {
        this._fullscreen = !!on;
        var app = window.__atlasApp;
        if (app && app.$ && app.$.tabStrip) {
            if (on) { this._stripWasShowing = app.$.tabStrip.showing; }
            try { app.$.tabStrip.setShowing(on ? false : !!this._stripWasShowing); } catch (e) {}
        }
        this._bounds = "";                 // the rect is computed differently now — force a push
        this.scheduleBoundsSync();
    },
    /* Called by Atlas's Back gesture so the page leaves fullscreen instead of navigating away. Returns
     * true when it consumed the gesture. */
    exitFullscreenIfActive: function () {
        if (!this._fullscreen) { return false; }
        try { if (this.pageContents && this.pageContents.exitFullscreen) { this.pageContents.exitFullscreen(); } } catch (e) {}
        this.setPageFullscreen(false);
        return true;
    },

    /* Pick the largest advertised icon and hand it to Atlas as an absolute URL. */
    onFavicons: function (favicons) {
        var list = favicons || [], best = "", bestArea = -1;
        for (var i = 0; i < list.length; i++) {
            var f = list[i];
            if (!f || !f.url) { continue; }
            var area = 0, sizes = f.sizes || [];
            for (var k = 0; k < sizes.length; k++) {
                area = Math.max(area, (sizes[k].width || 0) * (sizes[k].height || 0));
            }
            if (area > bestArea) { bestArea = area; best = f.url; }
        }
        /* Ignore icons announced before this view has committed a page of its own. A brand-new tab is
         * created on about:blank, and an icon arriving in that window is the previous page's, not the
         * one about to load: that is how a fresh nu.nl tab came to store tweakers.net's icon. The
         * engine's own url cannot be used to tell them apart - it reads about:blank for a suspended
         * background tab and sometimes an ad frame's url for a live one - but "has this view ever
         * committed a page" is unambiguous, and a page always commits before it announces an icon. */
        if (!this._navigated) { return; }
        if (best) {
            this.faviconUrl = best;
            /* Remember which page announced it, taken from the ENGINE rather than from Atlas's own
             * this.url. The two differ exactly when it matters: this.url is set optimistically to what
             * was asked for ("nu.nl") the moment a load starts, while a brand-new tab is still sitting
             * on the about:blank it was born with — and an icon announced in that window belongs to
             * whatever that page is, not to the site about to load. Recording it against this.url is
             * how a fresh nu.nl tab ended up storing tweakers.net's icon with forUrl "nu.nl". */
            this.faviconForUrl = this.url || "";
        }
    },

    /* The icon, but only if it belongs to the page this view is showing.
     *
     * Matched by host against Atlas's url, which unlike the engine's survives a background tab being
     * suspended to about:blank and so keeps the icon in the tab list. Host rather than exact url:
     * Atlas's url may be what the user typed against a committed https://www. form, and a site's icon
     * commonly lives elsewhere on the same site. */
    getFavicon: function () {
        if (!this.faviconUrl || !this.faviconForUrl) { return ""; }
        var a = this.hostOfUrl(this.faviconForUrl), b = this.hostOfUrl(this.url);
        if (!a || !b) { return ""; }
        return (a === b) ? this.faviconUrl : "";
    },
    hostOfUrl: function (inUrl) {
        var u = String(inUrl || "").replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
        u = u.split("/")[0].split("?")[0].split("#")[0];
        return u.replace(/^www\./i, "").toLowerCase();
    },

    /* Route a camera/mic request through Atlas's confirm dialog. pendingDialog is a single slot, so a
     * request arriving while a page dialog is up is denied rather than silently stealing its response. */
    onPermissionRequest: function (req) {
        var request = req.request;
        if (!request) { return; }
        var deny = function () { try { request.deny(); } catch (e) {} };
        if (this.pendingDialog) { deny(); return; }
        this.pendingDialog = {
            ok: function () { try { request.allow(); } catch (e) {} },
            cancel: deny
        };
        this.doConfirmDialog(this.permissionPrompt(req.permission));
    },
    permissionPrompt: function (permission) {
        var host = (String(this.url || "").match(/^https?:\/\/([^\/]+)/i) || [])[1] || $L("This site");
        switch (String(permission)) {
        case "media":
        case "videoCapture":  return enyo.macroize($L("Allow {$host} to use your camera?"), {host: host});
        case "audioCapture":  return enyo.macroize($L("Allow {$host} to use your microphone?"), {host: host});
        case "geolocation":   return enyo.macroize($L("Allow {$host} to access your location?"), {host: host});
        case "notifications": return enyo.macroize($L("Allow {$host} to show notifications?"), {host: host});
        default:              return enyo.macroize($L("Allow {$host} to use \"{$what}\"?"), {host: host, what: String(permission || "")});
        }
    },

    onEngineDialog: function (messageType, messageText, controller, defaultPromptText) {
        this.pendingDialog = controller || null;
        var msg = this.readString(messageText) || "";
        /* The only types the shell ever sends are alert/confirm/prompt (app_runtime_js_dialog_manager.cc).
         * HTTP auth is NOT one of them — it arrives as the separate "login" event — and neither is
         * "unresponsive", which is its own top-level event. Both used to have dead cases here. */
        switch (String(messageType)) {
        case "alert":       this.doAlertDialog(msg); break;
        case "confirm":     this.doConfirmDialog(msg); break;
        case "prompt":      this.doPromptDialog(msg, defaultPromptText || ""); break;
        default:            this.doAlertDialog(msg); break;
        }
    },

    /* Open a URL in a new tab. doNewPage cannot carry one: Atlas maps that event to
     * openNewCardWithIdentifier, whose argument is a webview IDENTIFIER, not a URL — passing the URL
     * there gave the new card an identifier-shaped URL and no page to load. atlasOpenCard is the
     * app-wide "open a card" entry point and takes a target; the tab layer turns it into a tab. */
    openInNewTab: function (url) {
        if (window.atlasOpenCard) { window.atlasOpenCard({ target: url }); }
        else { this.doNewPage(url); }
    },

    pushTitle: function () {
        // this.url is the MAIN FRAME location (onPageUrl); pageContents.url follows subframes too and
        // would put tracker iframe URLs in the address bar and the history database.
        var u = this.url || this.currentUrl();
        if (this.isBlank(u) && !this.isBlank(this.requestedUrl)) { return; }   // see did-finish-navigation
        this.doPageTitleChanged(this.title, u, this.canGoBack, this.canGoForward);
    },
    isBlank: function (u) {
        return !u || u === "about:blank";
    },
    refreshNavState: function () {
        if (!this.pageContents) { return; }
        this.canGoBack = !!this.pageContents.canGoBack;
        this.canGoForward = !!this.pageContents.canGoForward;
    },
    currentUrl: function () {
        try { return (this.pageContents && this.pageContents.url) || this.url || ""; } catch (e) { return this.url || ""; }
    },
    // ---------------------------------------------------------------------------------------------
    // input bridge: taps and scrolling inside the page
    // ---------------------------------------------------------------------------------------------
    /* browser_shell reports nothing about what happens INSIDE a page — no tap, no scroll — but Atlas
     * needs both (a tap dismisses the selection UI; the scroll offset positions it). The page is a
     * separate process, so the only channel is script injected into it talking back over ShellIpc on a
     * per-view channel. Re-injected on every dom-ready, since a navigation wipes the page context; the
     * guard flag makes a double injection harmless. */
    ipcChannel: function () {
        if (!this._ipcChannel) {
            this._ipcChannel = "atlas_input_" + (this.id || this.name || "view").replace(/[^A-Za-z0-9_]/g, "_");
        }
        return this._ipcChannel;
    },
    installInputBridge: function () {
        if (!this.pageContents) { return; }
        this.openInputChannel();
        var js = "(function(){" +
            "  if (window.__atlasInputBridge) { return; }" +
            "  if (typeof ShellIpc === 'undefined') { return; }" +
            "  window.__atlasInputBridge = 1;" +
            "  var ipc = new ShellIpc(" + JSON.stringify(this.ipcChannel()) + ");" +
            /* Hit-test for the long-press menu: what Atlas needs to decide between the link, image,
             * edit and page menus. */
            "  var hit = function (el) {" +
            "    var link = null, img = null, n = el;" +
            "    while (n && n !== document) {" +
            "      if (!link && n.tagName === 'A' && n.href) { link = n; }" +
            "      if (!img && n.tagName === 'IMG') { img = n; }" +
            "      n = n.parentNode;" +
            "    }" +
            "    var tag = (el && el.tagName || '').toUpperCase();" +
            "    var editable = !!(el && el.isContentEditable) || tag === 'TEXTAREA' ||" +
            "      (tag === 'INPUT' && /^(text|search|url|email|tel|password|number|)$/i.test(el.type || ''));" +
            "    return {" +
            "      isLink: !!link, linkUrl: link ? link.href : ''," +
            "      linkText: link ? (link.textContent || '').replace(/\\s+/g, ' ').substring(0, 200) : ''," +
            "      isImage: !!img, imageUrl: img ? img.src : ''," +
            "      title: (img && img.title) || (link && link.title) || ''," +
            "      altText: (img && img.alt) || ''," +
            "      editable: editable" +
            "    };" +
            "  };" +
            "  var postUrl = function () { ipc.post('url', { href: location.href, title: document.title }); };" +
            "  postUrl();" +
            "  window.addEventListener('popstate', postUrl, true);" +
            "  window.addEventListener('hashchange', postUrl, true);" +
            "  var postHold = function (x, y, el) {" +
            "    ipc.post('hold', { x: x, y: y, info: hit(el || document.elementFromPoint(x, y)) });" +
            "  };" +
            /* Blink raises contextmenu for a touch long-press as well as a right-click, so it covers
             * both; preventDefault stops Chromium's own menu appearing under Atlas's. */
            "  document.addEventListener('contextmenu', function (e) {" +
            "    e.preventDefault();" +
            "    postHold(e.clientX, e.clientY, e.target);" +
            "  }, true);" +
            /* Fallback for touch builds that never synthesise contextmenu. */
            "  var timer = null, sx = 0, sy = 0;" +
            "  var cancel = function () { if (timer) { clearTimeout(timer); timer = null; } };" +
            "  document.addEventListener('touchstart', function (e) {" +
            "    if (!e.touches || e.touches.length !== 1) { cancel(); return; }" +
            "    var t = e.touches[0]; sx = t.clientX; sy = t.clientY;" +
            "    cancel();" +
            "    timer = setTimeout(function () { timer = null; postHold(sx, sy, null); }, 550);" +
            "  }, true);" +
            "  document.addEventListener('touchmove', function (e) {" +
            "    var t = e.touches && e.touches[0];" +
            "    if (!t || Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) { cancel(); }" +
            "  }, true);" +
            "  document.addEventListener('touchend', cancel, true);" +
            "  document.addEventListener('touchcancel', cancel, true);" +
            "  document.addEventListener('click', function (e) {" +
            "    var n = e.target, link = '', img = '';" +
            "    while (n && n !== document) { if (n.tagName === 'A' && n.href) { link = n.href; break; } n = n.parentNode; }" +
            "    if (e.target && e.target.tagName === 'IMG') { img = e.target.src || ''; }" +
            "    ipc.post('tap', { x: e.clientX, y: e.clientY, link: link, img: img });" +
            "  }, true);" +
            /* Scroll reporting. The listener is on the window in the CAPTURE phase, so it also sees a
             * scroll inside an element — but window.pageYOffset is 0 for those, which is why a page
             * that scrolls an inner div (a mail client, an infinite feed) reported no movement at all.
             * Report the offsets of whatever actually scrolled. */
            "  var pending = false, target = null;" +
            "  var report = function () {" +
            "    pending = false;" +
            "    var t = target;" +
            "    var el = (t && t.nodeType === 1) ? t : null;" +
            "    ipc.post('scroll', el ? { x: el.scrollLeft || 0, y: el.scrollTop || 0, inner: true }" +
            "                          : { x: window.pageXOffset || 0, y: window.pageYOffset || 0 });" +
            "  };" +
            "  window.addEventListener('scroll', function (e) {" +
            "    target = e.target;" +
            "    if (pending) { return; }" +          /* coalesce to one report per frame */
            "    pending = true;" +
            /* Called as a bare reference these lose their receiver; rAF throws "Illegal invocation" if
             * the page is ever in strict mode. Call them on window explicitly. */
            "    if (window.requestAnimationFrame) { window.requestAnimationFrame(report); }" +
            "    else { window.setTimeout(report, 16); }" +
            "  }, true);" +
            this.findEngineScript() +
            "})();";
        this.runScript(js);
    },

    /* Find-in-page, in the page. pageContents has no find API at all, so Atlas used to call bare
     * window.find(): no direction, no wrap, no count, and no way to highlight the other matches.
     *
     * This walks the text nodes and paints matches with the CSS Custom Highlight API — Chromium has had
     * it since 105, and unlike wrapping matches in <mark> elements it does NOT touch the DOM, so it
     * cannot break a page's own scripts or layout. The match count comes back over the same IPC channel
     * the taps and scrolls use. */
    findEngineScript: function () {
        return "" +
            "  var hl = { ranges: [], index: -1, query: '' };" +
            "  var supported = !!(window.CSS && CSS.highlights && window.Highlight);" +
            "  if (supported && !document.getElementById('__atlasFindStyle')) {" +
            "    var st = document.createElement('style');" +
            "    st.id = '__atlasFindStyle';" +
            "    st.textContent = '::highlight(atlas-find){background:#ffe066;color:#000}' +" +
            "                     '::highlight(atlas-find-current){background:#ff9f1a;color:#000}';" +
            "    (document.head || document.documentElement).appendChild(st);" +
            "  }" +
            "  var clear = function () {" +
            "    hl.ranges = []; hl.index = -1; hl.query = '';" +
            "    if (supported) { CSS.highlights['delete']('atlas-find'); CSS.highlights['delete']('atlas-find-current'); }" +
            "  };" +
            /* Collect visible text nodes, skipping the ones whose content is never rendered. */
            "  var collect = function () {" +
            "    var nodes = [], text = '';" +
            "    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {" +
            "      acceptNode: function (n) {" +
            "        if (!n.nodeValue || !n.nodeValue.length) { return NodeFilter.FILTER_REJECT; }" +
            "        var p = n.parentNode, tag = p && p.tagName;" +
            "        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') {" +
            "          return NodeFilter.FILTER_REJECT;" +
            "        }" +
            "        return NodeFilter.FILTER_ACCEPT;" +
            "      }" +
            "    });" +
            "    var n;" +
            "    while ((n = w.nextNode())) { nodes.push({ node: n, start: text.length }); text += n.nodeValue; }" +
            "    return { nodes: nodes, text: text };" +
            "  };" +
            /* Map an offset in the flattened text back to (node, offset). */
            "  var locate = function (nodes, pos) {" +
            "    var lo = 0, hi = nodes.length - 1, best = 0;" +
            "    while (lo <= hi) {" +
            "      var mid = (lo + hi) >> 1;" +
            "      if (nodes[mid].start <= pos) { best = mid; lo = mid + 1; } else { hi = mid - 1; }" +
            "    }" +
            "    return { node: nodes[best].node, offset: pos - nodes[best].start };" +
            "  };" +
            "  var build = function (query) {" +
            "    var c = collect(), hay = c.text.toLowerCase(), needle = query.toLowerCase();" +
            "    var ranges = [], from = 0, at;" +
            "    while (needle && (at = hay.indexOf(needle, from)) !== -1) {" +
            "      var s = locate(c.nodes, at), e = locate(c.nodes, at + needle.length);" +
            "      try {" +
            "        var r = document.createRange();" +
            "        r.setStart(s.node, s.offset); r.setEnd(e.node, e.offset);" +
            "        ranges.push(r);" +
            "      } catch (err) {}" +
            "      from = at + needle.length;" +
            "      if (ranges.length >= 2000) { break; }" +     /* a pathological page must not hang the tab */
            "    }" +
            "    return ranges;" +
            "  };" +
            "  window.__atlasFind = function (query, forward) {" +
            "    query = String(query || '');" +
            "    if (!query) { clear(); ipc.post('find', { count: 0, index: 0, query: '' }); return; }" +
            "    if (query !== hl.query) {" +
            "      hl.ranges = build(query); hl.query = query; hl.index = -1;" +
            "      if (supported && hl.ranges.length) {" +
            "        var all = new Highlight();" +
            "        for (var i = 0; i < hl.ranges.length; i++) { all.add(hl.ranges[i]); }" +
            "        CSS.highlights.set('atlas-find', all);" +
            "      }" +
            "    }" +
            "    var n = hl.ranges.length;" +
            "    if (!n) {" +
            "      if (supported) { CSS.highlights['delete']('atlas-find'); CSS.highlights['delete']('atlas-find-current'); }" +
            "      ipc.post('find', { count: 0, index: 0, query: query });" +
            "      return;" +
            "    }" +
            "    hl.index = (forward === false) ? ((hl.index - 1 + n) % n) : ((hl.index + 1) % n);" +
            "    var cur = hl.ranges[hl.index];" +
            "    if (supported) {" +
            "      var one = new Highlight(); one.add(cur);" +
            "      CSS.highlights.set('atlas-find-current', one);" +
            "    }" +
            "    try {" +
            "      var rect = cur.getBoundingClientRect();" +
            "      window.scrollBy({ top: rect.top - (window.innerHeight / 2), left: 0, behavior: 'auto' });" +
            "    } catch (err2) {}" +
            "    ipc.post('find', { count: n, index: hl.index + 1, query: query });" +
            "  };" +
            "  window.__atlasFindClear = clear;";
    },
    openInputChannel: function () {
        if (this._ipc || typeof window.ShellIpc === "undefined") { return; }
        var self = this;
        try {
            this._ipc = new window.ShellIpc(this.ipcChannel());
            this._ipc.on("tap", function (msg) { self.onPageTap(msg || {}); });
            this._ipc.on("scroll", function (msg) { self.onPageScroll(msg || {}); });
            this._ipc.on("hold", function (msg) { self.onPageHold(msg || {}); });
            this._ipc.on("url", function (msg) { self.onPageUrl(msg || {}); });
            this._ipc.on("find", function (msg) { self.reportFindResult(msg || {}); });
        } catch (e) {
            enyo.log("[Atlas] input bridge unavailable: " + e);
        }
    },
    /* Page coordinates are relative to the page view; Atlas works in app-window coordinates, so shift
     * by where the view currently sits. */
    onPageTap: function (msg) {
        // The user touched the page: keyboard focus belongs to it now (the shim hands focus back to
        // the UI page whenever a UI field is focused).
        try { if (this.pageContents && this.pageContents.setFocus) { this.pageContents.setFocus(); } } catch (e) {}
        var r = this._rect || { left: 0, top: 0 };
        var position = { left: r.left + (msg.x || 0), top: r.top + (msg.y || 0) };
        var tapInfo = { linkUrl: msg.link || "", imageUrl: msg.img || "" };
        this.doSingleTap(position, null, tapInfo);
    },
    onPageScroll: function (msg) {
        this.doScrolledTo(msg.x || 0, msg.y || 0);
    },
    /* The main frame telling us where it actually is. pageContents.url follows SUBFRAME navigations
     * too, so on an ad-heavy page the address bar (and history) filled up with tracker iframe URLs.
     * The bridge only ever runs in the main frame, so this is authoritative. */
    onPageUrl: function (msg) {
        var href = msg && msg.href;
        if (!href || this.isBlank(href)) { return; }
        this.url = href;
        if (msg.title) { this.title = msg.title; }
        this.refreshNavState();
        this.doPageTitleChanged(this.title, href, this.canGoBack, this.canGoForward);
    },
    /* Long press -> Atlas's context menu. openContextMenu reads pageX/pageY to place the popup and
     * the hit-test to choose between the link, image, edit and page menus. */
    onPageHold: function (msg) {
        var r = this._rect || { left: 0, top: 0 };
        var ev = { pageX: r.left + (msg.x || 0), pageY: r.top + (msg.y || 0) };
        this.doMousehold(ev, msg.info || {});
    },
    /* Chromium selects natively, but Atlas drives the plain-text long press through
     * enableSelectionMode, so honour it by selecting the word under the point. The app-space point has
     * to come back to page space first. Atlas's marker/popover UI stays unwired: it is fed by the WPE
     * backend's selectionBounds messages, which have no equivalent here. */
    selectWordAt: function (appX, appY) {
        var r = this._rect || { left: 0, top: 0 };
        var x = Math.round((appX || 0) - r.left), y = Math.round((appY || 0) - r.top);
        this.runScript(
            "(function(){" +
            "  var rng = document.caretRangeFromPoint ? document.caretRangeFromPoint(" + x + "," + y + ") : null;" +
            "  if (!rng) { return; }" +
            "  var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);" +
            "  if (sel.modify) { sel.modify('move', 'backward', 'word'); sel.modify('extend', 'forward', 'word'); }" +
            "})();");
    },

    /* Schemes the engine itself cannot render — these are the ones Atlas should hand to the system
     * (mailto:, tel:, an app's custom OAuth redirect...). Everything web-ish stays in the tab. */
    isExternalScheme: function (u) {
        var m = /^([a-z][a-z0-9+.-]*):/i.exec(String(u || ""));
        if (!m) { return false; }
        var s = m[1].toLowerCase();
        return !(s === "http" || s === "https" || s === "file" || s === "about" ||
                 s === "data" || s === "blob" || s === "chrome" || s === "ftp");
    },
    readString: function (v) {
        if (typeof v === "string") { return v; }
        if (v && typeof v === "object") { return v.title || v.url || v.value || ""; }
        return "";
    },
    readProgress: function (ev) {
        var p = ev;
        if (ev && typeof ev === "object") { p = (ev.progress !== undefined) ? ev.progress : ev.value; }
        p = parseFloat(p);
        if (isNaN(p)) { return 0; }
        return (p <= 1) ? Math.round(p * 100) : Math.round(p);   // some builds report 0..1
    },

    // ---------------------------------------------------------------------------------------------
    // Atlas API
    // ---------------------------------------------------------------------------------------------
    identifierChanged: function () {},
    urlChanged: function () {
        this.loadUrl(this.url);
    },
    setUrl: function (inUrl) {
        this.url = inUrl;
        this.loadUrl(inUrl);
    },
    getUrl: function () {
        return this.currentUrl();
    },
    goToUrl: function (inUrl) {
        this.setUrl(inUrl);
    },
    loadUrl: function (inUrl) {
        var u = this.normalizeUrl(this.stripMarkers(inUrl));
        if (!u) { return; }
        this.requestedUrl = u;
        this._reissued = false;
        if (!this.pageContents) { this.pendingUrl = u; return; }
        try { this.pageContents.loadURL(u); } catch (e) { this.error("[Atlas] loadURL failed " + e); }
    },
    /* Chromium's loadURL needs an absolute URL. Atlas hands the engine whatever the user typed once it
     * decides the input is a URL rather than a search, and BrowserServer used to normalise a bare
     * hostname for us — pass "vk.nl" to pageContents.loadURL and the view just stays on about:blank.
     * Add the scheme here, conservatively: only for input that actually looks like a host. */
    normalizeUrl: function (inUrl) {
        var u = String(inUrl || "").trim();
        if (!u) { return u; }
        // "localhost:8080" parses as scheme "localhost" — a host:port is not a scheme.
        if (/^[a-z0-9.\-]+:\d+([\/?#]|$)/i.test(u)) { return "http://" + u; }
        if (/^[a-z][a-z0-9+.\-]*:/i.test(u)) { return u; }                 // already has a scheme
        if (/^\/\//.test(u)) { return "https:" + u; }                      // protocol-relative
        if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([\/?#]|$)/i.test(u)) { return "http://" + u; }
        if (/^[^\s\/?#]+\.[^\s\/?#]+/.test(u)) { return "https://" + u; }  // host.tld[/path]
        return u;                                                          // not host-like: leave alone
    },

    /* atlas-simple: / atlas-private: are WPE backend markers (viewport-only rendering, private mode).
     * Chromium handles both natively — simple mode is meaningless and private is a partition — so the
     * markers are stripped rather than sent to the engine. */
    stripMarkers: function (inUrl) {
        var u = String(inUrl || "");
        while (u.indexOf("atlas-private:") === 0 || u.indexOf("atlas-simple:") === 0) {
            u = u.substring(u.indexOf(":") + 1);
        }
        return u;
    },

    isLoading: function () { return this.loading; },
    setIdentifier: function (inId) { this.identifier = inId; },
    getZoom: function () {
        try { return this.pageContents ? this.pageContents.zoomFactor : 1; } catch (e) { return 1; }
    },
    setZoom: function (inZoom) {
        try { if (this.pageContents) { this.pageContents.zoomFactor = inZoom; } } catch (e) {}
    },
    insertStringAtCursor: function (inString) {
        this.runScript("document.execCommand('insertText', false, " + JSON.stringify(String(inString || "")) + ");");
    },
    /* Atlas calls this three ways: findInPage("") to reset, findInPage(s) for a new search, and
     * findInPage(s, true|false) for next/previous. The engine lives in the page (findEngineScript);
     * if the injection has not run yet — find pressed before dom-ready — fall back to window.find so
     * the button is never simply dead. */
    findInPage: function (inString, inForward) {
        var s = String(inString || "");
        var pc = this.pageContents;
        /* A patched webruntime exposes the engine's own find (see the browser_shell patch), which
         * beats the injected one: it searches cross-origin iframes the injected script cannot reach,
         * and its count comes from the engine rather than from our own DOM walk. Fall back when the
         * engine predates the patch. */
        var native = !!(pc && typeof pc.findInPage === "function");
        if (!s) {
            this._findQuery = "";
            if (native) { try { pc.stopFindInPage(true); } catch (e) {} }
            else { this.runScript("try { window.__atlasFindClear && window.__atlasFindClear(); } catch (e) {}"); }
            this.reportFindResult({ count: 0, index: 0, query: "" });
            return;
        }
        if (native) {
            // findNext advances within the current search; a changed needle starts a new one.
            var findNext = (s === this._findQuery);
            this._findQuery = s;
            try { pc.findInPage(s, inForward !== false, false, findNext); } catch (e2) {}
            return;
        }
        this.runScript(
            "if (window.__atlasFind) { window.__atlasFind(" + JSON.stringify(s) + ", " + (inForward !== false) + "); }" +
            "else { window.find(" + JSON.stringify(s) + ", false, " + (inForward === false) + ", true, false, true, false); }");
    },
    /* Match count for the find bar. Reported from the page, so it arrives asynchronously. */
    reportFindResult: function (msg) {
        var app = window.__atlasApp;
        var bar = this.owner && this.owner.$ && this.owner.$.findDialog;
        if (bar && bar.setMatchCount) { bar.setMatchCount(msg.count || 0, msg.index || 0); }
        else if (app) { app.log("[Atlas] find: " + (msg.index || 0) + "/" + (msg.count || 0)); }
    },
    runScript: function (js) {
        try { if (this.pageContents) { this.pageContents.executeJavaScriptInMainFrame(js); } } catch (e) {}
    },

    /* Atlas funnels everything the NPAPI plugin used to expose through viewCall -> callBrowserAdapter,
     * so this dispatch table IS the rest of the API. Anything without a browser_shell equivalent is
     * logged once and ignored rather than throwing into Atlas's call sites. */
    callBrowserAdapter: function (inMethod, inArgs) {
        var a = inArgs || [];
        var pc = this.pageContents;
        switch (inMethod) {
        case "reloadPage":      try { pc && pc.reload(); } catch (e) {} break;
        case "stopLoad":        try { pc && pc.stop(); } catch (e) {} break;
        case "goBack":          try { pc && pc.goBack(); } catch (e) {} break;
        case "goForward":       try { pc && pc.goForward(); } catch (e) {} break;
        case "clearHistory":    break;                       // the shell owns per-view history
        case "clearCache":      this.clearData(["cache"]); break;
        case "clearCookies":    this.clearData(["cookies"]); break;
        case "insertStringAtCursor": this.insertStringAtCursor(a[0]); break;
        case "findInPage":      this.findInPage(a[0], a[1]); break;
        case "copy":            this.runScript("document.execCommand('copy');"); break;
        case "paste":           this.runScript("document.execCommand('paste');"); break;
        case "selectAll":       this.runScript("document.execCommand('selectAll');"); break;
        case "enableSelectionMode": this.selectWordAt(a[0], a[1]); break;
        case "clearSelection":  this.runScript("try { window.getSelection().removeAllRanges(); } catch (e) {}"); break;
        case "acceptDialog":    this.answerDialog(true, a); break;
        case "cancelDialog":    this.answerDialog(false, a); break;
        case "sendDialogResponse": this.answerDialog(!!a[0], []); break;
        case "activate":        try { pc && pc.activate(); pc && pc.resumeDOM(); pc && pc.resumeMedia(); } catch (e) {} break;
        case "deactivate":      try { pc && pc.suspendMedia(); pc && pc.suspendDOM(); pc && pc.deactivate(); } catch (e) {} break;
        case "disconnectBrowserServer": this.teardownPageView(); break;
        /* No engine call needed: the popup decision is made in our own newwindow handler. */
        case "setBlockPopups":  this.blockPopups = !!a[0]; break;
        /* CSS does what the engine hook would have done. The rule is injected rather than set on the
         * document element so a page's own stylesheet cannot outrank it. */
        case "setUserSelect":
            this.runScript(
                "(function(){var id='__atlasUserSelect',e=document.getElementById(id);" +
                "if(" + (!a[0]) + "){if(!e){e=document.createElement('style');e.id=id;" +
                "e.textContent='*{-webkit-user-select:none !important;user-select:none !important}';" +
                "(document.head||document.documentElement).appendChild(e);}}" +
                "else if(e){e.parentNode.removeChild(e);}})();");
            break;
        /* Chromium owns the drag handles, but dismissing the selection is still meaningful. */
        case "disableSelectionMode":
            this.runScript("try { window.getSelection().removeAllRanges(); } catch (e) {}");
            break;
        /* Web preferences, on a patched webruntime. The stock engine exposes neither, so both stay
         * no-ops there rather than throwing into Atlas's call sites. */
        case "setEnableJavascript":
            if (pc && typeof pc.setEnableJavascript === "function") {
                try { pc.setEnableJavascript(!!a[0]); } catch (e) {}
            } else { this.unsupported(inMethod); }
            break;
        case "setAcceptCookies":
            if (pc && typeof pc.setAcceptCookies === "function") {
                try { pc.setAcceptCookies(!!a[0]); } catch (e) {}
            } else { this.unsupported(inMethod); }
            break;
        /* Still no engine equivalent even with the patch: print needs a whole printing stack that
         * neva does not build, and Atlas's marker-based selection needs selectionBounds reporting. */
        case "setAutoplayWithSound":
        case "ignoreMetaRefreshTags":
        case "printFrame":
        // Atlas's own marker/popover selection UI is fed by the WPE backend's selectionBounds messages,
        // which have no counterpart here.
        case "extendSelectionTo":
        case "setDragMode":
            this.unsupported(inMethod);
            break;
        default:
            this.unsupported(inMethod);
            break;
        }
    },
    answerDialog: function (accept, args) {
        var d = this.pendingDialog;
        this.pendingDialog = null;
        if (!d) { return; }
        try {
            if (accept && d.ok) { d.ok.apply(d, args || []); }
            else if (!accept && d.cancel) { d.cancel(); }
        } catch (e) {}
    },
    clearData: function (types) {
        try { if (this.pageContents) { this.pageContents.clearData({ since: 0 }, types); } } catch (e) {}
    },
    unsupported: function (name) {
        if (!this._warned) { this._warned = {}; }
        if (this._warned[name]) { return; }
        this._warned[name] = true;
        enyo.log("[Atlas] chromium engine: '" + name + "' has no browser_shell equivalent — ignored");
    },

    /* Card thumbnails. captureVisibleRegion is asynchronous here, where the NPAPI call was synchronous
     * and wrote files; callers get the data URI through the callback instead. */
    createPageImages: function (inCallback) {
        if (!this.pageContents || !this.pageContents.captureVisibleRegion) {
            if (inCallback) { inCallback(null); }
            return;
        }
        try {
            this.pageContents.captureVisibleRegion({ format: "jpeg", quality: 70 }, function (img) {
                if (inCallback) { inCallback(img); }
            });
        } catch (e) { if (inCallback) { inCallback(null); } }
    }
});

}
