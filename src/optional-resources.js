// @ts-check

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
