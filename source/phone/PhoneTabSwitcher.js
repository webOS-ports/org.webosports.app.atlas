/* Full-screen tab switcher.
 *
 * On the TouchPad the tabs live in a 34px strip along the top. At 450 css px that strip gives each tab
 * ~90px — unreadable and untappable — and it costs height permanently, so the phone hides it and puts
 * the count in the bottom bar instead. This is the screen that count opens: one row per tab, closed by
 * swiping the row aside and confirming, exactly as a bookmark, a history entry or a password is
 * deleted elsewhere in the app (SwipeableItem + onConfirm, see BookmarkList.js:36). Captioned "Close"
 * rather than "Delete": a tab is being closed, not data destroyed.
 *
 * It is also the closest thing to how webOS actually worked: the phone browser had no tab UI at all,
 * because every page was a card and the card switcher WAS this screen.
 *
 * Emits the same three events AtlasTabStrip does (onSelectTab / onCloseTab / onNewTab, each carrying a
 * tab index), so PhoneLayer wires it to TabLayer's existing atlasSelectTab / atlasCloseTab /
 * atlasNewTab and no tab bookkeeping is duplicated here.
 *
 * ROWS ARE REAL COMPONENTS — one SwipeableItem per tab, rebuilt when the tab list changes — and not
 * flyweight rows in a VirtualRepeater. Both reasons were measured on device:
 *
 *   - A SwipeableItem does not render AT ALL as a VirtualRepeater row: the repeater's RowServer
 *     flyweight and the swipeable's own confirm chrome do not compose, and the list came out empty.
 *     The lists that do this elsewhere in Atlas sit inside DbList, a real list kind.
 *   - SwipeableItem reports the swiped row as `this.index`, which list kinds set on their rows and the
 *     flyweight does not — so the index arrived undefined. That is dangerous, not just broken:
 *     TabLayer.atlasCloseTab guards with `inIndex < 0 || inIndex >= tabs.length` and BOTH comparisons
 *     are false for undefined, so the bad index sails past the guard and `tabs.splice(undefined, 1)`
 *     silently closes tab 0 — the wrong tab — before Math.min(undefined, ...) yields a NaN that
 *     crashes atlasSelectIndex.
 *
 * A real instance per row owns its own index, which makes that class of bug impossible, and with a
 * handful of tabs there is nothing for a flyweight to save.
 *
 * Chromium host only: the WPE host has real cards and no in-app tabs. */
enyo.kind({
    name: "PhoneTabSwitcher",
    kind: enyo.VFlexBox,
    className: "basic-back atlas-phone-tabswitcher",
    published: {
        tabs: [],
        activeIndex: 0
    },
    events: {
        onSelectTab: "",
        onCloseTab: "",
        onNewTab: "",
        onClose: ""
    },
    components: [
        {kind: "Header", className: "enyo-header-dark", components: [
            {name: "headerTitle", flex: 1, className: "atlas-phone-list-title", content: ""},
            {name: "newTab", kind: "ToolButton", className: "atlas-phone-newtab-button",
             icon: "images/chrome/menu-icon-add.png", onclick: "newTabClick"}
        ]},
        {kind: "Scroller", flex: 1, components: [
            {name: "rows"}
        ]},
        {kind: "Toolbar", components: [
            {kind: "Button", flex: 1, caption: $L("New Tab"), onclick: "newTabClick"},
            {kind: "Button", flex: 1, caption: $L("Done"), onclick: "doneClick"}
        ]}
    ],
    //* @protected
    create: function() {
        this.inherited(arguments);
        this.phoneBuildRows();
    },
    tabsChanged: function() {
        this.phoneBuildRows();
    },
    activeIndexChanged: function() {
        this.phoneBuildRows();
    },
    phoneBuildRows: function() {
        if (!this.$ || !this.$.rows) { return; }
        var tabs = this.tabs || [], n = tabs.length;
        this.$.headerTitle.setContent(n === 1 ? $L("1 Tab")
                                              : enyo.macroize($L("{$count} Tabs"), {count: n}));
        this.$.rows.destroyControls();
        for (var i = 0; i < n; i++) {
            var t = tabs[i];
            // about:blank is what a fresh tab's url reads as; it is not a label for one.
            var url = (t.url === "about:blank") ? "" : (t.url || "");
            this.$.rows.createComponent({
                kind: "SwipeableItem", index: i, confirmCaption: $L("Close"),
                layoutKind: "HFlexLayout", align: "center", tapHighlight: true,
                className: "atlas-phone-tab-row" + (i === this.activeIndex ? " atlas-phone-tab-active" : ""),
                onclick: "rowClick", onConfirm: "closeRow",
                components: [
                    {kind: "Image", className: "atlas-phone-tab-icon",
                     src: t.favicon || "images/bookmark-icon-default.png"},
                    {flex: 1, className: "atlas-phone-tab-text", components: [
                        {className: "url-item-title enyo-text-ellipsis",
                         content: t.title || url || $L("New Tab")},
                        {className: "url-item-url enyo-item-ternary enyo-text-ellipsis", content: url}
                    ]}
                ]
            }, {owner: this});
        }
        this.$.rows.render();
    },
    /* Both handlers take the index off the row that was tapped or swiped — the instance owns it. */
    rowClick: function(inSender) {
        var i = this.phoneRowIndex(inSender && inSender.index);
        if (i === null) { return true; }
        return atlasPhoneTap(this, "select:" + i, this.doSelectTab, [i]);
    },
    closeRow: function(inSender, inIndex) {
        var i = this.phoneRowIndex(typeof inIndex === "number" ? inIndex
                                                               : (inSender && inSender.index));
        if (i === null) { return true; }
        return atlasPhoneTap(this, "close:" + i, this.doCloseTab, [i]);
    },
    /* Refuse to act on an index the tab bookkeeping would mis-handle rather than pass it on: see the
     * splice(undefined, 1) note at the top of this file. */
    phoneRowIndex: function(inIndex) {
        if (typeof inIndex !== "number" || isNaN(inIndex) ||
            inIndex < 0 || inIndex >= (this.tabs || []).length) {
            try { console.log("[Atlas] phone tab switcher: ignoring row event, index " + inIndex); } catch (e) {}
            return null;
        }
        return inIndex;
    },
    newTabClick: function() {
        return atlasPhoneTap(this, "newTab", this.doNewTab);
    },
    doneClick: function() {
        return atlasPhoneTap(this, "done", this.doClose);
    }
});
