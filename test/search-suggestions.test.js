// Address-bar suggestions send what is typed to Google, so they are off until
// asked for, on new installs and on existing ones.
// Run with: node test/search-suggestions.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadKind(file, name) {
	const kinds = {};
	const noop = () => {};
	const sandbox = {
		$L: (s) => s,
		enyo: new Proxy({
			kind: (def) => { kinds[def.name] = def; },
			macroize: (s, map) => s.replace("{$query}", map.query),
		}, { get: (t, k) => (k in t ? t[k] : noop) }),
	};
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "source", file), "utf8"), sandbox);
	return kinds[name];
}

// A URLSearch with its published defaults, a typed "hello", and its requests.
function urlSearch(published) {
	const def = loadKind("URLSearch.js", "URLSearch");
	const requests = [];
	const self = Object.assign({}, def, def.published, published, {
		$: {
			address: { getUserInput: () => "hello" },
			suggestSearch: { setUrl: (u) => requests.push(u), call: () => {} },
		},
	});
	self.fetchSearchSuggestions();
	return requests;
}

// BrowserApp's first look at the preferences; returns what it stores.
function initialPreferences(existing) {
	const def = loadKind("BrowserApp.js", "enyo.BrowserApp");
	const puts = [];
	const self = {
		$: { browserPrefsService: { dbKind: "prefs:1", call: (a) => puts.push(a.objects) } },
		fetchPreferences: () => {},
	};
	def.gotInitialBrowserPreferences.call(self, null, { results: existing });
	return puts[0] || [];
}

let failed = 0;
function test(name, fn) {
	try {
		fn();
		console.log("ok   " + name);
	} catch (e) {
		failed++;
		console.log("FAIL " + name + "\n     " + e.message);
	}
}

test("nothing leaves the device by default", () => {
	assert.deepStrictEqual(urlSearch({}), []);
});

test("explicitly off asks nothing", () => {
	assert.deepStrictEqual(urlSearch({ searchSuggestions: false }), []);
});

test("the setting turned on asks the service", () => {
	const requests = urlSearch({ searchSuggestions: true });
	assert.strictEqual(requests.length, 1);
	assert.ok(requests[0].includes("q=hello"), requests[0]);
});

test("a new install stores it off", () => {
	const pref = initialPreferences([]).find((p) => p.key === "searchSuggestions");
	assert.ok(pref, "no default");
	assert.strictEqual(pref.value, false);
});

test("an existing install gets the record, off, so the toggle can persist", () => {
	const puts = initialPreferences([{ key: "blockPopups", value: true }]);
	const pref = puts.find((p) => p.key === "searchSuggestions");
	assert.ok(pref, "no record added");
	assert.strictEqual(pref.value, false);
});

test("a stored choice is left alone", () => {
	const puts = initialPreferences([{ key: "searchSuggestions", value: true }]);
	assert.strictEqual(puts.find((p) => p.key === "searchSuggestions"), undefined);
});

test("the preference reaches both address bars", () => {
	const def = loadKind("BrowserApp.js", "enyo.BrowserApp");
	const seen = {};
	const view = (name) => ({ setSearchSuggestions: (v) => { seen[name] = v; } });
	const self = Object.assign({ log: () => {} }, {
		$: {
			pane: { viewByName: (n) => view(n) },
			browser: view("browser"),
		},
	});
	def.applyPreference.call(self, "searchSuggestions", true);
	assert.deepStrictEqual(seen, { browser: true, startPage: true });
});

for (const [file, name, child] of [
	["Browser.js", "Browser", "actionbar"],
	["StartPage.js", "StartPage", "actionbar"],
	["ActionBar.js", "ActionBar", "search"],
]) {
	test(name + " passes it down, off by default", () => {
		const def = loadKind(file, name);
		assert.strictEqual(def.published.searchSuggestions, false);
		let got;
		def.searchSuggestionsChanged.call({
			searchSuggestions: true,
			$: { [child]: { setSearchSuggestions: (v) => { got = v; } } },
		});
		assert.strictEqual(got, true);
	});
}

test("Preferences has a toggle stored as a browser preference", () => {
	const src = fs.readFileSync(path.join(__dirname, "..", "source", "Preferences.js"), "utf8");
	assert.match(src, /name: "searchSuggestions", onChange: "togglePreferenceClick", preference: "searchSuggestions", type: "Browser"/);
});

process.exitCode = failed ? 1 : 0;
