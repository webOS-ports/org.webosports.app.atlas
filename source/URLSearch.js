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
	name: "URLSearch",
	kind: enyo.Control,
	published: {
		url: "",
		searchPreferences: [],
		defaultSearch: "",
		loading: false,
		/* Where the suggestion popup sits, as an offset added to the address field's own height.
		 * Note .addressbar-popup carries `margin: -36px 0` (css/browser.css), so the popup's visible
		 * top lands at fieldTop + fieldHeight + popupOffsetTop - 36: the tablet's 29 therefore tucks
		 * it 7px UNDER the field, behind its 24px 9-slice frame. Anything much below 36 covers the
		 * field instead - at 4 the popup started exactly at the field's top and hid what was being
		 * typed. See PhoneActionBar for the phone's value. */
		popupOffsetTop: 29,
		/* Cap on how many suggestion rows are shown. 0 keeps the historical behaviour: bookmarks and
		 * history are concatenated unbounded (only the search suggestions honour maxSearchResults),
		 * which on a phone filled the screen with 14 rows. */
		maxRows: 0
	},
	maxSearchResults: 32,
	suggestURL: "http://suggestqueries.google.com/complete/search?client=firefox&q={$query}",
	className: "addressbar",
	events: {
		onLoad: "",
		onStopLoad: "",
		onRefresh: "",
		onAddressInputFocused: "",
		onAddressInputBlurred: "",
		onAddBookmark: "",
		onDeleteBookmark: ""
	},
	components: [
		{name: "bookmarksService", kind: "DbService", method: "search", dbKind: "com.palm.browserbookmarks:1", onSuccess: "gotBookmarksData", onFailure: "finishShowSearchResults"},
		{name: "historyService", kind: "DbService", method: "search", dbKind: "com.palm.browserhistory:1", onSuccess: "gotHistoryData", onFailure: "finishShowSearchResults"},
		{name: "suggestSearch", kind: "WebService", onSuccess: "gotSearchSuggestion", onFailure: "endSearchSuggestion"},
		{name: "address", kind: "AddressInput", flex: 1, hint: $L("Enter URL or search terms"),
			onInputChange: "startSearch",
			onGo: "go",
			onStop: "doStopLoad",
			onRefresh: "doRefresh",
			onAddressInputFocused: "doAddressInputFocused",
			onAddressInputBlurred: "doAddressInputBlurred",
			onAddBookmark: "doAddBookmark",
			onDeleteBookmark: "doDeleteBookmark"
		},
		{name: "searchPopup", kind: "Menu", lazy: false, modal: false, className: "addressbar-popup", components: [
			{name: "providersList", className: "addressbar-providerslist", kind: "VirtualRepeater", onSetupRow: "providersListGetItem", components: [
				{name: "providerItem", kind: "Item", layoutKind: "HFlexLayout", tapHighlight: true, onclick: "providerClick", components: [
					{name: "providerTitle", width: "100%", className: "addressbar-provider-title"},
					{name: "providerIcon", kind: "Image", style: "height:35px; width 35px;"}
				]}
			]},
			{name: "popDivider", kind: "Control", className: "addressbar-popup-divider", showing: false},
			{name: "resultsList", className: "addressbar-resultslist", kind: "VirtualRepeater", onSetupRow: "resultsListGetItem", components: [
				{name: "resultsItem", kind: "Item", layoutKind: "HFlexLayout", tapHighlight: true, onclick: "resultClick", components: [
					{width: "100%", components: [
						{name: "resultsTitle", className: "url-item-title enyo-text-ellipsis"},
						{name: "resultsUrl", className: "url-item-url enyo-item-ternary enyo-text-ellipsis"}
					]},
					{name: "resultsImage", className: "url-item-image", kind: "Image" , style: "height:35px; width 35px;" },
				]}
			]}
		]}
	],
	//* @protected
	defaultSearchPreferences: [{
		title: "Google",
		url: "https://www.google.com/search?q={$query}",
		icon: "list-icon-google.png"
	}, {
		title: "Wikipedia",
		url: "https://en.wikipedia.org/wiki/Special:Search?search={$query}",
		icon: "list-icon-wikipedia.png"
	}],
	_boxSize: {},
	_searchResults: [],
	//* @protected
	rendered: function() {
		this.cacheBoxSize();
	},
	cacheBoxSize: function() {
		this._boxSize = enyo.fetchControlSize(this);
	},
	urlChanged: function() {
		this.$.address.setUrl(this.url);
	},
	startSearch: function() {
		this._value = this.$.address.getUserInput(true);
		if (this._value.length > 1) {
			enyo.job(this.id + "search", enyo.bind(this, "showSearchResults"), 150);
		} else {
			enyo.job.stop(this.id + "search");
			this.closeSearchPopup(true);
		}
	},
	showSearchResults: function() {
		// atlas: schemes (e.g. atlas:about) are internal pages — no suggestions popup.
		if (/^atlas:/i.test(this._value)) {
			this.closeSearchPopup(true);
			return;
		}
		var uri = enyo.uri.parseUri(this._value);
		if (uri.scheme && enyo.uri.isValidScheme(uri)) {
			this.$.providersList.setShowing(false);
		} else {
			this.$.providersList.render();
			this.$.providersList.setShowing(true);
		}
		this._searchResults = [];
		this.fetchSearchResults("bookmarksService", {limit:32});
	},
	finishShowSearchResults: function() {
		if (this.maxRows > 0 && this._searchResults.length > this.maxRows) {
			this._searchResults.length = this.maxRows;
		}
		this.$.resultsList.render();
		var empty = !this.$.providersList.showing && this._searchResults.length == 0;
		if (!this.$.searchPopup.isOpen && this.$.address.hasFocus() && !empty) {
			var n = this.$.address.hasNode();
			var o = enyo.dom.calcNodeOffset(n);
			this.$.searchPopup.scrollIntoView(0, 0);
			this.$.searchPopup.applyStyle("width", n.offsetWidth+10 + "px");
			this.$.searchPopup.openAtControl(this.$.address, {left: -5, top: n.offsetHeight + this.popupOffsetTop});
		} else if (empty && this.$.searchPopup.isOpen) {
			this.closeSearchPopup(true);
		}
	},
	fetchSearchResults: function(inServiceName, inMixin) {
		var query = {
			where:[{prop:"searchText", op:"?", val:this._value, collate:"primary"}],
			orderBy: "_rev",
			desc:true
		};
		enyo.mixin(query, inMixin);
		this.$[inServiceName].call({query:query});
	},
	gotBookmarksData: function(inSender, inResponse) {
		this._searchResults = inResponse.results;
		if (this._searchResults.length >= this.maxSearchResults) {
			this.finishShowSearchResults();
		} else {
			this.fetchSearchResults("historyService", {orderBy:"date", limit:50});
		}
	},
	gotHistoryData: function(inSender, inResponse) {
		this._searchResults = this._searchResults.concat(inResponse.results);
		if(this._searchResults.length > 0) {
			this.$.popDivider.show();
		} else {
			this.$.popDivider.hide();
		}
		// Show bookmark/history results immediately, then fetch search
		// suggestions asynchronously so a slow/offline network never
		// delays the dropdown.
		this.finishShowSearchResults();
		if (this._searchResults.length < this.maxSearchResults) {
			this.fetchSearchSuggestions();
		}
	},
	fetchSearchSuggestions: function() {
		var v = this.$.address.getUserInput(true);
		if (this.suggestURL && v && v.length > 1) {
			var suggestStr = enyo.macroize(this.suggestURL, {query: escape(v)});
			this.$.suggestSearch.setUrl(suggestStr);
			this.$.suggestSearch.call();
		}
	},
	gotSearchSuggestion: function(inSender, inResponse) {
		try {
			// firefox-client format: [query, [s1, s2, ...]]. Drop stale
			// responses where the query no longer matches the input.
			if (inResponse && inResponse[1] && inResponse[0] == this.$.address.getUserInput(true)) {
				var suggestItems = inResponse[1] || [];
				var provider = this.searchPreferences[0] || this.defaultSearchPreferences[0];
				var providerIconPath = provider.iconFilePath;
				var providerUrl = provider.url;
				var added = false;
				for (var i=0; i < suggestItems.length && this._searchResults.length < this.maxSearchResults; i++) {
					this._searchResults.push({title: suggestItems[i], url: enyo.macroize(providerUrl, {query: escape(suggestItems[i])}), iconFile32: providerIconPath});
					added = true;
				}
				if (added) {
					this.$.popDivider.show();
					this.finishShowSearchResults();
				}
			}
		} catch (e) {
			this.log("search suggestion error: " + e);
		}
	},
	endSearchSuggestion: function(inSender, inResponse) {
		// suggest request failed; bookmark/history results are already shown.
	},
	searchPreferencesChanged: function() {
		for (var i=0,s;s=this.searchPreferences[i];i++) {
			var url = s.url.replace(/\#\{searchTerms\}/, "{$query}");
			enyo.mixin(s, {url: url});
		}
	},
	defaultSearchChanged: function() {
		var sp = [];
		for (var i=0,s;s=this.searchPreferences[i];i++) {
			if (s.id === this.defaultSearch) {
				sp.unshift(s);
			} else {
				sp.push(s);
			}
		}
		this.searchPreferences = sp;
	},
	loadingChanged: function() {
		this.$.address.setLoading(this.loading);
	},
	providersListGetItem: function(inSender, inIndex) {
		if (inIndex == 0) {
			var list = this.searchPreferences;
			var provider = list[inIndex];
			if (!provider) {
				return;
			}
			// FIXME: set top-bottom item styling
			var s = inIndex == 0 ? "border-top: 0;" : (inIndex == list.length-1 ? "border-bottom: 0;" : "");
			// title
			var v = this.$.address.getUserInput(true);
			var t = provider.displayName + (v ? ' "' + v + '"' : "");
			this.$.providerItem.setStyle(s);
			this.$.providerTitle.setContent(t);
			this.$.providerIcon.setSrc(provider.iconFilePath);
			return true;
		}
	},
	providerClick: function(inSender, inEvent, inRowIndex) {
		var provider = this.defaultSearchPreferences[0];
		if (window.PalmSystem) {
			provider = this.searchPreferences[inRowIndex];
		}
		this.closeSearchPopup();
		this.log(this.$.address.getUserInput(true));
		this.doLoad(enyo.macroize(provider.url, {query: escape(this.$.address.getUserInput(true))}));
	},
	resultsListGetItem: function(inSender, inIndex) {
		var item = this._searchResults[inIndex];
		if ((!item) || (!item.title)) {
                        enyo.log("No item or item.title found in history DB");
			return;
		}
		var s = "";
		if (inIndex == 0) s += "border-top: 0;";
		if (inIndex == this._searchResults.length - 1)  s += "border-bottom: 0;";
		this.$.resultsItem.style = s;
		var icon = item.iconFile32 || item.thumbnailFile || "images/header-icon-history.png";
		this.$.resultsImage.showing = Boolean(icon);
		this.$.resultsImage.domAttributes.src = icon;
		this.$.resultsTitle.content = enyo.string.applyFilterHighlight(item.title, this._value, "addressbar-highlight");
		this.$.resultsUrl.content = enyo.string.applyFilterHighlight(item.url, this._value, "addressbar-highlight");
		return true;
	},
	// UNUSED/TODO(audit A2-6): no caller or enyo handler-wiring found — revisit in detail before deleting.
	highlightResultText: function(inText) {
		var i = inText.search(new RegExp(this._value, "i"));
		if (i <=0) {
			return inText;
		}
		var l = this._value.length;
		var b = inText.slice(0, i);
		var m = inText.slice(i, i+l);
		var e = inText.slice(i+l);
		return  b + "<span class=\"addressbar-highlight\">" + m + "</span>" + e;
	},
	resultClick: function(inSender, inEvent, inRowIndex) {
		var i = this._searchResults[inRowIndex];
		this.closeSearchPopup();
		document.activeElement.blur();
		this.doLoad(i.url);
	},
	go: function(inSender, inValue) {
		// atlas: schemes (e.g. atlas:about) are internal pages — load directly, don't search.
		if (/^atlas:/i.test(inValue)) {
			this.doLoad(inValue);
			this.closeSearchPopup();
			return;
		}
		// file:// URLs (local files) are valid but enyo.uri.isValidScheme/isValidUri reject them
		// (unknown scheme + empty host for file:///path), so they'd wrongly fall through to a Google
		// search. Load directly, like the atlas: case above.
		if (/^file:\/\//i.test(inValue)) {
			this.doLoad(inValue);
			this.closeSearchPopup();
			return;
		}
		var uri = enyo.uri.parseUri(inValue);
		if ((enyo.uri.isValidScheme(uri) && this.isUri(inValue, uri)) || (enyo.windowParams.allowAllSchemes && uri.scheme)) {
			this.doLoad(inValue);
		} else {
			this.providerClick(null, null, 0);
		}
		this.closeSearchPopup();
	},
	isUri: function(inText, inUri) {
		// probably a search term if there is a space
		if (inText.match(/\s/)) {
			return false;
		}
		return enyo.uri.isValidUri(inUri);
	},
	//* public
	resize: function() {
		// need to handle resize manually here because the
		// search dropdown needs to match the width of the
		// address bar, and Popup doesn't have a minSize
		// setting yet
		var s = enyo.fetchControlSize(this);
		if (s.w != this._boxSize.w && this.$.searchPopup.isOpen) {
			this.$.searchPopup.close();
			this.finishShowSearchResults();
		}
		this.cacheBoxSize();
	},
	forceFocus: function() {
		this.$.address.forceFocus();
	},
	closeSearchPopup: function(inKeepFocus) {
		this.log(inKeepFocus);
		// FIXME: eliminate transition artifact
		setTimeout(enyo.hitch(this, function() {
			if (this.$.searchPopup.isOpen) {
				this.$.searchPopup.close();
				if (!inKeepFocus) {
					document.activeElement.blur();
				}
			}
		}), 1);
	}
});