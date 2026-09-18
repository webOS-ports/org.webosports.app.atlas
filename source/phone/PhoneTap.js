/* One tap, one action.
 *
 * LunaCE delivers a real touch AND a synthesised mouse click for the same tap, so a button wired
 * straight to an event fires it twice — measured as a single tap on the tab button taking the count
 * from 1 to 3, and on New Tab opening two tabs. BrowserApp hits the same thing on its AppMenu and
 * guards it with a one-shot _menuArmed flag armed in toggleAppMenuItems (BrowserApp.js), but that
 * relies on there being a per-open moment to arm; a plain toolbar button has none.
 *
 * So: ignore a repeat of the same action inside a short window. A window rather than a strict one-shot
 * so that deliberate repeat taps (next, next, next) still work.
 *
 * Every tappable control in source/phone/ MUST go through this rather than binding onclick directly
 * to a do* event. Usage:
 *
 *     {name: "tabs", kind: "ToolButton", onclick: "tabsClick"}
 *     tabsClick: function() { return atlasPhoneTap(this, this.doTabs); }
 */
window.atlasPhoneTap = function (inOwner, inFire, inArgs) {
    var now = (new Date()).getTime();
    if (now - (inOwner._atlasLastTapMs || 0) < 600) { return true; }
    inOwner._atlasLastTapMs = now;
    inFire.apply(inOwner, inArgs || []);
    return true;
};
