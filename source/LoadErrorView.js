/* Atlas's own page for a load that failed, shown in place of the page view.
 *
 * On the Chromium host a failed main-frame load commits the runtime's network error page into the
 * tab. That page is the platform's, made for every web app: it offers "Close Tab" and launches
 * settings apps by their LG ids. Atlas knows more about what the user was doing, so the tab's page
 * view is hidden while this panel takes its place (Browser.showLoadError), in the same Enyo look as
 * the rest of Atlas.
 *
 * describe() is the whole policy (which words, which settings app) and is a plain function so
 * test/load-error.test.js can check it without a UI.
 *
 * The WPE host reports its own error codes (positive) and keeps the old dialog; this panel only
 * handles Chromium's net:: codes, which are negative. */
enyo.kind({
	name: "LoadErrorView",
	kind: enyo.VFlexBox,
	className: "atlas-load-error",
	events: {
		onRetry: "",
		onOpenSettings: ""
	},
	components: [
		{kind: "Scroller", flex: 1, components: [
			{className: "atlas-load-error-box", components: [
				{name: "title", className: "atlas-load-error-title"},
				{kind: "Group", components: [
					{className: "atlas-load-error-body", components: [
						{name: "message", className: "atlas-load-error-message"},
						{name: "hint", className: "atlas-load-error-hint"},
						{name: "detail", className: "atlas-load-error-detail"}
					]}
				]},
				{className: "atlas-load-error-buttons", components: [
					{name: "retryButton", kind: "ActivityButton", className: "enyo-button-blue atlas-load-error-button",
						caption: $L("Try Again"), onclick: "retryClick"},
					{name: "settingsButton", kind: "Button", className: "atlas-load-error-button",
						showing: false, onclick: "settingsClick"}
				]}
			]}
		]}
	],

	/* Show the error for net error inCode (negative) on inUrl. inName is Chromium's short name
	 * ("net::ERR_NAME_NOT_RESOLVED"), shown small for anyone reporting a problem. */
	setError: function(inCode, inName, inUrl) {
		var d = this.describe(inCode, inUrl);
		this.settingsAppId = d.settingsAppId;
		this.$.title.setContent(d.title);
		this.$.message.setContent(d.message);
		this.$.hint.setContent(d.hint);
		this.$.hint.setShowing(!!d.hint);
		this.$.detail.setContent((inName ? inName + " " : "") + "(" + inCode + ")");
		this.$.settingsButton.setCaption(d.settingsCaption || "");
		this.$.settingsButton.setShowing(!!d.settingsAppId);
		this.setRetrying(false);
	},
	setRetrying: function(inRetrying) {
		this.$.retryButton.setActive(!!inRetrying);
		this.$.retryButton.setDisabled(!!inRetrying);
	},
	retryClick: function() {
		this.setRetrying(true);
		this.doRetry();
	},
	settingsClick: function() {
		if (this.settingsAppId) {
			this.doOpenSettings(this.settingsAppId);
		}
	},

	/* The TLS-handshake net errors outside the certificate range, from net/base/net_error_list.h:
	 * SSL_PROTOCOL_ERROR, SSL_CLIENT_AUTH_CERT_NEEDED, SSL_VERSION_OR_CIPHER_MISMATCH,
	 * SSL_RENEGOTIATION_REQUESTED, BAD_SSL_CLIENT_AUTH_CERT, SSL_NO_RENEGOTIATION,
	 * SSL_DECOMPRESSION_FAILURE_ALERT, SSL_BAD_RECORD_MAC_ALERT,
	 * SSL_CLIENT_AUTH_PRIVATE_KEY_ACCESS_DENIED, SSL_CLIENT_AUTH_CERT_NO_PRIVATE_KEY,
	 * PROXY_CERTIFICATE_INVALID, INSECURE_RESPONSE. */
	tlsErrors: [-107, -110, -113, -114, -117, -123, -125, -126, -134, -135, -136, -501],

	hostOf: function(inUrl) {
		var m = /^[a-z][a-z0-9+.\-]*:\/\/(?:[^@\/?#]*@)?(\[[^\]]*\]|[^:\/?#]*)/i.exec(inUrl || "");
		return (m && m[1]) || "";
	},

	/* -> {title, message, hint, settingsCaption, settingsAppId}. Codes are net/base/net_error_list.h. */
	describe: function(inCode, inUrl) {
		var host = this.hostOf(inUrl);
		var site = host || $L("the site");
		var wifi = {caption: $L("Wi-Fi Settings"), app: "org.webosports.app.settings.wifi"};
		var clock = {caption: $L("Date & Time Settings"), app: "org.webosports.app.settings.dateandtime"};
		var d = null, settings = null;
		var code = parseInt(inCode, 10);

		switch (code) {
		case -106: // INTERNET_DISCONNECTED
			d = [$L("No Internet Connection"),
				$L("This device is not connected to a network."),
				$L("Connect to Wi-Fi or mobile data, then try again.")];
			settings = wifi;
			break;
		case -105: // NAME_NOT_RESOLVED
		case -137: // NAME_RESOLUTION_FAILED
			d = [$L("Server Not Found"),
				enyo.macroize($L("Atlas could not find {$site}."), {site: site}),
				$L("Check the address for typing errors, and that this device is online.")];
			settings = wifi;
			break;
		case -7:   // TIMED_OUT
		case -118: // CONNECTION_TIMED_OUT
			d = [$L("Connection Timed Out"),
				enyo.macroize($L("{$site} took too long to respond."), {site: site}),
				$L("The site may be busy. Try again in a moment.")];
			break;
		case -21:  // NETWORK_CHANGED
		case -15:  // SOCKET_NOT_CONNECTED
		case -100: // CONNECTION_CLOSED
		case -101: // CONNECTION_RESET
		case -102: // CONNECTION_REFUSED
		case -104: // CONNECTION_FAILED
		case -109: // ADDRESS_UNREACHABLE
		case -324: // EMPTY_RESPONSE
			d = [$L("Unable to Connect"),
				enyo.macroize($L("Atlas could not connect to {$site}."), {site: site}),
				$L("The site may be down, or the network may have dropped. Try again in a moment.")];
			settings = wifi;
			break;
		case -201: // CERT_DATE_INVALID
			d = [$L("Secure Connection Failed"),
				enyo.macroize($L("The security certificate of {$site} is expired or not yet valid."), {site: site}),
				$L("Check that the date and time on this device are correct.")];
			settings = clock;
			break;
		case -310: // TOO_MANY_REDIRECTS
			d = [$L("Redirect Loop"),
				enyo.macroize($L("{$site} redirected too many times."), {site: site}),
				$L("Clearing the site's cookies may help.")];
			break;
		case -20:  // BLOCKED_BY_CLIENT
		case -27:  // BLOCKED_BY_RESPONSE
			d = [$L("Page Blocked"),
				enyo.macroize($L("{$site} cannot be shown here."), {site: site}),
				""];
			break;
		case -6:   // FILE_NOT_FOUND
		case -10:  // ACCESS_DENIED
		case -300: // INVALID_URL
		case -301: // DISALLOWED_URL_SCHEME
			d = [$L("Page Not Available"),
				$L("This address cannot be opened."),
				$L("Check the address for typing errors.")];
			break;
		default:
			// Every certificate and TLS problem: -200 to -299 is the certificate range; the
			// TLS handshake errors are scattered through the -100s (see this.tlsErrors).
			if ((code <= -200 && code > -300) || this.tlsErrors.indexOf(code) >= 0) {
				d = [$L("Secure Connection Failed"),
					enyo.macroize($L("Atlas could not set up a secure connection to {$site}."), {site: site}),
					$L("The site's security certificate may be invalid, or something on the network is interfering.")];
			} else {
				d = [$L("Unable to Load Page"),
					enyo.macroize($L("Atlas could not load {$site}."), {site: site}),
					$L("Try again in a moment.")];
			}
			break;
		}
		return {
			title: d[0], message: d[1], hint: d[2],
			settingsCaption: settings ? settings.caption : "",
			settingsAppId: settings ? settings.app : ""
		};
	}
});
