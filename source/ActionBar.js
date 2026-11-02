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
	name: "ActionBar",
	kind: enyo.VFlexBox,
	defaultKind: "ToolButton",
	pack: "center",
	className: "enyo-toolbar actionbar",
	published: {
		url: "",
		title: "",
		canGoBack: false,
		canGoForward: false,
		canShare: true,
		currentPage: {},
		historyUrl: "",
		searchPreferences: {},
		defaultSearch: "",
		progress: 0,
		loading: false,
		showTranslate: false,
		searchSuggestions: false
	},
		backHistory: [],
	forwardHistory: [],
	wentBackOrForward: false,
	buttonHeld: false,
	events: {
		onBack: "",
		onForward: "",
		onLoad: "",
		onStopLoad: "",
		onRefresh: "",
		onAddBookmark: "",
		onDeleteBookmark: "",
		onAddToLauncher: "",
		onShareLink: "",
		onOpenBookmarks: "",
		onNewCard: "",
		onHistorySelected: "",
		onTranslate: ""
	},
	components: [
    	{kind: "Control", showing: false, name: "title", className: "page-title enyo-text-ellipsis", content: "Untitled"},
		{kind: enyo.HFlexBox, className: "menu-container", align: "center", components: [
			{kind: "ToolButton", name: "back", className: "actionbar-tool-button", icon: "images/chrome/menu-icon-back.png", onclick: "goBack", onmousehold: "openBackHistoryPopup"},
			{kind: "ToolButton", name: "forward", className: "actionbar-tool-button", icon: "images/chrome/menu-icon-forward.png", onclick: "goForward", onmousehold: "openForwardHistoryPopup"},
			{kind: "ToolButton", name: "search", className: "actionbar-tool-button", flex: 1, kind: "URLSearch", onLoad: "doLoad", onStopLoad: "doStopLoad", onRefresh: "doRefresh", onAddressInputFocused: "hideButtons", onAddressInputBlurred: "showButtons", onAddBookmark: "doAddBookmark", onDeleteBookmark: "doDeleteBookmark"},
			{kind: "ToolButton", name: "share", className: "actionbar-tool-button", icon: "images/chrome/menu-icon-share.png", onclick: "showSharePopup"},
			{kind: "ToolButton", name: "newcard", className: "actionbar-tool-button", icon: "images/chrome/menu-icon-newcard.png", onclick: "doNewCard"},
			{kind: "ToolButton", name: "bookmarks", className: "actionbar-tool-button", icon: "images/chrome/menu-icon-bookmark.png", onclick: "doOpenBookmarks"},
			{name: "translateButton", kind: "Image", className: "actionbar-tool-button atlas-translate-button", src: "images/translate-icon.png", showing: false, onclick: "doTranslateClick"},
			{name: "kbButton", kind: "Image", className: "actionbar-tool-button atlas-kb-button", src: "images/icon-hide-keyboard.png", onclick: "changeKB"},
		]},
		{name: "sharePopup", className: "launch-popup",  kind: "Menu", components: [
			{caption: $L("Add Bookmark"), onclick: "doAddBookmark"},
			{caption: $L("Share Link"), onclick: "doShareLink"},
			{caption: $L("Add to Launcher"), onclick: "doAddToLauncher"}
		]},
		{name: "backPopup", kind: "Popup", className: "history-popup", onClose: "backPopupClosed", components: []},
		{name: "forwardPopup", kind: "Popup", className: "history-popup", onClose: "forwardPopupClosed", components: []},
		{name: "progressBar", kind: "ProgressBar", className: "url-progress invisible", animatePosition: false},
	],
	//* @public
	hideButtons: function() {
		if ( enyo.getWindowOrientation() == "up" || enyo.getWindowOrientation() == "down") {
			this.$.back.hide();
			this.$.forward.hide();
			this.$.share.hide();
			this.$.newcard.hide();
			//this.$.bookmarks.hide();
		}
	},
	showButtons: function() {
		this.$.back.show();
		this.$.forward.show();
		this.$.share.show();
		this.$.newcard.show();
		//this.$.bookmarks.show();
	},	
	resize: function() {
		this.$.search.resize();
	},
	forceFocus: function() {
		this.$.search.forceFocus();
	},
	forceBlur: function() {
		this.$.search.closeSearchPopup();
	},
	//* @protected
	create: function() {
		this.inherited(arguments);
		this.urlChanged();
		this.titleChanged();
		this.canGoBackChanged();
		this.canGoForwardChanged();
		this.canShareChanged();
		this.loadingChanged();
	},
	urlChanged: function() {
		this.$.search.setUrl(this.url);
	},
	titleChanged: function() {
		this.$.title.setContent(this.title || $L("Untitled"));
	},
	canGoBackChanged: function() {
		this.$.back.setDisabled(!this.canGoBack);
	},
	canGoForwardChanged: function() {
		this.$.forward.setDisabled(!this.canGoForward);
	},
	canShareChanged: function() {
		this.$.share.setDisabled(!this.canShare);
	},
	searchPreferencesChanged: function() {
		this.$.search.setSearchPreferences(this.searchPreferences);
	},
	defaultSearchChanged: function() {
		this.$.search.setDefaultSearch(this.defaultSearch);
	},
	searchSuggestionsChanged: function() {
		this.$.search.setSearchSuggestions(this.searchSuggestions);
	},
	showSharePopup: function(inSender, inEvent) {
		this.$.sharePopup.openAt({top: -1000});
		var pop = this.$.sharePopup.getBounds(); 
		this.$.sharePopup.close();
		this.$.sharePopup.openAtControl(this.$.share, {left: -pop.width+10, top: 26});
	},
		closeHistoryPopups: function() {
		if (this.buttonHeld) this.$[this.buttonHeld+"Popup"].close();
	},
 	currentPageChanged: function(oldValue, newValue) {
		this.closeHistoryPopups();
		if (!this.wentBackOrForward && oldValue.url) {
			this.backHistory.unshift(oldValue);
			if (this.forwardHistory.length > 0) this.forwardHistory.splice(0, this.forwardHistory.length);
		} else {
			this.wentBackOrForward = false;
		}
		this.canGoBack = this.backHistory.length > 0;
		this.canGoForward = this.forwardHistory.length > 0;
	},
	/* The history entry is captured (setCurrentPage) at ~10% load, before the real <title> parses, so it
	 * grabs "Untitled"/a stale title. When the real title later arrives for the SAME url, patch the entry. */
	updateCurrentTitle: function(inUrl, inTitle) {
		if (inTitle && this.currentPage && this.currentPage.url === inUrl && this.currentPage.title !== inTitle) {
			this.currentPage.title = inTitle;
		}
	},
	goBack: function(inIndex) {
		if (!this.buttonHeld && this.backHistory.length > 0) {
			if (isNaN(inIndex)) {
				this.forwardHistory.unshift(this.currentPage);
				this.historyUrl = this.backHistory[0].url;
				this.backHistory.shift();
			} else {
				this.forwardHistory.unshift(this.currentPage);
				for (var i=0; i<inIndex; i++) {
					this.forwardHistory.unshift(this.backHistory[i]);
				}
				this.historyUrl = this.backHistory[inIndex].url;
				this.backHistory.splice(0,inIndex+1);
			}
			this.wentBackOrForward = true;
			this.doHistorySelected();
		}
	},
	goForward: function(inIndex) {
		if (!this.buttonHeld && this.forwardHistory.length > 0) {
			if (isNaN(inIndex)) {
				this.backHistory.unshift(this.currentPage);
				this.historyUrl = this.forwardHistory[0].url;
				this.forwardHistory.shift();
			} else {
				this.backHistory.unshift(this.currentPage);
				for (var i=0; i<inIndex; i++) {
					this.backHistory.unshift(this.forwardHistory[i]);
				}
				this.historyUrl = this.forwardHistory[inIndex].url;
				this.forwardHistory.splice(0,inIndex+1);
			}
			this.wentBackOrForward = true;
			this.doHistorySelected();
		}
	},
	populateHistoryPopups: function() {
		var a = (this.buttonHeld == "back" ? this.backHistory : this.forwardHistory);
		var popup = this.$[this.buttonHeld+"Popup"];
		popup.destroyControls();
		for(var i=0; i<a.length; i++) {
			popup.createComponent({kind: "HistoryItem", hb: this.buttonHeld, url: a[i].url, index: i, content: a[i].title, onclick: "selectHistoryItem", owner: this});
		}
	},
	openBackHistoryPopup: function() {
		if (this.buttonHeld) {
			this.closeHistoryPopups();
		}
		this.buttonHeld = "back";
		this.$.back.setDepressed(true);
		this.$.backPopup.openAt({left: 0, top: 53});
		this.populateHistoryPopups();
		this.$.backPopup.render();
	},
	backPopupClosed: function() {
		this.$.back.setDepressed(false);
		this.buttonHeld = false;
	},
	openForwardHistoryPopup: function() {
		if (this.buttonHeld) {
			this.closeHistoryPopups();
		}
		this.buttonHeld = "forward";
		this.$.forward.setDepressed(true);
		this.$.forwardPopup.openAt({left: this.$.forward.getBounds().left, top: 53});
		this.populateHistoryPopups();
		this.$.forwardPopup.render();
	},
	forwardPopupClosed: function() {
		this.$.forward.setDepressed(false);
		this.buttonHeld = false;
	},
	selectHistoryItem: function(inSender) {
		this.closeHistoryPopups();
		if (inSender.hb == "forward") {
			this.goForward(inSender.index);
		} else {
			this.goBack(inSender.index);
		}
	},
	progressChanged: function() {
		this.$.progressBar.setPosition(this.progress);
	},
	loadingChanged: function() {
		this.$.search.setLoading(this.loading);
		if (this.loading) {
			if (this.$.progressBar.hasClass("invisible")) {
				this.$.progressBar.removeClass("invisible");
			}
		} else {
			if (!this.$.progressBar.hasClass("invisible")) {
				this.$.progressBar.addClass("invisible"); 
			}
		}
	},
	changeKB: function(){
		if (enyo.keyboard.isShowing()){
			enyo.keyboard.forceHide();
			enyo.keyboard.setManualMode(false);
		}
		else{
		enyo.keyboard.forceShow(0);
		}
	},
	//* Google Translate button: shown in the address bar only when "Offer to translate pages" is enabled.
	showTranslateChanged: function() {
		if (this.$.translateButton) { this.$.translateButton.setShowing(this.showTranslate); }
	},
	doTranslateClick: function() {
		this.doTranslate();
	}
 });

enyo.kind({
	name: "HistoryItem",
	kind: "Item",
	className: "history-row",
	tapHighlight: true,
	published: {
		index: "",
		title: "",
		url: ""
	}
});