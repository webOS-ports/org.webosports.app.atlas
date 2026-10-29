// Atlas Web — App Museum II auto-updater.
//
// On startup (see BrowserApp.rendered) this asks the App Museum II web service whether a newer
// build of the app exists. If so it fires onUpdateFound; the app then confirms with the user and,
// on consent, hands the IPK's download URI to Preware (which performs the actual install).
//
// Spec: github.com/webOSArchive/webos-mcp  ->  knowledge/updater.md
//   GET getLatestVersionInfo.php?app={name}/{ver}&clientid={uuid}&device={model/plat/carrier/locale}
//
// clientid is a random UUID made once per install and kept in localStorage - never the device's
// NDUID, which on Halium is SHA-1 of the hardware serial and would let the service (and anyone on
// the path) recognise the phone across reinstalls. The request goes over HTTPS.
//   -> {"version","versionNote","downloadURI"}  ("" or "ERROR:..." => none)
//   numeric #.#.# version compare; install by launching org.webosinternals.preware {type:install,file:uri}
//
// Logic only (no UI): Preware is launched by the host app via its existing applicationManager service.
enyo.kind({
	name: "Updater",
	kind: "Component",
	published: {
		// MUST match the App Museum II registration exactly.
		appName: "Atlas Web",
		serviceURL: "https://appcatalog.webosarchive.org/WebService/getLatestVersionInfo.php"
	},
	events: {
		// (inSender, inInfo{version, versionNote, downloadURI}) — fired only when a STRICTLY newer build exists.
		onUpdateFound: ""
	},
	version: "0",
	clientId: "",
	create: function() {
		this.inherited(arguments);
		// current version from appinfo.json — single source of truth (kept in sync with the package)
		var self = this;
		this.getJSON("appinfo.json", function(ai) { if (ai && ai.version) { self.version = ai.version; } });
	},
	//* @public — silent check; surfaces via onUpdateFound only when a newer version is available.
	checkForUpdate: function() {
		if (!(window.PalmSystem || (window.enyo && enyo.platform && enyo.platform.webos))) { return; } // device only
		this.clientId = this.installUuid();
		this.doServiceCheck();
	},
	//* A random UUID kept per install ("updater-uuid"); a fresh one each launch if storage is unavailable.
	installUuid: function() {
		var id = null;
		try { id = window.localStorage && localStorage.getItem("updater-uuid"); } catch (e) {}
		if (!id) {
			id = "yxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
				var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
			});
			try { localStorage.setItem("updater-uuid", id); } catch (e) {}
		}
		return id;
	},
	deviceString: function() {
		var model = "TouchPad", plat = "3.0.5", carrier = "WiFi",
			locale = (navigator.language || "en_us").replace("-", "_").toLowerCase();
		try {
			var di = window.PalmSystem && PalmSystem.deviceInfo && enyo.json.parse(PalmSystem.deviceInfo);
			if (di) { model = di.modelName || model; plat = di.platformVersion || plat; }
		} catch (e) {}
		return [model, plat, carrier, locale].join("/");
	},
	doServiceCheck: function() {
		var url = this.serviceURL;
		url += "?app=" + encodeURIComponent(this.appName + "/" + this.version) +
			"&clientid=" + encodeURIComponent(this.clientId) +
			"&device=" + encodeURIComponent(this.deviceString());
		var self = this;
		this.getText(url, function(text) { self.gotVersionInfo(text); });
	},
	gotVersionInfo: function(text) {
		if (!text) { return; }
		text = text.replace(/^\s+|\s+$/g, "");
		if (!text || text.indexOf("ERROR:") === 0) { return; } // no app found / service error
		var info; try { info = enyo.json.parse(text); } catch (e) { return; }
		if (!info || !info.version || !info.downloadURI) { return; }
		if (this.compareVersions(info.version, this.version) > 0) {
			this.doUpdateFound(info);
		}
	},
	//* numeric major.minor.build comparison — returns >0 if a is newer than b (NOT lexicographic).
	compareVersions: function(a, b) {
		var pa = String(a).split("."), pb = String(b).split(".");
		for (var i = 0; i < 3; i++) {
			var na = parseInt(pa[i], 10) || 0, nb = parseInt(pb[i], 10) || 0;
			if (na !== nb) { return na - nb; }
		}
		return 0;
	},
	// --- tiny XHR helpers (this Enyo 1 build has no enyo.Ajax) ---
	getText: function(url, cb) {
		try {
			var xhr = new XMLHttpRequest();
			xhr.open("GET", url, true);
			xhr.onreadystatechange = function() {
				if (xhr.readyState === 4) { cb((xhr.status >= 200 && xhr.status < 300) ? xhr.responseText : ""); }
			};
			xhr.send();
		} catch (e) { cb(""); }
	},
	getJSON: function(url, cb) {
		this.getText(url, function(t) { var o = null; try { o = t && enyo.json.parse(t); } catch (e) {} cb(o); });
	}
});
