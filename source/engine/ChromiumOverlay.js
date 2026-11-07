/* Let Atlas's popups be seen on the Chromium host.
 *
 * A browser_shell page view is a native view the shell composites ON TOP of the UI page — that is why a
 * mis-positioned view covers the ActionBar. The same rule quietly breaks every popup Atlas draws over
 * the page area: the context menu, the JS dialogs, the login prompt, the SSL sheet. They open in the
 * DOM exactly as they always have (openContextMenu returns handled, the popup lays out with a real
 * rect and display:block) and are simply never seen, because the page is painted over them.
 *
 * There is no z-order to fix — a native view cannot go behind the UI page. So while any popup is on
 * screen, the active tab's page view stops painting and the area falls back to the app's background;
 * it returns, with bounds re-pushed, once the last popup closes. The page keeps running (this is not
 * the tab-suspend path) so nothing is lost but the pixels.
 *
 * Detection is done in the DOM rather than by patching enyo.Popup: enyo resolves this.inherited at
 * kind-creation time, so a monkey-patch on enyo.Popup.prototype installed later is invisible to kinds
 * that were already defined (measured: BrowserContextMenu never hit a patched showingChanged). Every
 * popup kind does carry the enyo-popup class, so watching for a visible one is both simpler and more
 * robust — including for popups Atlas grows later. Inert on the WPE host. */
if (window.__atlasChromium) {

(function () {
    var scheduled = null;
    var lastState = null;

    function activeWebView() {
        var app = window.__atlasApp;
        var view = app && app.atlasActiveView && app.atlasActiveView();
        return (view && view.$) ? view.$.view : null;
    }

    /* Laid out and not hidden. Not offsetParent: that is null for display:none, but also for every
     * position:fixed element, and the AppMenu is fixed - so an open menu counted as closed, the page
     * kept painting over it and only the strip above the page (Find on Page) was seen. */
    function laidOut(el) {
        var st = window.getComputedStyle(el);
        if (!st || st.display === "none") { return false; }
        if (st.position !== "fixed" && el.offsetParent === null) { return false; }   // inside a display:none
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function anyPopupVisible() {
        var els = document.querySelectorAll(".enyo-popup");
        for (var i = 0; i < els.length; i++) {
            if (laidOut(els[i])) { return true; }
        }
        return false;
    }

    /* Popups are not the only thing Atlas draws over the page: the bookmarks / history / downloads
     * toaster is an ordinary view, and it is a 320px drawer pinned to the right edge — point sampling
     * inside the page rect misses it entirely. Hit testing is the wrong instrument anyway, because an
     * overlay that paints UNDER the transparent placeholder is still hidden by the native view.
     *
     * So: walk up from the placeholder and look at the siblings along the way. Any visible sibling
     * whose box meaningfully overlaps the page area is UI that the page would be covering. The walk is
     * bounded by the depth of the tree, and it stays generic — no list of class names to maintain. */
    function overlaps(a, b) {
        var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return w > 16 && h > 16;          // ignore hairline touching (borders, 1px separators)
    }

    function isVisible(el) {
        if (!laidOut(el)) { return false; }
        var st = window.getComputedStyle(el);
        return st.visibility !== "hidden" && st.opacity !== "0";
    }

    function coveringRects(wv) {
        var node = (wv && wv.hasNode && wv.hasNode()) ? wv.node : null;
        if (!node) { return null; }
        var rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) { return null; }
        var found = [];
        var el = node;
        while (el && el.parentNode && el.parentNode.children) {
            var sibs = el.parentNode.children;
            for (var i = 0; i < sibs.length; i++) {
                var sib = sibs[i];
                if (sib === el || sib.contains(node)) { continue; }
                if (!isVisible(sib)) { continue; }
                var r = sib.getBoundingClientRect();
                if (overlaps(r, rect)) { found.push(r); }
            }
            el = el.parentNode;
        }
        return { page: rect, covers: found };
    }

    /* Work out how much of the page area is still free. A drawer pinned to one edge (the toaster is
     * 320px on the right, full height) only needs the page to step aside by that much — blanking the
     * whole thing was needlessly destructive. Anything that is NOT a full edge band (a context menu in
     * the middle, say) cannot be worked around: for those the page still has to stop painting.
     *
     * Returns: false = nothing covering, a rect = shrink to it, null = hide. */
    var EDGE = 4;          // tolerance for "touches this edge"
    var MIN_LEFT = 120;    // pointless to keep a sliver of page

    function freeArea(wv) {
        var info = coveringRects(wv);
        if (!info) { return false; }
        if (!info.covers.length) { return false; }
        var p = info.page;
        var left = p.left, top = p.top, right = p.right, bottom = p.bottom;
        for (var i = 0; i < info.covers.length; i++) {
            var c = info.covers[i];
            var fullHeight = (c.top <= top + EDGE) && (c.bottom >= bottom - EDGE);
            var fullWidth = (c.left <= left + EDGE) && (c.right >= right - EDGE);
            if (fullHeight && c.right >= right - EDGE) { right = Math.min(right, c.left); }
            else if (fullHeight && c.left <= left + EDGE) { left = Math.max(left, c.right); }
            else if (fullWidth && c.bottom >= bottom - EDGE) { bottom = Math.min(bottom, c.top); }
            else if (fullWidth && c.top <= top + EDGE) { top = Math.max(top, c.bottom); }
            else { return null; }                       // covers the middle — cannot clip around it
        }
        if (right - left < MIN_LEFT || bottom - top < MIN_LEFT) { return null; }
        return { left: left, top: top, width: right - left, height: bottom - top };
    }

    function evaluate() {
        scheduled = null;
        var wv = activeWebView();
        if (!wv || !wv.setOverlayHidden) { return; }
        // A popup is transient and usually lands mid-screen, so it keeps the simple treatment. Anything
        // else gets the geometry answer: shrink where we can, hide only when we must.
        var hide, clip = null;
        if (anyPopupVisible()) {
            hide = true;
        } else {
            var area = freeArea(wv);            // false | rect | null
            if (area === false) { hide = false; }
            else if (area) { hide = false; clip = area; }
            else { hide = true; }
        }
        var key = (hide ? "hide" : "show") + (clip ? [clip.left, clip.top, clip.width, clip.height].join(",") : "");
        if (key === lastState) { return; }
        lastState = key;
        wv.setOverlayClip(clip);
        wv.setOverlayHidden(hide);
    }

    function schedule() {
        if (scheduled) { return; }
        scheduled = setTimeout(evaluate, 30);      // coalesce bursts of DOM mutation into one check
    }

    function start() {
        if (!document.body || typeof window.MutationObserver !== "function") { return; }
        var mo = new window.MutationObserver(schedule);
        mo.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["style", "class"]     // enyo opens/closes a popup by toggling these
        });
        window.addEventListener("resize", schedule, false);
        schedule();
    }

    if (document.body) { start(); }
    else { document.addEventListener("DOMContentLoaded", start, false); }
})();

}
