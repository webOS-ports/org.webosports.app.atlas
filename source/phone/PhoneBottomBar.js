/* The phone's bottom command bar.
 *
 * The 2.2.4 phone browser put navigation in the command menu at the BOTTOM of the screen and kept the
 * top for identity (title + lock). That is the arrangement this bar restores: four large targets in
 * thumb reach, and everything occasional in the menu, instead of the tablet ActionBar's eight
 * controls crowded into one 54px row.
 *
 *   [ back ] [ forward ] [ tabs (count) ] [ menu ]
 *
 * Only ever instantiated on a phone — PhoneLayer.js appends it to BrowserApp, and PhoneLayer's whole
 * body is behind the __atlasPhone guard.
 *
 * The tabs button differs by host: browser_shell gives the app a single window, so cards became
 * in-app tabs and the button shows how many there are and opens the switcher. On the WPE host, cards
 * are real webOS cards and there is nothing to count, so it becomes plain "new card". */
enyo.kind({
    name: "PhoneBottomBar",
    kind: enyo.HFlexBox,
    className: "enyo-toolbar atlas-phone-bottombar",
    align: "center",
    published: {
        canGoBack: false,
        canGoForward: false,
        tabCount: 1
    },
    events: {
        onBack: "",
        onForward: "",
        onTabs: "",
        onMenu: ""
    },
    components: [
        {name: "back", kind: "ToolButton", flex: 1, className: "atlas-phone-bb-button",
         icon: "images/chrome/menu-icon-back.png", onclick: "backClick"},
        {name: "forward", kind: "ToolButton", flex: 1, className: "atlas-phone-bb-button",
         icon: "images/chrome/menu-icon-forward.png", onclick: "forwardClick"},
        // Caption rather than an icon: the caption IS the information (how many tabs are open). On the
        // WPE host it carries the new-card icon instead, set in create().
        {name: "tabs", kind: "ToolButton", flex: 1, className: "atlas-phone-bb-button atlas-phone-bb-tabs",
         onclick: "tabsClick"},
        // menu-icon-menu.png follows the toolbar convention: a 32x64 two-state sprite (translucent
        // normal on top, opaque pressed below). button-menu.png is a 50x100 button BACKGROUND, not a
        // glyph, and renders as a blob at this size.
        {name: "menu", kind: "ToolButton", flex: 1, className: "atlas-phone-bb-button",
         icon: "images/chrome/menu-icon-menu.png", onclick: "menuClick"}
    ],
    create: function() {
        this.inherited(arguments);
        if (!window.__atlasChromium) {
            // No in-app tabs on this host: the button opens another card.
            this.$.tabs.setIcon("images/chrome/menu-icon-newcard.png");
            this.$.tabs.removeClass("atlas-phone-bb-tabs");
        }
        this.canGoBackChanged();
        this.canGoForwardChanged();
        this.tabCountChanged();
    },
    //* @protected
    /* Every button goes through atlasPhoneTap (PhoneTap.js): LunaCE fires touch AND a synthesised
     * click for one tap, so binding onclick straight to a do* event doubles every action. */
    backClick: function() {
        return atlasPhoneTap(this, "back", this.doBack);
    },
    forwardClick: function() {
        return atlasPhoneTap(this, "forward", this.doForward);
    },
    tabsClick: function() {
        return atlasPhoneTap(this, "tabs", this.doTabs);
    },
    menuClick: function() {
        return atlasPhoneTap(this, "menu", this.doMenu);
    },
    /* Back is never disabled: with no page history it closes the tab/card, which is what Back means
     * on webOS (see Browser.goBack). Forward is disabled when there is nowhere to go, so the bar
     * reads as a real state rather than a dead button. */
    canGoBackChanged: function() {
    },
    canGoForwardChanged: function() {
        this.$.forward.setDisabled(!this.canGoForward);
    },
    tabCountChanged: function() {
        if (!window.__atlasChromium) { return; }
        var n = this.tabCount || 1;
        this.$.tabs.setCaption(n > 99 ? "99+" : String(n));
    }
});
