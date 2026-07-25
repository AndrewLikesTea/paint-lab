// @ts-check
// eslint-disable-next-line no-unused-vars
/* global file_format:writable, file_name:writable, saved:writable, system_file_handle:writable */
/* global $status_text, localize, main_canvas */
import { $DialogWindow } from "./$ToolWindow.js";
// import { localize } from "./app-localization.js";
import { deselect, handle_keyshortcuts, load_image_from_uri, open_from_image_info, show_error_message, update_title } from "./functions.js";
import { E, render_access_key } from "./helpers.js";

// Drawings saved with File > Save to Browser live in localStorage, alongside (but separate from)
// the per-session autosave backups written by sessions.js, which use the "image#" prefix
// and are listed by File > Manage Storage. These are explicit, user-named saves, so they get
// their own prefix, their own metadata, and are never written or removed automatically.
const STORAGE_KEY_PREFIX = "saved-drawing#";

/**
 * @typedef {object} SavedDrawing
 * @property {string} storage_key - the localStorage key the drawing is stored under
 * @property {string} name - the name the user gave the drawing
 * @property {string} data_url - a PNG data URL of the canvas
 * @property {number} width - canvas width in pixels, for display (0 if unknown)
 * @property {number} height - canvas height in pixels, for display (0 if unknown)
 * @property {number} saved_at - Unix timestamp in milliseconds (0 if unknown)
 */

/**
 * localStorage, or null if the browser won't let us use it.
 * Reading is enough to tell whether storage is blocked entirely (cookies disabled, some private
 * browsing modes); a storage area that's merely *full* still reads fine, and failing writes are
 * handled separately, since that's a recoverable situation with a different remedy.
 * @returns {Storage | null}
 */
function get_local_storage() {
	try {
		const storage = window.localStorage;
		// Chrome throws on the property access above; Firefox throws here instead.
		storage.getItem(`${STORAGE_KEY_PREFIX}availability-test`);
		return storage;
	} catch (_error) {
		return null;
	}
}

/**
 * @param {string} storage_key
 * @param {string | null} json
 * @returns {SavedDrawing | null} null if the entry isn't a usable saved drawing
 */
function parse_saved_drawing(storage_key, json) {
	if (!json) {
		return null;
	}
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch (_error) {
		return null; // corrupted, or written by something else using the same prefix
	}
	if (
		!parsed ||
		typeof parsed.name !== "string" ||
		typeof parsed.data_url !== "string" ||
		!parsed.data_url.startsWith("data:image/")
	) {
		return null;
	}
	return {
		storage_key,
		name: parsed.name,
		data_url: parsed.data_url,
		width: Number(parsed.width) || 0,
		height: Number(parsed.height) || 0,
		saved_at: Number(parsed.saved_at) || 0,
	};
}

/**
 * @returns {SavedDrawing[] | null} null if local storage is unavailable; newest first
 */
function list_saved_drawings() {
	const storage = get_local_storage();
	if (!storage) {
		return null;
	}
	const drawings = [];
	for (let index = 0; index < storage.length; index += 1) {
		const storage_key = storage.key(index);
		if (!storage_key || storage_key.indexOf(STORAGE_KEY_PREFIX) !== 0) {
			continue;
		}
		// Skip unreadable entries rather than failing the whole list;
		// one bad entry shouldn't hide the user's other drawings.
		const drawing = parse_saved_drawing(storage_key, storage.getItem(storage_key));
		if (drawing) {
			drawings.push(drawing);
		}
	}
	drawings.sort((a, b) => b.saved_at - a.saved_at);
	return drawings;
}

/**
 * @param {Error & {code?: number, number?: number}} error
 * @returns {boolean}
 */
function is_quota_exceeded(error) {
	// Same detection as storage.js, plus the modern name.
	return (
		error.name === "QuotaExceededError" ||
		error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
		error.code === 22 ||
		error.number === -2147024882
	);
}

// A polite live region, so saving and deleting are announced to screen reader users;
// these actions otherwise only change things visually (or close the dialog outright).
let $announcer;
/**
 * @param {string} message
 */
function announce(message) {
	if (!$announcer) {
		$announcer = $(E("div")).addClass("sr-only").attr({ role: "status", "aria-live": "polite" }).appendTo("body");
	}
	// Re-setting identical text doesn't always re-announce, so clear it first.
	$announcer.text("");
	setTimeout(() => {
		$announcer.text(message);
	}, 100);
}

/**
 * @param {number} saved_at
 * @returns {string}
 */
function format_saved_at(saved_at) {
	if (!saved_at) {
		return "";
	}
	try {
		return new Date(saved_at).toLocaleString([], {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
	} catch (_error) {
		return new Date(saved_at).toString();
	}
}

/** @type {OSGUI$Window} */
let $save_to_browser_window;

function show_save_to_browser_dialog() {
	if ($save_to_browser_window) {
		$save_to_browser_window.close();
	}
	const $w = $DialogWindow(localize("Save to Browser")).addClass("save-to-browser-window horizontal-buttons");
	$save_to_browser_window = $w;

	$w.$main.append(`
		<p class="save-to-browser-explanation">${localize("Saves the drawing in this browser, on this device. It won't be uploaded anywhere.")}</p>
		<div class="save-to-browser-field">
			<label for="saved-drawing-name">${render_access_key("&Name:")}</label>
			<input type="text" id="saved-drawing-name" class="inset-deep" maxlength="100" autocomplete="off" aria-keyshortcuts="Alt+N" aria-describedby="save-to-browser-message">
		</div>
		<p id="save-to-browser-message" class="save-to-browser-message" role="alert"></p>
	`);
	const $input = /** @type {JQuery<HTMLInputElement>} */($w.$main.find("#saved-drawing-name"));
	const $message = $w.$main.find("#save-to-browser-message");

	// Default to the document name without its file extension, the way Save As does.
	$input.val(String(file_name ?? "").replace(/\.[^.]*$/, "") || localize("untitled"));

	// The storage key the next Save will overwrite, once the user has been told
	// that the name is taken. Confirming inline keeps everything in one window;
	// a second window stacked on this one can end up behind it.
	let replacing_storage_key = null;

	/**
	 * @param {string} message
	 */
	const show_field_error = (message) => {
		$message.text(message);
		$input.focus();
		$input[0].select();
	};

	const clear_pending_replace = () => {
		if (replacing_storage_key) {
			replacing_storage_key = null;
			$save.text(localize("Save"));
			$message.text("");
		}
	};

	/**
	 * @param {string} name
	 * @param {string} storage_key
	 */
	const save = (name, storage_key) => {
		// Include the selection, like Save and Export PNG do.
		deselect();
		let data_url;
		try {
			data_url = main_canvas.toDataURL("image/png");
		} catch (error) {
			$w.close();
			show_error_message(localize("Failed to save document."), error);
			return;
		}
		const storage = get_local_storage();
		if (!storage) {
			show_field_error(localize("Please enable local storage in your browser's settings for local backup. It may be called Cookies, Storage, or Site Data."));
			return;
		}
		try {
			storage.setItem(storage_key, JSON.stringify({
				name,
				data_url,
				width: main_canvas.width,
				height: main_canvas.height,
				saved_at: Date.now(),
			}));
		} catch (error) {
			if (is_quota_exceeded(error)) {
				show_field_error(localize("There's not enough space in this browser. Delete drawings you no longer need with File > Open from Browser, or save to your computer with File > Save."));
			} else {
				$w.close();
				show_error_message(localize("Failed to save document."), error);
			}
			return;
		}
		$w.close();
		// This is now the document's persisted PNG representation. Detach any file-system
		// handle from a document opened earlier; a later File > Save must not overwrite that
		// unrelated file after the browser save adopted a new name.
		saved = true;
		system_file_handle = null;
		file_name = `${name}.png`;
		file_format = "image/png";
		update_title();
		$status_text.text(localize("Saved %1 in this browser.", `"${name}"`));
		announce(localize("Saved %1 in this browser.", `"${name}"`));
	};

	const $save = $w.$Button(localize("Save"), () => {
		const name = String($input.val()).trim();
		if (!name) {
			show_field_error(localize("Please enter a name for the drawing."));
			return;
		}
		const drawings = list_saved_drawings();
		if (!drawings) {
			show_field_error(localize("Please enable local storage in your browser's settings for local backup. It may be called Cookies, Storage, or Site Data."));
			return;
		}
		const existing = drawings.find((drawing) => drawing.name.toLowerCase() === name.toLowerCase());
		if (existing && replacing_storage_key !== existing.storage_key) {
			// Ask first, by turning Save into Replace; the alert is announced, and pressing
			// Enter again (or clicking Replace) goes through with it.
			replacing_storage_key = existing.storage_key;
			$save.text(localize("Replace"));
			$message.text(localize("%1 already exists in this browser. Choose Replace to overwrite it, or type a different name.", `"${existing.name}"`));
			$save.focus();
			return;
		}
		save(name, existing?.storage_key ?? `${STORAGE_KEY_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
	}, { type: "submit" });

	// Editing the name is a change of mind; go back to a plain Save.
	$input.on("input", clear_pending_replace);

	$w.$Button(localize("Cancel"), () => {
		$w.close();
	});

	$w.on("closed", () => {
		if ($save_to_browser_window === $w) {
			$save_to_browser_window = null;
		}
	});

	$w.center();
	$input[0].focus();
	$input[0].select();

	// Makes the access key underlined in the Name label work.
	handle_keyshortcuts($w);
}

/** @type {OSGUI$Window} */
let $open_from_browser_window;

function show_open_from_browser_dialog() {
	if ($open_from_browser_window) {
		$open_from_browser_window.close();
	}
	const $w = $DialogWindow(localize("Open from Browser")).addClass("open-from-browser-window squish");
	$open_from_browser_window = $w;

	// The message describes the list, so it comes first, in reading order as well as visually.
	const $message = $(E("p")).addClass("saved-drawings-message").appendTo($w.$main);
	const $list = $(E("ul")).addClass("saved-drawings-list").appendTo($w.$main);
	const $close = $w.$Button(localize("Close"), () => {
		$w.close();
	});

	const drawings = list_saved_drawings();

	/**
	 * One row of the list, for one saved drawing.
	 * @param {SavedDrawing} drawing
	 * @returns {JQuery<HTMLLIElement>}
	 */
	const make_row = (drawing) => {
		const $row = /** @type {JQuery<HTMLLIElement>} */($(E("li")).addClass("saved-drawing"));

		const dimensions = drawing.width && drawing.height ? `${drawing.width} × ${drawing.height}` : "";
		const saved_at = format_saved_at(drawing.saved_at);
		const details = [dimensions, saved_at].filter(Boolean).join(" · ");

		const $thumbnail = $(E("span")).addClass("saved-drawing-thumbnail-container").appendTo($row);
		// The name is right next to it in the reading order, so the image is decorative.
		$(E("img")).attr({ src: drawing.data_url, alt: "" }).addClass("saved-drawing-thumbnail").appendTo($thumbnail);

		const $text = $(E("span")).addClass("saved-drawing-text").appendTo($row);
		const $name = $(E("span")).addClass("saved-drawing-name").text(drawing.name).appendTo($text);
		const $details = $(E("span")).addClass("saved-drawing-details").text(details).appendTo($text);

		const $buttons = $(E("span")).addClass("saved-drawing-buttons").appendTo($row);
		const $open = $(E("button")).attr({ type: "button" })
			.addClass("open-button")
			.text(localize("Open"))
			// Starts with the visible label, so voice control ("click Open") still works.
			.attr("aria-label", `${localize("Open")} "${drawing.name}"`)
			.appendTo($buttons);
		const $delete = $(E("button")).attr({ type: "button" })
			.addClass("remove-button")
			.text(localize("Delete"))
			.attr("aria-label", `${localize("Delete")} "${drawing.name}"`)
			.appendTo($buttons);

		$open.on("click", () => {
			$w.close();
			load_image_from_uri(drawing.data_url).then((info) => {
				// Not into_existing_session: opening starts a new session, like File > Open,
				// so the autosave of the document you were working on isn't overwritten.
				open_from_image_info(info, () => {
					file_name = `${drawing.name}.png`;
					update_title();
					$status_text.text(localize("Opened %1 from this browser.", `"${drawing.name}"`));
				});
			}, (error) => {
				show_error_message(localize("Failed to open image from local storage."), error);
			});
		});

		// Removing is immediate, like File > Manage Storage, but the button becomes Undo,
		// so a mis-click doesn't cost you a drawing. It's the same button element throughout,
		// so keyboard focus stays put, and there's no second window to stack on this one.
		let deleted = false;
		/** Exactly what was stored, so Undo restores it byte for byte. */
		let stored_json = null;
		$delete.on("click", () => {
			const storage = get_local_storage();
			if (!storage) {
				// Storage went away since the list was read (it was readable then, or there'd be no rows).
				show_error_message(localize("Failed to delete %1.", `"${drawing.name}"`));
				return;
			}
			if (deleted) {
				try {
					storage.setItem(drawing.storage_key, stored_json);
				} catch (error) {
					show_error_message(localize("Failed to restore %1.", `"${drawing.name}"`), error);
					return;
				}
				deleted = false;
				$row.removeClass("deleted");
				$name.text(drawing.name);
				$details.text(details);
				$open.prop("disabled", false);
				$delete.text(localize("Delete")).attr("aria-label", `${localize("Delete")} "${drawing.name}"`);
				announce(localize("Restored %1.", `"${drawing.name}"`));
				return;
			}
			stored_json = storage.getItem(drawing.storage_key);
			try {
				storage.removeItem(drawing.storage_key);
			} catch (error) {
				show_error_message(localize("Failed to delete %1.", `"${drawing.name}"`), error);
				return;
			}
			deleted = true;
			$row.addClass("deleted");
			$name.text(localize("Deleted %1.", `"${drawing.name}"`));
			$details.text("");
			$open.prop("disabled", true);
			// Starts with the visible label, so voice control ("click Undo") still works.
			$delete.text(localize("Undo")).attr("aria-label", `${localize("Undo")} ${localize("Delete")} "${drawing.name}"`);
			announce(localize("Deleted %1.", `"${drawing.name}"`));
		});

		return $row;
	};

	if (!drawings) {
		$list.remove();
		$message.text(localize("Please enable local storage in your browser's settings for local backup. It may be called Cookies, Storage, or Site Data."));
	} else if (drawings.length === 0) {
		$list.remove();
		$message.text(localize("No drawings are saved in this browser yet. Use File > Save to Browser to save one."));
	} else {
		for (const drawing of drawings) {
			$list.append(make_row(drawing));
		}
		$message.text(localize("Drawings saved in this browser, on this device."));
	}

	$w.on("closed", () => {
		if ($open_from_browser_window === $w) {
			$open_from_browser_window = null;
		}
	});

	$w.center();
	// Focus the first Open button if there is one, otherwise the Close button.
	const $first_open = $list.find(".open-button").first();
	if ($first_open.length) {
		$first_open.focus();
	} else {
		$close.focus();
	}
}

export { show_open_from_browser_dialog, show_save_to_browser_dialog };
