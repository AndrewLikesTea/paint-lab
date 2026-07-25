// @ts-check

/**
 * Touch input policy for the drawing surfaces.
 *
 * The app already implements everything a touch user needs — one finger draws, two fingers
 * pan and zoom (`app.js`, "Panning and Zooming") — but the *browser* wants to scroll and
 * pinch-zoom the page with those same gestures. This module owns the one job of deciding,
 * per surface, which touches belong to the app, and taking them away from the browser.
 *
 * ## Contract
 *
 * One controller per surface, with an explicit policy:
 *
 * - `"draw"` (the canvas): every touch belongs to the app. `touch-action: none` is applied
 *   and touch defaults are prevented, so a stroke can never scroll or zoom the page, and a
 *   double-tap can't zoom in the middle of stippling.
 * - `"gesture"` (the canvas area): only *multi*-touch belongs to the app, because two fingers
 *   mean the app's own pan/zoom, and letting the browser scroll the same container at the same
 *   time pans it twice as far as the fingers moved. Single-finger scrolling of the area (and of
 *   its scrollbars) is left to the browser exactly as before.
 *
 * `start()`/`stop()` are idempotent and `stop()` removes every listener; a stopped controller
 * has no effect on the page. Prevention never depends on tracking state: an event we failed to
 * account for is still prevented, so a bookkeeping bug can't turn into a scrolling canvas.
 *
 * ## Transactional boundaries
 *
 * A touch is a transaction with exactly two ends: `pointerup` (released) or `pointercancel`
 * (taken away by the browser — palm rejection, a system edge swipe, the tab losing the
 * pointer). Both close the record; there is no third state where a touch stays half-open.
 * `stop()` closes any that are still open, and reports them. The drawing gesture keyed to a
 * touch has the matching commit/abort boundary in `app.js`.
 *
 * ## Observable failures
 *
 * Touch input fails quietly by nature — the page just scrolls and the stroke goes nowhere —
 * so every way this policy can lose is counted and reported rather than swallowed:
 *
 * - a `touchmove` arrives that can no longer be canceled, meaning the browser already committed to scrolling
 *   or pinching and `preventDefault()` came too late (reported once per gesture, since
 *   `touchmove` fires every frame);
 * - a touch ends that we never saw begin, i.e. pointer ids got out of step;
 * - more simultaneous touches than {@link MAX_TRACKED_TOUCHES};
 * - touches still open at `stop()`.
 *
 * `get_state()` returns a snapshot of all of it, which is also how the Cypress specs assert
 * the policy instead of asserting on console noise.
 *
 * ## Edge cases
 *
 * - **Empty state:** with no touches down, `get_state()` reports zeroes and the listeners are
 *   no-ops. This is the normal state for mouse, pen, and keyboard use.
 * - **Mouse and pen are not touched.** Everything here filters on `pointerType === "touch"`,
 *   so mouse drawing, pen pressure, and the right-click behaviors keep their defaults, and
 *   `touch-action` doesn't apply to them in the first place.
 * - **Assistive input keeps working.** Dwell Clicker, Head Tracker and speech recognition
 *   drive drawing with *synthetic* jQuery events (`pointerType: "mouse"`, `pointerId`
 *   1234567890/12345). Those never reach these listeners (jQuery's `.trigger()` doesn't
 *   invoke native listeners) and wouldn't match the touch filter if they did.
 * - **Accessibility of zoom.** `touch-action: none` on the canvas means pinch no longer zooms
 *   the *page* over the drawing. Zooming the *drawing* replaces it, and stays reachable
 *   without pinching: two-finger pinch on the canvas, **View > Zoom**, `Ctrl+/` and `Ctrl+-`,
 *   and **Extras > Enlarge UI** for the surrounding chrome. Single-finger scrolling still
 *   works in the canvas area, so a zoomed-in canvas can be moved around one-handed.
 * - **Safari's `gesture*` events** are prevented as well: iOS Safari ignores
 *   `user-scalable=no`, and pinch there can still zoom the page.
 * - A surface can be replaced or detached; `stop()` is safe to call afterwards.
 */

/**
 * Cap on tracked concurrent touches per surface. Ten fingers is the physical limit for the
 * gestures this app has; past that we stop growing the map and report it, rather than let a
 * runaway event source (or a synthetic test) allocate without bound. Prevention is unaffected.
 */
const MAX_TRACKED_TOUCHES = 10;

/**
 * @typedef {object} TouchRecord
 * @property {number} pointer_id
 * @property {number} client_x
 * @property {number} client_y
 * @property {number} started_at milliseconds from `performance.now()`
 */

/**
 * @typedef {object} InteractionFailure
 * @property {string} message
 * @property {object} details
 */

/**
 * @typedef {object} InteractionState
 * @property {boolean} started
 * @property {"draw" | "gesture"} policy
 * @property {number} active_touch_count
 * @property {number[]} active_touch_ids
 * @property {number} prevented_count how many browser defaults this surface has taken over
 * @property {number} failure_count
 * @property {InteractionFailure | null} last_failure
 */

/**
 * @param {Error} error
 * @param {object} details
 */
function default_report_failure(error, details) {
	console.warn("Canvas touch policy problem.", { error, ...details });
}

/** Events that end a touch, in the sense of {@link CanvasInteractionController}'s contract. */
const END_EVENT_TYPES = ["pointerup", "pointercancel"];

class CanvasInteractionController {
	/**
	 * @param {HTMLElement} target
	 * @param {object} [options]
	 * @param {"draw" | "gesture"} [options.policy] which touches this surface claims; see the
	 * module comment. Defaults to `"draw"`.
	 * @param {(error: Error, details: object) => void} [options.report_failure]
	 */
	constructor(target, options = {}) {
		if (!(target instanceof HTMLElement)) {
			throw new TypeError("CanvasInteractionController target must be an HTMLElement");
		}
		const { policy = "draw", report_failure = default_report_failure } = options;
		if (policy !== "draw" && policy !== "gesture") {
			throw new TypeError(`CanvasInteractionController policy must be "draw" or "gesture"; received ${policy}`);
		}
		this.target = target;
		this.policy = policy;
		this.report_failure = report_failure;
		/** @type {Map<number, TouchRecord>} */
		this.active_touches = new Map();
		this.started = false;
		this.prevented_count = 0;
		this.failure_count = 0;
		/** @type {InteractionFailure | null} */
		this.last_failure = null;
		// Reported at most once per gesture; `touchmove` fires every frame.
		this.reported_unpreventable_move = false;
		this.handle_pointer_event = this.handle_pointer_event.bind(this);
		this.handle_touch_event = this.handle_touch_event.bind(this);
		this.handle_gesture_event = this.handle_gesture_event.bind(this);
	}
	start() {
		if (this.started) {
			return;
		}
		this.started = true;
		if (this.policy === "draw") {
			// This, not `preventDefault()`, is what actually keeps a stroke from scrolling the
			// page: per spec, preventing a pointer event does not prevent panning.
			this.target.style.touchAction = "none";
		}
		this.target.addEventListener("pointerdown", this.handle_pointer_event, { passive: false });
		this.target.addEventListener("pointermove", this.handle_pointer_event, { passive: false });
		this.target.addEventListener("pointerup", this.handle_pointer_event, { passive: false });
		this.target.addEventListener("pointercancel", this.handle_pointer_event, { passive: false });
		// Must be non-passive to be able to prevent scrolling, and to notice when the browser
		// hands us a move it will no longer let us cancel because it already started scrolling.
		this.target.addEventListener("touchstart", this.handle_touch_event, { passive: false });
		this.target.addEventListener("touchmove", this.handle_touch_event, { passive: false });
		// Safari-only pinch events, the remaining way to zoom the page on iOS.
		this.target.addEventListener("gesturestart", this.handle_gesture_event, { passive: false });
		this.target.addEventListener("gesturechange", this.handle_gesture_event, { passive: false });
	}
	stop() {
		if (!this.started) {
			return;
		}
		this.started = false;
		if (this.active_touches.size > 0) {
			this.report("Touches were still active when the interaction controller stopped", {
				operation: "stop",
				pointer_ids: [...this.active_touches.keys()],
			});
		}
		this.active_touches.clear();
		this.reported_unpreventable_move = false;
		this.target.removeEventListener("pointerdown", this.handle_pointer_event);
		this.target.removeEventListener("pointermove", this.handle_pointer_event);
		this.target.removeEventListener("pointerup", this.handle_pointer_event);
		this.target.removeEventListener("pointercancel", this.handle_pointer_event);
		this.target.removeEventListener("touchstart", this.handle_touch_event);
		this.target.removeEventListener("touchmove", this.handle_touch_event);
		this.target.removeEventListener("gesturestart", this.handle_gesture_event);
		this.target.removeEventListener("gesturechange", this.handle_gesture_event);
	}
	/**
	 * A read-only snapshot, for diagnostics and tests. Never returns internal collections.
	 * @returns {InteractionState}
	 */
	get_state() {
		return Object.freeze({
			started: this.started,
			policy: this.policy,
			active_touch_count: this.active_touches.size,
			active_touch_ids: [...this.active_touches.keys()],
			prevented_count: this.prevented_count,
			failure_count: this.failure_count,
			last_failure: this.last_failure,
		});
	}
	/**
	 * @param {string} message
	 * @param {object} details
	 */
	report(message, details) {
		this.failure_count += 1;
		this.last_failure = Object.freeze({ message, details: Object.freeze({ ...details }) });
		this.report_failure(new Error(message), { policy: this.policy, ...details });
	}
	/**
	 * @param {Event} event
	 * @returns {boolean} whether the default was prevented
	 */
	prevent(event) {
		if (!event.cancelable) {
			return false;
		}
		event.preventDefault();
		this.prevented_count += 1;
		return true;
	}
	/** @param {PointerEvent} event */
	handle_pointer_event(event) {
		if (event.pointerType !== "touch") {
			return; // mouse, pen, and synthetic assistive input keep their defaults
		}
		if (event.type === "pointerdown") {
			this.begin_touch(event);
		}
		if (this.policy === "draw") {
			// Preventing a pointer event doesn't stop panning on its own (`touch-action` and
			// the `touchmove` handler do that); it stops the compatibility mouse events the
			// browser would otherwise synthesize from a touch on the canvas.
			this.prevent(event);
		}
		if (END_EVENT_TYPES.includes(event.type)) {
			this.end_touch(event);
		}
	}
	/** @param {TouchEvent} event */
	handle_touch_event(event) {
		// `event.touches` is the authority on how many fingers are down right now, including
		// touches this surface never saw begin.
		if (!this.claims(event.touches.length)) {
			return;
		}
		if (!this.prevent(event) && event.type === "touchmove" && !this.reported_unpreventable_move) {
			this.reported_unpreventable_move = true;
			this.report("Touch move could not be prevented; the page may scroll or zoom while drawing", {
				operation: "prevent-touch-default",
				event_type: event.type,
				touch_count: event.touches.length,
			});
		}
	}
	/** @param {Event} event Safari's non-standard `GestureEvent`. */
	handle_gesture_event(event) {
		// Pinch is multi-touch by definition, so both policies claim it.
		this.prevent(event);
	}
	/**
	 * @param {number} touch_count
	 * @returns {boolean} whether this surface claims a gesture of this many touches
	 */
	claims(touch_count) {
		return this.policy === "draw" ? touch_count >= 1 : touch_count >= 2;
	}
	/** @param {PointerEvent} event */
	begin_touch(event) {
		if (this.active_touches.has(event.pointerId)) {
			return; // already open; nothing to reconcile
		}
		if (this.active_touches.size >= MAX_TRACKED_TOUCHES) {
			this.report("More simultaneous touches than the interaction controller tracks", {
				operation: "begin-touch",
				pointer_id: event.pointerId,
				max_tracked_touches: MAX_TRACKED_TOUCHES,
			});
			return;
		}
		this.active_touches.set(event.pointerId, {
			pointer_id: event.pointerId,
			client_x: event.clientX,
			client_y: event.clientY,
			started_at: performance.now(),
		});
	}
	/** @param {PointerEvent} event */
	end_touch(event) {
		if (!this.active_touches.delete(event.pointerId)) {
			// Not a tracked touch: either it began before `start()`, or over another element,
			// or pointer ids got out of step (see the Firefox pen-tablet bug noted in `app.js`).
			this.report("A touch ended that never began on this surface", {
				operation: "end-touch",
				event_type: event.type,
				pointer_id: event.pointerId,
			});
		}
		if (this.active_touches.size === 0) {
			this.reported_unpreventable_move = false;
		}
	}
}

export {
	CanvasInteractionController
};
