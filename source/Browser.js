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

/* The card's WebView config lives in a factory rather than inline in components[] because
 * engine-restart recovery has to build a SECOND one. When BrowserServer dies, the existing plugin
 * instance is unrecoverable: the framework's connect() runs the adapter's init -> connect, but that
 * never re-establishes the link (measured on-device 2026-08-03 — 25 connect() attempts over 60s,
 * no onConnected). A FRESH plugin instance connects to the new engine immediately, so recovery
 * destroys the dead view and builds a new one from this. Keep it a function, not a shared object
 * literal: enyo mutates the config it is handed. See engineDisconnected(). */
function atlasWebViewConfig() {
	return {name: "view", kind: "WebView", flex: 1, height: "100%",
		onMousehold: "openContextMenu",
		onPageTitleChanged: "pageTitleChanged",
		onUrlRedirected: "doUrlRedirected",
		onLoadStarted: "loadStarted",
		onLoadProgress: "loadProgress",
		onLoadStopped: "loadStopped",
		onLoadComplete: "loadCompleted",
		onFileLoad: "doFileLoad",
		onError: "browserError",
		onSingleTap: "browserTap",
		onScrolledTo: "browserScrolled",
		onAlertDialog: "showAlertDialog",
		onConfirmDialog: "showConfirmDialog",
		onPromptDialog: "showPromptDialog",
		onSSLConfirmDialog: "showSSLConfirmDialog",
		onUserPasswordDialog: "showUserPasswordDialog",
		onNewPage: "openNewCardWithIdentifier",
		onPrint: "doPrint",
		onEditorFocusChanged: "editorFocusChanged",
		onConnected: "engineConnected",
		onDisconnected: "engineDisconnected",
		minFontSize: 2
	};
}

enyo.kind({
	name: "Browser",
	kind: enyo.VFlexBox,
	className: "basic-back",
	published: {
		url: "",
		searchPreferences: {},
		defaultSearch: "",
		offerTranslate: false,
		// MODE 2 (viewport/low-memory): when true, this card's loads are tagged with the internal
		// "atlas-simple:" marker so BS renders viewport-only (mult=1) instead of the tall pan buffer —
		// for non-scrolling cards (OAuth popups, app SPAs). Set from the launch param mode=simple.
		simpleMode: false
	},
	events: {
		onPageTitleChanged: "",
		onPageLoadStopped: "",
		onFileLoad: "",
		onDownloadLink: "",
		onAddBookmark: "",
		onDeleteBookmark: "",
		onAddToLauncher: "",
		onShareLink: "",
		onOpenBookmarks: "",
		onPrint: "",
		onUrlRedirected: "",
		// called when user picks "Reading Mode" on a link in the context menu
		onReaderLink: "",
		// called when user wants to leave the browser
		onClose: "",
		// user typed atlas:home in the address bar -> app switches to the start-page (bookmark grid) view
		onGoHome: "",
		// user tapped the address-bar translate icon -> app opens the page via Google Translate
		onTranslatePage: ""
	},
	components: [
		{kind: "Control", style: "position:absolute; bottom:0px; left:0px; height:8px; width:100%; background-color:none; z-index:120;"},
		{name: "launchApplicationService", kind: enyo.PalmService, service: enyo.palmServices.application, method: "open"},
		{name: "importWallpaperService", kind: enyo.PalmService, service: enyo.palmServices.system, method: "wallpaper/importWallpaper", onSuccess: "importedWallpaper", onFailure: "wallpaperError"},
		{name: "setWallpaperService", kind: enyo.PalmService, service: enyo.palmServices.system, method: "setPreferences", onFailure: "wallpaperError"},
		{name: "actionbar", kind: "ActionBar",
			onBack: "goBack",
			onForward: "goForward",
			onLoad: "goClick",
			onStopLoad: "stopClick",
			onRefresh: "reloadClick",
			onAddBookmark: "doAddBookmark",
			onDeleteBookmark: "doDeleteBookmark",
			onAddToLauncher: "doAddToLauncher",
			onShareLink: "doShareLink",
			onOpenBookmarks: "doOpenBookmarks",
			onNewCard: "openNewCard",
			onHistorySelected: "setHistoryUrl",
			onTranslate: "actionbarTranslate"
		},
		{name: "findDialog", kind: "FindBar", showing: false, onFind: "find", onGoToPrevious: "goToPrevious", onGoToNext: "goToNext"},
		atlasWebViewConfig(),
		{kind: "FindBar", showing: false, onFind: "find", onGoToPrevious: "goToPrevious", onGoToNext: "goToNext"},
		{name: "context", kind: "BrowserContextMenu", onItemClick: "contextItemClick"},
		{name: "dialog", kind: "VerticalAcceptCancelPopup", cancelCaption: "", components: [
			{name: "dialogTitle", className: "enyo-dialog-prompt-title"},
			{name: "dialogMessage", className: "browser-dialog-body enyo-text-body "}
		]},
		{name: "alertDialog", kind: "AcceptCancelPopup", cancelCaption: "", onResponse: "sendDialogResponse", components: [
			{name: "alertMessage", className: "browser-dialog-body enyo-text-body "}
		]},
		{name: "confirmDialog", kind: "VerticalAcceptCancelPopup", onResponse: "sendDialogResponse", components: [
			{name: "confirmMessage", className: "browser-dialog-body enyo-text-body "}
		]},
		{name: "promptDialog", kind: "AcceptCancelPopup", cancelCaption: "", onResponse: "promptResponse", onClose: "closePrompt", components: [
			{name: "promptMessage", className: "browser-dialog-body enyo-text-body "},
			{name: "promptInput", kind: "Input", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase"}
		]},
		{name: "shareLinkDialog", kind: "ShareLinkDialog"},
		{name: "loginDialog", kind: "AcceptCancelPopup", onResponse: "loginResponse", onClose: "closeLogin", components: [
			{name: "loginMessage", className: "browser-dialog-body enyo-text-body "},
			{name: "userInput", kind: "Input", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase", hint: $L("Username...")},
			{name: "passwordInput", kind: "PasswordInput", hint: $L("Password...")}
		]},
		{name: "sslDialog", kind: "Popup", onClose: "sslConfirmResponse", components: [
			{name: "sslConfirmMessage", className: "browser-dialog-body enyo-text-body "},
			{kind: enyo.HFlexBox, components: [
				{kind: "Button", name: "viewCertButton", flex: 1, caption: $L("View Certificate"), className: "enyo-button-dark", onclick: "viewSSLCertificate"},
				{kind: "Button", flex: 1, caption: $L("Trust Always"), response: "1", className: "enyo-button-dark", onclick: "closeSSLConfirmBox"},
				{kind: "Button", flex: 1, caption: $L("Trust Once"), response: "2", className: "enyo-button-dark", onclick: "closeSSLConfirmBox"},
				{kind: "Button", flex: 1, caption: $L("Don't Trust"), response: "0", className: "enyo-button-dark", onclick: "closeSSLConfirmBox"}
			]}
		]},
        {name: "sslCertDialog", kind: "CertificateDialog", onCertLoad: "enableViewSSLCertificate", onClose: "closeSSLCertificate"},
		// Per-site saved logins + autofill. One-shot fill on first login-field focus; a picker only when
		// the host has more than one saved login. (The old bottom-right toasters were replaced.)
		{name: "loginsService", kind: "DbService", dbKind: "org.webosports.logins:1", reCallWatches: true},
		{name: "loginPicker", kind: "LoginPicker", onPick: "loginPicked"},
		{name: "saveLoginDialog", kind: "VerticalAcceptCancelPopup", acceptCaption: $L("Save"), onResponse: "saveLoginResponse", components: [
			{name: "saveLoginMessage", className: "browser-dialog-body enyo-text-body "}
		]},
		// Web-content text selection (legacy-style): press a word -> engine selects it and reports the
		// start/end rects on the "selectionBounds" channel; we pin the two drag markers (arrows) at the
		// selection ends and a Copy popover above it. Copy ferries the selection back via copiedText ->
		// clipboard. Markers are position:fixed (reported coords are window/pageX,Y space).
		// 30x30 transparent hit area with the 18x15 arrow centered inside — a much bigger grab zone so the
		// drag lands on the marker instead of falling through to the page (which then scrolls).
		{name: "selStart", kind: "Control", showing: false,
			ondragstart: "selMarkerDragStart", ondrag: "selMarkerDrag", ondragfinish: "selMarkerDragFinish",
			style: "position:fixed; z-index:1000; width:30px; height:30px;", components: [
			{kind: "Image", src: "images/webkit/topmarker.png", style: "position:absolute; left:6px; top:15px; width:18px; height:15px;"}
		]},
		{name: "selEnd", kind: "Control", showing: false,
			ondragstart: "selMarkerDragStart", ondrag: "selMarkerDrag", ondragfinish: "selMarkerDragFinish",
			style: "position:fixed; z-index:1000; width:30px; height:30px;", components: [
			{kind: "Image", src: "images/webkit/bottommarker.png", style: "position:absolute; left:6px; top:0px; width:18px; height:15px;"}
		]},
		// One popover, buttons shown per context: non-editable selection = Copy|Select All; editable field
		// with no selection = Select|Select All|Paste; editable with a selection = Cut|Copy|Paste. Separators
		// come from a CSS border on every button except the first-visible (tagged atlas-select-first).
		{name: "selPopover", className: "atlas-select-popover", showing: false, style: "position:fixed; z-index:1001;", components: [
			{name: "cutBtn", className: "atlas-select-btn", content: $L("Cut"), onclick: "cutSelectionClick", showing: false},
			{name: "copyBtn", className: "atlas-select-btn", content: $L("Copy"), onclick: "copySelectionClick", showing: false},
			{name: "selectBtn", className: "atlas-select-btn", content: $L("Select"), onclick: "editSelectClick", showing: false},
			{name: "selectAllBtn", className: "atlas-select-btn", content: $L("Select All"), onclick: "selectAllSelectionClick", showing: false},
			{name: "pasteBtn", className: "atlas-select-btn", content: $L("Paste"), onclick: "pasteSelectionClick", showing: false}
		]}
    ],
		loginsKind: "org.webosports.logins:1",
        changedUrl: false,
	    isQuickRedirect: false,
	WebKitErrors: {
		ERR_SYS_FILE_DOESNT_EXIST: 14,
		ERR_WK_FLOADER_CANCELLED: 1000,
		ERR_WK_NOINTERNET:1005,
		ERR_CURL_FAILURE: 2000,
		ERR_CURL_COULDNT_RESOLVE_HOST: 2006,
		ERR_CURL_SSL_CACERT: 2060
	},
	create: function() {
		this.inherited(arguments);
		this.$.context.setView(this.$.view);
		this.urlChanged();
		this.searchPreferencesChanged();
		this.defaultSearchChanged();
		if (window.PalmSystem) {
			this.$.view.setIdentifier(enyo.windowParams.webviewId);
		}
	},
	destroy: function() {
		// Don't leave an engine-recovery retry ticking against a torn-down view (the card can be
		// swiped away mid-recovery).
		if (this._engineTimer) { clearTimeout(this._engineTimer); this._engineTimer = null; }
		this._engineDown = false;
		this.inherited(arguments);
	},
	resize: function() {
		this.$.actionbar.resize();
		this.$.view.resize();
	},
	showingChanged: function() {
		this.inherited(arguments);
		if (!this.showing) {
			this.$.actionbar.forceBlur();
		}
	},
	//* @public
	printFrame: function(inJobID, inPrintParams) {
		this.viewCall("printFrame", ["", inJobID, inPrintParams.width, inPrintParams.height, inPrintParams.pixelUnits, false, inPrintParams.renderInReverseOrder]);
	},
	showFind: function() {
		//this.$.findBar.show();
		this.findStr = null;
 		this.$.findDialog.show();
	},
	//* @protected
	find: function(inSender, inString) {
		this.log(inString);
	//this.$.view.callBrowserAdapter("findInPage", [inString]);
	if (this.findStr != inString) {
			/* Reset */
			this.$.view.findInPage("");
			this.findStr = inString;
		}
		this.$.view.findInPage(this.findStr);
	},
	goToPrevious: function() {
		this.$.view.findInPage(this.findStr, false);
	},
	goToNext: function() {
		this.$.view.findInPage(this.findStr, true);
	},
	setEnableJavascript: function(inEnable) {
		this.viewCall("setEnableJavascript", [inEnable]);
	},
	setBlockPopups: function(inBlock) {
		this.viewCall("setBlockPopups", [inBlock]);
	},
	setAcceptCookies: function(inAccept) {
		this.viewCall("setAcceptCookies", [inAccept]);
	},
	setAutoplayWithSound: function(inEnable) {
		this.viewCall("setAutoplayWithSound", [inEnable]);
	},
	clearHistory: function() {
		this.viewCall("clearHistory");
	},
	clearCookies: function() {
		new PalmServiceBridge().call('palm://com.palm.browserServer/clearCookies', '{}');
	},
	clearCache: function() {
		new PalmServiceBridge().call('palm://com.palm.browserServer/clearCache', '{}');
	},
	isLoading: function() {
		return this.$.actionbar.getProgress() != 0;
	},
	viewCall: function(inMethod, inArgs) {
		if (window.PalmSystem) {
			var v = this.$.view;
			if (v[inMethod]) {
				v[inMethod].apply(v, inArgs);
			} else {
				v.callBrowserAdapter(inMethod, inArgs);
			}
		}
	},
		setHistoryUrl: function() {
		var newUrl = this.$.actionbar.getHistoryUrl();
		this.url = newUrl;
		this.urlChanged();
 	},
	urlChanged: function() {
		this.log(this.url);
		// MODE 2: tag ONLY the load with the internal "atlas-simple:" marker (BS parses+strips it -> mult=1).
		// The address bar (actionbar.setUrl below) keeps the clean URL. Composes with the private marker
		// (atlas-private:atlas-simple:URL — private stays the outer prefix, matching BS's parse order).
		var loadUrl = this.url;
		if (this.simpleMode && loadUrl && loadUrl.indexOf("atlas-simple:") < 0 && loadUrl.indexOf("about:") !== 0) {
			if (loadUrl.indexOf("atlas-private:") === 0) {
				loadUrl = "atlas-private:atlas-simple:" + loadUrl.substring(14);
			} else {
				loadUrl = "atlas-simple:" + loadUrl;
			}
		}
		this.$.view.setUrl(loadUrl);
		this.$.actionbar.setLoading(true);
		// Show the resolving slice IMMEDIATELY. Between hitting go and the engine's first progress
		// report there is a real pause — the URL is still being completed and resolved (typing
		// "www.example.com" walks through http:// then https://), which on this hardware can take a
		// couple of seconds. setLoading alone only makes the bar VISIBLE; it sits at 0 and looks
		// stuck. Parking it at RESOLVE_PROGRESS says "something is happening" straight away.
		this._navigating = false;   // user asked for a new page: restart the bar even mid-load
		this.beginProgress();
		this.$.actionbar.setUrl(this.url);
	},
	//* Bottom slice of the progress bar, reserved for URL completion/resolution before the engine
	//* reports anything. Real load progress is scaled into the remainder (see loadProgress).
	RESOLVE_PROGRESS: 5,
	/**
	 * Start the progress bar for a NEW navigation, parked at the resolving slice.
	 *
	 * Guarded by _navigating because a single navigation fires loadStarted repeatedly - typing
	 * "example.com" redirects www -> http -> https, and each hop starts a load. Without the guard the
	 * bar slides backwards to 5% on every hop (observed: 5, 15, 5, 10, 15...). Only an actual new
	 * navigation restarts it; redirects keep climbing from where they were.
	 */
	beginProgress: function() {
		if (this._navigating) { return; }
		this._navigating = true;
		this._lastProgress = this.RESOLVE_PROGRESS;
		this.$.actionbar.setProgress(this.RESOLVE_PROGRESS);
	},
	searchPreferencesChanged: function() {
		this.$.actionbar.setSearchPreferences(this.searchPreferences);
	},
	defaultSearchChanged: function() {
		this.$.actionbar.setDefaultSearch(this.defaultSearch);
	},
	pageTitleChanged: function(inSender, inTitle, inUrl, inBack, inForward) {
		this.log(inUrl, inTitle, inBack, inForward);
		this.url = inUrl;
		this.title = inTitle || $L("Untitled");
		if (!this.$.dialog.isOpen) {
			this.$.actionbar.setUrl(this.url);
			this.$.actionbar.setTitle(this.title);
		}
		if (inTitle) { this.$.actionbar.updateCurrentTitle(inUrl, inTitle); }   // patch the history entry once the real title parses (fixes "Untitled"/mismatch)
		this.changedUrl = true;
		this.checkHostLogins(inUrl);
		this.doPageTitleChanged(this.title, this.url);
	},
	//* @protected
	// Derive a bare, lowercased host from a URL (used to key saved logins).
	hostFromUrl: function(inUrl) {
		var m = (inUrl || "").match(/^[a-z]+:\/\/([^\/:?#]+)/i);
		return m ? m[1].toLowerCase() : "";
	},
	// Autofill: when the page host changes, look up any saved logins for that host.
	checkHostLogins: function(inUrl) {
		var host = this.hostFromUrl(inUrl);
		this._loginFilled = false;   // allow one autofill per page load
		if (!host) {
			this._loginHost = null;
			this.hostLogins = [];
			return;
		}
		if (host === this._loginHost) {
			return; // already resolved logins for this host
		}
		this._loginHost = host;
		this.$.loginsService.call({query: {where: [{prop: "host", op: "=", val: host}]}},
			{method: "find", onSuccess: "gotHostLogins", onFailure: "loginsDbFailure"});
	},
	gotHostLogins: function(inSender, inResponse) {
		// Just remember them; don't fill until a login field is focused (form is reliably present then).
		this.hostLogins = (inResponse && inResponse.results) || [];
	},
	// Engine editor-focus signal (WebView.onEditorFocusChanged -> BrowserAdapter "editorFocused"): a field
	// gained focus. Autofill ONCE per page: single login -> fill both fields in one shot; multiple -> picker.
	editorFocusChanged: function(inSender, inFocused, inFieldType, inFieldActions) {
		if (!inFocused || this._loginFilled) { return; }
		if (!this.hostLogins || !this.hostLogins.length) { return; }
		this._loginFilled = true;
		if (this.hostLogins.length === 1) {
			this.fillLogin(this.hostLogins[0]);
		} else {
			this.$.loginPicker.setLogins(this.hostLogins);
			this.$.loginPicker.openAtCenter();
		}
	},
	// User picked a login from the multi-login picker.
	loginPicked: function(inSender, inLogin) {
		this.fillLogin(inLogin);
	},
	// One-shot fill: hand the engine "\x02user\x02pass" via the existing insertStringAtCursor command; the
	// engine fills BOTH the username + password fields in a single JS pass (no per-field tapping).
	fillLogin: function(inLogin) {
		if (!inLogin) { return; }
		this.$.view.insertStringAtCursor("\x02" + (inLogin.username || "") + "\x02" + (inLogin.password || ""));
	},
	loginsDbFailure: function(inSender, inResponse) {
		enyo.log("[Atlas] logins db error: " + (inResponse && (inResponse.errorText || inResponse.errorCode)));
		// A read failure shouldn't swallow the offer: if we were mid save-offer, still prompt the user.
		if (this.pendingSaveLogin) {
			var p = this.pendingSaveLogin, who = p.username || p.host;
			var msg = enyo.macroize($L("Save the password for {$user} on {$host}?"), {user: who, host: p.host});
			this.$.saveLoginDialog.validateComponents();
			this.$.saveLoginMessage.setContent(msg);
			this.showPopup(this.$.saveLoginDialog);
			enyo.log("[Atlas] loginsDbFailure: showed save-login popup anyway");
		}
	},
	gotHistoryState: function(inBack, inForward) {
		this.canGoBack = inBack;
		this.$.actionbar.setCanGoBack(inBack);
		this.$.actionbar.setCanGoForward(inForward);
	},
	goClick: function(inSender, inUrl) {
		// atlas:home / atlas:start -> jump back to the bookmark start-page view (handled by BrowserApp)
		var u = (inUrl || "").replace(/^\s+|\s+$/g, "").toLowerCase().replace(/\/+$/, "");
		if (u === "atlas:home" || u === "atlas://home" || u === "atlas:start" || u === "atlas://start") {
			this.doGoHome();
			return;
		}
		this.setUrl(inUrl);
	},
	browserTap: function(inSender, inPosition, inEvent, inTapInfo) {
		// a tap on the page dismisses an active text selection (markers + popover)
		if (this._selBounds) {
			this.viewCall("clearSelection", []);
			this.hideSelectionUI();
		}
	},
	// The markers/popover are position:fixed on screen, so once the page scrolls they'd go stale ->
	// auto-hide + clear the selection when a real scroll happens (a new long-press re-selects).
	browserScrolled: function(inSender, inX, inY) {
		this._lastScrollX = inX;
		this._lastScrollY = inY;
		// Don't clear while a marker is being dragged (the drag itself must not count as a scroll). Otherwise
		// auto-hide on a genuine scroll — but use a generous threshold so the flick's settle/recenter tail
		// (which posts a few late scroll updates just after selection) doesn't nuke a fresh selection.
		if (this._dragMarker === undefined || this._dragMarker === null) {
			// grace window after a fresh selection: the flick's settle/recenter posts a few late scroll
			// updates that would otherwise nuke the selection right after it appears ("yellow disappears").
			var sinceSel = (new Date()).getTime() - (this._selShownMs || 0);
			if (this._selBounds && sinceSel > 700 && Math.abs(inY - (this._selBaseScrollY || 0)) > 24) {
				this.viewCall("clearSelection", []);
				this.hideSelectionUI();
			}
		}
	},
	// Show/hide the address-bar Google Translate icon based on the "Offer to translate pages" preference.
	offerTranslateChanged: function() {
		if (this.$.actionbar) { this.$.actionbar.setShowTranslate(this.offerTranslate); }
	},
	// Address-bar translate icon tapped -> ask the app to open the current page via Google Translate.
	actionbarTranslate: function() {
		this.doTranslatePage(this.url || (this.$.view.getUrl ? this.$.view.getUrl() : ""));
	},
	showPopup: function(inPopup) {
		var w = enyo.fetchControlSize(this).w;
		inPopup.applyStyle("max-width", w - 100);
		inPopup.openPopup();
	},
	showAlertDialog: function(inSender, inMsg) {
		this.$.alertDialog.validateComponents();
		this.$.alertMessage.setContent(inMsg);
		this.showPopup(this.$.alertDialog);
	},
	showConfirmDialog: function(inSender, inMsg) {
		this.$.confirmDialog.validateComponents();
		this.$.confirmMessage.setContent(inMsg);
		this.showPopup(this.$.confirmDialog);
	},
	showPromptDialog: function(inSender, inMsg, inDefaultValue) {
		this.$.promptDialog.validateComponents();
		this.$.promptMessage.setContent(inMsg);
		this.$.promptInput.setValue("");
		this.$.promptInput.setHint(inDefaultValue);
		this.showPopup(this.$.promptDialog);
	},
    showShareLinkDialog: function(inUrl, inTitle) {
        this.$.shareLinkDialog.init(inUrl, inTitle);
        this.showPopup(this.$.shareLinkDialog);
    },
	promptResponse: function(inAccept) {
		this.sendDialogResponse(this, inAccept, this.$.promptInput.getValue() || this.$.promptInput.getHint());
	},
	closePrompt: function() {
		this.$.promptInput.forceBlur();
	},
	showSSLConfirmDialog: function(inSender, inHost, inErrorCode, inCertFile) {
		this.$.sslDialog.validateComponents();
		this.$.viewCertButton.setDisabled(true);
		this.$.sslCertDialog.setCertFile(inCertFile);
		var msg;
		if (inErrorCode == 0) {
			msg = $L("The security certificate #{websiteName} sent is expired. Connecting to this site might put your confidential information at risk.");
		} else if (inErrorCode >= 2 && inErrorCode < 5) {
			msg = $L("The website #{websiteName} didn't send a security certificate to identify itself. Connecting to this site might put your confidential information at risk.");
		} else if (inErrorCode >= 5 && inErrorCode < 10) {
			msg = $L("The security certificate #{websiteName} sent could not be read completely. Connecting to this site might put your confidential information at risk.");
		} else if (inErrorCode >= 10 && inErrorCode < 18) {
			msg = $L("The security certificate #{websiteName} sent has some invalid information. Connecting to this site might put your confidential information at risk.");
		} else if (inErrorCode >= 18 && inErrorCode < 24) {
			msg = $L("The security certificate #{websiteName} sent has questionable signatures. Connecting to this site might put your confidential information at risk.");
		} else if (inErrorCode >= 24 && inErrorCode < 30) {
			msg = $L("The security certificate #{websiteName} sent is invalid. Connecting to this site might put your confidential information at risk.");
		} else if (inErrorCode == 30 || inErrorCode == 31 || inErrorCode == 50) {
			msg = $L("The security certificate #{websiteName} sent has inconsistent information in it. Connecting to this site might put your confidential information at risk.");
		}
		if (msg) {
			var m = msg.replace("#{websiteName}", inHost);
			this.$.sslConfirmMessage.setContent(m);
		}
		this.$.sslDialog.response = "0";
		this.$.sslDialog.openAtCenter();
	},
	closeSSLConfirmBox: function(inSender) {
		this.$.sslDialog.response = inSender.response;
		this.$.sslDialog.close();
	},
	sslConfirmResponse: function(inSender) {
		this.viewCall("sendDialogResponse", [inSender.response]);
	},
	enableViewSSLCertificate: function() {
		this.$.viewCertButton.setDisabled(false);
	},
	viewSSLCertificate: function(inSender) {
		this.$.sslCertDialog.validateComponents();
		this.$.sslCertDialog.openAtCenter();
	},
	closeSSLCertificate: function(inSender) {
		this.$.sslCertDialog.close();
	},
	showUserPasswordDialog: function(inSender, inMsg) {
		this.$.loginDialog.validateComponents();
		var msg = $L("The server {$serverName} requires a username and password");
		msg = enyo.macroize(msg, {serverName: inMsg});
		this.$.loginMessage.setContent(msg);
		this.showPopup(this.$.loginDialog);
	},
	loginResponse: function(inSender, inAccept) {
		var user = this.$.userInput.getValue();
		var pass = this.$.passwordInput.getValue();
		this.sendDialogResponse(this, inAccept, user, pass);
		// After a successful HTTP/proxy-auth login, offer to remember it for this host.
		if (inAccept && user && pass) {
			this.offerSaveLogin(user, pass);
		}
	},
	// Offer to save a submitted credential. Skips the prompt if the same host+username is
	// already stored so the user isn't nagged on every visit.
	// Engine-side hook: a web login form was submitted (host supplied by the engine).
	engineSaveLogin: function(inHost, inUser, inPass) {
		enyo.log("[Atlas] engineSaveLogin host=" + inHost + " user='" + inUser + "' hasPass=" + (inPass ? 1 : 0));
		if (!inPass) {
			return;
		}
		this.offerSaveLogin(inUser, inPass, inHost);
	},
	// Engine-side hook: web-content selection was copied -> place on the system clipboard.
	engineCopiedText: function(inText) {
		if (!inText) {
			return;
		}
		this._lastClipboard = inText;   // remembered for in-browser Paste (the system-clipboard read is blocked)
		enyo.dom.setClipboard(inText);
		var params = enyo.json.stringify({dontLaunch: true});
		enyo.windows.addBannerMessage($L("Copied to clipboard"), params);
	},
	offerSaveLogin: function(inUser, inPass, inHost) {
		var url = this.url || "";
		var host = inHost || this.hostFromUrl(url);
		if (!host) {
			return;
		}
		this.pendingSaveLogin = {host: host, url: url, username: inUser, password: inPass, title: this.title || host};
		enyo.log("[Atlas] offerSaveLogin host=" + host + " user='" + inUser + "' -> find");
		this.$.loginsService.call({query: {where: [{prop: "host", op: "=", val: host}]}},
			{method: "find", onSuccess: "checkOfferSave", onFailure: "loginsDbFailure"});
	},
	checkOfferSave: function(inSender, inResponse) {
		var p = this.pendingSaveLogin;
		if (!p) {
			enyo.log("[Atlas] checkOfferSave: no pendingSaveLogin");
			return;
		}
		var results = (inResponse && inResponse.results) || [];
		enyo.log("[Atlas] checkOfferSave host=" + p.host + " user='" + p.username + "' existing=" + results.length);
		// Skip the prompt only if the SAME non-empty username+password is already stored (don't nag).
		// An empty username never counts as a match; a changed password should re-prompt.
		for (var i = 0; i < results.length; i++) {
			if (p.username && results[i].username === p.username && results[i].password === p.password) {
				enyo.log("[Atlas] checkOfferSave: already stored, skipping prompt");
				this.pendingSaveLogin = null; // already saved for this host+username
				return;
			}
		}
		var who = p.username || p.host;
		var msg = enyo.macroize($L("Save the password for {$user} on {$host}?"), {user: who, host: p.host});
		this.$.saveLoginDialog.validateComponents();
		this.$.saveLoginMessage.setContent(msg);
		this.showPopup(this.$.saveLoginDialog);
		enyo.log("[Atlas] checkOfferSave: showed save-login popup");
	},
	saveLoginResponse: function(inSender, inAccept) {
		var p = this.pendingSaveLogin;
		this.pendingSaveLogin = null;
		if (inAccept && p) {
			p._kind = this.loginsKind;
			p.date = (new Date()).getTime();
			this.$.loginsService.call({objects: [p]}, {method: "put", onSuccess: "savedLogin", onFailure: "loginsDbFailure"});
		}
	},
	savedLogin: function() {
		// Force the next host check to re-query so the new login shows up for autofill.
		this._loginHost = null;
		var params = enyo.json.stringify({dontLaunch: true});
		enyo.windows.addBannerMessage($L("Password saved"), params);
	},
	sendDialogResponse: function(inSender, inAccepted) {
		this.log(inAccepted);
		if (inAccepted) {
			this.viewCall("acceptDialog", [].slice.call(arguments, 2));
		} else {
			this.viewCall("cancelDialog");
		}
	},
	closeLogin: function() {
		this.$.userInput.forceBlur();
		this.$.passwordInput.forceBlur();
	},
	openContextMenu: function(inSender, inEvent, inTapInfo) {
		// inTapInfo is the engine hit-test at the long-press point
		// (isLink/linkUrl, isImage/imageUrl, editable). If the engine hit-test
		// isn't wired yet it may be null/isNull; fall back to page-level actions.
		// On the bookmark start page (atlas:home/start) long-press belongs to the grid's drag-to-reorder —
		// don't hijack it with a text-selection/edit menu.
		if (this.url && /^atlas:(\/\/)?(home|start)\b/i.test(this.url)) { return; }
		var info = inTapInfo || {};
		// Long-press in an editable field: show the edit menu (Select | Select All | Paste) at the point.
		if (info.editable) {
			this._selEditable = true;
			this._editPressPt = {left: inEvent.pageX, top: inEvent.pageY};
			this.showEditMenu(inEvent.pageX, inEvent.pageY);
			return true;
		}
		this._selEditable = false;
		// Plain text (no link/image): select the word directly — legacy-style, no "Select Text" menu step.
		if (!info.isLink && !info.isImage) {
			this._selAnchor = {left: inEvent.pageX, top: inEvent.pageY};
			this.viewCall("enableSelectionMode", [inEvent.pageX, inEvent.pageY]);
			return true;
		}
		this.$.context.openAtTap(inEvent, info);
		return true;
	},
	contextItemClick: function(inSender, inValue, inTapInfo, inPosition) {
		if (this[inValue]) {
			this[inValue](inTapInfo, inPosition);
		}
	},
	// --- web-content text selection (legacy-style markers + Copy popover) ---
	selectTextClick: function(inTapInfo, inPosition) {
		if (!inPosition) {
			return;
		}
		// engine selects the word at the point, paints the native highlight, and reports the selection
		// rects back on "selectionBounds" (-> engineSelectionBounds) which pins the markers + popover.
		this.viewCall("enableSelectionMode", [inPosition.left, inPosition.top]);
	},
	// Engine-side hook: selection changed -> {sx,sy,sh,ex,ey,len} in window/pageX,Y coords. Pin the two
	// drag markers at the ends and the Copy popover above the start.
	engineSelectionBounds: function(inData) {
		var b;
		try { b = enyo.json.parse(inData); } catch (e) { return; }
		if (!b || !b.len) {
			// while the "Select | Select All | Paste" edit menu is up, an empty report (e.g. from focusing
			// the field) must NOT dismiss it — it's dismissed by a button, a scroll, or a new long-press.
			if (this._editMenuUp) { return; }
			this.hideSelectionUI(); return;
		}
		this._editMenuUp = false;   // a real selection supersedes the edit-empty menu
		this._selBounds = b;
		this._selBaseScrollY = this._lastScrollY || 0;   // scroll pos at selection time (auto-hide on scroll)
		// The engine now reports rects in VISIBLE-viewport space (it already folded the pan-model scroll math:
		// m_renderedY on the way in, m_renderedY - m_scrollY on the way out). So the app only has to add the
		// WebView's on-screen offset (top ~= address-bar height, left ~= 0) to hit real-screen coords. The
		// overlay nodes are reparented to document.body first because enyo Panes carry a -webkit-transform
		// that would otherwise make position:fixed relative to the pane instead of the viewport.
		this._reparentSelectionUI();
		var vr = this.$.view.hasNode() ? this.$.view.node.getBoundingClientRect() : {top: 0, left: 0};
		var ox = Math.round(vr.left), oy = Math.round(vr.top);
		// 30x30 hit box; the arrow inside is offset so its tip sits at the selection end. selStart arrow tip
		// = box (15,30) so box goes at (sx-15, sy-30); selEnd arrow tip = box (15,0) so box at (ex-15, ey).
		// Form inputs have no per-character rects, so no drag markers there — just the popover. Page/
		// contenteditable selections get the draggable start/end arrows.
		if (b.ed) {
			this.$.selStart.setShowing(false);
			this.$.selEnd.setShowing(false);
		} else {
			this.$.selStart.applyStyle("left", (b.sx - 15 + ox) + "px");
			this.$.selStart.applyStyle("top", (b.sy - 30 + oy) + "px");
			this.$.selStart.setShowing(true);
			this.$.selEnd.applyStyle("left", (b.ex - 15 + ox) + "px");
			this.$.selEnd.applyStyle("top", (b.ey + oy) + "px");
			this.$.selEnd.setShowing(true);
		}
		// Copy bubble centered above the selection (clamp on-screen). Single-line selection uses the
		// midpoint of start/end; multi-line falls back to above the start.
		var midX = (b.ey - b.sy < b.sh + 4) ? Math.round((b.sx + b.ex) / 2) : b.sx;
		// sit the bubble above the selection AND above the top marker (which occupies sy-15..sy) so they
		// don't overlap; its tail then points down toward the marker/selection.
		this.$.selPopover.applyStyle("top", Math.max(4, b.sy - 60 + oy) + "px");
		// selection in an editable field -> Cut|Copy|Paste; otherwise Copy|Select All
		this.setPopoverMode(this._selEditable ? "edit-sel" : "copy");
		this.$.selPopover.setShowing(true);
		// center by the popover's real width (varies with which buttons are shown)
		var pw = this.$.selPopover.hasNode() ? this.$.selPopover.node.offsetWidth : 150;
		this.$.selPopover.applyStyle("left", Math.max(4, midX - Math.round(pw / 2) + ox) + "px");
	},
	// Show/hide the popover buttons for the given context and tag the first visible one (for the CSS
	// separators). mode: "copy" (Copy|Select All), "edit-sel" (Cut|Copy|Paste), "edit-empty" (Select|Select All|Paste).
	setPopoverMode: function(mode) {
		var vis = {cutBtn: false, copyBtn: false, selectBtn: false, selectAllBtn: false, pasteBtn: false};
		if (mode === "edit-sel") { vis.cutBtn = vis.copyBtn = vis.pasteBtn = true; }
		else if (mode === "edit-empty") { vis.selectBtn = vis.selectAllBtn = vis.pasteBtn = true; }
		else { vis.copyBtn = vis.selectAllBtn = true; }
		var order = ["cutBtn", "copyBtn", "selectBtn", "selectAllBtn", "pasteBtn"], visList = [];
		for (var i = 0; i < order.length; i++) {
			var btn = this.$[order[i]];
			btn.setShowing(vis[order[i]]);
			btn.removeClass("atlas-select-first"); btn.removeClass("atlas-select-last");
			if (vis[order[i]]) { visList.push(btn); }
		}
		if (visList.length) { visList[0].addClass("atlas-select-first"); visList[visList.length - 1].addClass("atlas-select-last"); }
	},
	// Editable long-press with no selection: Select | Select All | Paste, at the press point.
	showEditMenu: function(x, y) {
		this._editMenuUp = true;   // stays up through the focus {len:0}; dismissed by a button, a scroll, or a new long-press
		this._reparentSelectionUI();
		var vr = this.$.view.hasNode() ? this.$.view.node.getBoundingClientRect() : {top: 0, left: 0};
		this.setPopoverMode("edit-empty");
		this.$.selPopover.applyStyle("top", Math.max(4, y) + "px");
		this.$.selPopover.setShowing(true);
		var pw = this.$.selPopover.hasNode() ? this.$.selPopover.node.offsetWidth : 200;
		this.$.selPopover.applyStyle("left", Math.max(4, Math.round(x - pw / 2)) + "px");
	},
	// "Select" in the edit menu -> select the current word at the press point.
	editSelectClick: function() {
		if (this._editPressPt) { this.viewCall("enableSelectionMode", [this._editPressPt.left, this._editPressPt.top]); }
		return true;
	},
	// Paste into the focused field. Reads the SYSTEM clipboard via the platform's PalmSystem.paste()
	// (enyo.dom.getClipboard) — this is the cross-app path: text copied in Notes/anywhere is readable,
	// as is our own in-browser Copy (which writes the system clipboard via execCommand cut). The read is
	// async (paste settles a tick later), so the insert happens in the callback. Falls back to the last
	// in-browser copy, then the engine's own Paste command.
	pasteSelectionClick: function() {
		// Guard against a double-fire (a stray second onclick would paste the text twice).
		var now = (new Date()).getTime();
		if (this._lastPasteMs && (now - this._lastPasteMs) < 700) { return true; }   // ignore a stray double-fire
		this._lastPasteMs = now;
		this.hideSelectionUI();
		var self = this;
		var doInsert = function(text) {
			var txt = text || self._lastClipboard || "";
			if (txt) { self.viewCall("insertStringAtCursor", [txt]); }
			else { self.viewCall("paste", []); }
		};
		if (window.PalmSystem && enyo.dom && typeof enyo.dom.getClipboard === "function") {
			enyo.dom.getClipboard(function(text) { doInsert(text); });
		} else {
			doInsert("");
		}
		return true;
	},
	// Cut = copy the selection, then delete it (insert empty over it).
	cutSelectionClick: function() {
		this.viewCall("copy", []);
		this.viewCall("insertStringAtCursor", [""]);
		this.hideSelectionUI();
		return true;
	},
	_reparentSelectionUI: function() {
		if (this._selReparented) { return; }
		var ctrls = [this.$.selStart, this.$.selEnd, this.$.selPopover];
		for (var i = 0; i < ctrls.length; i++) {
			var n = ctrls[i] && ctrls[i].hasNode();
			if (n && n.parentNode !== document.body) { document.body.appendChild(n); }
		}
		this._selReparented = true;
	},
	hideSelectionUI: function() {
		this._selBounds = null;
		this._editMenuUp = false;
		if (this.$.selStart) { this.$.selStart.setShowing(false); }
		if (this.$.selEnd) { this.$.selEnd.setShowing(false); }
		if (this.$.selPopover) { this.$.selPopover.setShowing(false); }
	},
	// --- drag the start/end markers to grow/shrink the selection ---
	// selEnd drags the FOCUS end (whichEnd=1, anchor stays at the start); selStart drags the start
	// (whichEnd=0, anchor stays at the end). The engine extends the selection and re-reports its bounds on
	// "selectionBounds" -> engineSelectionBounds repositions the markers + popover to follow the drag.
	selMarkerDragStart: function(inSender, inEvent) {
		if (!this._selBounds) { return true; }
		this._dragMarker = (inSender.name === "selEnd") ? 1 : 0;
		this._dragLastMs = 0;
		this.$.selPopover.setShowing(false);   // hide the Copy bubble while dragging
		return true;   // claim the gesture so it doesn't scroll the page
	},
	selMarkerDrag: function(inSender, inEvent) {
		if (this._dragMarker === undefined || this._dragMarker === null) { return true; }
		// throttle: the drag fires rapidly and each call runs JS in the engine
		var now = (new Date()).getTime();
		if (this._dragLastMs && (now - this._dragLastMs) < 40) { return true; }
		this._dragLastMs = now;
		// convert window coords -> "page space minus header" (content-relative); the adapter adds the scroll
		var vr = this.$.view.hasNode() ? this.$.view.node.getBoundingClientRect() : {top: 0, left: 0};
		var cx = Math.round(inEvent.pageX - vr.left);
		var cy = Math.round(inEvent.pageY - vr.top);
		this.viewCall("extendSelectionTo", [this._dragMarker, cx, cy]);
		return true;
	},
	selMarkerDragFinish: function(inSender, inEvent) {
		this._dragMarker = null;
		this.viewCall("setDragMode", [false]);   // re-enable normal scrolling
		// re-show the Copy bubble now the drag is done (engineSelectionBounds will place it on the next report)
		if (this._selBounds) { this.$.selPopover.setShowing(true); }
		return true;
	},
	copySelectionClick: function() {
		// engine runs Copy + ferries the selection text back via copiedText -> engineCopiedText (clipboard).
		this.viewCall("copy", []);
		this.hideSelectionUI();
		this.viewCall("clearSelection", []);
		return true;
	},
	selectAllSelectionClick: function() {
		this.viewCall("selectAll", []);
		return true;
	},
	// UNUSED/TODO(audit A2-6): no caller or enyo handler-wiring found — revisit in detail before deleting.
	doneSelectionClick: function() {
		this.viewCall("clearSelection", []);
		this.viewCall("disableSelectionMode", []);
		this.hideSelectionUI();
		return true;
	},
	// --- web-content drag ---
	startDragModeClick: function(inTapInfo, inPosition) {
		// Arm drag mode: the next touch-and-drag drives the in-page element (slider/canvas/DnD) instead
		// of scrolling; the adapter auto-clears it on release. Hint the user since it's a one-shot mode.
		this.viewCall("setDragMode", [true]);
		var params = enyo.json.stringify({dontLaunch: true});
		enyo.windows.addBannerMessage($L("Drag mode: touch and drag the item"), params);
	},
	newCardClick: function(inTapInfo) {
		window.atlasOpenCard({url: inTapInfo.linkUrl});
	},
	openNewCard: function() {
		window.atlasOpenCard({});
	},
	// --- page-level context menu actions (long-press on plain page/text, or when
	// the engine hit-test is unavailable). These operate on the current page. ---
	pageNewCardClick: function() {
		this.openNewCard();
	},
	pageCopyLinkClick: function() {
		if (!this.url) {
			return;
		}
		enyo.dom.setClipboard(this.url);
		var params = enyo.json.stringify({dontLaunch:true});
		enyo.windows.addBannerMessage($L("Link Copied to clipboard"), params);
	},
	pageShareClick: function() {
		this.shareLink(this.url, this.title || this.url);
	},
	pageReaderClick: function() {
		this.doReaderLink(this.url, this.title || this.url);
	},
	openNewCardWithIdentifier: function(inSender, inIdentifier) {
		window.atlasOpenCard({webviewId: inIdentifier});
	},
	copyLinkClick: function(inTapInfo) {
		enyo.dom.setClipboard(inTapInfo.linkUrl);
		var params = enyo.json.stringify({dontLaunch:true});
		enyo.windows.addBannerMessage($L("Link Copied to clipboard"), params);
	},
    //handler for the context menu shareLinkClick in BrowserContextMenu.js.
    //TODO: refactor these for a clearer abstraction. So you don't have to hunt
    //to see where it is being called.
	shareLinkClick: function(inTapInfo) {
		this.shareLink(inTapInfo.linkUrl, inTapInfo.linkText || inTapInfo.linkUrl);
	},
	shareLink: function(inUrl, inTitle) {
        this.showShareLinkDialog(inUrl, inTitle);
	},
    downloadlinkClick: function(inTapInfo) {
        this.doDownloadLink(inTapInfo.linkUrl);
    },
	readerLinkClick: function(inTapInfo) {
		this.doReaderLink(inTapInfo.linkUrl, inTapInfo.linkText || inTapInfo.linkUrl);
	},
	copyToPhotosClick: function(inTapInfo, inPosition) {
		this.viewCall("saveImageAtPoint", [inPosition.left, inPosition.top, "/media/internal",
			enyo.hitch(this, "finishCopyToPhotos", inTapInfo)]);
	},
	shareImageClick: function(inTapInfo, inPosition) {
		this.viewCall("saveImageAtPoint", [inPosition.left, inPosition.top, "/tmp",
			enyo.hitch(this, "finishShareImage", inTapInfo)]);
	},
	setWallpaperClick: function(inTapInfo, inPosition) {
		this.viewCall("saveImageAtPoint", [inPosition.left, inPosition.top, "/media/internal",
			enyo.hitch(this, "finishSetWallpaper", inTapInfo)]);
	},
	copyImageUrlClick: function(inTapInfo) {
		if (!inTapInfo || !inTapInfo.imageUrl) {
			return;
		}
		enyo.dom.setClipboard(inTapInfo.imageUrl);
		var params = enyo.json.stringify({dontLaunch:true});
		enyo.windows.addBannerMessage($L("Image URL Copied to clipboard"), params);
	},
	openDialog: function(inTitle, inMessage) {
		this.$.dialog.validateComponents();
		this.$.dialogTitle.setContent(inTitle);
		this.$.dialogMessage.setContent(inMessage);
		this.$.dialog.openPopup();
	},
	finishCopyToPhotos: function(inTapInfo, inSuccess, inPath) {
		var params = enyo.json.stringify({dontLaunch:true});
		if (inSuccess) {
			enyo.windows.addBannerMessage($L("Image Saved to Photos"),params);
		} else {
			enyo.windows.addBannerMessage($L("Error Saving Image"),params);
		}
	},
	finishShareImage: function(inTapInfo, inSuccess, inPath) {
		if (inSuccess) {
			var url = inTapInfo.imageUrl;
			var defaultTitle = url.indexOf("data:") >= 0 ? $L("Picture Link") : $L("Picture at ") + url;
			var title = inTapInfo.title || inTapInfo.altText || defaultTitle;
			var msg = $L("Here's a picture I think you'll like: <a href='{$src}'>{$title}</a>");
			msg = enyo.macroize(msg, {src: url, title: title});
			var s = url.lastIndexOf("/") + 1;
			var params = {
				summary: $L("Check out this picture..."),
				text: msg,
				attachments: [{name: url.substring(s), path: inPath}]
			};
			this.$.launchApplicationService.call({id: "com.palm.app.email", params: params});
		} else {
			var p = enyo.json.stringify({dontLaunch:true});
			enyo.windows.addBannerMessage($L("Error Sharing Image"),p);
		}
	},
	finishSetWallpaper: function(inTapInfo, inSuccess, inPath) {
		if (inSuccess) {
			this.$.importWallpaperService.call({target: inPath, scale: 1.0});
		} else {
			var p = enyo.json.stringify({dontLaunch:true});
			enyo.windows.addBannerMessage($L("Error Setting Wallpaper"),p);
		}
	},
	importedWallpaper: function(inSender, inResponse) {
		this.$.setWallpaperService.call({wallpaper: inResponse.wallpaper});
	},
	wallpaperError: function(inSender, inResponse) {
		this.openDialog($L("Error"), $L("Failed to set wallpaper"));
	},
	goBack: function() {
		// Leaving fullscreen is what Back means while a video is fullscreen — navigating away from the
		// page instead is the wrong thing and loses the user's place. Chromium host only; the method
		// does not exist on the WPE WebView.
		if (this.$.view.exitFullscreenIfActive && this.$.view.exitFullscreenIfActive()) {
			return;
		}
		if (this.canGoBack) {
			this.$.actionbar.goBack(0);
		} else {
			this.doClose();
		}
	},
	goForward: function() {
		this.$.actionbar.goForward(0);
	},
	reloadClick: function() {
	if(this.isErrorLoadFailed === true) {
		this.isErrorLoadFailed = false;
		this.setUrl(this.failedLoadUrl);
	}
	else
		this.$.view.callBrowserAdapter("reloadPage");
		//this.$.view.setZoom(this.$.view.getZoom() + 0.1);
	},
	stopClick: function() {
		this.log();
		this.$.view.callBrowserAdapter("stopLoad");
		this._navigating = false;
		this.$.actionbar.setProgress(0);
	},
	loadStarted: function() {
	   this.hideSelectionUI();
	   if (this._timeoutHandle != null) {
		   clearTimeout(this._timeoutHandle);
		   this._timeoutHandle = null;
	   }
	   this.isErrorLoadFailed = false;
	   this.$.actionbar.setLoading(true);
	   // Covers loads we did not start ourselves (tapping a link). No-op for the redirect hops of a
	   // navigation already in flight, so the bar never slides backwards.
	   this.beginProgress();
	},
	loadProgress: function(inSender, inProgress) {
		// Scale the engine's 0-100 into the slice above RESOLVE_PROGRESS, so the bar continues from
		// where the resolving slice left it instead of snapping backwards to a low real percentage.
		// Thresholds below stay on the RAW value — they are about load state, not bar position.
		var scaled = this.RESOLVE_PROGRESS +
			Math.round(inProgress * (100 - this.RESOLVE_PROGRESS) / 100);
		if (this._lastProgress < scaled) {
			this.$.actionbar.setProgress(scaled);
			this._lastProgress = scaled;

			if (inProgress === 100) {
				this._timeoutHandle = setTimeout(enyo.hitch(this, "clearProgress"), 1000);
			}
			if (this.changedUrl && inProgress > 10) {
				if (!this.isQuickRedirect && this.url !== this.$.actionbar.getCurrentPage().url) {
					this.$.actionbar.setCurrentPage({title: this.title, url: this.url});
				}
				if (this.isQuickRedirect) this.isQuickRedirect = false;
				this.changedUrl = false;
				this.gotHistoryState(this.$.actionbar.getCanGoBack(), this.$.actionbar.getCanGoForward());
			}
		}
	},
	loadStopped: function() {
		this.doPageLoadStopped(this.url);
	},
	loadCompleted: function() {
		// empty
		if (this._lastProgress <= 50) this.isQuickRedirect = true;
	},
	clearProgress: function() {
		this._navigating = false;   // next loadStarted is a genuinely new navigation
		this.$.actionbar.setProgress(0);
		this.$.actionbar.setLoading(false);
		this._timeoutHandle = null;
	},
	/* ---- Engine-restart recovery -------------------------------------------------------------
	 * The GPU wedge (atlas-wpe-env#3) parks BrowserServer's main thread in a futex wait. BS's own
	 * deadlock watchdog eventually aborts it and upstart respawns a fresh engine — but the CARD
	 * does not come back on its own: the adapter's yap socket died with the old BS and nothing
	 * re-establishes it, so the card sits dead (verified on-device 2026-08-03: a relaunch into a
	 * stale card spawns no WebProcess and logs nothing) until the user closes and reopens it.
	 *
	 * Recovery RELOADS THE CARD'S DOCUMENT. Nothing short of that works — measured on-device
	 * 2026-08-03, against a real engine restart:
	 *   - view.connect() (the framework's reconnect path): 25 attempts over 60s, no onConnected.
	 *   - destroying the WebView and building a fresh one in the same document: same, 18 attempts.
	 *   - a brand-new CARD: connects and renders immediately.
	 * So the plugin binding is per-document and cannot be re-established in place. Replacing the
	 * card was the other candidate, but a WPE-hosted card cannot close itself (see the OAuth
	 * self-dismiss note in BrowserApp.checkOAuthRedirect), so that would strand a dead card next to
	 * the new one. Reloading keeps the card, its position in the stack, and its identity.
	 *
	 * The reload is delayed because a respawn takes ~12s (the boot wrapper waits for LunaSysMgr,
	 * sleeps 3s, then the engine initialises); reloading sooner just lands in a still-dead engine.
	 * Jittered so that several open cards recovering at once don't reload in lockstep.
	 */
	//* atlas-sensord's loopback control socket (it is root; this card is not). Used ONLY by the
	//* Restart Browser Engine menu item — Atlas does not try to detect a hang by itself.
	ENGINE_CTL_URL: "http://127.0.0.1:8442/restart-engine",
	//* Fire-and-forget: the response does not matter, and the engine is going down either way.
	requestEngineRestart: function() {
		try {
			var x = new XMLHttpRequest();
			x.open("GET", this.ENGINE_CTL_URL + "?t=" + (new Date()).getTime(), true);
			x.send(null);
		} catch (e) { this.log("[Atlas] engine restart request failed: " + e); }
	},
	ENGINE_RECOVER_MS: 15000,
	//* window.name survives a document reload (localStorage would be shared by every card), so it
	//* carries both the page to restore and the "we already tried" stamp that stops a reload loop.
	ENGINE_STAMP_PREFIX: "atlas-engine-recover:",
	ENGINE_STAMP_FRESH_MS: 120000,   // how long a stashed URL is still worth restoring
	ENGINE_STAMP_GUARD_MS: 90000,    // reloading again inside this window means it did not work
	engineDisconnected: function() {
		if (this._engineDown) { return; }   // the adapter can report the drop more than once
		this._engineDown = true;
		this.log("[Atlas] engine disconnected — card reload scheduled");
		this.engineBanner($L("Atlas hung - restarting..."));
		// The dead load will never finish; stop pretending it might.
		this._navigating = false;
		this.$.actionbar.setProgress(0);
		this.$.actionbar.setLoading(false);
		var delay = this.ENGINE_RECOVER_MS + Math.floor(Math.random() * 3000);
		this._engineTimer = setTimeout(enyo.hitch(this, "engineRecover"), delay);
	},
	engineRecover: function() {
		this._engineTimer = null;
		if (!this._engineDown) { return; }   // engine came back on its own (see engineConnected)

		// Already reloaded once for this outage? Then reloading again will not help either — the
		// engine is down for a reason we cannot fix from here. Say so instead of looping forever.
		var stamp = this.engineStamp();
		var now = (new Date()).getTime();
		if (stamp && (now - stamp.at) < this.ENGINE_STAMP_GUARD_MS) {
			this.log("[Atlas] engine still down after a reload — giving up");
			this._engineDown = false;
			this.engineBanner($L("Close and re-open Atlas. Engine died."));
			return;
		}

		this.log("[Atlas] engine recovery: reloading card for " + (this.url || "(no url)"));
		try {
			window.name = this.ENGINE_STAMP_PREFIX + now + ":" + (this.url || "");
		} catch (e) {}
		window.location.reload();
	},
	//* Parse the recovery stamp left in window.name by engineRecover; null when absent/malformed.
	engineStamp: function() {
		var n = "";
		try { n = window.name || ""; } catch (e) { return null; }
		if (n.indexOf(this.ENGINE_STAMP_PREFIX) !== 0) { return null; }
		var rest = n.substring(this.ENGINE_STAMP_PREFIX.length);
		var sep = rest.indexOf(":");
		if (sep < 0) { return null; }
		var at = parseInt(rest.substring(0, sep), 10);
		if (!at) { return null; }
		return {at: at, url: rest.substring(sep + 1)};
	},
	engineConnected: function() {
		if (!this._engineDown) { return; }   // ordinary first connect when the card is created
		// The engine came back before our reload fired (a fast respawn, or it never really went).
		this._engineDown = false;
		if (this._engineTimer) { clearTimeout(this._engineTimer); this._engineTimer = null; }
		this.log("[Atlas] engine reconnected without a reload — reloading page");
		this.engineBanner($L("Atlas restarted - reloading..."));
		// The new engine holds no page for this card, so load it again. Clear the view's cached url
		// first: setUrl to the value it already holds is a no-op, which would skip the reload.
		if (this.url) {
			this.$.view.url = "";
			this.urlChanged();
		}
	},
	/* One banner per event, not one per open card: every card's adapter reports the same drop, and
	 * three stacked "engine restarting" banners is noise. Dedupe on the shared root window (the same
	 * cross-card state trick AtlasEngineOverride uses for the open-card debounce). */
	engineBanner: function(inMessage) {
		var now = (new Date()).getTime();
		var store = null;
		try { store = enyo.windows.getRootWindow(); } catch (e) {}
		if (store) {
			if (store.__atlasEngineBannerAt && (now - store.__atlasEngineBannerAt) < 4000 &&
				store.__atlasEngineBannerMsg === inMessage) {
				return;
			}
			store.__atlasEngineBannerAt = now;
			store.__atlasEngineBannerMsg = inMessage;
		}
		enyo.windows.addBannerMessage(inMessage, enyo.json.stringify({dontLaunch: true}));
	},
	browserError: function(inSender, inErrorCode, inMsg) {
		
		switch(inErrorCode){
			case this.WebKitErrors.ERR_SYS_FILE_DOESNT_EXIST:
				this.openDialog($L("Error"), $L('File does not exist.'));
				break;
			case this.WebKitErrors.ERR_CURL_COULDNT_RESOLVE_HOST:
				this.isErrorLoadFailed = true;
				this.failedLoadUrl = this.url;
				this.openDialog($L("Error"), $L('Unable to resolve host.'));
				break;
			case this.WebKitErrors.ERR_WK_NOINTERNET:
				this.isErrorLoadFailed = true;
				this.failedLoadUrl = this.url;
				this.openDialog($L("Error"), $L('No Internet Connection.'));
				break;
			case this.WebKitErrors.ERR_WK_FLOADER_CANCELLED:
				break;
			default:
				this.openDialog($L("Error"), $L("Unable to Load Page"));
				this.log("Unknown Handled Error: " + inMsg);
				break;
				
			}
		this.clearProgress();
	},
	createPageImages: function() {
		// The app chrome runs in LunaSysMgr's old WebKit (system OpenSSL 0.9.8) and CANNOT load remote https
		// favicons. So ask the WPE engine (modern TLS) to download the current site's favicon to a LOCAL file
		// via saveViewToFile -> BrowserPageWPE::renderToFile, and show that local path. The single-arg form
		// makes the adapter send renderToFile with the viewport rect (which the backend ignores — it fetches
		// the favicon, not a page snapshot). /var/... is the adapter's required safe dir.
		// The engine auto-downloads each site's favicon (PNG) into the app's OWN bundle at
		// faviconcache/fav_<host>.png — LunaSysMgr's file-access jailer blocks the app from reading
		// /var/luna/... but ALWAYS allows its own dir. We reference it by a RELATIVE path (resolves under the
		// app dir, same as the chrome images). Host sanitization must match the engine's atlas_favicon_dest_for.
		// On the Chromium host none of that applies: the app chrome IS Chromium, so it can load the
		// remote icon the page advertised (ChromiumWebView collects it from did-update-favicon-url) and
		// no local cache file exists to point at.
		var direct = this.$.view && this.$.view.faviconUrl;
		if (direct) {
			return {thumbnailFile: direct, iconFile32: direct, iconFile64: direct};
		}
		var m = (this.url || "").match(/^https?:\/\/([^\/]+)/i);
		var icon = m ? ("faviconcache/fav_" + m[1].replace(/[^A-Za-z0-9.\-]/g, "_") + ".png") : "";
		return {thumbnailFile: icon, iconFile32: icon, iconFile64: icon};
	},
	// UNUSED/TODO(audit A2-6): no caller or enyo handler-wiring found — revisit in detail before deleting.
	deleteImages: function(inImages) {
		for (var i=0, image; image=inImages[i]; i++) {
			this.log(image);
			this.viewCall("deleteImage", [image]);
		}
	}
})
