// While a popup is open the page view stops painting, so the popup can be
// seen: ChromiumOverlay's check of which popups are open, against a stand-in
// DOM. The AppMenu is position:fixed, and a fixed element has no
// offsetParent, so the check must not go by offsetParent alone.
// Run with: node test/overlay.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function el(style, rect, offsetParent) {
	return {
		style: style,
		offsetParent: offsetParent === undefined ? {} : offsetParent,
		getBoundingClientRect: () => rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
		hasNode: function() { return this; },
	};
}
const box = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x: x, y: y });

function run(popups) {
	const calls = [];
	let observer = null;
	const page = el({ display: "block", position: "static" }, box(0, 100, 450, 700));
	page.parentNode = null;
	const view = {
		hasNode: () => page,
		node: page,
		setOverlayClip: () => {},
		setOverlayHidden: (h) => calls.push(h),
	};
	page.hasNode = () => page;
	view.node = page;
	const sandbox = {
		__atlasChromium: true,
		__atlasApp: { atlasActiveView: () => ({ $: { view: Object.assign(view, { hasNode: () => page }) } }) },
		document: {
			body: {},
			querySelectorAll: () => popups,
			addEventListener: () => {},
		},
		getComputedStyle: (e) => Object.assign({ visibility: "visible", opacity: "1" }, e.style),
		MutationObserver: function(cb) { observer = cb; this.observe = () => {}; },
		addEventListener: () => {},
		setTimeout: (fn) => { fn(); return 1; },
		console: console,
	};
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "source", "engine", "ChromiumOverlay.js"), "utf8"), sandbox);
	return calls;
}

// The AppMenu open: fixed, laid out, no offsetParent. The page stops painting.
assert.deepStrictEqual(run([el({ display: "block", position: "fixed" }, box(-10, 0, 230, 506), null)]), [true],
	"an open fixed popup (the AppMenu) hides the page");

// The same menu closed: display:none.
assert.deepStrictEqual(run([el({ display: "none", position: "fixed" }, box(0, 0, 0, 0), null)]), [false],
	"a closed fixed popup does not");

// A popup inside something not shown: no offsetParent, not fixed.
assert.deepStrictEqual(run([el({ display: "block", position: "absolute" }, box(0, 0, 0, 0), null)]), [false],
	"a popup inside a hidden container does not");

// A dialog laid out in the middle (absolute, with an offsetParent).
assert.deepStrictEqual(run([el({ display: "block", position: "absolute" }, box(40, 300, 360, 400))]), [true],
	"an open dialog hides the page");

console.log("overlay: all passed");
