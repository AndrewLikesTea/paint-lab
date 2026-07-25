// @ts-check

/**
 * @typedef {object} CanvasState
 * @property {number} logicalWidth
 * @property {number} logicalHeight
 * @property {number} backingWidth
 * @property {number} backingHeight
 */

/**
 * @typedef {object} DeviceMetrics
 * @property {number} pixelRatio
 * @property {number} magnification
 */

/**
 * @typedef {object} CanvasSizing
 * @property {CanvasState} canvas
 * @property {DeviceMetrics} device
 * @property {number} renderScale
 */

const assert_positive_finite = (value, name) => {
	if (!Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive finite number; received ${value}`);
	}
};

/**
 * Calculate display-canvas dimensions without changing the document's pixel model.
 * Backing dimensions use the nearest physical pixel for fractional DPR values.
 *
 * @param {{ logicalWidth: number, logicalHeight: number }} canvas
 * @param {DeviceMetrics} device
 * @returns {CanvasSizing}
 */
function calculate_canvas_sizing(canvas, device) {
	assert_positive_finite(canvas.logicalWidth, "logicalWidth");
	assert_positive_finite(canvas.logicalHeight, "logicalHeight");
	assert_positive_finite(device.pixelRatio, "pixelRatio");
	assert_positive_finite(device.magnification, "magnification");

	const renderScale = device.pixelRatio * device.magnification;
	return Object.freeze({
		canvas: Object.freeze({
			logicalWidth: canvas.logicalWidth,
			logicalHeight: canvas.logicalHeight,
			backingWidth: Math.round(canvas.logicalWidth * renderScale),
			backingHeight: Math.round(canvas.logicalHeight * renderScale),
		}),
		device: Object.freeze({ ...device }),
		renderScale,
	});
}

/**
 * Resize both canvas axes as one update. A failed second assignment restores the
 * original bitmap dimensions and reports enough state to diagnose the failure.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasSizing} sizing
 * @param {(error: Error, details: object) => void} [report_failure]
 * @returns {boolean} whether the backing store changed
 */
function apply_canvas_sizing(canvas, sizing, report_failure = default_report_failure) {
	const previous = { width: canvas.width, height: canvas.height };
	if (
		previous.width === sizing.canvas.backingWidth &&
		previous.height === sizing.canvas.backingHeight
	) {
		return false;
	}

	try {
		canvas.width = sizing.canvas.backingWidth;
		canvas.height = sizing.canvas.backingHeight;
	} catch (error) {
		try {
			canvas.width = previous.width;
			canvas.height = previous.height;
		} catch (rollback_error) {
			report_failure(
				rollback_error instanceof Error ? rollback_error : new Error(String(rollback_error)),
				{ operation: "rollback-canvas-sizing", previous, requested: sizing.canvas },
			);
		}
		const resize_error = error instanceof Error ? error : new Error(String(error));
		report_failure(resize_error, {
			operation: "apply-canvas-sizing",
			previous,
			requested: sizing.canvas,
		});
		throw resize_error;
	}
	return true;
}

function default_report_failure(error, details) {
	console.error("Canvas rendering update failed.", { error, ...details });
}

/**
 * Owns the bounded touch policy for one drawing surface.
 */
class CanvasInteractionController {
	/**
	 * @param {HTMLElement} target
	 * @param {(error: Error, details: object) => void} [report_failure]
	 */
	constructor(target, report_failure = default_report_failure) {
		if (!(target instanceof HTMLElement)) {
			throw new TypeError("CanvasInteractionController target must be an HTMLElement");
		}
		this.target = target;
		this.report_failure = report_failure;
		this.active_touch_ids = new Set();
		this.started = false;
		this.handle_pointer_event = this.handle_pointer_event.bind(this);
	}
	start() {
		if (this.started) {
			return;
		}
		this.started = true;
		this.target.style.touchAction = "none";
		this.target.addEventListener("pointerdown", this.handle_pointer_event, { passive: false });
		this.target.addEventListener("pointermove", this.handle_pointer_event, { passive: false });
		this.target.addEventListener("pointerup", this.handle_pointer_event, { passive: false });
		this.target.addEventListener("pointercancel", this.handle_pointer_event, { passive: false });
	}
	stop() {
		if (!this.started) {
			return;
		}
		this.started = false;
		this.active_touch_ids.clear();
		this.target.removeEventListener("pointerdown", this.handle_pointer_event);
		this.target.removeEventListener("pointermove", this.handle_pointer_event);
		this.target.removeEventListener("pointerup", this.handle_pointer_event);
		this.target.removeEventListener("pointercancel", this.handle_pointer_event);
	}
	/** @param {PointerEvent} event */
	handle_pointer_event(event) {
		if (event.pointerType !== "touch") {
			return;
		}
		if (event.type === "pointerdown") {
			this.active_touch_ids.add(event.pointerId);
		}
		if (this.active_touch_ids.has(event.pointerId) && event.cancelable) {
			event.preventDefault();
			if (!event.defaultPrevented) {
				this.report_failure(new Error("Cancelable touch event was not prevented"), {
					operation: "prevent-touch-default",
					eventType: event.type,
					pointerId: event.pointerId,
				});
			}
		}
		if (event.type === "pointerup" || event.type === "pointercancel") {
			this.active_touch_ids.delete(event.pointerId);
		}
	}
}

export {
	CanvasInteractionController,
	apply_canvas_sizing,
	calculate_canvas_sizing
};
