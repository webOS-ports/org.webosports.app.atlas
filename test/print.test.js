// Printing on the Chromium host: the PrintDialog's render step makes the page a
// PDF in the engine (pageContents.printToPDF) on the job's paper, adds it to the
// job and reports the render status.
// Run with: node test/print.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// The Chromium WebView kind, with a PalmServiceBridge that records its calls
// and answers addFile with |addFileReply|.
function chromiumWebView(addFileReply) {
	const kinds = {};
	const calls = [];
	const noop = () => {};
	function PalmServiceBridge() {}
	PalmServiceBridge.prototype.call = function (uri, json) {
		calls.push({ uri: uri, params: JSON.parse(json) });
		const bridge = this;
		if (/addFile$/.test(uri)) {
			setImmediate(() => bridge.onservicecallback(JSON.stringify(addFileReply)));
		}
	};
	const sandbox = {
		$L: (s) => s,
		setImmediate: setImmediate,
		PalmServiceBridge: PalmServiceBridge,
		__atlasChromium: true,
		enyo: new Proxy({
			kind: (def) => { kinds[def.name] = def; },
			Control: {},
		}, { get: (t, k) => (k in t ? t[k] : noop) }),
	};
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "source", "engine", "ChromiumWebView.js"), "utf8"), sandbox);
	return { def: kinds["enyo.WebView"], calls: calls };
}

// The params the print service gives for US Letter at 300 dpi with 0.5 in insets
// (its printer margins are 0.125 in).
const LETTER = {
	pixelUnits: 300, rawWidth: 2475, rawHeight: 3225, width: 2251, height: 3001,
	pageTopMargin: 0.125, pageLeftMargin: 0.125, pageRightMargin: 0.125, pageBottomMargin: 0.125,
	topInset: 0.5, leftInset: 0.5, rightInset: 0.5, bottomInset: 0.5,
};

const pending = [];
let failed = 0;
function test(name, fn) {
	pending.push(Promise.resolve().then(fn).then(
		() => console.log("ok   " + name),
		(e) => { failed++; console.log("FAIL " + name + "\n     " + e.message); }));
}
const settle = () => new Promise((r) => setTimeout(r, 200));
const renderStatus = (calls) => calls.filter((c) => /setRenderStatus$/.test(c.uri)).map((c) => c.params);

test("the PDF has the job's paper and its margins", () => {
	const { def } = chromiumWebView();
	const o = def.printOptions(LETTER);
	assert.strictEqual(o.paperWidth, 8.5);
	assert.strictEqual(o.paperHeight, 11);
	assert.deepStrictEqual([o.marginTop, o.marginBottom, o.marginLeft, o.marginRight], [0.5, 0.5, 0.5, 0.5]);
});

test("no margin is narrower than the printer's own", () => {
	const { def } = chromiumWebView();
	const o = def.printOptions(Object.assign({}, LETTER, { topInset: 0, leftInset: undefined }));
	assert.strictEqual(o.marginTop, 0.125);
	assert.strictEqual(o.marginLeft, 0.125);
});

test("without the paper's size the engine's default is left alone", () => {
	const { def } = chromiumWebView();
	const o = def.printOptions({ pixelUnits: 0 });
	assert.strictEqual(o.paperWidth, undefined);
	assert.strictEqual(o.marginTop, undefined);
});

test("the PDF is added to the job and the render is done", async () => {
	const { def, calls } = chromiumWebView({ returnValue: true });
	let asked = null;
	const self = Object.assign(Object.create(def), {
		pageContents: { printToPDF: (opts, cb) => { asked = opts; cb("/var/lib/wam/Print/1.pdf", ""); } },
	});
	self.callBrowserAdapter("printFrame", ["", 7, 2251, 3001, 300, false, false, LETTER]);
	await settle();
	assert.strictEqual(asked.paperWidth, 8.5);
	const add = calls.find((c) => /addFile$/.test(c.uri));
	assert.deepStrictEqual(add.params, { jobID: 7, pathName: "/var/lib/wam/Print/1.pdf", currentPage: 1, totalPages: 1 });
	assert.deepStrictEqual(renderStatus(calls), [{ jobID: 7, renderResultCode: 0, renderResultText: "" }]);
});

test("a PDF the engine could not make fails the render", async () => {
	const { def, calls } = chromiumWebView({ returnValue: true });
	const self = Object.assign(Object.create(def), {
		pageContents: { printToPDF: (opts, cb) => cb("", "Printing failed") },
	});
	self.printPage(3, LETTER);
	await settle();
	assert.ok(!calls.some((c) => /addFile$/.test(c.uri)));
	assert.deepStrictEqual(renderStatus(calls), [{ jobID: 3, renderResultCode: -703, renderResultText: "Printing failed" }]);
});

test("a file the print service refuses fails the render with its code", async () => {
	const { def, calls } = chromiumWebView({ returnValue: false, errorCode: -616, errorText: "unsupported" });
	const self = Object.assign(Object.create(def), {
		pageContents: { printToPDF: (opts, cb) => cb("/x.pdf", "") },
	});
	self.printPage(4, LETTER);
	await settle();
	assert.deepStrictEqual(renderStatus(calls), [{ jobID: 4, renderResultCode: -616, renderResultText: "unsupported" }]);
});

test("an engine without printToPDF fails the render instead of leaving the dialog waiting", async () => {
	const { def, calls } = chromiumWebView();
	const self = Object.assign(Object.create(def), { pageContents: {} });
	self.printPage(5, LETTER);
	await settle();
	assert.strictEqual(renderStatus(calls)[0].renderResultCode, -703);
});

Promise.all(pending).then(() => {
	if (failed) {
		console.log(failed + " failed");
		process.exit(1);
	}
	console.log("all passed");
});
