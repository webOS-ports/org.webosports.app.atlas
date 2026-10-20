//   Copyright 2012 Hewlett-Packard Development Company, L.P.
//
//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.

/* Which download manager to talk to.
 *
 * The service is the same Palm download manager either way - same methods, same parameters (target,
 * mime, targetDir, targetFilename) - but the bus name differs by platform, and a call to the wrong one
 * simply never gets a reply:
 *
 *   legacy webOS (TouchPad, Pre 3)   com.palm.downloadmanager        (what the stock browser calls)
 *   LuneOS                           com.webos.service.downloadmanager
 *
 * Verified on LuneOS with ls-monitor: only com.webos.service.downloadmanager is registered, and
 * nothing in /usr/share/luna-service2 maps the old name onto it, so every download Atlas started went
 * nowhere silently.
 *
 * Keyed on the engine because that is what distinguishes the two platforms in practice: browser_shell
 * exists only on LuneOS, and on LuneOS Atlas only runs there (WAM cannot embed web content - no NPAPI,
 * and the webview tag is inert under --disable-extensions). An Atlas somehow running under WAM on
 * LuneOS would need the modern name too; if that ever ships, probe instead of guessing. */
var ATLAS_DOWNLOAD_SERVICE = window.__atlasChromium ?
	"luna://com.webos.service.downloadmanager/" : "palm://com.palm.downloadmanager/";

enyo.kind({
	name: "enyo.BrowserApp",
	kind: enyo.VFlexBox,
	className: "basic-back",
	published: {
		url: "",
		systemPreferences: {},
		browserPreferences: {},
		searchPreferences: [],
		defaultSearch: ""
	},
	components: [
		{kind: "ApplicationEvents", onWindowActivated: "windowActivatedHandler", onWindowDeactivated: "windowDeactivatedHandler", onApplicationRelaunch: "applicationRelaunchHandler"},
		{name: "downloadService", kind: enyo.PalmService, service: ATLAS_DOWNLOAD_SERVICE, method: "download", onSuccess: "gotDownloadStatus", onFailure: "gotDownloadFailure", subscribe: true, resubscribe: true},
		{name: "cancelDownloadService", kind: enyo.PalmService, service: ATLAS_DOWNLOAD_SERVICE, method: "cancelDownload"},
		{name: "downloadHistoryService", kind: enyo.PalmService, service: ATLAS_DOWNLOAD_SERVICE, method: "getAllHistory", onSuccess: "gotDownloadHistory"},
		{name: "clearDownloadsService", kind: enyo.PalmService, service: ATLAS_DOWNLOAD_SERVICE, method: "clearHistory"},
		{name: "bookmarksService", kind: "DbService", dbKind: "com.palm.browserbookmarks:1", reCallWatches: true},
		{name: "historyService", kind: "DbService", dbKind: "com.palm.browserhistory:1", reCallWatches: true},
		{name: "systemPrefsService", kind: "SystemService"},
		{name: "browserPrefsService", kind: "DbService", dbKind: "com.palm.browserpreferences:1", reCallWatches: true},
		{name: "universalSearchService", kind: enyo.PalmService, service: "palm://com.palm.universalsearch/", method: "getUniversalSearchList", onSuccess: "gotUniversalSearchList", subscribe: true, resubscribe: true},
		{name: "setSearchPreferenceService", kind: enyo.PalmService, service: "palm://com.palm.universalsearch/", method: "setSearchPreference"},
		{name: "clearOptionalSearchListService", kind: enyo.PalmService, service: "palm://com.palm.universalsearch/", method: "clearOptionalSearchList"},
		{name: "stService", kind: "PalmService", service: "palm://com.palm.stservice/", timeout: 500},
		// Teams OAuth redirect-capture channel: when this card is launched by the Teams account
		// validator (mode=simple + oauthRedirectPrefix), the captured redirect URL is handed back
		// through a systemservice preference the validator subscribes to. No custom db8 kind needed.
		{name: "sysPrefsService", kind: "PalmService", service: "palm://com.palm.systemservice/", method: "setPreferences"},
		{name: "launchApplicationService", kind: "PalmService", service: enyo.palmServices.application, method: "open", onFailure: "gotResourceError"},
		{name: "addToLauncherService", kind: "PalmService", service: enyo.palmServices.application, method: "addLaunchPoint"},
		{name: "resourceInfoService", kind: "PalmService", service: enyo.palmServices.application, method: "getResourceInfo", onSuccess: "gotResourceInfo", onFailure: "gotResourceError"},
		{name: "updater", kind: "Updater", onUpdateFound: "onUpdateFound"},
		{name: "updatePopup", kind: "AcceptCancelPopup", acceptCaption: $L("Update"), cancelCaption: $L("Not Now"), onResponse: "updateResponse", components: [
			{name: "updateMessage", className: "browser-dialog-body enyo-text-body ", allowHtml: true}
		]},
		{kind: enyo.Pane, flex: 1, height: "100%", lazyViews: [
			{name: "startPage", kind: "StartPage", 
				onUrlChange: "processUrlChange",
				onOpenBookmarks: "bookmarksClick",
				onNewCard: "newCardClick",
				onShow: "startPageShown"
			},
			{name: "browser", kind: "Browser",
				onPageTitleChanged: "pageTitleChanged",
				onTranslatePage: "translatePage",
				onPageLoadStopped: "pageLoadStopped",
				onFileLoad: "handleResource",
				onAddBookmark: "addBookmark",
				onDeleteBookmark: "deleteBookmark",
				onAddToLauncher: "showAddtoLauncherDialog",
				onShareLink: "shareClick",
				onDownloadLink: "downloadClick",
				onOpenBookmarks: "bookmarksClick",
				onPrint: "printClick",
				onUrlRedirected: "openResource",
				onClose: "browserClosed",
				onShow: "browserShown",
				onHide: "browserHidden",
				onReaderLink: "readerLinkHandler",
				onGoHome: "goHome"
			},
			{name: "reader", kind: "ReaderView",
				onClose: "readerClosed",
				onOpenUrl: "readerOpenUrl",
				onShow: "readerShown"
			},
			{name: "preferences", kind: "Preferences",
				onPreferenceChanged: "preferenceChanged",
				onShow: "preferencesShown",
				onClose: "backHandler"
			}
		]},
		{kind: enyo.Toaster, flyInFrom: "right", dismissWithClick: false, style: "top: 0px; bottom: 0px", lazy: false, components: [
			{className: "enyo-sliding-view-shadow"},
			{kind: enyo.VFlexBox, flex: 1, width: "320px", height: "100%", components: [
				{kind: "Header", className: "enyo-header-dark", components: [
					{kind: "RadioGroup", flex: 1, components: [
						{kind: "RadioButton", value: "bookmarks", className: "enyo-radiobutton-dark", icon: "images/chrome/toaster-icon-bookmarks.png", onclick: "showBookmarks"},
						{kind: "RadioButton", value: "history", className: "enyo-radiobutton-dark", icon: "images/chrome/toaster-icon-history.png", onclick: "showHistory"},
						{kind: "RadioButton", value: "downloads", className: "enyo-radiobutton-dark", icon: "images/chrome/toaster-icon-downloads.png", onclick: "showDownloads"},
						{kind: "RadioButton", value: "passwords", className: "enyo-radiobutton-dark", icon: "images/chrome/toaster-icon-passwords.png", onclick: "showPasswords"},
						{kind: "RadioButton", value: "autofill", className: "enyo-radiobutton-dark", icon: "images/autofill-icon.png", onclick: "showAutofill"}
					]}
				]},
				{name: "drawerPane", kind: "Pane", flex: 1, lazyViews: [
					{name: "bookmarks", kind: "BookmarkList",
						onSelectItem: "selectItem",
						onEditItem: "showEditBookmarkDialog",
						onDeleteItem: "deleteBookmark",
						onAddBookmark: "addBookmark",
						onClose: "closeToaster"
					},
					{name: "history", kind: "HistoryList",
						onSelectItem: "selectItem",
						onDeleteItem: "deleteHistory",
						onClose: "closeToaster",
					},
					{name: "downloads", kind: "DownloadList",
						onOpenItem: "openDownloadedFile",
						onCancelItem: "cancelDownload",
						onRetryItem: "retryDownload",
						onDeleteItem: "deleteDownload",
						onClearAll: "showClearDownloadsDialog",
						onClose: "closeToaster",
						onShow: "downloadListShown"
					},
					{name: "passwords", kind: "PasswordList",
						onClose: "closeToaster",
						onEditPassword: "showEditPasswordDialog",
						onImport: "importPasswordsFromToaster",
						onExport: "exportPasswordsClick"
					},
					{name: "autofill", kind: "AutofillList",
						onClose: "closeToaster",
						onEditAutofill: "showEditAutofillDialog",
						onAddAutofill: "addAutofillEntry"
					}
				]}
			]}
		]},
		{kind: "BookmarkDialog", onAccept: "bookmarkAccept", onBeforeOpen: "setupBookmarkDialog"},
		{name: "passwordEditDialog", kind: "PasswordEditDialog"},
		{name: "autofillEditDialog", kind: "AutofillEditDialog"},
		{name: "downloadError", kind: "BrowserPrompt", caption: $L("Cannot open MIME type"), message: ""},
		{name: "clearDownloadsDialog", kind: "BrowserPrompt",
			caption: $L("Are you sure you want to clear the Downloads list?"),
			message: $L("This will not delete the file(s). Plug your device into a computer and use USB mode."),
			acceptCaption: $L("Clear List"),
			onAccept: "clearDownloads"
		},
		{kind: "PrintDialog", lazy: false, duplexOption: true, colorOption: true, onRenderDocument: "renderDocument", appName: "Browser"},
		{kind: "AppMenu", onBeforeOpen: "toggleAppMenuItems", components: [
			//{caption: $L("Find on Page"), onclick: "showFindOnPage"},
			{name: "findMenuItem", caption: $L("Find on Page"), onclick: "showFindOnPage"},
			{name: "readerMenuItem", caption: $L("Reading Mode"), onclick: "readerClick"},
			{name: "privateCardItem", caption: $L("New Private Card"), onclick: "newPrivateCardClick"},
			{name: "preferencesItem", caption: $L("Preferences"), onclick: "preferencesClick"},
			{name: "passwordsItem", caption: $L("Password Manager"), onclick: "passwordsClick"},
			{name: "autofillItem", caption: $L("Autofill"), onclick: "autofillClick"},
			{name: "printMenuItem", caption: $L("Print"), onclick: "printClick"},
			{name: "restartEngineItem", caption: $L("Restart Browser Engine"), onclick: "restartEngineClick"},
			{caption: $L("Help"), onclick: "helpClick"}
		]},
		{name: "loginImporter", kind: "LoginImporter", onImportDone: "loginImportDone"},
		{name: "loginExporter", kind: "LoginExporter", onExportDone: "loginExportDone"}
	],
	//* @protected
	constructor: function() {
		this.inherited(arguments);
		this.downloads = [];
		this.preferences = {};
	},
	create: function() {
		this.inherited(arguments);
		this.fetchInitialPreferences();
		this.log(enyo.json.stringify(enyo.windowParams));
	},
	applicationRelaunchHandler: function(inSender) {
		var c = enyo.windows.getActiveWindow();
		var params = enyo.windowParams;
		// squelch needless banner clicks
		if (params.dontLaunch) return true;
		if (params.sendDataToShare !== undefined) {
			this.$.stService.call({data: {target: c.enyo.$.browserApp.getUrl(), type: "rawdata", mimetype: "text/html"}}, {method: "shareData"});
			return true;
		} else if (params.toasterOpen) {
			this.$.toaster.open();
			this.$.radioGroup.setValue(params.toasterOpen);
			this.$.drawerPane.selectViewByPane(params.toasterOpen);
		} else if (params._atlasInApp ||
				(window.__atlasInAppOpenAt && ((new Date()).getTime() - window.__atlasInAppOpenAt) < 5000)) {
			// In-app "open in new card": the originating openWindow already created the card
			// (which loads the url in rendered()). On LunaCE that internal open ALSO fires a
			// relaunch here, so re-opening would create a duplicate card — swallow it. The
			// {_atlasInApp} param doesn't reliably reach this handler's windowParams, so we also
			// check a timestamp stamped on the shared root window by atlasOpenCard().
			window.__atlasInAppOpenAt = 0;
			return true;
		} else if (window.atlasOpenCard &&
				(params.mode === "simple" ||
				 (params.target && params.target.indexOf("atlas-simple:") === 0) ||
				 (params.target && params.target.indexOf("atlas-private:") === 0))) {
			// Simple / private cards (memory-heavy SPAs like web.whatsapp.com, OAuth popups, private
			// browsing) must be BORN in that mode: the viewport (vs tall MODE-1) render buffer and the
			// BS session are fixed at card creation, so navigating a reused MODE-1 card to a simple target
			// does nothing (the tall buffer stays, page lays out 12000px+ into a 3072px buffer -> "loads
			// halfway"). Route through the proven new-card path so rendered() runs with mode set from the
			// start. The byproduct relaunch openWindow fires is swallowed by the _atlasInApp check above.
			window.atlasOpenCard(params);
			return true;
		} else {
			// Normal relaunch (launcher tap, or a luna-send carrying a target). When an Atlas card already
			// exists, openWindow("index.html") just brings it forward WITHOUT re-running rendered(), so the
			// new target is silently dropped and the stale (often white) card is shown. Make the launch
			// target authoritative: navigate the existing card directly. Only open a fresh window when
			// there is genuinely no card to reuse.
			var relTarget = params.target || params.url;
			var app = (c && c.enyo && c.enyo.$) ? c.enyo.$.browserApp : null;
			if (relTarget && app && app.setUrl && !this.isAtlasHome(relTarget)) {
				app._launchSimple = (params.mode === "simple");
				app._oauthRedirectPrefix = params.oauthRedirectPrefix || "";
				app._oauthResultKey = params.oauthResultKey || "x_teams_oauth_result";
				app.setUrl(relTarget);
			} else {
				enyo.windows.openWindow("index.html", null, params);
			}
			return true;
		}
	},
	rendered: function() {
		this.inherited(arguments);
		this.log();
		var p = window.PalmSystem ? enyo.windowParams : this.processQueryString();
		// Private browsing: a card whose webviewId is tagged "private" (New Private Card) must NOT
		// write to history (the BS session is already ephemeral, but history is the app's own DB).
		this.isPrivate = !!(p.webviewId && p.webviewId.indexOf("private") === 0);
		// MODE 2 (viewport / low-memory): optional launch param mode=simple for cards that don't page-scroll
		// (OAuth2 popups, app SPAs like web.whatsapp.com). Stash it here; browserShown() sets it on the browser
		// widget right before the load (where $.browser definitely exists). Omitted -> default scroll mode.
		this._launchSimple = (p.mode === "simple");
		// Teams OAuth redirect-capture: the validator passes the redirect_uri prefix to watch for.
		// When a navigation lands on it, we hand the full URL (carrying ?code=...) back to the
		// validator via a systemservice pref, then close this card. Key is overridable per-request.
		this._oauthRedirectPrefix = p.oauthRedirectPrefix || "";
		this._oauthResultKey = p.oauthResultKey || "x_teams_oauth_result";
		// CARD-CLOSE WEBPROCESS REAP: swiping the card away does NOT run ~BrowserAdapter on our custom-mime
		// (application/x-atlas-browser) WebView plugin, so ~YapClient never closes the yap socket ->
		// BrowserServer never gets the disconnect (G_IO_HUP) -> the BrowserPage + its WPEWebProcess (tens-to-
		// hundreds of MB; web.whatsapp.com ~340MB) LEAK forever, starving the device until new pages load
		// WHITE. Disconnect the engine explicitly on window unload so BS deletes the page and terminates the
		// WebProcess. (disconnectBrowserServer -> adapter asyncCmdDisconnect -> BrowserServer::clientDisconnected.)
		if (!this._reapHooked) {
			this._reapHooked = true;
			var self = this;
			var reapWebProcess = function() {
				try { if (self.$.browser && self.$.browser.viewCall) self.$.browser.viewCall("disconnectBrowserServer"); } catch (e) {}
				try { if (self.$.reader && self.$.reader.viewCall) self.$.reader.viewCall("disconnectBrowserServer"); } catch (e2) {}
			};
			window.addEventListener("pagehide", reapWebProcess, false);
			window.addEventListener("unload", reapWebProcess, false);
		}
		enyo.log("[Atlas] launch mode=" + p.mode + " simple=" + this._launchSimple + " target=" + (p.target || p.url || "") + " oauthPrefix=" + this._oauthRedirectPrefix);
		var url = p.target || p.url;
		// Engine-restart recovery (Browser.engineRecover) reloads this card's document, because a
		// plugin instance whose BrowserServer died cannot be re-connected in place. Our launch
		// params still carry the URL the card was ORIGINALLY opened with, so the page the user was
		// actually on is stashed in window.name (which survives a reload) — prefer it here. The
		// stamp is deliberately left in place: it doubles as the guard that stops a reload loop.
		var recovered = this.engineRecoveryUrl();
		if (recovered) {
			enyo.log("[Atlas] restoring page after engine-restart card reload: " + recovered);
			url = recovered;
		}
		// #25 DIRECT-RENDER TEST (fb1/alpha hole): when the target URL carries the "atlasfs" marker,
		// request webOS card fullscreen -> CardWindow::fullScreenEnabled(true) -> allowDirectRendering
		// -> LunaSysMgr unblanks fb1 and the card renders into it. Gated so normal launches are unaffected.
		if (url && url.indexOf("atlasfs") >= 0 && window.PalmSystem && window.PalmSystem.enableFullScreenMode) {
			try { window.PalmSystem.hasAlphaHole = true; window.PalmSystem.enableFullScreenMode(true);
				enyo.log("[Atlas] #25 enableFullScreenMode(true)+hasAlphaHole for direct-render test"); } catch(e){ enyo.log("[Atlas] #25 fs err "+e); }
		}
		if (url && !this.isAtlasHome(url)) {
			this.setUrl(url); // this opens the browser view
		} else if (p.webviewId) {
			this.$.pane.selectViewByName("browser");
		} else {
			this.$.pane.selectViewByName("startPage");
		}
		this.showBookmarks();
		//this.showAppMenu();
		//this.resize();
		// Auto-update: check App Museum II a few seconds after launch (don't compete with the initial load).
		if (window.PalmSystem && this.$.updater) {
			var self = this;
			setTimeout(function() { self.$.updater.checkForUpdate(); }, 6000);
		}
	},
	/* Reads the stash Browser.engineRecover leaves in window.name before reloading the card after an
	 * engine restart: "atlas-engine-recover:<ms>:<url>". Returns the URL to restore, or "" when there
	 * is no stamp or it is too old to be about this card's current session. (The prefix and the
	 * freshness window are mirrored in Browser.ENGINE_STAMP_PREFIX / ENGINE_STAMP_FRESH_MS.) */
	engineRecoveryUrl: function() {
		var PREFIX = "atlas-engine-recover:", FRESH_MS = 120000;
		var n = "";
		try { n = window.name || ""; } catch (e) { return ""; }
		if (n.indexOf(PREFIX) !== 0) { return ""; }
		var rest = n.substring(PREFIX.length);
		var sep = rest.indexOf(":");
		if (sep < 0) { return ""; }
		var at = parseInt(rest.substring(0, sep), 10);
		if (!at || ((new Date()).getTime() - at) > FRESH_MS) { return ""; }
		return rest.substring(sep + 1);
	},
	// Updater fired: a strictly-newer build exists — confirm with the user before handing it to Preware.
	onUpdateFound: function(inSender, inInfo) {
		this.pendingUpdate = inInfo;
		this.$.updatePopup.validateComponents();
		this.$.updateMessage.setContent(
			$L("A new version of Atlas Web") + " (" + inInfo.version + ") " + $L("is available.") +
			(inInfo.versionNote ? "<br><br>" + inInfo.versionNote : ""));
		this.$.updatePopup.openAtCenter();
	},
	// User's response to the update prompt — on accept, launch Preware to install the IPK.
	updateResponse: function(inSender, inAccepted) {
		if (inAccepted && this.pendingUpdate && this.pendingUpdate.downloadURI) {
			this.$.launchApplicationService.call({
				id: "org.webosinternals.preware",
				params: {type: "install", file: this.pendingUpdate.downloadURI}
			});
		}
		this.pendingUpdate = null;
	},
	processQueryString: function() {
		var q = location.search.slice(1), queryArgs = {};
		if (q) {
			var args = q.split("&");
			for (var i=0, a, nv; a=args[i]; i++) {
				var nv = args[i] = a.split("=");
				if (nv) {
					queryArgs[nv[0]] = unescape(nv[1]);
				}
			}
		}
		if (queryArgs.query) {
			queryArgs.url = "https://www.google.com/search?q=" + queryArgs.query;
		}
		return queryArgs;
	},
	isBrowserShowing: function() {
		return this.$.pane.getViewName() === "browser";
	},
	isStartPageShowing: function() {
		return this.$.pane.getViewName() === "startPage";
	},
	isPreferencesShowing: function() {
		return this.$.pane.getViewName() === "preferences";
	},
	isDownloadListShowing: function() {
		return this.$.toaster.isOpen && this.$.drawerPane.getViewName() === "downloads";
	},
	isBrowserLoading: function() {
		if (this.$.browser) {
			return this.$.browser.isLoading();
		} else {
			return false;
		}
	},
	resizeHandler: function() {
		this.inherited(arguments);
		if (this.isBrowserShowing()) {
			this.$.browser.resize();
		} else if (this.isStartPageShowing()) {
			this.$.startPage.resize();
		}
	},
	windowActivatedHandler: function() {
		//this.$.browser.hasKind();
		if (this.isBrowserShowing()) {
			this.$.browser.viewCall("activate");
		}
		this.refreshDownloads();
	},
	windowDeactivatedHandler: function() {
		if (this.isBrowserShowing()) {
			this.$.browser.viewCall("deactivate");
		}
	},
	refreshPanes: function() {
		this.inherited(arguments);
		var i = this.$.drawerPane.getViewByIndex();
		this.$.drawerPane.selectViewByIndex(i);
	},
	browserShown: function(inSender, inShowing, inRefresh) {
		enyo.keyboard.setResizesWindow(false);
		// FIXME: there's a transition skag. trying to eliminate.
		setTimeout(enyo.hitch(this, function() {
			this.$.browser.viewCall("activate");
			if (inRefresh || !this.$.browser.getUrl()) {
				this.$.browser.simpleMode = !!this._launchSimple;   // MODE 2: set before the load (urlChanged tags it)
				this.$.browser.setUrl(this.url);
			}
		}), 1);
	},
	browserHidden: function() {
		enyo.keyboard.setResizesWindow(true);
		this.$.browser.viewCall("deactivate");
	},
	browserClosed: function() {
		this.gotoView("startPage");
	},
	downloadListShown: function(inSender) {
		this.$.downloads.setDownloads(this.downloads);
	},
	preferencesShown: function(inSender) {
		this.$.preferences.updatePreferences(this.preferences);
	},
	startPageShown: function() {
		this.$.startPage.setUrl("");
	},
	toggleAppMenuItems: function() {
		var browser = this.isBrowserShowing();
		this.$.printMenuItem.setDisabled(!browser || this.isBrowserLoading());
		this.$.findMenuItem.setDisabled(!browser);
		this.$.readerMenuItem.setDisabled(!browser);
		this.$.preferencesItem.setDisabled(this.isPreferencesShowing());
		// One-shot arm: AppMenu items fire onclick TWICE on LunaCE (touch+mouse, seen ~2.5s apart here),
		// which opened two private cards. Arm once per menu-open; the handler disarms after the first fire.
		this._menuArmed = true;
	},
	applyPreference: function(inPreference, inValue) {
		this.log(inPreference, inValue);
		var preferenceMap = {
			enableJavascript: "setEnableJavascript",
			blockPopups: "setBlockPopups",
			acceptCookies: "setAcceptCookies",
			offerTranslate: "setOfferTranslate",
			autoplayWithSound: "setAutoplayWithSound",
		}
		this.$.pane.viewByName("browser");
		var o = inPreference == "clearHistory" || inPreference == "clearBookmarks" ? this : this.$.browser;
		this.log(preferenceMap[inPreference] || inPreference);
		this.log(o);
		this.log(o[preferenceMap[inPreference] || inPreference]);
		if (o[preferenceMap[inPreference] || inPreference]) {
			this.log(preferenceMap[inPreference || inPreference], inValue);
			o[preferenceMap[inPreference] || inPreference](inValue);
		}
	},
	systemPreferencesChanged: function() {
		for (var key in this.systemPreferences) {
			this.log(key, this.systemPreferences[key]);
			this.applyPreference(key, this.systemPreferences[key]);
		}
		this.$.pane.viewByName("preferences").setSystemPreferences(this.systemPreferences);
	},
	browserPreferencesChanged: function() {
		for (var key in this.browserPreferences) {
			this.applyPreference(key, this.browserPreferences[key]);
		}
		this.$.pane.viewByName("preferences").setBrowserPreferences(this.browserPreferences);
	},
	searchPreferencesChanged: function() {
		var views = ["browser", "startPage", "preferences"];
		for (var i=0, v;v=views[i];i++) {
			this.$.pane.viewByName(v).setSearchPreferences(this.searchPreferences);
		}
	},
	defaultSearchChanged: function() {
		this.log(this.defaultSearch);
		var views = ["browser", "startPage", "preferences"];
		for (var i=0, v;v=views[i];i++) {
			this.$.pane.viewByName(v).setDefaultSearch(this.defaultSearch);
		}
	},
	gotSystemPreferences: function(inSender, inResponse) {
		delete inResponse.returnValue;
		this.setSystemPreferences(inResponse);
	},
	gotBrowserPreferences: function(inSender, inResponse) {
		for (var i=0,p;p=inResponse.results[i];i++) {
			this.browserPreferences[p.key] = p.value;
		}
		this.browserPreferencesChanged();
	},
	gotInitialBrowserPreferences: function(inSender, inResponse) {
		var kind = this.$.browserPrefsService.dbKind;
		var defaultBrowserPreferences = [
			{_kind: kind, key: "blockPopups", value: true},
			{_kind: kind, key: "acceptCookies", value: true},
			{_kind: kind, key: "enableJavascript", value: true},
			{_kind: kind, key: "autoplayWithSound", value: false},
			{_kind: kind, key: "rememberPasswords", value: true},
			{_kind: kind, key: "offerTranslate", value: false}
		];
		if (inResponse.results.length == 0) {
			this.$.browserPrefsService.call({objects: defaultBrowserPreferences}, {method: "put", onSuccess: "fetchPreferences"});
		} else {
			// migrate existing installs: create any newly-introduced default prefs that have no record yet
			// (e.g. offerTranslate) — otherwise a toggle's merge-by-key updates 0 rows and never persists.
			var have = {};
			for (var i = 0; i < inResponse.results.length; i++) { have[inResponse.results[i].key] = true; }
			var missing = [];
			for (var j = 0; j < defaultBrowserPreferences.length; j++) {
				if (!have[defaultBrowserPreferences[j].key]) { missing.push(defaultBrowserPreferences[j]); }
			}
			if (missing.length) {
				this.$.browserPrefsService.call({objects: missing}, {method: "put", onSuccess: "fetchPreferences"});
			} else {
				this.fetchPreferences();
			}
		}
	},
	fetchInitialPreferences: function() {
		this.$.browserPrefsService.call(undefined, {method: "find", onSuccess: "gotInitialBrowserPreferences"});
	},
	fetchPreferences: function(inSuccessCallback, inSubscribe) {
		var systemPreferences = [
			"flashplugins",
			"click2play"
		];
		this.$.systemPrefsService.call({keys: systemPreferences}, {method: "getPreferences", onSuccess: "gotSystemPreferences", subscribe: true});
		this.$.browserPrefsService.call(undefined, {method: "find", onSuccess: "gotBrowserPreferences", subscribe: true});
		this.$.universalSearchService.call();
	},
	gotUniversalSearchList: function(inSender, inResponse) {
		this.searchPreferences = [];
		for (var i=0, s;s=inResponse.UniversalSearchList[i];i++) {
			if (s.type === "web" && s.enabled) {
				// The system search list ships http:// URLs → Google serves "Update your browser".
				// Force https so modern results load.
				if (s.url) s.url = s.url.replace(/^http:\/\//, "https://");
				this.searchPreferences.push(s);
			}
		}
		this.searchPreferencesChanged();
		this.setDefaultSearch(inResponse.defaultSearchEngine);
	},
	preferenceChanged: function(inSender, inPreference, inType, inValue) {
		if (inType === "System") {
			this.systemPreferences[inPreference] = inValue;
			var p = {};
			p[inPreference] = inValue;
			this.$.systemPrefsService.call(p, {method: "setPreferences"});
			this.applyPreference(inPreference, inValue);
		} else if (inType === "Browser") {
			this.browserPreferences[inPreference] = inValue;
			this.$.browserPrefsService.call({props: {value: inValue}, query: {from: this.$.browserPrefsService.dbKind, where: [{prop:"key","op":"=","val":inPreference}]}}, {method: "merge"});
			this.applyPreference(inPreference, inValue);
		} else if (inType === "Search") {
			this.$.setSearchPreferenceService.call({key: "defaultSearchEngine", value: inValue});
			this.setDefaultSearch(inValue);
		} else {
			this.applyPreference(inPreference, inValue);
		}
	},
	// atlas:home / atlas:start are our internal "show the bookmark start page" URLs (like atlas:about is
	// the diagnostics page). Both are accepted so either address resolves to the bookmark grid.
	isAtlasHome: function(u) {
		u = (u || "").replace(/^\s+|\s+$/g, "").toLowerCase().replace(/\/+$/, "");
		return u === "atlas:home" || u === "atlas://home" || u === "atlas:start" || u === "atlas://start";
	},
	goHome: function() {
		this.gotoView("startPage");
	},
	processUrlChange: function(inSender, inUrl) {
		if (this.isAtlasHome(inUrl)) { this.gotoView("startPage"); return; }
		this.setUrl(inUrl);
	},
	urlChanged: function() {
		if (this.isBrowserShowing()) {
			this.browserShown(this, true, true);
		} else {
			this.gotoView("browser");
		}
	},
	selectItem: function(inSender, inItem) {
		this.closeToaster();
		if (this.isAtlasHome(inItem.url)) { this.gotoView("startPage"); return; }
		this.setUrl(inItem.url);
	},
	gotoView: function(inName) {
		this.closeToaster();
		this.$.pane.selectViewByName(inName);
	},
	pageTitleChanged: function(inSender, inTitle, inUrl) {
		this.url = inUrl;
		this.title = inTitle;
		this.checkOAuthRedirect(inUrl);
	},
	// Teams OAuth redirect-capture. Every navigation is checked against the redirect_uri prefix the
	// validator asked us to watch. On a match we already have the authorization code in the query
	// (login.microsoftonline.com/.../nativeclient?code=...); hand the whole URL back and close.
	checkOAuthRedirect: function(inUrl) {
		if (this._oauthCaptured || !this._oauthRedirectPrefix || !inUrl) { return; }
		if (inUrl.indexOf(this._oauthRedirectPrefix) !== 0) { return; }
		this._oauthCaptured = true;
		enyo.log("[Atlas] OAuth redirect captured -> " + inUrl.substring(0, 80) + "...");
		var prefs = {};
		prefs[this._oauthResultKey] = inUrl;
		try { this.$.sysPrefsService.call(prefs); } catch (e) { enyo.log("[Atlas] OAuth pref write err " + e); }
		enyo.log("[Atlas] OAuth pref written; result handed to validator");
		// Best-effort self-dismiss. A WPE-hosted card can't reliably close itself (window.close()
		// is a no-op and applicationManager/close ignores the calling process), so the launching
		// Teams validator does the authoritative close by processId once it reads the result pref.
		try { window.close(); } catch (e) {}
	},
	pageLoadStopped: function(inSender, inUrl) {
		this.checkOAuthRedirect(inUrl || this.url);   // redirect page may carry no title -> catch it here too
		this.updateHistory(this.title, this.url);
	},
	handleResource: function(inSender, inMimeType, inUrl) {
		// The adapter's onFileLoad arg order isn't guaranteed; the URL is the http(s)/ftp
		// one and the other is the MIME. Guards getResourceInfo from a swapped uri (which
		// fails -> "Cannot open MIME type" instead of downloading).
		var url = inUrl, mime = inMimeType;
		if (!/^(https?|ftp):/i.test(url) && /^(https?|ftp):/i.test(mime)) { url = inMimeType; mime = inUrl; }
		// The BS only hands off resources it CAN'T display (= already a download). The
		// getResourceInfo round-trip races the concurrent nav-to-unsupported and gets
		// cancelled -> false "Cannot open MIME type". Download directly instead.
		this.downloadResource(url, mime);
	},
	gotResourceInfo: function(inSender, inResponse, inRequest) {
		var uri = enyo.uri.parseUri(inResponse.uri);
		if (inResponse.appIdByExtension == enyo.fetchAppId()) {
			this.downloadResource(inResponse.uri, inRequest.params.mime);
		} else if (inResponse.canStream) {
			this.openResourceWithApp(inResponse.appIdByExtension, inResponse.uri, inRequest.params.mime);
		} else if (uri.scheme != "http" && uri.scheme != "https" && uri.scheme != "ftp") {
			this.openResource(inResponse.uri);
		} else {
			this.downloadResource(inResponse.uri, inRequest.params.mime);
		}
	},
	gotResourceError: function(inSender, inResponse) {
		this.$.toaster.close();
		this.$.downloadError.openPopup();
	},
	downloadResource: function(inUrl, inMime) {
		this.downloads.unshift({url: inUrl, mimetype: inMime});
		this.$.downloadService.call({target: inUrl, mime: inMime});
		this.showDownloads();
		this.$.toaster.open();
	},
	openDownloadedFile: function(inSender, inIndex) {
		var d = this.downloads[inIndex];
		if (d.completed && !d.aborted && !d.interrupted) {
			this.$.launchApplicationService.call({target: d.destPath + d.destFile});
		}
	},
	cancelDownload: function(inSender, inIndex) {
		var d = this.downloads[inIndex];
		this.$.cancelDownloadService.call({ticket: d.ticket});
	},
	retryDownload: function(inSender, inIndex) {
		var u = this.downloads[inIndex].url;
		this.downloads[inIndex] = {url: u};
		this.$.downloadService.call({target: u});
	},
	deleteDownload: function(inSender, inIndex) {
		var d = this.downloads[inIndex];
		if (!d) {
			return;
		}
		// If it's still downloading, cancel it first so it stops.
		if (d.ticket && !d.completed && !d.aborted) {
			this.$.cancelDownloadService.call({ticket: d.ticket});
		}
		this.downloads.splice(inIndex, 1);
		this.$.downloads.setDownloads(this.downloads);
	},
	showClearDownloadsDialog: function() {
		this.$.clearDownloadsDialog.openAtCenter();
	},
	clearDownloads: function() {
		var newDownloads = [];
		for (var i=0,d;d=this.downloads[i];i++) {
			if (!d.completed) {
				newDownloads.push(d);
			}
		}
		this.downloads = newDownloads;
		this.$.downloads.setDownloads(this.downloads);
		this.$.clearDownloadsService.call({owner: enyo.fetchAppId()});
	},
	findDownload: function(inObj, inSkipUrl) {
		for (var i=0, d; d=this.downloads[i]; i++) {
			if (d.ticket && d.ticket == inObj.ticket) {
				return d;
			}
			if (!inSkipUrl && d.url && d.url == inObj.url) {
				return d;
			}
		}
	},
	gotDownloadStatus: function(inSender, inResponse) {
		var d = this.findDownload(inResponse);
		if (d) {
			// download manager returns the wrong mimetype
			inResponse.mimetype = d.mimetype;
			enyo.mixin(d, inResponse);
			if (!this.$.downloads.showing && d.completed) {
				var filename = d.destFile.replace(/%20/g, " ");
				var params = enyo.json.stringify({toasterOpen:"downloads"});
				if (d.completionStatusCode == 200) {
					enyo.windows.addBannerMessage(filename + ' ' + $L("finished downloading"), params);
				} else {
					enyo.windows.addBannerMessage($L("There was a problem downloading ") + filename, params);
				}
			}
			if (this.$.downloads.showing) {
				this.$.downloads.setDownloads(this.downloads);
			}
		}
	},
	gotDownloadFailure: function(inSender, inResponse) {
		this.log(inResponse);
	},
	refreshDownloads: function() {
		this.$.downloadHistoryService.call({owner: enyo.fetchAppId()});
	},
	gotDownloadHistory: function(inSender, inResponse) {
		// inResponse is sorted by ticket in ascending order
		var iidx = this.downloads.length;
		for (var i=0,d;d=inResponse.items[i];i++) {
			if (d.state == "completed" && d.fileExistsOnFilesys) {
				iidx = this.insertIntoDownloads(enyo.json.parse(d.recordString), iidx);
			}
		}
		if (this.isDownloadListShowing()) {
			this.$.downloads.setDownloads(this.downloads);
		}
	},
	insertIntoDownloads: function(inObj, inStartIndex) {
		for (var i=inStartIndex,d;d=this.downloads[i-1];i--) {
			if (d.ticket == inObj.ticket) {
				return i;
			}
			if (d.ticket > inObj.ticket) {
				this.downloads.splice(i, 0, inObj);
				return i;
			}
		}
		this.downloads.unshift(inObj);
		return 0;
	},
	openResource: function(inSender, inUrl) {
		this.$.launchApplicationService.call({target: inUrl});
	},
	openResourceWithApp: function(inAppId, inUrl, inMime) {
		this.$.launchApplicationService.call({id: inAppId, params: {target: inUrl, mime: inMime}});
	},
	updateHistory: function(inTitle, inUrl) {
		if (this.isPrivate) return;   // private browsing: never record history
		this.$.historyService.call(
			{query: {where: [{prop:"url",op:"=",val:inUrl}]}},
			{method: "delByQuery"});
		var history = {
			_kind: this.$.historyService.dbKind,
			url: inUrl,
			title: inTitle,
			searchText: (inTitle || "") + " " + inUrl,
			date: (new Date()).getTime()
		}
		this.$.historyService.call({objects: [history]}, {method: "put"});
	},
	deleteHistory: function(inSender, inHistory) {
		this.$.historyService.call({ids: [inHistory._id]}, {method: "del"});
	},
	clearHistory: function() {
		this.$.historyService.call(undefined, {method: "delByQuery"});
		if (this.$.browser) {
			this.$.browser.clearHistory();
		}
		// remove when open search is redesigned - clearing history
		// also clears user added search engines
		this.$.clearOptionalSearchListService.call();
	},
	showFindOnPage: function() {
		if (this.isBrowserShowing()) {
			this.$.browser.showFind();
		}
	},
	//* User-triggered engine restart. Atlas does not try to detect a hang; this is how you clear one.
	//* The card reloads itself onto its page once the new engine is up.
	restartEngineClick: function() {
		if (!this._menuArmed) { return; }   // AppMenu double-fire
		this._menuArmed = false;
		var b = this.isBrowserShowing() && this.$.browser;
		if (b) { b.requestEngineRestart(); b.engineDisconnected(); }
	},
	printClick: function() {
		if (!this._menuArmed) { return; }   // AppMenu double-fire -> would open two print dialogs
		this._menuArmed = false;
		this.$.printDialog.openAtCenter();
	},
	renderDocument: function(inSender, inJobID, inPrintParams) {
		if (this.isBrowserShowing()) {
			this.$.browser.printFrame(inJobID, inPrintParams);
		}
	},
	setupBookmarkDialog: function() {
	},
	showAddtoLauncherDialog: function() {
		this.$.bookmarkDialog.setTitle(this.$.browser.title);
		this.$.bookmarkDialog.setUrl(this.$.browser.url);
		this.$.bookmarkDialog.setIcons(this.$.browser.createPageImages());
		this.$.bookmarkDialog.setAcceptCaption($L("Add to Launcher"));
		this.$.bookmarkDialog.acceptAction = "addToLauncher";
		this.$.bookmarkDialog.openAtCenter();
	},
	addToLauncher: function(inTitle, inUrl, inIcons, inId) {
		this.$.addToLauncherService.call({id: enyo.fetchAppId(), icon: inIcons.iconFile64, title: inTitle, params: {url: inUrl}});
	},
	// Open the top-level password edit dialog (kept outside the Toaster so its buttons don't dismiss it).
	showEditPasswordDialog: function(inSender, inItem) {
		this.$.passwordEditDialog.setItem(inItem);
		this.$.passwordEditDialog.openAtCenter();
	},
	showEditBookmarkDialog: function(inSender, inBookmark) {
		this.$.bookmarkDialog.setTitle(inBookmark.title);
		this.$.bookmarkDialog.setUrl(inBookmark.url);
		this.$.bookmarkDialog.setIcons({thumbnailFile: inBookmark.thumbnailFile, iconFile32: inBookmark.iconFile32, iconFile64: inBookmark.iconFile64});
		this.$.bookmarkDialog.setId(inBookmark._id);
		this.$.bookmarkDialog.setAcceptCaption($L("Save"));
		this.$.bookmarkDialog.acceptAction = "editBookmark";
		this.$.bookmarkDialog.openAtCenter();
	},
	bookmarkAccept: function(inSender, inTitle, inUrl, inIcons, inId) {
		var a = inSender.acceptAction;
		if (this[a]) {
			this[a](inTitle, inUrl, inIcons, inId);
		}
	},
	addBookmark: function() {
		var date = (new Date()).getTime();
		var b = {
			_kind: this.$.bookmarksService.dbKind,
			title: this.$.browser.title,
			url: this.$.browser.url,
			searchText: (this.$.browser.title || "") + " " + (this.$.browser.url || ""),
			date: date,
			lastVisited: date,
			defaultEntry: false,
			visitCount: 0,
			idx: null
		};
		enyo.mixin(b, this.$.browser.createPageImages());
		this.$.bookmarksService.call({objects: [b]}, {method: "put"});
	},
	editBookmark: function(inTitle, inUrl, inIcons, inId) {
		var date = (new Date()).getTime();
		var b = {
			_id: inId,
			title: inTitle,
			url: inUrl,
			date: date,
		};
		enyo.mixin(b, inIcons);
		this.$.bookmarksService.call({objects: [b]}, {method: "merge"});
	},
	deleteBookmark: function(inSender, inBookmark) {
		this.$.bookmarksService.call({ids: [inBookmark._id]}, {method: "del"});
	},
	clearBookmarks: function() {
		this.$.bookmarksService.call(undefined,{method:"delByQuery"});
	},
	newCardClick: function() {
		window.atlasOpenCard({});
	},
	// Private browsing: open a card whose webviewId is tagged "private" — Browser.js passes it to the
	// BS via setIdentifier, and BrowserPageWPE makes that card's network session ephemeral (no cookies,
	// history, or cache persisted). The "private" substring is the agreed contract with the BS.
	newPrivateCardClick: function() {
		// AppMenu items fire onclick twice (touch+mouse) -> would open two private cards. Allow exactly one
		// per menu-open (re-armed by toggleAppMenuItems on the next open).
		if (!this._menuArmed) { return; }
		this._menuArmed = false;
		// "atlas-private:" is the BS per-card private signal (openUrl is the only reliably-forwarded
		// command — setIdentifier is a no-op in the adapter). BrowserPageWPE strips it, makes this
		// card's network session ephemeral, and loads about:blank — nothing is persisted.
		window.atlasOpenCard({target: "atlas-private:about:blank", webviewId: "private-" + (new Date()).getTime()});
	},
	shareClick: function() {
		this.$.browser.shareLink(this.url, this.title);
	},
    downloadClick: function(inSender, inLink, inMime) {
        this.downloadResource(inLink, inMime);
    },
	bookmarksClick: function() {
		this.$.toaster.open();
		this.$.drawerPane.selectView(this.$.drawerPane.getView());
	},
	preferencesClick: function() {
		this.gotoView("preferences");
	},
	// Open the current page through Google Translate (target = device language). Fired by the per-page
	// translate bar (Browser.onTranslatePage) when the "Offer to translate pages" preference is on.
	translatePage: function(inSender, inUrl) {
		var url = inUrl || (this.$.browser.getUrl ? this.$.browser.getUrl() : this.$.browser.url);
		if (!url || !(/^https?:\/\//i).test(url)) { return; }
		// don't re-wrap an already-translated page
		if (url.indexOf("translate.goog") >= 0 || url.indexOf("translate.google.com/translate") >= 0) { return; }
		var turl = "https://translate.google.com/translate?sl=auto&tl=" + this.translateTargetLang() +
			"&u=" + encodeURIComponent(url);
		this.setUrl(turl);
	},
	translateTargetLang: function() {
		try {
			if (enyo.g11n && enyo.g11n.currentLocale) {
				var loc = enyo.g11n.currentLocale();
				var l = loc && loc.getLanguage ? loc.getLanguage() : null;
				if (l) { return l; }
			}
		} catch (e) {}
		return "en";
	},
	readerClick: function() {
		if (this.isBrowserShowing()) {
			var b = this.$.browser;
			var url = b.url || this.url;
			// On-demand: tell the BS to extract the CURRENTLY-loaded DOM's article (no wait for the
			// full page load, and always the right card). Clear any stale entry so the reader waits
			// for the fresh one. Result arrives via the "actionData" event into window.__atlasReaderMap.
			if (window.__atlasReaderMap && url) { delete window.__atlasReaderMap[url]; }
			window.__atlasReaderLatest = null;
			try { b.viewCall("findInPage", ["__ATLAS_EXTRACT__"]); } catch (e) {}
			this.pendingReader = {url: url, title: b.title || this.title, browser: b};
			this.gotoView("reader");
		}
	},
	readerLinkHandler: function(inSender, inUrl, inTitle) {
		if (inUrl) {
			this.pendingReader = {url: inUrl, title: inTitle || inUrl};
			this.gotoView("reader");
		}
	},
	readerShown: function() {
		if (this.pendingReader) {
			this.$.reader.load(this.pendingReader.url, this.pendingReader.title, this.pendingReader.browser);
			this.pendingReader = null;
		}
	},
	readerClosed: function() {
		this.gotoView("browser");
	},
	readerOpenUrl: function(inSender, inUrl) {
		this.gotoView("browser");
		if (inUrl) {
			this.url = inUrl;
			this.$.browser.setUrl(inUrl);
		}
	},
	helpClick: function() {
		if (!this._menuArmed) { return; }   // AppMenu double-fire -> would launch help twice
		this._menuArmed = false;
		this.$.launchApplicationService.call({params: {target: "http://help.palm.com/web/index.html"}, id: "com.palm.app.help"});
	},
	// CSV importer trigger: read a Chrome/Google Password Manager export from
	// /media/internal/atlas-logins.csv and bulk-insert it into the logins store.
	// Triggered by the import icon in the Password Manager toaster (PasswordList debounces the tap).
	importPasswordsFromToaster: function() {
		var params = enyo.json.stringify({dontLaunch: true});
		enyo.windows.addBannerMessage($L("Importing passwords..."), params);
		this.$.loginImporter.run();   // has its own re-entry guard
	},
	// Triggered by the export icon in the Password Manager toaster.
	exportPasswordsClick: function() {
		var params = enyo.json.stringify({dontLaunch: true});
		enyo.windows.addBannerMessage($L("Exporting passwords..."), params);
		this.$.loginExporter.run();   // has its own re-entry guard
	},
	loginExportDone: function(inSender, inResult) {
		var params = enyo.json.stringify({dontLaunch: true});
		var msg;
		if (!inResult || !inResult.ok) {
			msg = $L("Password export failed: ") + ((inResult && inResult.error) || $L("unknown error"));
		} else {
			msg = enyo.macroize($L("Exported {$count} password(s) to {$path}"),
				{count: inResult.count, path: inResult.path});
		}
		enyo.windows.addBannerMessage(msg, params);
	},
	loginImportDone: function(inSender, inResult) {
		var params = enyo.json.stringify({dontLaunch: true});
		var msg;
		if (inResult && inResult.error) {
			msg = $L("Password import failed: ") + inResult.error;
		} else {
			msg = enyo.macroize($L("Imported {$added} password(s), skipped {$skipped} duplicate(s)"),
				{added: inResult.added, skipped: inResult.skipped});
		}
		enyo.windows.addBannerMessage(msg, params);
	},
	showBookmarks: function() {
		this.$.radioGroup.setValue("bookmarks");
		this.$.drawerPane.selectViewByName("bookmarks");
	},
	showHistory: function() {
		this.$.radioGroup.setValue("history");
		this.$.drawerPane.selectViewByName("history");
	},
	showDownloads: function() {
		this.$.radioGroup.setValue("downloads");
		this.$.drawerPane.selectViewByName("downloads");
	},
	showPasswords: function() {
		this.$.radioGroup.setValue("passwords");
		this.$.drawerPane.selectViewByName("passwords");
	},
	// Open the passwords manager (toaster drawer) from the app menu. One per menu-open (double-fire guard).
	passwordsClick: function() {
		if (!this._menuArmed) { return; }
		this._menuArmed = false;
		this.$.toaster.open();
		this.showPasswords();
	},
	showAutofill: function() {
		this.$.radioGroup.setValue("autofill");
		this.$.drawerPane.selectViewByName("autofill");
	},
	// Open the autofill manager (toaster drawer) from the app menu. One per menu-open (double-fire guard).
	autofillClick: function() {
		if (!this._menuArmed) { return; }
		this._menuArmed = false;
		this.$.toaster.open();
		this.showAutofill();
	},
	// Edit an existing autofill entry (top-level dialog, kept outside the toaster).
	showEditAutofillDialog: function(inSender, inItem) {
		this.$.autofillEditDialog.setItem(inItem);
		this.$.autofillEditDialog.openAtCenter();
	},
	// Add a new autofill entry (blank item -> the dialog hides its Delete button).
	addAutofillEntry: function() {
		this.$.autofillEditDialog.setItem({});
		this.$.autofillEditDialog.openAtCenter();
	},
	closeToaster: function() {
		this.$.toaster.close();
	},
	backHandler: function(inSender, e) {
		var n = this.$.pane.getViewName();
		switch (n) {
			case "browser":
				this.$.browser.goBack();
				e.preventDefault();
				break;
			case "startPage":
				break;
			default:
				this.$.pane.back(e);
		}
	}
});
