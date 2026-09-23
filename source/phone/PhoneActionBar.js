/* The phone's top bar: identity, not a toolbar.
 *
 * The tablet ActionBar puts eight controls in one row — back, forward, the address field, share, new
 * card, bookmarks, translate, keyboard — which at 450 css px leaves the URL about 80px of text. The
 * 2.2.4 phone browser did the opposite: the top row showed the page TITLE with a lock, and became an
 * editable URL field only when tapped (page-title.html <-> url-field.html), while navigation lived in
 * the bottom command menu. That is what this is; PhoneBottomBar.js is the other half.
 *
 *     [ 🔒  Example Domain                    ⟳ ]
 *
 * It SUBCLASSES ActionBar rather than replacing it, so the ~120 lines of back/forward history
 * bookkeeping, progress and event plumbing are inherited untouched. A subkind's `components` replaces
 * the base's (enyo.Component.subclass assigns ctor.prototype.kindComponents), so the layout is ours
 * while the behaviour stays the base's.
 *
 * Consequence to respect: the base and Browser.js reach into this kind BY CHILD NAME —
 * canGoBackChanged touches $.back, canShareChanged $.share, loadingChanged $.search and
 * $.progressBar, changeKB $.kbButton, and so on. Every one of those names is therefore still
 * declared here; the ones the phone has no room for are simply `showing: false`. Dropping a name
 * would not be a layout change, it would be a TypeError somewhere far away.
 *
 * Only instantiated on a phone: PhoneLayer.js rewrites Browser's and StartPage's `kind: "ActionBar"`
 * to this, and its whole body is behind the __atlasPhone guard. */
enyo.kind({
    name: "PhoneActionBar",
    kind: "ActionBar",
    className: "enyo-toolbar actionbar atlas-phone-actionbar",
    components: [
        /* Display mode. The whole row is the tap target — 2.2.4 made the pill itself the button, and
         * at this size a small "edit" affordance would be worse than none. */
        {name: "titleRow", kind: enyo.HFlexBox, align: "center", className: "atlas-phone-urlrow",
         onclick: "enterEditMode", components: [
            {name: "phoneLock", className: "secure-lock atlas-phone-lock", showing: false},
            {name: "title", flex: 1, className: "atlas-phone-title enyo-text-ellipsis", content: ""},
            // Stop while loading, reload when idle — the two states 2.2.4 gave the same slot.
            {name: "stopReload", kind: "CustomButton", className: "addressbar-button refresh-button atlas-phone-stopreload",
             onclick: "stopReloadClick"}
        ]},

        /* Edit mode: the tablet's own address field, unchanged, except for where its suggestion popup
         * sits and how many rows it shows. 36 puts the popup flush under the field rather than over
         * it (see popupOffsetTop in URLSearch: the popup's -36px margin has to be paid back first),
         * and six rows is what fits on a phone without burying the page. */
        {name: "search", kind: "URLSearch", showing: false, popupOffsetTop: 36, maxRows: 6,
         onLoad: "phoneLoad", onStopLoad: "doStopLoad", onRefresh: "doRefresh",
         onAddressInputFocused: "doAddressInputFocused", onAddressInputBlurred: "phoneInputBlurred",
         onAddBookmark: "doAddBookmark", onDeleteBookmark: "doDeleteBookmark"},

        /* Names the base and Browser.js address. Kept, hidden: see the note at the top. The bottom bar
         * owns back/forward now, and share/new tab/bookmarks moved into the menu. */
        {name: "back", showing: false},
        {name: "forward", showing: false},
        {name: "share", showing: false},
        {name: "newcard", showing: false},
        {name: "bookmarks", showing: false},
        {name: "translateButton", kind: "Image", className: "atlas-translate-button",
         src: "images/translate-icon.png", showing: false, onclick: "doTranslateClick"},
        {name: "kbButton", kind: "Image", className: "atlas-kb-button",
         src: "images/icon-hide-keyboard.png", showing: false, onclick: "changeKB"},
        {name: "sharePopup", className: "launch-popup", kind: "Menu", components: [
            {caption: $L("Add Bookmark"), onclick: "doAddBookmark"},
            {caption: $L("Share Link"), onclick: "doShareLink"},
            {caption: $L("Add to Launcher"), onclick: "doAddToLauncher"}
        ]},
        {name: "backPopup", kind: "Popup", className: "history-popup", onClose: "backPopupClosed", components: []},
        {name: "forwardPopup", kind: "Popup", className: "history-popup", onClose: "forwardPopupClosed", components: []},
        {name: "progressBar", kind: "ProgressBar", className: "url-progress invisible", animatePosition: false}
    ],
    //* @protected
    _editing: false,

    create: function() {
        this.inherited(arguments);       // runs urlChanged/titleChanged/loading etc. for us
        this.phoneUpdatePill();
    },

    // ---------------------------------------------------------------------------------------------
    // display <-> edit
    // ---------------------------------------------------------------------------------------------
    enterEditMode: function() {
        if (this._editing) { return true; }
        this._editing = true;
        this.$.titleRow.setShowing(false);
        this.$.search.setShowing(true);
        this.$.search.setUrl(this.url);
        // The row's height does not change, so no bounds resync is needed — only its contents swap.
        this.$.search.render();
        this.$.search.forceFocus();
        return true;
    },
    exitEditMode: function() {
        if (!this._editing) { return; }
        this._editing = false;
        this.$.search.closeSearchPopup();
        this.$.search.setShowing(false);
        this.$.titleRow.setShowing(true);
        this.phoneUpdatePill();
    },
    /* Leaving the field without committing (the user tapped the page, or hid the keyboard) goes back
     * to showing the title, which is where 2.2.4 landed too. Deferred a beat: the blur that arrives
     * when the suggestion list is tapped would otherwise tear the field down before the tap lands. */
    phoneInputBlurred: function() {
        this.doAddressInputBlurred();
        enyo.job(this.id + "phoneExitEdit", enyo.bind(this, function () {
            if (this._editing && !this.$.search.$.address.hasFocus()) { this.exitEditMode(); }
        }), 250);
        return true;
    },
    /* A committed URL means the page is about to change, so the title is the right thing to show
     * again. The payload has to be forwarded exactly as the base would: Browser.goClick reads
     * (sender, url). */
    phoneLoad: function(inSender, inUrl) {
        this.exitEditMode();
        this.doLoad(inUrl);
        return true;
    },
    stopReloadClick: function() {
        if (this.loading) { this.doStopLoad(); } else { this.doRefresh(); }
        return true;                     // do not let the tap reach the row and open edit mode
    },

    // ---------------------------------------------------------------------------------------------
    // the pill's contents
    // ---------------------------------------------------------------------------------------------
    /* Title if the page has one, else the host, else the hint — an empty pill would look broken, and
     * a bare "Untitled" (what the tablet shows) tells the user nothing about where they are. */
    phoneUpdatePill: function() {
        if (!this.$ || !this.$.title) { return; }
        var text = this.title;
        if (!text || text === $L("Untitled")) { text = this.phoneHostOf(this.url); }
        this.$.title.setContent(text || $L("Enter URL or search terms"));
        this.$.title.addRemoveClass("atlas-phone-title-hint", !text);
        this.$.phoneLock.setShowing(/^https:/i.test(this.url || ""));
    },
    phoneHostOf: function(inUrl) {
        var u = inUrl || "";
        if (!u || /^atlas:/i.test(u)) { return ""; }
        var m = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#]+)/i.exec(u);
        return m ? m[1].replace(/^www\./i, "") : u;
    },

    // ---------------------------------------------------------------------------------------------
    // base hooks
    // ---------------------------------------------------------------------------------------------
    urlChanged: function() {
        this.inherited(arguments);       // keeps $.search in sync
        this.phoneUpdatePill();
    },
    titleChanged: function() {
        // Deliberately NOT calling inherited: it writes "Untitled" straight into $.title.
        this.phoneUpdatePill();
    },
    loadingChanged: function() {
        this.inherited(arguments);       // $.search + the progress bar
        if (this.$.stopReload) {
            this.$.stopReload.addRemoveClass("stop-button", this.loading);
            this.$.stopReload.addRemoveClass("refresh-button", !this.loading);
        }
    },
    /* The tablet hides its trailing buttons while the address field has focus (ActionBar.hideButtons).
     * There is nothing to hide here — the pill is replaced wholesale — and letting the base run would
     * un-hide back/forward/share/newcard, which the phone keeps hidden for good. */
    hideButtons: function() {
    },
    showButtons: function() {
    },
    /* Long-press history. The base opens these popups at a hard-coded top:53, the tablet bar's height,
     * and the buttons they point at are not on screen here. The bottom bar's arrows will get their own
     * long-press later; until then, no popup rather than one in the wrong place. */
    openBackHistoryPopup: function() {
    },
    openForwardHistoryPopup: function() {
    }
});
