// @ts-check
/* global localize */

// One home for everything the app keeps in localStorage on the user's behalf:
// the automatic backup of the document you're drawing (File > Manage Storage lists these),
// and the drawings you name yourself with File > Save to Browser (File > Open from Browser
// lists those).
//
// These grew up as two unrelated schemes: autosave wrote a bare PNG data URL under "image#<session id>",
// while Save to Browser wrote a small JSON object under "saved-drawing#<id>". Two prefixes, two shapes,
// two copies of the "is localStorage even usable?" dance, and two different ideas of what a failed
// write means. This module replaces both with one key structure, one record shape, and one API,
// so a save is a save no matter which path the user took.
//
// Old entries are migrated on load (see migrate_legacy_sessions below); reads fall back to the old
// keys, so nothing is lost if the migration can't write.

/** Every key this module owns starts with this. Nothing else in localStorage does. */
const SESSION_KEY_PREFIX = "paint-session#";

/** Written continuously while you draw, one per session ID (the `#local:` part of the URL). */
const AUTOSAVE = "autosave";
/** Written only when the user asks, by File > Save to Browser. Named, and never touched automatically. */
const MANUAL = "manual";

/** The prefixes these two kinds used before they were unified. Read, migrated away from, never written. */
const LEGACY_PREFIXES = {
	[AUTOSAVE]: "image#",
	[MANUAL]: "saved-drawing#",
};

/** Bump if the stored shape changes incompatibly; parse_record decides what to do with older records. */
const RECORD_FORMAT = 1;

/**
 * A saved document, however it got saved. Autosaves have no name; manual saves do.
 * @typedef {object} SessionRecord
 * @property {number} format - RECORD_FORMAT at the time it was written
 * @property {"autosave" | "manual"} kind
 * @property {string} id - session ID for autosaves, an opaque generated ID for manual saves
 * @property {string} name - what the user called it ("" for autosaves, which are unnamed)
 * @property {string} data_url - a PNG data URL of the canvas
 * @property {number} width - canvas width in pixels, for display (0 if unknown)
 * @property {number} height - canvas height in pixels, for display (0 if unknown)
 * @property {number} saved_at - Unix timestamp in milliseconds (0 if unknown)
 */

/**
 * What every operation here returns. Nothing throws and nothing fails quietly: `ok` says whether it
 * worked, and when it didn't, `reason` says why in terms a caller can act on — "you're out of space"
 * (the user can free some) is a different situation from "your browser won't let me store anything"
 * (the user can allow it) is a different situation from "that entry is garbage" (not the user's
 * fault, and not their problem to fix).
 *
 * This is one shape rather than a success | failure union because the project type-checks without
 * strictNullChecks, and without it TypeScript won't narrow `if (!result.ok)` to the failure case.
 *
 * @typedef {object} StorageResult
 * @property {boolean} ok
 * @property {"unavailable" | "quota" | "corrupt" | "io"} [reason] - set when ok is false
 * @property {Error} [error] - the underlying error, for the expandable details of an error dialog
 * @property {SessionRecord} [record] - read_session and find_session_by_name (null if there's none
 *   under that ID or name), write_session (what it wrote)
 * @property {SessionRecord[]} [records] - list_sessions
 * @property {string} [key] - write_session: the localStorage key it wrote
 * @property {Record<string, string>} [snapshot] - delete_session: exactly what it removed
 * @property {number} [migrated] - migrate_legacy_sessions
 * @property {number} [failed] - migrate_legacy_sessions
 */

/**
 * @param {StorageResult["reason"]} reason
 * @param {Error} [error]
 * @returns {StorageResult}
 */
function failure(reason, error) {
	return { ok: false, reason, error };
}

/**
 * localStorage, or null if the browser won't let us use it.
 * Reading is enough to tell whether storage is blocked entirely (cookies disabled, some private
 * browsing modes); a storage area that's merely *full* still reads fine, and failing writes are
 * handled separately, since that's a recoverable situation with a different remedy.
 * @returns {Storage | null}
 */
function get_storage() {
	try {
		const storage = window.localStorage;
		// Chrome throws on the property access above; Firefox throws here instead.
		storage.getItem(`${SESSION_KEY_PREFIX}availability-test`);
		return storage;
	} catch (_error) {
		return null;
	}
}

/**
 * @returns {boolean} whether saving anything is possible at all right now
 */
function is_storage_available() {
	return get_storage() !== null;
}

/**
 * @param {string} kind
 * @param {string} id
 * @returns {string}
 */
function session_key(kind, id) {
	if (kind !== AUTOSAVE && kind !== MANUAL) {
		throw new TypeError(`Unknown session kind '${kind}'`);
	}
	if (typeof id !== "string" || id === "") {
		throw new TypeError("Session ID must be a non-empty string");
	}
	// The kind goes in the key, not just the record, so an autosave and a manual save can never
	// land on the same key even if they somehow generate the same ID.
	return `${SESSION_KEY_PREFIX}${kind}:${id}`;
}

/**
 * @param {string} kind
 * @param {string} id
 * @returns {string}
 */
function legacy_key(kind, id) {
	return `${LEGACY_PREFIXES[kind]}${id}`;
}

/**
 * @param {string} key
 * @returns {{kind: "autosave" | "manual", id: string, legacy: boolean} | null}
 */
function parse_key(key) {
	if (key.indexOf(SESSION_KEY_PREFIX) === 0) {
		const rest = key.slice(SESSION_KEY_PREFIX.length);
		const separator = rest.indexOf(":");
		if (separator < 1) {
			return null;
		}
		const kind = rest.slice(0, separator);
		const id = rest.slice(separator + 1);
		// Split on the *first* colon only: session IDs come from the URL hash and may contain one.
		if ((kind !== AUTOSAVE && kind !== MANUAL) || id === "") {
			return null;
		}
		return { kind, id, legacy: false };
	}
	for (const kind of [AUTOSAVE, MANUAL]) {
		const prefix = LEGACY_PREFIXES[kind];
		if (key.indexOf(prefix) === 0 && key.length > prefix.length) {
			return { kind: /** @type {"autosave" | "manual"} */(kind), id: key.slice(prefix.length), legacy: true };
		}
	}
	return null;
}

/**
 * @param {Error & {code?: number, number?: number}} error
 * @returns {"quota" | "io"}
 */
function classify_write_error(error) {
	const quota_exceeded =
		error.name === "QuotaExceededError" ||
		error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
		error.code === 22 ||
		error.number === -2147024882;
	return quota_exceeded ? "quota" : "io";
}

/**
 * Turns stored JSON into a record, whatever shape it was written in.
 * @param {"autosave" | "manual"} kind
 * @param {string} id
 * @param {string | null} json
 * @returns {SessionRecord | null} null if the entry isn't a usable saved document
 */
function parse_record(kind, id, json) {
	if (json === null || json === "") {
		return null;
	}
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch (_error) {
		// Autosaves were once written as a raw data URL, without JSON.stringify. Accept those too;
		// anything else under one of our prefixes is corrupted, or written by something else.
		parsed = json.indexOf("data:image/") === 0 ? json : null;
	}
	// The pre-refactor autosave format: just the data URL, JSON-encoded as a string.
	if (typeof parsed === "string") {
		parsed = { data_url: parsed };
	}
	if (
		!parsed ||
		typeof parsed !== "object" ||
		typeof parsed.data_url !== "string" ||
		parsed.data_url.indexOf("data:image/") !== 0
	) {
		return null;
	}
	return {
		format: Number(parsed.format) || RECORD_FORMAT,
		kind,
		id,
		name: typeof parsed.name === "string" ? parsed.name : "",
		data_url: parsed.data_url,
		width: Number(parsed.width) || 0,
		height: Number(parsed.height) || 0,
		saved_at: Number(parsed.saved_at) || 0,
	};
}

/**
 * @param {Storage} storage
 * @param {string} key
 * @param {string | null} previous - what was there before, or null if the key was unset
 */
function roll_back(storage, key, previous) {
	try {
		if (previous === null) {
			storage.removeItem(key);
		} else {
			storage.setItem(key, previous);
		}
	} catch (_error) {
		// Nothing further we can do; the caller is already reporting a failure.
	}
}

/**
 * Writes one key, and either leaves it holding exactly `json` or leaves it exactly as it was.
 * @param {Storage} storage
 * @param {string} key
 * @param {string} json
 * @param {boolean} verify - read the value back and roll back on mismatch
 * @returns {StorageResult}
 */
function commit(storage, key, json, verify) {
	/** @type {string | null} */
	let previous = null;
	if (verify) {
		try {
			previous = storage.getItem(key);
		} catch (error) {
			return failure("io", error);
		}
	}
	try {
		storage.setItem(key, json);
	} catch (error) {
		// Per spec the old value survives a failed setItem, so there's nothing to undo here.
		return failure(classify_write_error(error), error);
	}
	if (verify) {
		let written;
		try {
			written = storage.getItem(key);
		} catch (_error) {
			written = null;
		}
		if (written !== json) {
			// Some private browsing modes accept writes and quietly discard them. Put back what was
			// there, so a save that didn't happen can't also destroy the save that did.
			roll_back(storage, key, previous);
			return failure("io", new Error(
				`Wrote ${json.length} characters to '${key}' but read back ${written === null ? "nothing" : `${written.length} characters`}.`
			));
		}
	}
	return { ok: true };
}

/**
 * @param {Storage} storage
 * @param {"autosave" | "manual"} kind
 * @param {string} id
 */
function forget_legacy(storage, kind, id) {
	try {
		if (storage.getItem(legacy_key(kind, id)) !== null) {
			storage.removeItem(legacy_key(kind, id));
		}
	} catch (_error) {
		// Harmless: reads and listings prefer the unified record anyway.
	}
}

/**
 * Reads one saved document.
 * @param {"autosave" | "manual"} kind
 * @param {string} id
 * @returns {StorageResult}
 */
function read_session(kind, id) {
	const storage = get_storage();
	if (!storage) {
		return failure("unavailable");
	}
	/** @type {string | null} */
	let json;
	try {
		json = storage.getItem(session_key(kind, id));
		if (json === null) {
			// Not migrated yet, or migration couldn't write (no space). Falling back here is what
			// makes the migration safe to fail: a backup is never invisible just because the
			// rewrite didn't happen.
			json = storage.getItem(legacy_key(kind, id));
		}
	} catch (error) {
		return failure("io", error);
	}
	if (json === null) {
		return { ok: true, record: null };
	}
	const record = parse_record(kind, id, json);
	if (!record) {
		return failure("corrupt", new Error(`Unreadable ${kind} record for '${id}'.`));
	}
	return { ok: true, record };
}

/**
 * Saves one document, by either path. The write lands whole or not at all.
 * @param {{kind: "autosave" | "manual", id: string, data_url: string, name?: string, width?: number, height?: number, saved_at?: number}} fields
 * @param {{verify?: boolean}} [options] - verify:false skips the read-back for the autosave path,
 *   which runs up to ten times a second on data URLs that can be megabytes; localStorage already
 *   guarantees the previous value survives a failed setItem, so there's nothing to roll back to.
 * @returns {StorageResult}
 */
function write_session(fields, options = {}) {
	const storage = get_storage();
	if (!storage) {
		return failure("unavailable");
	}
	if (typeof fields.data_url !== "string" || fields.data_url.indexOf("data:image/") !== 0) {
		return failure("corrupt", new Error("Refusing to save a session record without image data."));
	}
	/** @type {SessionRecord} */
	const record = {
		format: RECORD_FORMAT,
		kind: fields.kind,
		id: fields.id,
		name: fields.name ?? "",
		data_url: fields.data_url,
		width: Number(fields.width) || 0,
		height: Number(fields.height) || 0,
		saved_at: Number(fields.saved_at) || Date.now(),
	};
	const key = session_key(record.kind, record.id);
	const result = commit(storage, key, JSON.stringify(record), options.verify ?? true);
	if (!result.ok) {
		return result;
	}
	// This record is now the only copy. Drop the pre-refactor twin if migration left it behind
	// (it does when it can't write), so the same document never exists under two keys.
	forget_legacy(storage, record.kind, record.id);
	return { ok: true, record, key };
}

/**
 * Lists saved documents, newest first.
 * @param {"autosave" | "manual"} [kind] - omit for all kinds
 * @returns {StorageResult}
 */
function list_sessions(kind) {
	const storage = get_storage();
	if (!storage) {
		return failure("unavailable");
	}
	/** @type {Map<string, {record: SessionRecord, legacy: boolean}>} */
	const found = new Map();
	try {
		for (let index = 0; index < storage.length; index += 1) {
			const key = storage.key(index);
			const parsed = key && parse_key(key);
			if (!parsed || (kind && parsed.kind !== kind)) {
				continue;
			}
			// Skip unreadable entries rather than failing the whole list;
			// one bad entry shouldn't hide the user's other drawings.
			const record = parse_record(parsed.kind, parsed.id, storage.getItem(key));
			if (!record) {
				continue;
			}
			// A legacy entry can outlive its replacement if it couldn't be removed. The unified
			// record wins either way, so the same document is never listed twice.
			const existing = found.get(`${parsed.kind}:${parsed.id}`);
			if (existing && (parsed.legacy || !existing.legacy)) {
				continue;
			}
			found.set(`${parsed.kind}:${parsed.id}`, { record, legacy: parsed.legacy });
		}
	} catch (error) {
		return failure("io", error);
	}
	const records = [...found.values()].map(({ record }) => record);
	records.sort((a, b) => b.saved_at - a.saved_at);
	return { ok: true, records };
}

/**
 * @param {"autosave" | "manual"} kind
 * @param {string} name - matched case-insensitively, the way the file system would
 * @returns {StorageResult}
 */
function find_session_by_name(kind, name) {
	const listing = list_sessions(kind);
	if (!listing.ok) {
		return listing;
	}
	const match = listing.records.find((record) => record.name.toLowerCase() === name.toLowerCase());
	return { ok: true, record: match ?? null };
}

/**
 * Removes a saved document, including any un-migrated copy of it.
 * @param {"autosave" | "manual"} kind
 * @param {string} id
 * @returns {StorageResult} snapshot is exactly what
 *   was stored, for restore_session to put back byte for byte
 */
function delete_session(kind, id) {
	const storage = get_storage();
	if (!storage) {
		return failure("unavailable");
	}
	const keys = [session_key(kind, id), legacy_key(kind, id)];
	/** @type {Record<string, string>} */
	const snapshot = {};
	try {
		for (const key of keys) {
			const json = storage.getItem(key);
			if (json !== null) {
				snapshot[key] = json;
			}
		}
	} catch (error) {
		return failure("io", error);
	}
	/** @type {string[]} */
	const removed = [];
	for (const key of Object.keys(snapshot)) {
		try {
			storage.removeItem(key);
			removed.push(key);
		} catch (error) {
			// Put back whatever already went, so a half-done delete can't leave a document
			// partly gone and un-restorable.
			for (const done of removed) {
				roll_back(storage, done, snapshot[done]);
			}
			return failure("io", error);
		}
	}
	return { ok: true, snapshot };
}

/**
 * Puts back exactly what delete_session removed, or nothing at all.
 * @param {Record<string, string>} snapshot
 * @returns {StorageResult}
 */
function restore_session(snapshot) {
	const storage = get_storage();
	if (!storage) {
		return failure("unavailable");
	}
	/** @type {string[]} */
	const applied = [];
	for (const key of Object.keys(snapshot)) {
		const result = commit(storage, key, snapshot[key], true);
		if (!result.ok) {
			for (const done of applied) {
				roll_back(storage, done, null);
			}
			return result;
		}
		applied.push(key);
	}
	return { ok: true };
}

/**
 * @returns {string} an ID for a manual save, unique enough that two saves in the same millisecond
 *   don't collide
 */
function new_session_id() {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Rewrites pre-refactor entries under the unified keys.
 *
 * Order matters: the replacement is written and read back before the old key is removed, so an
 * interrupted or out-of-space migration leaves the old entry exactly where it was, and read_session
 * still finds it. Nothing is deleted that hasn't first been proven readable somewhere else.
 * @returns {StorageResult}
 */
function migrate_legacy_sessions() {
	const storage = get_storage();
	if (!storage) {
		return { ...failure("unavailable"), migrated: 0, failed: 0 };
	}
	/** @type {string[]} */
	const legacy_keys = [];
	try {
		// Collect first: the loop below removes keys, and storage.key(index) reflects that
		// immediately, so iterating while mutating would skip entries.
		for (let index = 0; index < storage.length; index += 1) {
			const key = storage.key(index);
			const parsed = key && parse_key(key);
			if (parsed && parsed.legacy) {
				legacy_keys.push(key);
			}
		}
	} catch (error) {
		return { ...failure("io", error), migrated: 0, failed: 0 };
	}
	let migrated = 0;
	let failed = 0;
	for (const key of legacy_keys) {
		const parsed = parse_key(key);
		let json;
		let existing;
		try {
			json = storage.getItem(key);
			existing = storage.getItem(session_key(parsed.kind, parsed.id));
		} catch (_error) {
			failed += 1;
			continue;
		}
		if (json === null) {
			continue; // gone since we listed it (another tab, most likely)
		}
		if (existing !== null && !parse_record(parsed.kind, parsed.id, existing)) {
			// A key merely existing is not proof that it contains the drawing. Keep the readable
			// legacy copy instead of deleting the user's last recoverable version. A later explicit
			// save can replace the corrupt unified entry and clean up the legacy one.
			failed += 1;
			continue;
		}
		if (existing === null) {
			const record = parse_record(parsed.kind, parsed.id, json);
			if (!record) {
				// Corrupted, or written by something else using our old prefix. Leave it alone
				// rather than deleting data we can't identify.
				failed += 1;
				continue;
			}
			const result = commit(storage, session_key(parsed.kind, parsed.id), JSON.stringify(record), true);
			if (!result.ok) {
				// Out of space, most likely. Keep the old entry: reads fall back to it, so nothing
				// is lost, and the next successful write cleans it up.
				failed += 1;
				continue;
			}
		}
		try {
			storage.removeItem(key);
		} catch (_error) {
			// Harmless: the unified record already wins in reads and listings.
		}
		migrated += 1;
	}
	return { ok: true, migrated, failed };
}

const STORAGE_DISABLED_MESSAGE = "Please enable local storage in your browser's settings for local backup. It may be called Cookies, Storage, or Site Data.";
const STORAGE_FULL_MESSAGE = "There's not enough space in this browser. Delete drawings you no longer need with File > Open from Browser, or save to your computer with File > Save.";

/**
 * One wording per failure mode, so every save path explains the same problem the same way.
 * @param {StorageResult} storage_failure
 * @returns {string}
 */
function describe_storage_failure(storage_failure) {
	switch (storage_failure.reason) {
		case "unavailable":
			return localize(STORAGE_DISABLED_MESSAGE);
		case "quota":
			return localize(STORAGE_FULL_MESSAGE);
		default:
			// "corrupt" and "io" aren't anything the user did or can fix; the underlying error
			// goes in the expandable details of an error dialog, or the console.
			return localize("Failed to access local storage.");
	}
}

// Run before anything reads or writes. A module body finishes evaluating before the body of
// anything importing it, so this is done before sessions.js can start a session — which matters,
// because an autosave of a blank canvas landing on a unified key first would make the old entry
// look already-migrated, and it would be deleted.
migrate_legacy_sessions();

export {
	AUTOSAVE,
	delete_session,
	describe_storage_failure,
	find_session_by_name,
	is_storage_available,
	list_sessions,
	MANUAL,
	migrate_legacy_sessions,
	new_session_id,
	parse_key,
	read_session,
	restore_session,
	session_key,
	SESSION_KEY_PREFIX,
	STORAGE_DISABLED_MESSAGE,
	write_session
};
