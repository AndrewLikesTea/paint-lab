// Use only ES5 syntax for this script!
// (Same reason as error-handling-basic.js, which this runs alongside in the <head>:
// it loads before anything can explain a syntax error to the user.)

// Which input device and how much screen we're dealing with, reflected onto <html>
// as classes, before the first paint. Two separate things are detected, because
// they call for different changes:
//
//   .touch-device  The primary pointer is a finger. Tap targets grow to something
//                  you can hit without aiming: MS Paint's 25px tool buttons and
//                  15px palette swatches were sized for a mouse.
//                  A laptop with a touchscreen *and* a mouse reports `pointer: fine`
//                  and is deliberately left alone -- its primary input is the mouse,
//                  and shrinking its canvas area would be a regression.
//
//   .phone-layout  A touch device with a small screen, checked against the *short*
//                  side of the viewport so a phone held sideways still counts.
//                  Screen space is scarce, so a new document is sized to fit rather
//                  than starting the user off scrolled away from three of its corners.
//
// The styles live in the "Touch and phone layout" section of styles/layout.css.
// Both classes can be forced on with the `touch-device` / `phone-layout` URL hash
// params, to check the layout on a desktop (see `param_types` in src/functions.js).

(function () {
	"use strict";

	var TOUCH_DEVICE_QUERY = "(pointer: coarse)";
	var PHONE_LAYOUT_QUERY =
		"(pointer: coarse) and (max-width: 700px), " +
		"(pointer: coarse) and (max-height: 500px)";

	// Below this the palette drops from three rows to two, and (in landscape) the toolbox
	// goes from two tall columns to four short ones. Must match styles/layout.css.
	var SHORT_VIEWPORT_MAX_HEIGHT = 650;

	// The classic MS Paint default, and what anything with a mouse keeps getting.
	var CLASSIC_CANVAS_WIDTH = 683;
	var CLASSIC_CANVAS_HEIGHT = 384;

	// Room the app's chrome takes around the canvas, in CSS pixels: the toolbox beside it,
	// and the menu bar, colors box and status bar stacked with it. Approximate on purpose --
	// this only picks a *default* document size, and the canvas area scrolls regardless;
	// it just shouldn't open already scrolled.
	var TWO_COLUMN_TOOLBOX_WIDTH = 104;
	var FOUR_COLUMN_TOOLBOX_WIDTH = 190;
	var THREE_ROW_PALETTE_CHROME_HEIGHT = 200;
	var TWO_ROW_PALETTE_CHROME_HEIGHT = 125;

	// Below this a "fitted" canvas is too small to draw on; let it scroll instead.
	var MIN_FITTED_CANVAS_SIZE = 64;

	var touch_device = false;
	var phone_layout = false;

	function media_query_matches(query) {
		return !!window.matchMedia && window.matchMedia(query).matches;
	}

	// Same loose matching as the other URL hash params (see `update_from_url_params` in app.js).
	function forced_in_url(param_name) {
		return new RegExp(param_name, "i").test(location.hash);
	}

	function update_classes() {
		phone_layout = forced_in_url("phone-layout") || media_query_matches(PHONE_LAYOUT_QUERY);
		// A phone is a touch device; forcing the phone layout shouldn't leave you with
		// mouse-sized tool buttons on it.
		touch_device = phone_layout || forced_in_url("touch-device") || media_query_matches(TOUCH_DEVICE_QUERY);

		document.documentElement.classList.toggle("touch-device", touch_device);
		document.documentElement.classList.toggle("phone-layout", phone_layout);
	}

	/**
	 * Whether the primary pointer is a finger.
	 * @returns {boolean}
	 */
	function is_touch_device() {
		return touch_device;
	}

	/**
	 * Whether the space-constrained phone layout is in effect.
	 * @returns {boolean}
	 */
	function is_phone_layout() {
		return phone_layout;
	}

	/**
	 * The size of a new document. The classic 683x384 everywhere except the phone
	 * layout, where it's shrunk to fit the screen -- never grown past the classic
	 * size, so a phone never opens a *bigger* document than a PC does.
	 * @returns {{ width: number, height: number }}
	 */
	function get_default_canvas_size() {
		if (!phone_layout) {
			return { width: CLASSIC_CANVAS_WIDTH, height: CLASSIC_CANVAS_HEIGHT };
		}
		// Mirrors the media queries in styles/layout.css.
		var shallow = window.innerHeight <= SHORT_VIEWPORT_MAX_HEIGHT;
		var landscape = window.innerWidth > window.innerHeight;
		var chrome_width = shallow && landscape ? FOUR_COLUMN_TOOLBOX_WIDTH : TWO_COLUMN_TOOLBOX_WIDTH;
		var chrome_height = shallow ? TWO_ROW_PALETTE_CHROME_HEIGHT : THREE_ROW_PALETTE_CHROME_HEIGHT;
		return {
			width: fit(window.innerWidth - chrome_width, CLASSIC_CANVAS_WIDTH),
			height: fit(window.innerHeight - chrome_height, CLASSIC_CANVAS_HEIGHT),
		};
	}

	function fit(available, classic_size) {
		return Math.max(MIN_FITTED_CANVAS_SIZE, Math.min(classic_size, Math.floor(available)));
	}

	update_classes();

	// Plugging in a mouse, rotating the phone, or resizing a desktop window with the
	// layout forced on can all change the answer.
	if (window.matchMedia) {
		[TOUCH_DEVICE_QUERY, PHONE_LAYOUT_QUERY].forEach(function (query) {
			var media_query_list = window.matchMedia(query);
			if (media_query_list.addEventListener) {
				media_query_list.addEventListener("change", update_classes);
			} else if (media_query_list.addListener) {
				// Safari didn't support addEventListener on MediaQueryList until 14.
				media_query_list.addListener(update_classes);
			}
		});
	}
	window.addEventListener("hashchange", update_classes);

	window.is_touch_device = is_touch_device;
	window.is_phone_layout = is_phone_layout;
	window.get_default_canvas_size = get_default_canvas_size;
})();
