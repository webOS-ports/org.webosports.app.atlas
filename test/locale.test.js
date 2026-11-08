// The PalmSystem shim on browser_shell takes the system's language and
// regions from systemservice, as WAM gives them, and passes them to Enyo's
// g11n. Its first guess, the engine's language, says nothing of the region:
// English with Dutch formats printed on US Letter instead of A4.
// Run with: node test/locale.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PREFS = {
	returnValue: true,
	locale: { languageCode: "en", countryCode: "us", phoneRegion: { countryCode: "us", countryName: "United States" } },
	region: { countryCode: "nl", countryName: "Netherlands" },
};

// Runs the shim; |reply| is what systemservice answers, |g11nReady| whether
// Enyo's g11n has already read PalmSystem.
function shim(reply, g11nReady) {
	const calls = [];
	const setLocale = [];
	let bridge = null;
	function PalmServiceBridge() { bridge = this; }
	PalmServiceBridge.prototype.call = function (uri, json) { calls.push({ uri: uri, params: JSON.parse(json) }); };
	const noop = () => {};
	const sandbox = {
		__atlasChromium: true,
		navigator: { language: "en-US" },
		screen: { width: 1080, height: 2220 },
		document: { addEventListener: noop },
		setTimeout: noop,
		console: { log: noop },
		Intl: Intl,
		PalmServiceBridge: PalmServiceBridge,
		enyo: { g11n: { _initialized: g11nReady, setLocale: (p) => setLocale.push(JSON.parse(JSON.stringify(p))) } },
	};
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "source", "engine", "ShellPalmSystem.js"), "utf8"), sandbox);
	const before = { locale: sandbox.PalmSystem.locale, localeRegion: sandbox.PalmSystem.localeRegion };
	if (reply !== undefined) { bridge.onservicecallback(JSON.stringify(reply)); }
	const p = sandbox.PalmSystem;
	return { calls, setLocale, before, now: { locale: p.locale, localeRegion: p.localeRegion, phoneRegion: p.phoneRegion } };
}

// The first guess is in WAM's form, from the engine's language.
let r = shim(undefined, false);
assert.deepStrictEqual(r.before, { locale: "en_us", localeRegion: "us" });
assert.deepStrictEqual(r.calls, [{ uri: "luna://com.webos.service.systemservice/getPreferences",
	params: { keys: ["locale", "region"], subscribe: true } }]);

// The system's answer replaces it; Enyo's g11n, already started, is told.
r = shim(PREFS, true);
assert.deepStrictEqual(r.now, { locale: "en_us", localeRegion: "nl", phoneRegion: "us" });
assert.deepStrictEqual(r.setLocale, [{ uiLocale: "en_us", formatLocale: "en_nl", phoneLocale: "en_us" }]);

// g11n not started yet: it reads PalmSystem itself when it starts.
r = shim(PREFS, false);
assert.deepStrictEqual(r.now.localeRegion, "nl");
assert.deepStrictEqual(r.setLocale, []);

// No region given: the language's country.
r = shim({ returnValue: true, locale: { languageCode: "de", countryCode: "DE" } }, true);
assert.deepStrictEqual(r.now, { locale: "de_de", localeRegion: "de", phoneRegion: "de" });

// A reply without a language changes nothing.
r = shim({ returnValue: false, errorText: "denied" }, true);
assert.deepStrictEqual(r.now, { locale: "en_us", localeRegion: "us", phoneRegion: "us" });
assert.deepStrictEqual(r.setLocale, []);

console.log("locale: all passed");
