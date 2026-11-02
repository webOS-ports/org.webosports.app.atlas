//   Copyright 2012 Hewlett-Packard Development Company, L.P.
//
//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.

enyo.kind({
	name: "StartPage",
	kind: enyo.VFlexBox,
	className: "startpage",
	published: {
		url: "",
		searchPreferences: {},
		defaultSearch: "",
		searchSuggestions: false
	},
	events: {
		onUrlChange: "",
		onOpenBookmarks: "",
		onNewCard: ""
	},
	components: [
		{name: "actionbar", kind: "ActionBar", canShare: false, onLoad: "addressSelect", onOpenBookmarks: "doOpenBookmarks", onNewCard: "doNewCard"},
		{name: "bookmarksService", kind: "DbService", dbKind: "com.palm.browserbookmarks:1", reCallWatches: true, method: "find",
			onSuccess: "gotBookmarks", subscribe: true, onWatch: "refreshBookmarks"},
		// Separate (un-subscribed) handle for writes (del/merge) so we don't disturb the
		// subscribed "find" above; the subscription's onWatch picks up the change and refreshes.
		{name: "bookmarksWriteService", kind: "DbService", dbKind: "com.palm.browserbookmarks:1", reCallWatches: true},
		{name: "scroller", kind: "Scroller", flex: 1, className: "startpage-grid-scroller", components: [
			{name: "grid", className: "startpage-grid"},
			{name: "empty", className: "startpage-empty", showing: false, allowHtml: true,
				content: $L("No bookmarks yet &mdash; bookmark a page with the &#9733;")}
		]},
		// Long-press context menu for a tile.
		{name: "tileMenu", kind: "Menu", className: "startpage-tile-menu", onClose: "tileMenuClosed", components: [
			{caption: $L("Open"), onclick: "menuOpen"},
			{caption: $L("Open in New Card"), onclick: "menuOpenNewCard"},
			{caption: $L("Remove Bookmark"), onclick: "menuRemove"}
		]}
	],
	//* @protected
	create: function() {
		this.inherited(arguments);
		this.bookmarks = [];
		this.tileControls = [];
		this.dragging = false;
		this.suppressTap = false;
		this.heldNoDrag = false;
		this.searchPreferencesChanged();
		this.defaultSearchChanged();
		this.refreshBookmarks();
	},
	addressSelect: function(inSender, inUrl) {
		this.doUrlChange(inUrl);
	},
	showingChanged: function() {
		this.inherited(arguments);
		// Always focus the action bar when start page is shown.
		if (this.showing) {
			this.$.actionbar.forceFocus();
			// Pick up bookmarks added/removed while we were hidden.
			this.refreshBookmarks();
		} else {
			this.$.actionbar.forceBlur();
		}
	},
	urlChanged: function() {
		this.$.actionbar.setUrl(this.url);
	},
	searchPreferencesChanged: function() {
		this.$.actionbar.setSearchPreferences(this.searchPreferences);
	},
	defaultSearchChanged: function() {
		this.$.actionbar.setDefaultSearch(this.defaultSearch);
	},
	searchSuggestionsChanged: function() {
		this.$.actionbar.setSearchSuggestions(this.searchSuggestions);
	},
	//* @protected
	// Bookmark grid
	refreshBookmarks: function() {
		// Order by the user's manual arrangement ("idx" is an indexed prop on the kind).
		this.$.bookmarksService.call({query: {orderBy: "idx", limit: 100}});
	},
	gotBookmarks: function(inSender, inResponse) {
		var res = (inResponse && inResponse.results) || [];
		// Never rebuild the grid mid-drag (destroying controls wedges enyo's gesture dispatch), and skip the
		// redundant rebuild when the db watch just echoes our own reorder (same set + order) — that echo can
		// otherwise land during the NEXT drag's setup and stop it. Only rebuild on a real add/remove/reorder.
		if (this.dragging) { this.bookmarks = res; return; }
		if (this.sameBookmarkOrder(res)) { this.bookmarks = res; return; }
		this.bookmarks = res;
		this.buildTiles();
	},
	sameBookmarkOrder: function(res) {
		var cur = this.bookmarks || [];
		if (cur.length !== res.length) { return false; }
		for (var i = 0; i < res.length; i++) {
			if (!cur[i] || cur[i]._id !== res[i]._id) { return false; }
		}
		return true;
	},
	buildTiles: function() {
		if (!this.hasNode() || this.dragging) {
			return;
		}
		this.$.grid.destroyControls();
		this.tileControls = [];
		var bmarks = this.bookmarks || [];
		this.$.empty.setShowing(bmarks.length === 0);
		for (var i = 0, b; (b = bmarks[i]); i++) {
			this.createBookmarkTile(b, i);
		}
		this.$.grid.render();
	},
	createBookmarkTile: function(inBookmark, inIndex) {
		// In Atlas the favicon is a RELATIVE path (e.g. "faviconcache/fav_<host>.png")
		// that resolves under the app dir; use it directly as the Image src.
		var icon = inBookmark.iconFile32 || inBookmark.iconFile64 || inBookmark.thumbnailFile;
		var title = inBookmark.title || inBookmark.url || "";
		// The first-letter placeholder is ALWAYS rendered; it sits underneath the
		// favicon and shows through when there's no favicon or the file is
		// missing/broken (see iconError).
		var thumbComponents = [
			{className: "startpage-tile-letter", content: this.firstLetter(title)}
		];
		if (icon) {
			// The favicon is layered over the letter placeholder. enyo.Image bubbles a
			// native "error" event as "onerror"; if the file is missing/broken we hide
			// the image (iconError) so the letter shows instead of a broken-image glyph.
			thumbComponents.push({kind: "Image", className: "startpage-tile-icon", src: icon, onerror: "iconError"});
		}
		var tile = this.$.grid.createComponent({
			kind: enyo.VFlexBox, className: "startpage-tile", align: "center", pack: "center",
			bmIndex: inIndex, onclick: "tileClick",
			onmousehold: "tileHold",
			ondragstart: "tileDragStart", ondrag: "tileDrag", ondragfinish: "tileDragFinish",
			components: [
				{className: "startpage-tile-thumb", layoutKind: "VFlexLayout", align: "center", pack: "center", components: thumbComponents},
				{className: "startpage-tile-title", content: title}
			]
		}, {owner: this});
		this.tileControls[inIndex] = tile;
	},
	iconError: function(inSender) {
		// Broken/missing favicon: hide the image so the letter placeholder underneath
		// shows through. inSender is the enyo.Image whose load failed.
		var node = inSender && inSender.hasNode();
		if (node) {
			node.style.display = "none";
		}
		return true;
	},
	firstLetter: function(inText) {
		var t = (inText || "").replace(/^\s*(https?:\/\/)?(www\.)?/i, "");
		return (t.charAt(0) || "?").toUpperCase();
	},
	tileClick: function(inSender) {
		// onclick is declared on the tile, so inSender is the tile (clicks on the
		// image/label child bubble up to it). bmIndex maps back to the record.
		// A tap navigates; a preceding hold (menu) or drag (reorder) must NOT navigate.
		if (this.dragging) {
			this.suppressTap = false;
			return true;
		}
		// A long-press that never turned into a drag -> open the context menu now, on release
		// (hold arms the drag; releasing in place instead shows Open / New Card / Remove).
		if (this.heldNoDrag) {
			this.heldNoDrag = false;
			this.suppressTap = false;
			if (this.menuBookmark) {
				this.$.tileMenu.openAtControl(this.heldTile || inSender, {top: 10});
			}
			return true;
		}
		if (this.suppressTap) {
			this.suppressTap = false;
			return true;
		}
		var bookmark = this.bookmarks && this.bookmarks[inSender.bmIndex];
		if (bookmark && bookmark.url) {
			// Reuse the existing nav path: onUrlChange -> BrowserApp.processUrlChange -> setUrl.
			this.doUrlChange(bookmark.url);
		}
		return true;
	},
	//* @protected
	// Long-press context menu ------------------------------------------------
	tileHold: function(inSender, inEvent) {
		if (this.dragging) {
			return true;
		}
		// A long-press ARMS a drag-to-reorder — it does NOT pop the menu here. Moving the finger reorders
		// the tile (tileDragStart); releasing in place instead opens the menu (tileClick, via heldNoDrag).
		// Swallow the click that the ensuing "up" may generate after a hold.
		this.suppressTap = true;
		this.heldNoDrag = true;
		this.heldTile = inSender;
		this.menuBookmark = this.bookmarks && this.bookmarks[inSender.bmIndex];
		return true;
	},
	tileMenuClosed: function() {
		// Guarantee the flags can't get wedged if no stray click ever arrives.
		this.suppressTap = false;
		this.heldNoDrag = false;
	},
	menuOpen: function() {
		var b = this.menuBookmark;
		this.$.tileMenu.close();
		if (b && b.url) {
			this.doUrlChange(b.url);
		}
		return true;
	},
	menuOpenNewCard: function(inSender, inEvent) {
		var b = this.menuBookmark;
		this.$.tileMenu.close();
		if (b && b.url) {
			// Mirror BrowserApp.newCardClick, but launch the new card straight at the
			// bookmark URL (the plain onNewCard event opens a blank card).
			window.atlasOpenCard({target: b.url});
		}
		return true;
	},
	menuRemove: function() {
		var b = this.menuBookmark;
		this.$.tileMenu.close();
		if (b && b._id) {
			// db8 delete by _id; the subscribed find's onWatch refreshes the grid.
			this.$.bookmarksWriteService.call({ids: [b._id]}, {method: "del"});
		}
		return true;
	},
	//* @protected
	// Drag-and-drop reorder --------------------------------------------------
	eventClientX: function(inEvent) {
		if (inEvent && typeof inEvent.clientX == "number") { return inEvent.clientX; }
		if (inEvent && typeof inEvent.pageX == "number") { return inEvent.pageX - (window.pageXOffset || 0); }
		return 0;
	},
	eventClientY: function(inEvent) {
		if (inEvent && typeof inEvent.clientY == "number") { return inEvent.clientY; }
		if (inEvent && typeof inEvent.pageY == "number") { return inEvent.pageY - (window.pageYOffset || 0); }
		return 0;
	},
	tileDragStart: function(inSender, inEvent) {
		// If the menu is somehow up, close it and proceed to reorder.
		if (this.$.tileMenu.showing) {
			this.$.tileMenu.close();
		}
		this.heldNoDrag = false;   // the hold became a real drag, not a menu-on-release
		if (this.bookmarks.length < 2) {
			return true; // nothing to reorder
		}
		this.dragging = true;
		this.suppressTap = true;
		this.dragFromIndex = inSender.bmIndex;
		this.dragTargetIndex = inSender.bmIndex;
		this.dragTile = inSender;
		this.dragStartX = this.eventClientX(inEvent);
		this.dragStartY = this.eventClientY(inEvent);
		// Record each tile's natural slot rect (before any drag transform) so the OTHER tiles can reflow to
		// open a gap at the drop position — webOS-launcher style, no drop-highlight box.
		this.slotRects = [];
		for (var si = 0, sn; si < this.tileControls.length; si++) {
			sn = this.tileControls[si].hasNode();
			this.slotRects.push(sn ? sn.getBoundingClientRect() : null);
		}
		var n = inSender.hasNode();
		if (n) {
			n.className += " startpage-tile-dragging";
		}
		// Returning true claims the gesture so the enclosing Scroller doesn't scroll.
		return true;
	},
	tileDrag: function(inSender, inEvent) {
		if (!this.dragging) {
			return true;
		}
		var x = this.eventClientX(inEvent);
		var y = this.eventClientY(inEvent);
		var n = this.dragTile && this.dragTile.hasNode();
		if (n) {
			n.style.webkitTransform = "translate(" + (x - this.dragStartX) + "px," + (y - this.dragStartY) + "px) scale(1.08)";
		}
		this.updateDropTarget(x, y);
		return true;
	},
	updateDropTarget: function(x, y) {
		// Target = the slot whose CENTER is nearest the finger, tested against each tile's NATURAL slot
		// (captured at drag start), NOT its live getBoundingClientRect. Two reasons: (1) the reflow moves the
		// tiles, so live rects would make the target oscillate; (2) nearest-center (vs. strict containment)
		// snaps to the first slot when the finger goes past the far left and the last slot past the far right,
		// so the item CAN be dropped before the leftmost / after the rightmost tile. slotRects and the finger
		// coords are in the same viewport frame. The dragged tile's own slot is included → staying home = no move.
		var target = this.dragFromIndex, bestD = Infinity;
		for (var i = 0, r, cx, cy, d; i < this.slotRects.length; i++) {
			r = this.slotRects[i];
			if (!r) { continue; }
			cx = (r.left + r.right) / 2; cy = (r.top + r.bottom) / 2;
			d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
			if (d < bestD) { bestD = d; target = i; }
		}
		if (target !== this.dragTargetIndex) {
			this.dragTargetIndex = target;
			this.reflowTiles(target);
		}
	},
	// webOS-launcher style: instead of a drop-highlight box, slide the OTHER tiles over so a gap opens at the
	// drop position. Each non-dragged tile animates from its natural slot to the slot it would occupy once the
	// dragged tile is removed from `from` and reinserted at `target`.
	reflowTiles: function(target) {
		var F = this.dragFromIndex;
		for (var i = 0, node, src, dst, j; i < this.tileControls.length; i++) {
			if (i === F) { continue; }   // the lifted tile follows the finger, not the reflow
			node = this.tileControls[i].hasNode();
			src = this.slotRects[i];
			if (!node || !src) { continue; }
			j = i;                                  // where tile i ends up once F -> target
			if (F < target) { if (i > F && i <= target) { j = i - 1; } }
			else if (F > target) { if (i >= target && i < F) { j = i + 1; } }
			dst = this.slotRects[j];
			if (dst) {
				node.style.webkitTransform = (j === i) ? "" :
					("translate(" + (dst.left - src.left) + "px," + (dst.top - src.top) + "px)");
			}
		}
	},
	tileDragFinish: function(inSender, inEvent) {
		if (!this.dragging) {
			return true;
		}
		this.dragging = false;
		var from = this.dragFromIndex;
		var to = this.dragTargetIndex;
		// Clear the reflow transforms on all tiles (a reorder rebuilds them, but a no-op drop won't).
		for (var i = 0, cn; i < this.tileControls.length; i++) {
			cn = this.tileControls[i].hasNode();
			if (cn) { cn.style.webkitTransform = ""; }
		}
		var n = this.dragTile && this.dragTile.hasNode();
		if (n) {
			n.className = n.className.replace(/\s*startpage-tile-dragging/g, "");
		}
		this.dragTile = null;
		// Defer the reorder+rebuild OUT of this drag-finish dispatch: buildTiles() calls
		// grid.destroyControls(), and destroying the control tree while enyo is still dispatching the
		// gesture wedges the dispatcher so the NEXT drag won't register. A 0ms async breaks that.
		if (to !== from && to >= 0 && to < this.bookmarks.length) {
			var self = this;
			window.setTimeout(function() { self.commitReorder(from, to); }, 0);
		}
		return true;
	},
	commitReorder: function(inFrom, inTo) {
		// Move the record in the local array, then renumber idx = 0..n-1 across the
		// whole set and merge in one batch so the order survives reload.
		var order = this.bookmarks.slice();
		var moved = order.splice(inFrom, 1)[0];
		order.splice(inTo, 0, moved);
		var objs = [];
		for (var i = 0; i < order.length; i++) {
			order[i].idx = i;
			objs.push({_id: order[i]._id, idx: i});
		}
		this.bookmarks = order;
		// Instant local feedback; the subscribed find will re-confirm the same order.
		this.buildTiles();
		if (objs.length) {
			this.$.bookmarksWriteService.call({objects: objs}, {method: "merge"});
		}
	},
	//* @public
	resize: function() {
		this.$.actionbar.resize();
	},
	getUrl: function() {
		return this.$.actionbar.getUrl();
	}
});
