// Enyo is loaded once. /usr/palm/frameworks/enyo/1.0 is a link to 0.10, so
// loading both ran the framework twice: two enyo.dispatch functions on the
// document's touch events, every tap a double click, and toggles in the print
// dialog flipping on and straight back off.
// Run with: node test/index.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
	.replace(/<!--[\s\S]*?-->/g, "");
const enyo = html.match(/<script[^>]*\bsrc="[^"]*\/framework\/enyo\.js"/g) || [];
assert.strictEqual(enyo.length, 1, "enyo.js is loaded " + enyo.length + " times");
console.log("index: all passed");
