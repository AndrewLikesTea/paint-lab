// @ts-check
/* global $bottom, $left, $right, button, get_direction, is_touch_device, localize, palette, selected_colors */
import { $Component } from "./$Component.js";
// import { get_direction, localize } from "./app-localization.js";
import { show_edit_colors_window } from "./edit-colors.js";
import { $G, E, make_canvas } from "./helpers.js";

/**
 * Swatch sizes to try on a touch device, largest first. This is the whole target,
 * padding included; see `--palette-swatch-padding` in styles/layout.css for how much
 * of it is the color you actually see.
 *
 * 40px is a target you can hit with a fingertip without aiming. 27px is the floor:
 * it still clears WCAG 2.5.8's 24px minimum, and it's as far as a small phone can go --
 * 28 swatches at 40px need five rows there, and a palette that deep pushes the toolbox
 * off the bottom of the screen, where there's no scrollbar to reach it with.
 */
const TOUCH_SWATCH_SIZES = [40, 34, 27];
/** Space between swatches; must match the `margin` on `.color-button` in styles/layout.css. */
const SWATCH_GAP = 1;
/** MS Paint's palette is two rows deep. Keep that silhouette on a screen with room to
 * spare, rather than stringing all 28 colors out in a single line. */
const MIN_PALETTE_LINES = 2;
/** The most of the window the palette may take, however much room is going. Past this
 * it's winning space from the canvas that the canvas needs more. */
const MAX_PALETTE_FRACTION = 0.3;

/**
 * Used by the Colors Box and by the Edit Colors dialog.
 * @param {string | CanvasPattern} color
 * @returns {JQuery<HTMLDivElement>}
 */
function $Swatch(color) {
	const $swatch = $(E("div")).addClass("swatch");
	const swatch_canvas = make_canvas();
	$(swatch_canvas).css({ pointerEvents: "none" }).appendTo($swatch);

	// @TODO: clean up event listener
	$G.on("theme-load", () => { update_$swatch($swatch); });
	$swatch.data("swatch", color);
	update_$swatch($swatch, color);

	return $swatch;
}

/**
 * @param {JQuery<HTMLDivElement>} $swatch
 * @param {string | CanvasPattern | undefined=} new_color
 */
function update_$swatch($swatch, new_color) {
	if (new_color instanceof CanvasPattern) {
		$swatch.addClass("pattern");
		$swatch[0].dataset.color = "";
	} else if (typeof new_color === "string") {
		$swatch.removeClass("pattern");
		$swatch[0].dataset.color = new_color;
	} else if (new_color !== undefined) {
		throw new TypeError(`argument to update_$swatch must be CanvasPattern or string (or undefined); got type ${typeof new_color}`);
	}
	new_color = new_color || $swatch.data("swatch");
	$swatch.data("swatch", new_color);
	const swatch_canvas = /** @type {PixelCanvas} */ (
		$swatch.find("canvas")[0]
	);
	requestAnimationFrame(() => {
		// The content box, not the padding box: on a touch device a palette swatch is
		// padded out to a finger-sized target, and the color belongs inside the padding.
		swatch_canvas.width = $swatch.width();
		swatch_canvas.height = $swatch.height();
		if (new_color) {
			swatch_canvas.ctx.fillStyle = new_color;
			swatch_canvas.ctx.fillRect(0, 0, swatch_canvas.width, swatch_canvas.height);
		}
	});
}

/**
 * @param {boolean} vertical
 * @returns {JQuery<HTMLDivElement> & I$Component & I$ColorBox}
 */
function $ColorBox(vertical) {
	const $cb = $(E("div")).addClass("color-box");

	const $current_colors = $Swatch(selected_colors.ternary).addClass("current-colors");
	const $palette = $(E("div")).addClass("palette");

	$cb.append($current_colors, $palette);

	const $foreground_color = $Swatch(selected_colors.foreground).addClass("color-selection foreground-color");
	const $background_color = $Swatch(selected_colors.background).addClass("color-selection background-color");
	$current_colors.append($background_color, $foreground_color);

	$G.on("option-changed", () => {
		update_$swatch($foreground_color, selected_colors.foreground);
		update_$swatch($background_color, selected_colors.background);
		update_$swatch($current_colors, selected_colors.ternary);
	});

	$current_colors.on("pointerdown", () => {
		const new_bg = selected_colors.foreground;
		selected_colors.foreground = selected_colors.background;
		selected_colors.background = new_bg;
		$G.triggerHandler("option-changed");
	});

	const make_color_button = (color) => {

		const $b = $Swatch(color).addClass("color-button");
		$b.appendTo($palette);

		const double_click_period_ms = 400;
		let within_double_click_period = false;
		let double_click_button = null;
		let double_click_tid;
		// @TODO: handle left+right click at same time
		// can do this with mousedown instead of pointerdown, but may need to improve Dwell Clicker click simulation
		$b.on("pointerdown", (e) => {
			// @TODO: allow metaKey for ternary color, and selection cropping, on macOS?

			if (button === 0) {
				$c.data("$last_fg_color_button", $b);
			}

			const color_selection_slot = e.ctrlKey ? "ternary" : e.button === 0 ? "foreground" : e.button === 2 ? "background" : null;
			if (color_selection_slot) {
				if (within_double_click_period && e.button === double_click_button) {
					show_edit_colors_window($b, color_selection_slot);
				} else {
					selected_colors[color_selection_slot] = $b.data("swatch");
					$G.trigger("option-changed");
				}

				clearTimeout(double_click_tid);
				double_click_tid = setTimeout(() => {
					within_double_click_period = false;
					double_click_button = null;
				}, double_click_period_ms);
				within_double_click_period = true;
				double_click_button = e.button;
			}
		});
	};

	/** The height a docked column needs for its components. Unlike `scrollHeight`, this
	 * doesn't stop at the height the column has already been given. */
	const column_content_height = ($column) =>
		$column.children().toArray().reduce((total, el) => total + $(el).outerHeight(true), 0);

	let applied_swatch_size = null;

	// How big the swatches are and how many lines they wrap into, on a touch device.
	//
	// Classically both follow from a size fixed in CSS, because 28 swatches at 15px add
	// up to 224px and every screen is wider than that. Finger-sized swatches aren't so
	// accommodating: 28 of them don't fit across a phone at any size worth tapping, so
	// the palette has to wrap, and how far depends on how wide the screen is. Media
	// queries can't work that out -- what has to fit is the palette's own width, which
	// is the thing wrapping is supposed to produce -- so a line count fixed in CSS leaves
	// a 320px phone with a palette 105px wider than its screen, the last colors clipped
	// off the edge with no way to scroll to them.
	//
	// So the geometry is chosen here, where the measurements are: the largest swatch
	// that fits the room going, and however many lines that takes. The answer goes back
	// to CSS as two custom properties, which are what actually size things -- see
	// "Touch and phone layout" in styles/layout.css. Nothing is duplicated between them.
	const update_touch_palette_geometry = () => {
		// The room to run along (where the palette grows as it wraps), less whatever the
		// component spends on its frame and the current-colors indicator.
		const chrome_along = vertical ?
			$c.outerHeight(true) - $palette.outerHeight(true) :
			$c.outerWidth(true) - $palette.outerWidth(true);
		const room_along = (vertical ? $c.parent().height() : $c.parent().width()) - chrome_along;

		// And the room to stack up across.
		let room_across;
		if (vertical) {
			// Docked to a side, the palette deepens at the expense of the canvas's width,
			// which the canvas can spare -- it scrolls. Just don't let it take the window.
			room_across = window.innerWidth * MAX_PALETTE_FRACTION;
		} else {
			// Docked along the bottom, every line the palette gains is a line of height
			// taken from the row the canvas and the toolbox share. The canvas can afford
			// that too, but the toolbox can't: it has no scrollbar, so tools pushed past
			// the bottom of the screen are simply gone. So the palette may have what it
			// already occupies plus whatever that row has spare -- and its share of the
			// window, whichever is less.
			const spare_beside_the_canvas = $left.parent().height() -
				Math.max(column_content_height($left), column_content_height($right));
			room_across = Math.min(
				$palette.outerHeight(true) + spare_beside_the_canvas,
				window.innerHeight * MAX_PALETTE_FRACTION
			);
		}

		let geometry;
		for (const size of TOUCH_SWATCH_SIZES) {
			const per_line = Math.min(
				Math.max(1, Math.floor(room_along / (size + SWATCH_GAP))),
				Math.ceil(palette.length / MIN_PALETTE_LINES)
			);
			geometry = { size, lines: Math.ceil(palette.length / per_line) };
			if (geometry.lines * (size + SWATCH_GAP) <= room_across) {
				break;
			}
		}
		// Falling out of the loop leaves the smallest swatch, which is the best on offer.
		// It's sized to fit *along* the screen either way, and that's the constraint that
		// can't be recovered from: too long and the last colors are clipped away, whereas
		// too deep only borrows from the canvas.
		$c[0].style.setProperty("--palette-swatch-size", `${geometry.size}px`);
		$c[0].style.setProperty("--palette-lines", `${geometry.lines}`);

		if (geometry.size !== applied_swatch_size) {
			applied_swatch_size = geometry.size;
			// Each swatch paints into a canvas sized to fill it, so they have to be
			// repainted at the new size -- otherwise the colors keep their old footprint.
			$cb.find(".swatch").each((_index, swatch_el) => {
				update_$swatch($(/** @type {HTMLDivElement} */(swatch_el)));
			});
		}
	};

	// The palette wraps within a size fixed on its cross axis: two rows (or columns) of
	// 15px swatches classically, and fewer, larger ones on a touch device, where it's
	// worked out from the viewport just above.
	// So measure how many swatches fit across, and size the main axis to hold the rest.
	// Note: this doesn't work until the colors box is in the DOM.
	const update_palette_wrapping = () => {
		const $some_button = $palette.find(".color-button");
		if (!$some_button.length) {
			return;
		}
		if (is_touch_device()) {
			update_touch_palette_geometry();
		}
		const style = getComputedStyle($some_button[0]);
		const width_per_button =
			$some_button.outerWidth() +
			parseFloat(style.getPropertyValue("margin-left")) +
			parseFloat(style.getPropertyValue("margin-right"));
		const height_per_button =
			$some_button.outerHeight() +
			parseFloat(style.getPropertyValue("margin-top")) +
			parseFloat(style.getPropertyValue("margin-bottom"));
		if (vertical) {
			const columns = Math.max(1, Math.floor($palette.width() / width_per_button));
			$palette.height(Math.ceil(palette.length / columns) * height_per_button);
		} else {
			const rows = Math.max(1, Math.floor($palette.height() / height_per_button));
			$palette.width(Math.ceil(palette.length / rows) * width_per_button);
		}
	};

	const build_palette = () => {
		$palette.empty();

		palette.forEach(make_color_button);

		update_palette_wrapping();

		// the "last foreground color button" starts out as the first in the palette
		$c.data("$last_fg_color_button", $palette.find(".color-button:first-child"));
	};

	let $c;
	if (vertical) {
		$c = $Component(localize("Colors"), "colors-component", "tall", $cb);
		$c.appendTo(get_direction() === "rtl" ? $left : $right); // opposite ToolBox by default
	} else {
		$c = $Component(localize("Colors"), "colors-component", "wide", $cb);
		$c.appendTo($bottom);
	}

	build_palette();
	$(window).on("theme-change", build_palette);

	// I'm gonna do things messy, got a long road to go!
	// eslint-disable-next-line no-self-assign
	$c = /** @type {JQuery<HTMLDivElement> & I$Component & I$ColorBox} */ ($c);

	$c.rebuild_palette = build_palette;
	$c.update_palette_wrapping = update_palette_wrapping;

	return $c;
}

export {
	$ColorBox,
	$Swatch,
	update_$swatch
};

