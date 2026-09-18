/* One tap, one action.
 *
 * LunaCE delivers a real touch AND a synthesised mouse click for the same tap, so a button wired
 * straight to an event fires it twice — measured as a single tap on the tab button taking the count
 * from 1 to 3, and on New Tab opening two tabs. BrowserApp hits the same thing on its AppMenu and
 * guards it with a one-shot _menuArmed flag armed in toggleAppMenuItems (BrowserApp.js), but that
 * relies on there being a per-open moment to arm; a plain toolbar button has none.
 *
 * So: ignore a repeat of the SAME action inside a short window — a window rather than a strict
 * one-shot, so deliberate repeat taps (next, next, next) still work.
 *
 * The key is what makes it per-action rather than per-control-owner. Keying by owner alone is wrong
 * and was: tapping New Tab and then Done in the tab switcher swallowed Done, because a different
 * button on the same owner looked like the same tap repeated. Rows include their index in the key for
 * the same reason — closing two tabs in quick succession is two actions, not one repeated.
 *
 * Every tappable control in source/phone/ MUST go through this rather than binding onclick directly
 * to a do* event. Usage:
 *
 *     {name: "tabs", kind: "ToolButton", onclick: "tabsClick"}
 *     tabsClick: function() { return atlasPhoneTap(this, "tabs", this.doTabs); }
 */
window.atlasPhoneTap = function (inOwner, inKey, inFire, inArgs) {
    var now = (new Date()).getTime();
    var seen = inOwner._atlasTapAt || (inOwner._atlasTapAt = {});
    if (now - (seen[inKey] || 0) < 600) { return true; }
    seen[inKey] = now;
    inFire.apply(inOwner, inArgs || []);
    return true;
};
