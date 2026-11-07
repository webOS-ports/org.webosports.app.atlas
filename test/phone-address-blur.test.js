// On the phone, leaving the address field without committing goes back to the
// page title. The blur handler used to call an event the bar never declared,
// threw, and left the field stuck in edit mode.
// Run with: node test/phone-address-blur.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const kinds = {};
const jobs = [];
const sandbox = {
	$L: (s) => s,
	enyo: {
		kind: (def) => { kinds[def.name] = def; },
		job: (name, fn) => { jobs.push(fn); },
		bind: (self, fn) => fn.bind(self),
	},
	console: console,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "source", "phone", "PhoneActionBar.js"), "utf8"), sandbox);
const def = kinds.PhoneActionBar;
assert.ok(def, "PhoneActionBar.js defines PhoneActionBar");

// The bar as the framework would build it: only what phoneInputBlurred reaches.
// ActionBar's declared events become do* methods; anything else does not exist.
function bar(addressFocused) {
	const self = Object.assign(Object.create(null), def, {
		id: "bar", _editing: true, exited: 0,
		$: { search: { $: { address: { hasFocus: () => addressFocused } } } },
		exitEditMode() { this.exited++; this._editing = false; },
	});
	return self;
}

{
	jobs.length = 0;
	const b = bar(false);
	assert.doesNotThrow(() => b.phoneInputBlurred());
	assert.strictEqual(jobs.length, 1, "the exit is scheduled");
	jobs[0]();
	assert.strictEqual(b.exited, 1, "the field leaves edit mode once the blur sticks");
}
{
	// The blur that comes with tapping a suggestion: focus is back by the time
	// the job runs, so the field stays open for the tap.
	jobs.length = 0;
	const b = bar(true);
	b.phoneInputBlurred();
	jobs[0]();
	assert.strictEqual(b.exited, 0);
}

console.log("phone-address-blur: ok");
