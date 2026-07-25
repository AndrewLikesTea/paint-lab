// @ts-check
/* global localize */

// The menu bar, on a screen too narrow to lay it out across the top.
//
// Classically the seven menus (File, Edit, View, Image, Colors, Help, Extras) sit in a
// row, and `flex-wrap: wrap` deals with a window too narrow for them by spilling onto a
// second row -- two rows of text-height buttons, which is both the most chrome and the
// worst targets exactly where a phone can least afford either.
//
// Below the narrow-screen breakpoint (see src/mobile-layout.js) the same menu bar is
// laid out as a vertical drawer instead, closed by default behind a hamburger button.
// The drawer *is* the menu bar -- the same element, the same seven buttons opening the
// same popups -- so nothing is dropped or reimplemented for the small screen: every
// action the app has, from Save to Export to Undo, is where it always was, two taps in.
// A curated shortlist of "key actions" would have been the other way to do this, and
// would go stale the first time a menu item was added.
//
// What's added here is the button that opens it, the shape it takes when open, and the
// keyboard model that shape calls for. The rest is styles: see the "Responsive menu bar"
// section of styles/layout.css.
//
// ARIA-wise the menu bar keeps `role="menubar"`, gaining `aria-orientation="vertical"`
// while it's a drawer, which is what the Up/Down navigation below reflects. The toggle
// is a plain <button> outside the menubar -- a button that opens a menu, which is what
// `aria-haspopup="menu"` and `aria-expanded` describe -- and it's the only focusable
// thing in the app's chrome, so Tab reaches it and Escape comes back to it.

/** WCAG 2.5.5 (AAA): what a target should measure to be hit with a fingertip.
 * The sizing itself is in CSS; this is here for the one thing CSS can't do, below. */
const FINGER_TARGET_SIZE = 44;

/** Breathing room left below an open menu popup, so a menu clipped to the screen doesn't
 * sit flush against the bottom edge, where there's nothing to show it was clipped. */
const POPUP_VIEWPORT_MARGIN = 4;

/** For the toggle's `aria-controls`, which needs an ID on the menu bar to point at.
 * (jspaint has one menu bar, but OS-GUI supports several from the same definitions.) */
let menu_bar_count = 0;

/**
 * Give a menu bar a hamburger button and a drawer layout for narrow screens.
 * Nothing here takes effect until the `narrow-screen` class is on <html>; wider than
 * that, the menu bar is left exactly as it was, down to the pixel.
 * @param {{ element: HTMLElement, closeMenus: () => void }} menu_bar - as returned by `MenuBar()`
 * @returns {{ toggle_element: HTMLButtonElement, open: () => void, close: () => void, is_open: () => boolean }}
 */
export function make_menu_bar_responsive(menu_bar) {
	const menus_el = menu_bar.element;
	const owner_document = menus_el.ownerDocument;

	// The menu bar can't hold the toggle: its children are the menubar's menuitems, and a
	// button that shows and hides the menubar isn't one of them. So it gets a wrapper,
	// which is the row the toggle and the menu bar share. On a wide screen the wrapper is
	// a flex row containing only the menu bar, stretched to the full width -- the same box
	// the menu bar already had as a child of the column, hence no visual change.
	const area_el = owner_document.createElement("div");
	area_el.className = "menu-bar-area";
	menus_el.parentElement?.insertBefore(area_el, menus_el);
	area_el.appendChild(menus_el);

	menu_bar_count += 1;
	if (!menus_el.id) {
		menus_el.id = `menus-${menu_bar_count}`;
	}

	const label = localize("Menu");
	const toggle_el = owner_document.createElement("button");
	toggle_el.type = "button";
	toggle_el.className = "menu-bar-toggle";
	toggle_el.setAttribute("aria-haspopup", "menu");
	toggle_el.setAttribute("aria-expanded", "false");
	toggle_el.setAttribute("aria-controls", menus_el.id);
	toggle_el.setAttribute("aria-label", label);
	toggle_el.title = label;
	// A menu bar is a single tab stop, and while it's collapsed the toggle is that stop.
	// (OS-GUI gives every menu button `tabindex="-1"`; they're reached with the arrow keys,
	// or with Alt and an access key, neither of which a phone's keyboard has.)
	toggle_el.tabIndex = 0;
	// Three bars drawn in CSS, hidden from assistive tech: the button's own label already
	// says what it does, and there's nothing useful to announce about the glyph.
	const icon_el = owner_document.createElement("span");
	icon_el.className = "menu-bar-toggle-icon";
	icon_el.setAttribute("aria-hidden", "true");
	toggle_el.appendChild(icon_el);
	area_el.insertBefore(toggle_el, menus_el);

	const is_narrow_screen = () =>
		owner_document.documentElement.classList.contains("narrow-screen");

	const is_open = () => area_el.classList.contains("menu-bar-expanded");

	/** @returns {HTMLElement[]} */
	const menu_button_els = () =>
		/** @type {HTMLElement[]} */([...menus_el.querySelectorAll(".menu-button")]);

	const open = () => {
		if (is_open()) {
			return;
		}
		area_el.classList.add("menu-bar-expanded");
		toggle_el.setAttribute("aria-expanded", "true");
	};

	/**
	 * @param {boolean} [refocus_toggle] - true when the drawer is being dismissed rather
	 * than tabbed or tapped away from, in which case focus has to land somewhere
	 * deliberate instead of on the element that's about to be hidden.
	 */
	const close = (refocus_toggle = false) => {
		if (!is_open()) {
			return;
		}
		// Any open menu belongs to a button that's about to be `display: none`, so it goes
		// with the drawer; otherwise it's left hanging over the canvas, orphaned.
		menu_bar.closeMenus();
		const focus_was_inside = menus_el.contains(owner_document.activeElement);
		area_el.classList.remove("menu-bar-expanded");
		toggle_el.setAttribute("aria-expanded", "false");
		if (refocus_toggle || focus_was_inside) {
			toggle_el.focus({ preventScroll: true });
		}
	};

	// The button is a step back out, not just a way in. An open menu covers the drawer rows
	// below the one it came from, so there's no tapping past it to another menu -- and the
	// button is the one thing a menu never covers, sitting above where popups open. So the
	// first tap leaves the menu for the drawer it came from, and only the next one closes
	// the drawer. Getting from File to Edit is then two taps, as it is on a wide screen.
	//
	// Which menu was open has to be noted on `pointerdown`: OS-GUI closes menus on a
	// pointerdown anywhere outside them, this button included, and its listener is on the
	// window, so by the time the click lands there's nothing left to ask.
	/** @type {HTMLElement | null} */
	let menu_open_at_pointer_down = null;
	toggle_el.addEventListener("pointerdown", () => {
		menu_open_at_pointer_down =
			/** @type {HTMLElement | null} */(menus_el.querySelector(".menu-button[aria-expanded='true']"));
	});

	toggle_el.addEventListener("click", () => {
		const stepping_back_from = menu_open_at_pointer_down;
		menu_open_at_pointer_down = null;
		if (is_open()) {
			if (stepping_back_from) {
				menu_bar.closeMenus();
				stepping_back_from.focus({ preventScroll: true });
				return;
			}
			close(true);
			return;
		}
		open();
		// Focusing the first menu is what makes Up/Down work without a further Tab. A tap
		// moves focus off it again the moment you tap a menu, so it costs a pointer user
		// nothing, and it's what a keyboard user opening a menu expects to find.
		menu_button_els()[0]?.focus({ preventScroll: true });
	});

	// --- Keyboard navigation within the drawer ---

	// OS-GUI maps Left/Right to "previous/next menu" and Up/Down to "open this menu",
	// which is the right model for a horizontal bar and the wrong one for a vertical
	// drawer, where Up and Down are how you move between the menus you can see.
	// Listening in the capture phase gets here first, and `preventDefault()` is what
	// OS-GUI checks for at the top of its own handler, so handling a key suppresses it.
	menus_el.addEventListener("keydown", (event) => {
		if (!is_narrow_screen() || !is_open() || event.defaultPrevented) {
			return;
		}
		// Only while focus is on the drawer itself. Once a menu is open, focus is on the
		// popup, which has its own handler and its own (unchanged) meaning for Up/Down.
		const buttons = menu_button_els();
		const focused_index = buttons.indexOf(
			/** @type {HTMLElement} */(owner_document.activeElement)
		);
		if (focused_index === -1) {
			return;
		}
		const rtl = getComputedStyle(menus_el).direction === "rtl";
		/** @param {number} index */
		const focus_button = (index) => {
			buttons[(index + buttons.length) % buttons.length].focus({ preventScroll: true });
		};
		switch (event.key) {
			case "ArrowDown":
				focus_button(focused_index + 1);
				break;
			case "ArrowUp":
				focus_button(focused_index - 1);
				break;
			case "Home":
				focus_button(0);
				break;
			case "End":
				focus_button(buttons.length - 1);
				break;
			case "ArrowRight":
			case "ArrowLeft":
				// Into the menu in the direction it opens, back out of the drawer the
				// other way. Opening is OS-GUI's to do and it has no entry point for it
				// other than the keys it handles, so this asks it in its own language
				// rather than reaching into the library. (Enter and Space already mean
				// "open this menu" there, and are left alone above.)
				if ((event.key === "ArrowRight") !== rtl) {
					buttons[focused_index].dispatchEvent(new KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
						cancelable: true,
					}));
				} else {
					close(true);
				}
				break;
			case "Escape":
				close(true);
				break;
			default:
				return; // access keys and first-letter navigation stay OS-GUI's
		}
		event.preventDefault();
	}, true);

	// --- Dismissal ---

	// Running a command is the end of the errand; the drawer shouldn't stay open over the
	// drawing you just changed. Only for commands, though: an item that opens a submenu
	// is on the way to one, and a checkbox or radio item leaves its menu open so you can
	// flip another (OS-GUI's behavior, and the drawer behind it should agree).
	for (const popup_el of menu_popup_elements()) {
		popup_el.addEventListener("click", (event) => {
			const item_el = /** @type {Element | null} */(event.target)?.closest?.(".menu-item");
			if (item_el?.getAttribute("role") === "menuitem" && !item_el.classList.contains("has-submenu")) {
				close();
			}
		});
	}

	// Tapping the canvas, a tool, or anywhere else outside dismisses it, the way tapping
	// outside any menu does. (OS-GUI closes its own popups on the same event; this is the
	// drawer's half.) The toggle is excluded, or a tap there would close and reopen.
	owner_document.addEventListener("pointerdown", (event) => {
		const target = /** @type {Element | null} */(event.target);
		if (!target || area_el.contains(target) || target.closest?.(".menu-popup")) {
			return;
		}
		close();
	});

	// Tab out of the drawer and it's no longer where you are; leaving it open over the
	// canvas would be a menu with nothing focused and no obvious way back out of it.
	owner_document.addEventListener("focusin", (event) => {
		const target = /** @type {Element | null} */(event.target);
		if (!target || area_el.contains(target) || target.closest?.(".menu-popup")) {
			return;
		}
		close();
	});

	// --- Reacting to the breakpoint ---

	// The drawer's shape is a narrow screen's. A window widened past the breakpoint gets
	// its horizontal menu bar back, and mustn't get it back mid-drawer.
	const update_for_breakpoint = () => {
		if (is_narrow_screen()) {
			menus_el.setAttribute("aria-orientation", "vertical");
		} else {
			menus_el.removeAttribute("aria-orientation");
			close();
		}
	};
	window.addEventListener("narrow-screen-change", update_for_breakpoint);
	update_for_breakpoint();

	// --- Keeping long menus on screen ---

	// OS-GUI positions a popup below the button that opens it and nudges it back inside
	// the viewport horizontally, but nothing bounds its height. Opened from the last row
	// of the drawer, the File menu runs off the bottom of a phone -- and the app is
	// `overflow: hidden`, so items past the edge aren't scrolled to, they're just gone.
	//
	// The library already sets `touch-action: pan-y` on popups for this ("allow for
	// scrolling overflowing menus (in the future)"), so what's missing is the bound. It
	// has to be measured rather than written in CSS: the room left is whatever is below
	// wherever the popup landed.
	//
	// "update" is the event the library positions from, but it positions submenus a few
	// lines *after* dispatching it, so measuring in the handler would read a stale top.
	// Deferring to the next animation frame reads the position either kind of popup
	// settled on, and still runs before the frame is painted, so nothing flashes.
	for (const popup_el of menu_popup_elements()) {
		popup_el.addEventListener("update", () => {
			if (!is_narrow_screen()) {
				// Widen the window again and the classic behavior comes back, rather than
				// a max-height left over from the last time it was narrow. Done here and
				// not in the frame callback, so a wide screen never schedules one.
				popup_el.style.maxHeight = "";
				popup_el.style.overflowY = "";
				return;
			}
			requestAnimationFrame(() => {
				const room_below = window.innerHeight - popup_el.getBoundingClientRect().top - POPUP_VIEWPORT_MARGIN;
				// A menu with less than two items' worth of room below it is better off
				// overlapping what's above it than being a scrollbar with a sliver of menu.
				popup_el.style.maxHeight = `${Math.max(FINGER_TARGET_SIZE * 2, room_below)}px`;
				popup_el.style.overflowY = "auto";
			});
		});
	}

	/**
	 * Every popup this menu bar opens, top level and submenus alike. They're built up
	 * front and parented to the body, reachable only by following `aria-controls` from
	 * the buttons and items that open them.
	 * @returns {HTMLElement[]}
	 */
	function menu_popup_elements() {
		/** @type {HTMLElement[]} */
		const popups = [];
		/** @param {Element} el */
		const visit = (el) => {
			const controls_id = el.getAttribute("aria-controls");
			const popup_el = controls_id && owner_document.getElementById(controls_id);
			if (!popup_el || popups.includes(popup_el)) {
				return;
			}
			popups.push(popup_el);
			for (const item_el of popup_el.querySelectorAll(".menu-item[aria-controls]")) {
				visit(item_el);
			}
		};
		for (const button_el of menus_el.querySelectorAll(".menu-button")) {
			visit(button_el);
		}
		return popups;
	}

	return {
		toggle_element: toggle_el,
		open,
		close: () => close(),
		is_open,
	};
}
