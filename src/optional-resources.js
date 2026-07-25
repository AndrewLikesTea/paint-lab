// @ts-check
/* global decodeBMP, pako, UTIF */

const pendingScripts = new Map();

/**
 * Load a classic script only when its feature is requested.
 * Concurrent requests share one promise and failed requests may be retried.
 * @param {string} src
 * @param {() => boolean} isReady
 */
export function loadOptionalScript(src, isReady) {
	if (isReady()) {
		return Promise.resolve();
	}
	if (pendingScripts.has(src)) {
		return pendingScripts.get(src);
	}
	const promise = new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = src;
		script.async = true;
		script.onload = () => {
			if (isReady()) {
				resolve();
			} else {
				reject(new Error(`The optional resource did not initialize: ${src}`));
			}
		};
		script.onerror = () => reject(new Error(`Could not load the optional resource: ${src}`));
		document.head.appendChild(script);
	}).catch((error) => {
		pendingScripts.delete(src);
		throw error;
	});
	pendingScripts.set(src, promise);
	return promise;
}

const pendingStylesheets = new Map();

/**
 * Load a stylesheet only when its feature is requested, so it doesn't block
 * the first render. Resolves once the styles have actually applied, so callers
 * can measure or show the UI it styles without a flash of unstyled content.
 * @param {string} href
 */
export function loadOptionalStylesheet(href) {
	if (pendingStylesheets.has(href)) {
		return pendingStylesheets.get(href);
	}
	const promise = new Promise((resolve, reject) => {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.type = "text/css";
		link.href = href;
		link.onload = () => resolve();
		link.onerror = () => reject(new Error(`Could not load the optional stylesheet: ${href}`));
		document.head.appendChild(link);
	}).catch((error) => {
		pendingStylesheets.delete(href);
		throw error;
	});
	pendingStylesheets.set(href, promise);
	return promise;
}

/**
 * Load classic scripts strictly in order.
 * Some of these libraries capture their dependencies as they load
 * (UTIF.js grabs `self.pako` at the top of the file), so they can't race.
 * @param {[src: string, isReady: () => boolean][]} scripts
 */
async function loadOptionalScriptsInOrder(scripts) {
	for (const [src, isReady] of scripts) {
		await loadOptionalScript(src, isReady);
	}
}

// Loaders for libraries that are only needed once the user reaches for a
// specific feature. Keeping them off the initial page load is what lets the
// canvas show up quickly; each loader is idempotent, and safe to call again
// after a failure.

/** Palette file reading/writing, for Colors > Get Colors / Save Colors. */
export const load_palette_library = () =>
	loadOptionalScript("lib/anypalette-0.6.0.js", () => typeof AnyPalette !== "undefined");

/** BMP encoding/decoding, for opening and saving .bmp/.dib files. */
export const load_bmp_codec = () =>
	loadOptionalScript("lib/bmp.js", () => typeof decodeBMP !== "undefined");

/**
 * UTIF.js, used to read and write TIFF files.
 * pako is loaded up front for UPNG.js, but it's listed here too so this doesn't
 * quietly break if PNG ever stops being on the critical path.
 */
export const load_tiff_codec = () =>
	loadOptionalScriptsInOrder([
		["lib/pako-2.0.3.min.js", () => typeof pako !== "undefined"],
		["lib/UTIF.js", () => typeof UTIF !== "undefined"],
	]);
