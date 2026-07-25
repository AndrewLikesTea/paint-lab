// @ts-check

// Picks the canvas size for a *new* document.
//
// This app has always opened at 683x384, the MS Paint default, which is fine on a
// desktop and useless on a phone: the canvas is wider than the screen, so you start
// out scrolled into the top-left corner of a picture you can't see.
//
// The decision is split in two on purpose:
//
//   - `decide_initial_canvas_size()` is pure. It takes every input explicitly
//     (device signals, measured area, stored dimensions) and returns a decision
//     record with the reasons it reached. No DOM, no globals, no clock.
//   - `read_device_signals()` / `measure_available_area()` are the adapters that
//     collect those inputs from the browser. They're the only parts that can be
//     wrong in a way you can't unit test, so they're kept trivial.
//
// The decision record is the contract. It's exposed on
// `api_for_cypress_tests.get_canvas_sizing_decision()` so a test (or a bug report)
// can see *why* a canvas came out the size it did, not just that it did.

/**
 * Bump when the shape of `SizingDecision` changes, so anything reading a
 * persisted or logged decision can tell whether it understands it.
 */
export const CANVAS_SIZING_SCHEMA_VERSION = 1;

/** The MS Paint default, and the size this app has always started at. */
export const DESKTOP_CANVAS_WIDTH = 683;
export const DESKTOP_CANVAS_HEIGHT = 384;

/**
 * Floor for an automatically chosen canvas. Below roughly this size you can't
 * draw anything recognizable, and it's better to overflow the screen slightly
 * than to hand someone a postage stamp.
 */
export const MIN_AUTO_CANVAS_WIDTH = 160;
export const MIN_AUTO_CANVAS_HEIGHT = 90;

/**
 * Room left inside the measured drawing area: the area's own 3px padding on each
 * side, plus the resize handles, which sit just outside the canvas edge. Without
 * this the auto-sized canvas fits by arithmetic and scrolls in practice.
 */
export const CANVAS_AREA_INSET_PX = 10;

/**
 * User agents that mean "this is a phone or tablet". Kept deliberately dumb;
 * it's a hint, not an identity. `Mobile` covers Mobile Safari and Firefox for
 * Android; `Silk`/`Kindle` cover Fire tablets, which don't say either.
 */
const MOBILE_USER_AGENT_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk|Kindle|Tablet/i;

/**
 * Raw device signals, as read from the browser.
 * @typedef {object} DeviceSignals
 * @property {string} user_agent - `navigator.userAgent`, or `""` if unavailable.
 * @property {boolean | null} coarse_pointer - `matchMedia("(pointer: coarse)")`, or null if `matchMedia` is unavailable.
 * @property {number} max_touch_points - `navigator.maxTouchPoints`, or 0 if unavailable.
 */

/**
 * A measured rectangle in CSS pixels.
 * @typedef {object} AreaSize
 * @property {number} width
 * @property {number} height
 */

/**
 * Dimensions previously saved by the user (via Image > Attributes, or any resize).
 * Values arrive from localStorage, so they're `string`, but tolerate numbers.
 * `null` or a missing field means "never saved".
 * @typedef {object} StoredDimensions
 * @property {string | number | null | undefined} [width]
 * @property {string | number | null | undefined} [height]
 */

/**
 * @typedef {object} SizingRequest
 * @property {DeviceSignals} signals
 * @property {AreaSize | null} available_area - the drawing area, or null if it couldn't be measured.
 * @property {StoredDimensions | null} stored_dimensions - null if storage was unreadable.
 */

/**
 * Why a canvas is the size it is.
 *  - `"stored"`: the user picked this size before. Always wins.
 *  - `"desktop-default"`: 683x384, the historical default.
 *  - `"fit-available"`: scaled down to fit a small screen.
 * @typedef {"stored" | "desktop-default" | "fit-available"} SizingSource
 */

/**
 * @typedef {"desktop" | "mobile" | "unknown"} DeviceClass
 */

/**
 * The output contract. Fully determined by the request.
 * @typedef {object} SizingDecision
 * @property {number} schema_version
 * @property {number} width - positive integer
 * @property {number} height - positive integer
 * @property {SizingSource} source
 * @property {DeviceClass} device_class
 * @property {number} scale - fraction of the desktop default this size represents; 1 unless `source` is `"fit-available"`.
 * @property {string[]} reasons - the rules that fired, in order, for debugging.
 * @property {string[]} warnings - inputs that were missing or malformed. Non-fatal by design; each one has a documented fallback.
 */

/**
 * Coerces a stored dimension to a usable canvas dimension.
 * Returns null for anything that isn't a finite positive number, including the
 * `null` that means "never saved" and the garbage that means "someone edited
 * localStorage".
 *
 * @param {string | number | null | undefined} value
 * @returns {number | null}
 */
function parse_dimension(value) {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const number = Number(value);
	if (!isFinite(number) || number < 1) {
		return null;
	}
	// Canvas dimensions are integers; a fractional stored value would be
	// truncated by the canvas anyway, so truncate it here where it's visible.
	return Math.floor(number);
}

/**
 * Classifies the device from the signals given. Two independent signals, either
 * of which is enough:
 *
 *   1. The user agent says phone/tablet.
 *   2. The primary pointer is coarse *and* the device reports touch points.
 *      This catches iPads, which claim to be desktop Macs.
 *
 * Neither signal is trusted alone to *rule out* mobile — a desktop browser with
 * a narrow window is still a desktop, and shrinking its canvas would be a
 * regression for anyone who works in a half-width window.
 *
 * @param {DeviceSignals} signals
 * @returns {{device_class: DeviceClass, reasons: string[], warnings: string[]}}
 */
export function classify_device(signals) {
	/** @type {string[]} */
	const reasons = [];
	/** @type {string[]} */
	const warnings = [];

	const user_agent = typeof signals?.user_agent === "string" ? signals.user_agent : "";
	const coarse_pointer = typeof signals?.coarse_pointer === "boolean" ? signals.coarse_pointer : null;
	const max_touch_points = Number.isFinite(signals?.max_touch_points) ? signals.max_touch_points : 0;

	if (!user_agent) {
		warnings.push("user-agent-unavailable");
	}
	if (coarse_pointer === null) {
		warnings.push("pointer-media-query-unavailable");
	}

	const user_agent_says_mobile = user_agent !== "" && MOBILE_USER_AGENT_PATTERN.test(user_agent);
	const touch_first = coarse_pointer === true && max_touch_points >= 1;

	if (user_agent_says_mobile) {
		reasons.push("user-agent-matches-mobile");
	}
	if (touch_first) {
		reasons.push("coarse-pointer-with-touch");
	}

	if (user_agent_says_mobile || touch_first) {
		return { device_class: "mobile", reasons, warnings };
	}
	if (!user_agent && coarse_pointer === null) {
		// Nothing to go on. Treated as desktop downstream, but say so rather
		// than claiming a confident "desktop".
		reasons.push("no-usable-signals");
		return { device_class: "unknown", reasons, warnings };
	}
	reasons.push("no-mobile-signals");
	return { device_class: "desktop", reasons, warnings };
}

/**
 * Scales the default canvas down to fit an area, preserving its aspect ratio.
 *
 * A single scale factor is applied to both axes — clamping the axes separately
 * would silently change the aspect ratio, and 683x384 being ~16:9 is part of why
 * the default looks right. The scale is clamped so the result is never larger
 * than the default and never smaller than the usability floor; when the floor
 * wins, the canvas overflows and scrolls, which is the honest outcome.
 *
 * @param {AreaSize} area
 * @returns {{width: number, height: number, scale: number}}
 */
function fit_default_to_area(area) {
	const usable_width = Math.max(1, area.width - CANVAS_AREA_INSET_PX);
	const usable_height = Math.max(1, area.height - CANVAS_AREA_INSET_PX);

	const min_scale = Math.max(
		MIN_AUTO_CANVAS_WIDTH / DESKTOP_CANVAS_WIDTH,
		MIN_AUTO_CANVAS_HEIGHT / DESKTOP_CANVAS_HEIGHT,
	);
	const fit_scale = Math.min(usable_width / DESKTOP_CANVAS_WIDTH, usable_height / DESKTOP_CANVAS_HEIGHT);
	const scale = Math.min(1, Math.max(min_scale, fit_scale));

	return {
		width: Math.max(MIN_AUTO_CANVAS_WIDTH, Math.round(DESKTOP_CANVAS_WIDTH * scale)),
		height: Math.max(MIN_AUTO_CANVAS_HEIGHT, Math.round(DESKTOP_CANVAS_HEIGHT * scale)),
		scale,
	};
}

/**
 * True if `area` is a pair of finite positive numbers.
 * @param {AreaSize | null | undefined} area
 * @returns {boolean}
 */
function is_measurable(area) {
	return !!area && isFinite(area.width) && isFinite(area.height) && area.width > 0 && area.height > 0;
}

/**
 * Decides the size of a new document's canvas.
 *
 * Pure: same request in, same decision out. The rules, in order — the first one
 * that matches decides, and no later rule can override it:
 *
 *   1. The user saved a size before → use it. An explicit choice outranks
 *      anything inferred, on every device, forever. This is also what keeps
 *      existing users' canvases exactly as they left them.
 *   2. The default fits in the available area → use the default. Preserves the
 *      historical size on desktops, and on tablets big enough for it.
 *   3. The device is mobile → scale the default down to fit (aspect preserved).
 *   4. Otherwise → the default. A desktop browser in a small window keeps the
 *      683x384 canvas and its scrollbars, exactly as before.
 *
 * Never throws on bad *values*; malformed inputs are recorded in `warnings` and
 * fall through to the default, because failing to boot the app over a bad
 * localStorage entry would be worse than an oversized canvas.
 *
 * @param {SizingRequest} request
 * @returns {SizingDecision}
 * @throws {TypeError} if `request` isn't an object — that's a programming error, not bad data.
 */
export function decide_initial_canvas_size(request) {
	if (!request || typeof request !== "object") {
		throw new TypeError("decide_initial_canvas_size: request must be an object");
	}

	const classification = classify_device(request.signals ?? { user_agent: "", coarse_pointer: null, max_touch_points: 0 });
	/** @type {string[]} */
	const reasons = classification.reasons.slice();
	/** @type {string[]} */
	const warnings = classification.warnings.slice();

	/**
	 * @param {number} width
	 * @param {number} height
	 * @param {SizingSource} source
	 * @param {number} scale
	 * @returns {SizingDecision}
	 */
	const decision = (width, height, source, scale) => ({
		schema_version: CANVAS_SIZING_SCHEMA_VERSION,
		width,
		height,
		source,
		device_class: classification.device_class,
		scale,
		reasons,
		warnings,
	});

	// Rule 1: an explicit choice by the user.
	const stored = request.stored_dimensions;
	if (stored === null || stored === undefined) {
		warnings.push("stored-dimensions-unavailable");
	} else {
		const stored_width = parse_dimension(stored.width);
		const stored_height = parse_dimension(stored.height);
		if (stored_width !== null && stored_height !== null) {
			reasons.push("stored-dimensions-present");
			return decision(stored_width, stored_height, "stored", 1);
		}
		if (stored_width !== null || stored_height !== null) {
			// Half-written pair: one axis saved, the other missing or corrupt.
			// Using one axis and inferring the other would produce a size the
			// user never chose, so the pair is discarded as a unit.
			warnings.push("stored-dimensions-incomplete");
		}
	}

	const area = request.available_area;
	if (!is_measurable(area)) {
		if (area !== null && area !== undefined) {
			warnings.push("available-area-invalid");
		} else {
			warnings.push("available-area-unavailable");
		}
		reasons.push("cannot-measure-area");
		return decision(DESKTOP_CANVAS_WIDTH, DESKTOP_CANVAS_HEIGHT, "desktop-default", 1);
	}

	// Rule 2: it already fits.
	const fits = (area.width - CANVAS_AREA_INSET_PX) >= DESKTOP_CANVAS_WIDTH &&
		(area.height - CANVAS_AREA_INSET_PX) >= DESKTOP_CANVAS_HEIGHT;
	if (fits) {
		reasons.push("default-fits-available-area");
		return decision(DESKTOP_CANVAS_WIDTH, DESKTOP_CANVAS_HEIGHT, "desktop-default", 1);
	}

	// Rule 3: small screen on a touch device.
	if (classification.device_class === "mobile") {
		const fitted = fit_default_to_area(area);
		reasons.push("scaled-to-fit-mobile-viewport");
		if (fitted.width > area.width || fitted.height > area.height) {
			// The usability floor beat the available space.
			warnings.push("min-size-exceeds-available-area");
		}
		return decision(fitted.width, fitted.height, "fit-available", fitted.scale);
	}

	// Rule 4: desktop in a small window — unchanged from how it's always behaved.
	reasons.push("non-mobile-keeps-default");
	return decision(DESKTOP_CANVAS_WIDTH, DESKTOP_CANVAS_HEIGHT, "desktop-default", 1);
}

/**
 * Reads device signals from the browser. Every lookup is guarded: this runs
 * during startup, before the error handling UI is necessarily up, so it must not
 * be the thing that breaks the load.
 *
 * @returns {DeviceSignals}
 */
export function read_device_signals() {
	/** @type {boolean | null} */
	let coarse_pointer = null;
	try {
		if (typeof window.matchMedia === "function") {
			coarse_pointer = window.matchMedia("(pointer: coarse)").matches;
		}
	} catch (_error) {
		// Old browsers throw on unsupported media features rather than
		// reporting `matches: false`. Unknown, not false.
	}
	return {
		user_agent: typeof navigator?.userAgent === "string" ? navigator.userAgent : "",
		coarse_pointer,
		max_touch_points: Number.isFinite(navigator?.maxTouchPoints) ? navigator.maxTouchPoints : 0,
	};
}

/**
 * Measures the area the canvas can occupy, in CSS pixels, falling back to the
 * viewport if the element isn't laid out, and to null if even that is unusable.
 * The caller treats null as "keep the default", which is the safe direction.
 *
 * @param {HTMLElement | null | undefined} canvas_area_element
 * @returns {AreaSize | null}
 */
export function measure_available_area(canvas_area_element) {
	try {
		const rect = canvas_area_element?.getBoundingClientRect();
		if (rect && rect.width > 0 && rect.height > 0) {
			return { width: rect.width, height: rect.height };
		}
	} catch (_error) {
		// Fall through to the viewport estimate.
	}
	// The element hasn't been laid out (or doesn't exist yet). The viewport is a
	// worse measurement — it includes the toolbars, palette, and menu bar — but
	// on the phones this feature exists for, it's still far smaller than 683px
	// wide, so the fitting rule reaches the right conclusion.
	const width = window.innerWidth;
	const height = window.innerHeight;
	if (isFinite(width) && isFinite(height) && width > 0 && height > 0) {
		return { width, height };
	}
	return null;
}
