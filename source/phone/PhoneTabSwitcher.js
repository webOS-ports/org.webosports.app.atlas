/* Full-screen tab switcher.
 *
 * On the TouchPad the tabs live in a 34px strip along the top. At 450 css px that strip gives each tab
 * ~90px — unreadable and untappable — and it costs height permanently, so the phone hides it and puts
 * the count in the bottom bar instead. This is the screen that count opens: one row per tab, each with
 * an X to close it.
 *
 * It is also the closest thing to how webOS actually worked: the phone browser had no tab UI at all,
 * because every page was a card and the card switcher WAS this screen.
 *
 * Closing is ONE TAP on the X, deliberately not the swipe-and-confirm that deletes a bookmark or a
 * password elsewhere in the app. That gesture is right for destroying data, where the confirm step
 * earns its keep; closing a tab is cheap and frequent, and two steps for it felt as long in use as it
 * sounds here.
 *
 * Emits the same three events AtlasTabStrip does (onSelectTab / onCloseTab / onNewTab, each carrying a
 * tab index), so PhoneLayer wires it to TabLayer's existing atlasSelectTab / atlasCloseTab /
 * atlasNewTab and no tab bookkeeping is duplicated here.
 *
 * ROWS ARE REAL COMPONENTS — one per tab, rebuilt when the tab list changes — and not flyweight rows
 * in a VirtualRepeater, which is worth keeping that way: a swipeable row does not render at all as a
 * repeater row (the RowServer flyweight and the swipeable's confirm chrome do not compose), and a
 * flyweight never sets the per-row `index` that such a row reports. That index arrived undefined and
 * was dangerous rather than merely broken: TabLayer.atlasCloseTab guards with
 * `inIndex < 0 || inIndex >= tabs.length` and BOTH comparisons are false for undefined, so the bad
 * index sailed past it and `tabs.splice(undefined, 1)` silently closed tab 0 — the wrong tab — before
 * Math.min(undefined, ...) yielded a NaN that crashed atlasSelectIndex. Real rows own their identity,
 * and with a handful of tabs there is nothing for a flyweight to save.
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
                // tabName is the identity; index is only where the row happens to sit today.
                kind: "Item", index: i, tabName: t.name || "",
                layoutKind: "HFlexLayout", align: "center", tapHighlight: true,
                className: "atlas-phone-tab-row" + (i === this.activeIndex ? " atlas-phone-tab-active" : ""),
                onclick: "rowClick",
                components: [
                    {kind: "Image", className: "atlas-phone-tab-icon",
                     src: t.favicon || "images/bookmark-icon-default.png"},
                    {flex: 1, className: "atlas-phone-tab-text", components: [
                        {className: "url-item-title enyo-text-ellipsis",
                         content: t.title || url || $L("New Tab")},
                        {className: "url-item-url enyo-item-ternary enyo-text-ellipsis", content: url}
                    ]},
                    // Carries tabName itself: the handler is given the button, not the row.
                    {kind: "CustomButton", tabName: t.name || "",
                     className: "addressbar-button stop-button atlas-phone-tab-close",
                     onclick: "closeRowClick"}
                ]
            }, {owner: this});
        }
        this.$.rows.render();
    },
    /* Both handlers work from the row's tabName, not its position.
     *
     * Position is not stable across the very actions these handlers cause: closing a tab rebuilds the
     * list, so the NEXT tab slides into the index just vacated. Keyed by index, the tap guard then
     * reads a second close as the same close repeated and drops it — which is exactly the "delete
     * from the list is not reliable, they do not get deleted and the counter does not update" that
     * showed up in use. Identity also means the index handed to the tab bookkeeping is resolved fresh
     * at fire time rather than remembered from when the row was built. */
    rowClick: function(inSender) {
        var name = inSender && inSender.tabName;
        var i = this.phoneIndexOf(name, inSender && inSender.index);
        if (i === null) { return true; }
        return atlasPhoneTap(this, "select:" + (name || i), this.doSelectTab, [i]);
    },
    /* The X. Returning true claims the tap so the row's own onclick does not also fire and select the
     * tab that is being closed. */
    closeRowClick: function(inSender) {
        var name = inSender && inSender.tabName;
        var i = this.phoneIndexOf(name, null);
        if (i === null) { return true; }
        return atlasPhoneTap(this, "close:" + (name || i), this.doCloseTab, [i]);
    },
    /* Where does that tab sit NOW? By name, falling back to the row's build-time index for a tab with
     * no name. Refuses to answer rather than guess: an index the tab bookkeeping mis-handles is worse
     * than no action, since atlasCloseTab's bounds check passes for undefined and then closes tab 0
     * (see the note at the top of this file). */
    phoneIndexOf: function(inName, inIndex) {
        var tabs = this.tabs || [];
        if (inName) {
            for (var i = 0; i < tabs.length; i++) {
                if (tabs[i].name === inName) { return i; }
            }
        }
        if (typeof inIndex === "number" && !isNaN(inIndex) && inIndex >= 0 && inIndex < tabs.length) {
            return inIndex;
        }
        try { console.log("[Atlas] phone tab switcher: no row for " + inName + "/" + inIndex); } catch (e) {}
        return null;
    },
    newTabClick: function() {
        return atlasPhoneTap(this, "newTab", this.doNewTab);
    },
    doneClick: function() {
        return atlasPhoneTap(this, "done", this.doClose);
    }
});
