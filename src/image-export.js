// @ts-check
/* global make_canvas */

// The image export pipeline, shared by every consumer of a scaled PNG:
// saving to a file, copying to the clipboard, and the Web Share API.
// Kept free of UI concerns on purpose — nothing here shows a dialog or
// localizes a string, so the same pipeline is usable from any of them.

/**
 * The scale factors offered for export.
 *
 * Integers only, and deliberately so: the export scales with image smoothing
 * disabled, which only lands on exact pixel boundaries at integer scales.
 * That's what keeps pixel art crisp instead of blurry when scaled up.
 * @type {readonly number[]}
 */
const EXPORT_SCALES = Object.freeze([1, 2, 4]);

/**
 * MIME types the export pipeline is allowed to produce.
 * PNG only for now; the dialog is "Export PNG", and lossy formats would
 * defeat the point of exporting at a higher scale for clarity.
 * @type {readonly string[]}
 */
const EXPORT_MIME_TYPES = Object.freeze(["image/png"]);

/**
 * @typedef {object} ExportConfig
 * @property {number} scale - One of `EXPORT_SCALES`.
 * @property {string} mime_type - One of `EXPORT_MIME_TYPES`.
 */

/**
 * Validates and freezes an export configuration.
 *
 * This is the one place that decides what an export request may ask for, so
 * that a bad scale fails here, with a clear message, rather than downstream as
 * a `make_canvas(NaN, NaN)` or a silently mis-sized image.
 * @param {{ scale: number, mime_type?: string }} options
 * @returns {ExportConfig} A frozen, validated config.
 * @throws {RangeError} If the scale or MIME type is unsupported.
 */
function make_export_config({ scale, mime_type = "image/png" }) {
	if (!EXPORT_SCALES.includes(scale)) {
		throw new RangeError(`Unsupported export scale ${JSON.stringify(scale)}; expected one of ${EXPORT_SCALES.join(", ")}`);
	}
	if (!EXPORT_MIME_TYPES.includes(mime_type)) {
		throw new RangeError(`Unsupported export MIME type ${JSON.stringify(mime_type)}; expected one of ${EXPORT_MIME_TYPES.join(", ")}`);
	}
	return Object.freeze({ scale, mime_type });
}

/**
 * The exact pixel dimensions an export will produce.
 * Split out so the dialog can label the options with the sizes the user will
 * actually get, from the same arithmetic that does the scaling.
 * @param {HTMLCanvasElement} source_canvas
 * @param {ExportConfig} config
 * @returns {{ width: number, height: number }}
 */
function export_dimensions(source_canvas, config) {
	return {
		width: source_canvas.width * config.scale,
		height: source_canvas.height * config.scale,
	};
}

/**
 * Renders the document to a new canvas at the configured scale.
 * @param {HTMLCanvasElement} source_canvas
 * @param {ExportConfig} config
 * @returns {PixelCanvas} A new canvas; the caller owns it.
 */
function render_export_canvas(source_canvas, config) {
	const { width, height } = export_dimensions(source_canvas, config);
	const export_canvas = make_canvas(width, height);
	// Nearest-neighbor. At integer scales each source pixel becomes an exact
	// block of identical pixels, so hard edges stay hard. Smoothing would blur
	// exactly the detail someone exporting at 4x is trying to preserve.
	// (Using the helper rather than setting imageSmoothingEnabled directly, as
	// it also covers the vendor-prefixed properties older Firefox needs.)
	export_canvas.ctx.disable_image_smoothing();
	export_canvas.ctx.drawImage(source_canvas, 0, 0, width, height);
	return export_canvas;
}

/**
 * Frees a canvas's backing store rather than waiting for the GC to notice.
 *
 * At 4x, the intermediate canvas holds 16x the document's pixels; for a large
 * document that's tens of megabytes we can hand back immediately instead of
 * keeping it alive until the next collection.
 * @param {HTMLCanvasElement} canvas
 */
function release_canvas(canvas) {
	canvas.width = 0;
	canvas.height = 0;
}

/**
 * Renders and encodes the document as an image file, at the configured scale.
 *
 * No partial results: it either resolves with a fully encoded, sanity-checked
 * blob or rejects, and the intermediate canvas is released on both paths.
 *
 * Caveat inherited from `write_image_file`: when `sanity_check_blob` rejects a
 * blob outright (zero-length, or wrong magic bytes) it reports that to the user
 * and calls neither callback, so this promise never settles and the canvas is
 * retained. The user does see an error, so this is a leak rather than a silent
 * failure; fixing it properly means changing `sanity_check_blob`'s contract,
 * which has several other callers.
 *
 * Rejection reasons carry `already_reported` so callers know whether the user
 * has been told: the encoder (`write_image_file`) shows its own error message,
 * whereas an allocation failure here has not been surfaced to anyone yet.
 * Use `report_export_error` rather than branching on this by hand.
 *
 * `write_image_file` is injected rather than imported to keep this module a
 * leaf — functions.js already imports plenty, and a cycle between the two
 * would be needless fragility.
 * @param {HTMLCanvasElement} source_canvas
 * @param {ExportConfig} config
 * @param {(canvas: HTMLCanvasElement, mime_type: string, blob_callback: (blob: Blob) => void, error_callback: (error: unknown) => void) => void} write_image_file
 * @returns {Promise<Blob>}
 */
function export_image_blob(source_canvas, config, write_image_file) {
	return new Promise((resolve, reject) => {
		let export_canvas;
		try {
			export_canvas = render_export_canvas(source_canvas, config);
		} catch (error) {
			// Typically out of memory, which is most likely at 4x on a large
			// document. Nobody has reported this to the user yet.
			reject(annotate_export_error(error, false));
			return;
		}
		let settled = false;
		/** @param {(value: any) => void} settle @param {any} value */
		const finish = (settle, value) => {
			// write_image_file's callbacks are only supposed to fire once, but
			// this promise must not be settled twice regardless, and the canvas
			// must not be released while an encode is still reading it.
			if (settled) {
				return;
			}
			settled = true;
			release_canvas(export_canvas);
			settle(value);
		};
		try {
			write_image_file(
				export_canvas,
				config.mime_type,
				(blob) => finish(resolve, with_mime_type(blob, config.mime_type)),
				// write_image_file has already shown an error message for this.
				(error) => finish(reject, annotate_export_error(error, true)),
			);
		} catch (error) {
			finish(reject, annotate_export_error(error, false));
		}
	});
}

/**
 * Guarantees the blob is labeled with the MIME type the export asked for.
 *
 * Not cosmetic: the PNG encoder builds its blob from a raw ArrayBuffer without
 * passing a type, so `blob.type` comes back as "". A file download doesn't care
 * (the extension carries it), but the Clipboard API keys entries by MIME type
 * and the Share API needs it to hand the file to the right app, so both break
 * on an untyped blob. Re-wrapping references the same bytes; it doesn't copy.
 * @param {Blob} blob
 * @param {string} mime_type
 * @returns {Blob}
 */
function with_mime_type(blob, mime_type) {
	if (blob.type === mime_type) {
		return blob;
	}
	return new Blob([blob], { type: mime_type });
}

/**
 * Tags an error with whether the user has already seen a message about it.
 * @param {unknown} error
 * @param {boolean} already_reported
 * @returns {Error & { already_reported: boolean }}
 */
function annotate_export_error(error, already_reported) {
	const annotated = /** @type {Error & { already_reported: boolean }} */ (
		error instanceof Error ? error : new Error(String(error))
	);
	annotated.already_reported = already_reported;
	return annotated;
}

/**
 * Shows an error message for a failed export, unless the user has already been
 * told about it. Prevents the double error dialog you'd otherwise get for
 * encoder failures, which report themselves.
 * @param {unknown} error
 * @param {string} message - Localized, action-specific message.
 * @param {(message: string, error?: Error | string) => void} show_error_message
 */
function report_export_error(error, message, show_error_message) {
	if (error && /** @type {{ already_reported?: boolean }} */ (error).already_reported) {
		return;
	}
	show_error_message(message, /** @type {Error} */ (error));
}

/**
 * Whether the platform can share image files, as opposed to only text or URLs.
 *
 * `navigator.share` rejects for unsupported payloads, and most desktop browsers
 * can't share files at all, so this is checked up front to decide whether to
 * offer sharing rather than offering it and failing.
 * @returns {boolean}
 */
function can_share_image_files() {
	// A zero-byte probe: canShare inspects the file list's types, not contents.
	if (typeof File !== "function" || !navigator.canShare) {
		return false;
	}
	try {
		return navigator.canShare({
			files: [new File([], "image.png", { type: "image/png" })],
		});
	} catch (_error) {
		// Older implementations can throw instead of returning false.
		return false;
	}
}

export {
	can_share_image_files, export_dimensions, export_image_blob, EXPORT_MIME_TYPES, EXPORT_SCALES,
	make_export_config, release_canvas, render_export_canvas, report_export_error
};
