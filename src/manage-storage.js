// @ts-check
/* global localize */
import { $DialogWindow } from "./$ToolWindow.js";
// import { localize } from "./app-localization.js";
import { E, is_discord_embed } from "./helpers.js";
import { showMessageBox } from "./msgbox.js";
import { AUTOSAVE, delete_session, describe_storage_failure, list_sessions } from "./session-storage.js";

/** @type {OSGUI$Window & I$DialogWindow} */
let $storage_manager;
let $quota_exceeded_window;
let ignoring_quota_exceeded = false;

async function storage_quota_exceeded() {
	if ($quota_exceeded_window) {
		$quota_exceeded_window.close();
		$quota_exceeded_window = null;
	}
	if (ignoring_quota_exceeded) {
		return;
	}
	const { promise, $window } = showMessageBox({
		title: "Storage Error",
		messageHTML: `
			<p>JS Paint normally keeps a local backup of images you edit.</p>
			<p>However, it has run out of space to do so.</p>
			<p>You can still save the current image with <b>File > Save</b>. You should save frequently, or free up space for backups.</p>
		`,
		buttons: [
			{ label: "Manage Storage", value: "manage", default: true },
			{ label: "Ignore", value: "ignore" },
		],
		iconID: "warning",
	});
	$quota_exceeded_window = $window;
	const result = await promise;
	if (result === "ignore") {
		ignoring_quota_exceeded = true;
	} else if (result === "manage") {
		ignoring_quota_exceeded = false;
		manage_storage();
	}
}

function manage_storage() {
	if ($storage_manager) {
		$storage_manager.close();
	}
	$storage_manager = $DialogWindow();
	$storage_manager.title("Manage Storage").addClass("storage-manager squish");
	// @TODO: way to remove all (with confirmation)
	const $table = $(E("table")).appendTo($storage_manager.$main);
	const $message = $(E("p")).appendTo($storage_manager.$main).html(
		"This lists automatic backups. Images you've saved with <b>File > Save</b> or <b>File > Save to Browser</b> will not be affected."
	);
	const $close = $storage_manager.$Button("Close", () => {
		$storage_manager.close();
	});

	/**
	 * @param {import("./session-storage.js").SessionRecord} record
	 */
	const addRow = (record) => {
		const $tr = $(E("tr")).appendTo($table);

		const $img = $(E("img")).attr({ src: record.data_url }).addClass("thumbnail-img");
		const $remove = $(E("button")).text("Remove").addClass("remove-button").attr("type", "button");
		// An autosave's ID *is* its session ID, so the backup links back to the session it belongs to.
		const href = `#local:${record.id}`;
		// The Electron app is a single window for now. This isn't a great experience, but it's better than a broken link.
		// The Discord Activity can open a external links (with a prompt), but opening internally seems better,
		// and it was opening a new tab with the app but not loading the document, so this fixes that.
		// (It seemed to be a separate storage area, despite the same origin? only glancing, not sure.)
		const target = window.is_electron_app || is_discord_embed ? "_self" : "_blank";
		const $open_link = $(E("a")).attr({ href, target }).text(localize("Open"));
		const $thumbnail_open_link = $(E("a")).attr({ href, target }).addClass("thumbnail-container");
		$thumbnail_open_link.append($img);
		$(E("td")).append($thumbnail_open_link).appendTo($tr);
		$(E("td")).append($open_link).appendTo($tr);
		$(E("td")).append($remove).appendTo($tr);

		$remove.on("click", () => {
			// Focus the next or previous row's remove button, or the close button if there are no more rows.
			// Try focusing controls in reverse order of priority, so the highest priority control gets focus.
			$close.focus();
			$tr.prev().find(".remove-button").focus();
			$tr.next().find(".remove-button").focus();

			const result = delete_session(AUTOSAVE, record.id);
			if (!result.ok) {
				showMessageBox({
					title: "Storage Error",
					message: describe_storage_failure(result),
					iconID: "warning",
				});
				return;
			}
			$tr.remove();
			if ($table.find("tr").length == 0) {
				$message.html("<p>All clear!</p>");
			}
		});
	};

	// Listing reads rather than writes, so it still works when storage is completely full.
	// Test with https://stackoverflow.com/questions/45760110/how-to-fill-javascript-localstorage-to-its-max-capacity-quickly
	const listing = list_sessions(AUTOSAVE);

	if (listing.ok) {
		for (const record of listing.records) {
			addRow(record);
		}
	}

	if (!listing.ok) {
		// @TODO: instructions for your browser; it's called Cookies in chrome/chromium at least, and "storage" gives NO results
		$message.text(describe_storage_failure(listing));
	} else if ($table.find("tr").length == 0) {
		$message.html("<p>All clear!</p>");
	}

	$storage_manager.$content.width(450);
	$storage_manager.center();

	$storage_manager.find(".remove-button").focus();
}

export {
	manage_storage, storage_quota_exceeded
};

