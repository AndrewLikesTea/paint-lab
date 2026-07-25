// @ts-check

/**
 * Installs a browser confirmation guard for active document changes.
 *
 * This module deliberately owns no document state. The application supplies a
 * predicate so save/reset semantics remain in the state-management layer.
 * Importing the module has no side effects; the returned function is the
 * rollback mechanism for the installed listener.
 *
 * @param {Pick<Window, "addEventListener" | "removeEventListener">} eventTarget
 * @param {() => boolean} hasActiveChanges
 * @returns {() => void}
 */
function installBeforeUnloadGuard(eventTarget, hasActiveChanges) {
	if (!eventTarget || typeof eventTarget.addEventListener !== "function" ||
		typeof eventTarget.removeEventListener !== "function") {
		throw new TypeError("A browser event target is required.");
	}
	if (typeof hasActiveChanges !== "function") {
		throw new TypeError("A document-change predicate is required.");
	}

	/** @param {BeforeUnloadEvent} event */
	const handleBeforeUnload = (event) => {
		if (!hasActiveChanges()) {
			return;
		}

		event.preventDefault();
		// Browsers require returnValue to be set, but deliberately ignore custom
		// text and show their own confirmation message.
		event.returnValue = "";
	};

	eventTarget.addEventListener("beforeunload", handleBeforeUnload);

	let installed = true;
	return () => {
		if (!installed) {
			return;
		}
		eventTarget.removeEventListener("beforeunload", handleBeforeUnload);
		installed = false;
	};
}

export { installBeforeUnloadGuard };
