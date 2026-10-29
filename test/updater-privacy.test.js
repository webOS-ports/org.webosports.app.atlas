// Checks what Atlas sends off the device on its own: the App Museum update
// check must carry a random per-install id over HTTPS, never the device's
// NDUID, and address-bar suggestions must go over HTTPS.
// Run with: node test/updater-privacy.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadKinds(file, globals) {
	const kinds = {};
	const sandbox = Object.assign({
		enyo: {
			kind: (def) => { kinds[def.name] = def; },
			json: { parse: JSON.parse, stringify: JSON.stringify },
		},
	}, globals || {});
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "source", file), "utf8"), sandbox);
	return { kinds, sandbox };
}

function updaterRun(storage) {
	const requests = [];
	const serviceCalls = [];
	const store = storage || {};
	const { kinds } = loadKinds("Updater.js", {
		PalmSystem: { deviceInfo: JSON.stringify({ modelName: "q25", platformVersion: "1.0" }) },
		navigator: { language: "en-US" },
		localStorage: {
			getItem: (k) => (k in store ? store[k] : null),
			setItem: (k, v) => { store[k] = String(v); },
		},
		XMLHttpRequest: function () {
			this.open = (m, url) => requests.push(url);
			this.send = () => {};
		},
	});
	const u = Object.create(kinds.Updater);
	u.appName = kinds.Updater.published.appName;
	u.serviceURL = kinds.Updater.published.serviceURL;
	u.version = "1.0.0";
	// Anything reaching for a bus service (such as the NDUID property) is recorded.
	u.$ = new Proxy({}, { get: (t, name) => ({ call: (a) => serviceCalls.push([name, a]) }) });
	u.checkForUpdate();
	return { requests, serviceCalls, store };
}

let failed = 0;
function test(name, fn) {
	try { fn(); console.log("ok   " + name); }
	catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message); }
}

test("update check goes over HTTPS", () => {
	const { requests } = updaterRun();
	assert.strictEqual(requests.length, 1);
	assert.ok(requests[0].startsWith("https://appcatalog.webosarchive.org/"), requests[0]);
});

test("update check does not ask for the NDUID", () => {
	const { serviceCalls } = updaterRun();
	assert.deepStrictEqual(serviceCalls, []);
	const src = fs.readFileSync(path.join(__dirname, "..", "source", "Updater.js"), "utf8");
	assert.ok(!/com\.palm\.properties\.nduid/.test(src), "Updater.js still names the NDUID property");
});

test("clientid is a random UUID kept per install", () => {
	const store = {};
	const first = updaterRun(store).requests[0];
	const second = updaterRun(store).requests[0];
	const id = new URL(first).searchParams.get("clientid");
	assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	assert.strictEqual(new URL(second).searchParams.get("clientid"), id);
	assert.strictEqual(store["updater-uuid"], id);
});

test("address-bar suggestions go over HTTPS", () => {
	const { kinds } = loadKinds("URLSearch.js", { $L: (s) => s });
	const def = Object.values(kinds).find((k) => k.suggestURL);
	assert.ok(def, "no kind with a suggestURL");
	assert.ok(def.suggestURL.startsWith("https://"), def.suggestURL);
});

process.exitCode = failed ? 1 : 0;
