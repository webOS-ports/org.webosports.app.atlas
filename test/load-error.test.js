// A failed load on the Chromium host shows Atlas's own error panel instead of
// the runtime's error page: which words and settings app each net error gets,
// which engine events raise and clear it, and that the page view stays hidden
// while it is up, even when the tab is brought back to the front.
// Run with: node test/load-error.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadKinds(file, extra) {
	const kinds = {};
	const sandbox = Object.assign({
		$L: (s) => s,
		enyo: {
			kind: (def) => { kinds[def.name] = def; },
			macroize: (s, map) => s.replace(/\{\$(\w+)\}/g, (m, k) => map[k]),
		},
		__atlasChromium: true,
		console: console,
		setTimeout: () => 0,
	}, extra || {});
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "source", file), "utf8"), sandbox);
	return kinds;
}

// --- LoadErrorView.describe: the policy --------------------------------------
const view = loadKinds("LoadErrorView.js").LoadErrorView;
const describe = (code, url) => view.describe.call(view, code, url);

{
	const d = describe(-106, "https://www.example.com/a");
	assert.strictEqual(d.title, "No Internet Connection");
	assert.strictEqual(d.settingsAppId, "org.webosports.app.settings.wifi");
}
{
	const d = describe(-105, "http://does-not-exist.invalid/x?y");
	assert.strictEqual(d.title, "Server Not Found");
	assert.ok(d.message.indexOf("does-not-exist.invalid") >= 0, d.message);
	assert.strictEqual(d.settingsAppId, "org.webosports.app.settings.wifi");
}
{
	// A wrong clock is the usual cause, so this one opens Date & Time.
	const d = describe(-201, "https://expired.example/");
	assert.strictEqual(d.title, "Secure Connection Failed");
	assert.strictEqual(d.settingsAppId, "org.webosports.app.settings.dateandtime");
}
// Certificate range and the scattered TLS handshake codes are all "secure", with
// no settings button: there is nothing on the device to change.
for (const code of [-200, -202, -299, -107, -113, -501]) {
	const d = describe(code, "https://h/");
	assert.strictEqual(d.title, "Secure Connection Failed", String(code));
	assert.strictEqual(d.settingsAppId, "", String(code));
}
// Neighbours of the TLS codes that are not TLS errors.
for (const code of [-111, -115, -124, -301]) {
	assert.notStrictEqual(describe(code, "https://h/").title, "Secure Connection Failed", String(code));
}
assert.strictEqual(describe(-118, "http://slow.example/").title, "Connection Timed Out");
assert.strictEqual(describe(-102, "http://h/").title, "Unable to Connect");
assert.strictEqual(describe(-310, "http://h/").title, "Redirect Loop");
assert.strictEqual(describe(-999, "http://h/").title, "Unable to Load Page");
// The code arrives as a number or a string depending on the runtime.
assert.strictEqual(describe("-106", "").title, "No Internet Connection");

assert.strictEqual(view.hostOf("https://user:pw@www.example.com:8443/p"), "www.example.com");
assert.strictEqual(view.hostOf("http://[::1]:8080/"), "[::1]");
assert.strictEqual(view.hostOf("not a url"), "");
assert.ok(describe(-105, "").message.indexOf("the site") >= 0, "no host: still a sentence");

// --- ChromiumWebView: raising and clearing ----------------------------------
const webViewDef = loadKinds("engine/ChromiumWebView.js")["enyo.WebView"];
assert.ok(webViewDef, "ChromiumWebView.js defines enyo.WebView");

function fakeView() {
	const handlers = {};
	const visible = [];
	const self = Object.assign(Object.create(null), webViewDef, {
		showing: true,
		pageContents: { on: (name, fn) => { handlers[name] = fn; } },
		pageView: { setVisible: (v) => visible.push(v) },
		errors: [], cleared: 0, scheduleBoundsSync() {}, refreshNavState() {},
		doError(code, msg, url) { this.errors.push([code, msg, url]); },
		doErrorCleared() { this.cleared++; },
		doLoadStarted() {}, doLoadStopped() {}, doLoadComplete() {}, doLoadProgress() {},
		pushTitle() {}, installInputBridge() {},
	});
	self.wireEvents();
	return { self, handlers, visible };
}

{
	const { self, handlers } = fakeView();
	handlers["did-fail-load"]("http://x.invalid/", false, "net::ERR_NAME_NOT_RESOLVED", -105);
	assert.strictEqual(self.errors.length, 0, "a sub-frame failure is not a page error");
	handlers["did-fail-load"]("http://x.invalid/", true, "net::ERR_ABORTED", -3);
	assert.strictEqual(self.errors.length, 0, "a stopped load leaves the page as it is");
	handlers["did-fail-load"]("http://x.invalid/", true, "net::ERR_NAME_NOT_RESOLVED", -105);
	assert.deepStrictEqual(self.errors, [[-105, "net::ERR_NAME_NOT_RESOLVED", "http://x.invalid/"]]);

	assert.strictEqual(self.cleared, 0);
	handlers["did-finish-navigation"]("http://x.example/");
	assert.strictEqual(self.cleared, 1, "a good commit clears the error");
	handlers["did-finish-navigation"]("http://x.example/2");
	assert.strictEqual(self.cleared, 1, "and only once");
}

{
	// Browser hides the control behind the panel; bringing the tab to the front
	// again must not make the error page paint over it.
	const { self, visible } = fakeView();
	self.showing = false;
	self.showingChanged = webViewDef.showingChanged;
	self.inherited = () => {};
	self.showingChanged();
	assert.strictEqual(visible.pop(), false);
	self.setEngineActive(false);
	assert.strictEqual(visible.pop(), false);
	self.setEngineActive(true);
	assert.strictEqual(visible.pop(), false, "re-activated tab stays hidden while the panel is up");
	self.setOverlayHidden(false);
	assert.strictEqual(visible.pop(), false, "closing a popup does not show it either");
	self.showing = true;
	self.showingChanged();
	assert.strictEqual(visible.pop(), true);
	self.setOverlayHidden(true);
	assert.strictEqual(visible.pop(), false);
}

console.log("load-error: ok");
