/// <reference types="Cypress" />

// The menu bar at the three sizes it's laid out for. See the "Responsive menu bar"
// section of styles/layout.css for the breakpoints, and src/menu-bar-responsive.js for
// the hamburger button and the keyboard navigation the collapsed shape calls for.
//
// The 600px breakpoint is a plain width media query, so `cy.viewport` is enough to cross
// it -- unlike `.touch-device`, which needs `pointer: coarse` and has to be forced with a
// URL hash param (Cypress drives a desktop browser).

context("responsive menu bar", () => {
	/** WCAG 2.5.5 (AAA): what a target should measure to be hit with a fingertip. */
	const FINGER_TARGET_SIZE = 44;

	const PHONE_PORTRAIT = [390, 844];
	const SMALL_PHONE_PORTRAIT = [320, 568];
	const TABLET_PORTRAIT = [768, 1024];
	const DESKTOP = [1280, 800];

	/** The menus the bar has always had; the point of the drawer is that it still has
	 * all of them, rather than a shortlist of "key actions" that would go stale. */
	const TOP_LEVEL_MENUS = ["File", "Edit", "View", "Image", "Colors", "Help", "Extras"];

	const visit = (viewport, hash = "") => {
		cy.viewport(viewport[0], viewport[1]);
		cy.visit(`/${hash}`);
		cy.window().should("have.property", "api_for_cypress_tests");
	};

	// Menus need pointer events currently; a click doesn't open them.
	const openMenu = (label) => {
		cy.contains(".menu-button", new RegExp(`^${label}$`))
			.trigger("pointerdown", { which: 1 })
			.trigger("pointerup", { force: true });
	};

	const labels = ($buttons) => $buttons.toArray().map((el) => el.textContent.trim());

	context("on a desktop", () => {
		beforeEach(() => visit(DESKTOP));

		it("leaves the classic menu bar alone", () => {
			cy.get("html").should("not.have.class", "narrow-screen");
			cy.get(".menu-bar-toggle").should("not.be.visible");
			cy.get(".menus").should("be.visible");
			cy.get(".menus").should("not.have.attr", "aria-orientation");
			cy.get(".menu-button").should(($buttons) => {
				expect(labels($buttons), "top level menus").to.deep.equal(TOP_LEVEL_MENUS);
			});
		});

		it("keeps every menu on one row across the top", () => {
			// What the wrapper added around the menu bar could plausibly have broken:
			// the bar is still one full-width row, laid out left to right.
			cy.get(".menu-button").should(($buttons) => {
				const tops = new Set($buttons.toArray().map((el) =>
					Math.round(el.getBoundingClientRect().top)));
				expect(tops.size, "rows the menu bar wrapped into").to.equal(1);
			});
			cy.window().then((win) => {
				const menus = win.document.querySelector(".menus").getBoundingClientRect();
				expect(menus.left, "menu bar left edge").to.equal(0);
				expect(Math.round(menus.width), "menu bar width").to.equal(win.innerWidth);
				expect(Math.round(menus.top), "menu bar top edge").to.equal(0);
			});
		});

		it("still opens menus", () => {
			openMenu("File");
			cy.contains(".menu-item-label", /^Save$/).should("be.visible");
		});
	});

	context("on a tablet", () => {
		beforeEach(() => visit(TABLET_PORTRAIT, "#touch-device"));

		it("keeps the bar across the top, since there's width for it", () => {
			cy.get("html").should("not.have.class", "narrow-screen");
			cy.get(".menu-bar-toggle").should("not.be.visible");
			cy.get(".menus").should("be.visible");
		});

		it("grows the menu bar buttons to finger-sized targets", () => {
			cy.get(".menu-button").each(($button) => {
				const rect = $button[0].getBoundingClientRect();
				expect(rect.height, `${$button.text()} target height`).to.be.at.least(FINGER_TARGET_SIZE);
			});
		});
	});

	context("on a phone", () => {
		beforeEach(() => visit(PHONE_PORTRAIT));

		it("collapses the bar behind a hamburger button", () => {
			cy.get("html").should("have.class", "narrow-screen");
			cy.get(".menu-bar-toggle").should("be.visible");
			cy.get(".menus").should("not.be.visible");
		});

		it("spends only one button's worth of height on the closed menu bar", () => {
			// The problem it's solving: seven menus wrapped onto two and three rows.
			cy.window().then((win) => {
				const area = win.document.querySelector(".menu-bar-area").getBoundingClientRect();
				expect(area.height, "collapsed menu bar height")
					.to.be.closeTo(FINGER_TARGET_SIZE, 1);
			});
		});

		it("describes itself to assistive tech", () => {
			cy.get(".menu-bar-toggle")
				.should("have.attr", "aria-expanded", "false")
				.and("have.attr", "aria-haspopup", "menu")
				.and("have.attr", "aria-label", "Menu");
			cy.get(".menu-bar-toggle").then(($toggle) => {
				cy.get(".menus").should("have.id", $toggle.attr("aria-controls"));
			});
			cy.get(".menus").should("have.attr", "role", "menubar");
		});

		it("opens the drawer when the button is tapped", () => {
			cy.get(".menu-bar-toggle").click();
			cy.get(".menu-bar-toggle").should("have.attr", "aria-expanded", "true");
			cy.get(".menus").should("be.visible").and("have.attr", "aria-orientation", "vertical");
		});

		it("keeps every menu, laid out one per row", () => {
			cy.get(".menu-bar-toggle").click();
			cy.get(".menu-button").should(($buttons) => {
				expect(labels($buttons), "menus in the drawer").to.deep.equal(TOP_LEVEL_MENUS);
				const tops = $buttons.toArray().map((el) => Math.round(el.getBoundingClientRect().top));
				expect(new Set(tops).size, "rows in the drawer").to.equal(TOP_LEVEL_MENUS.length);
			});
		});

		it("makes every row in the drawer a finger-sized target", () => {
			cy.get(".menu-bar-toggle").click();
			cy.get(".menu-button").each(($button) => {
				const rect = $button[0].getBoundingClientRect();
				expect(rect.height, `${$button.text()} target height`).to.be.at.least(FINGER_TARGET_SIZE);
				expect(rect.width, `${$button.text()} target width`).to.be.at.least(FINGER_TARGET_SIZE);
			});
		});

		it("keeps the drawer and its button on screen", () => {
			cy.get(".menu-bar-toggle").click();
			cy.window().then((win) => {
				for (const selector of [".menu-bar-toggle", ".menus"]) {
					const rect = win.document.querySelector(selector).getBoundingClientRect();
					expect(rect.left, `${selector} left edge`).to.be.at.least(0);
					expect(rect.right, `${selector} right edge`).to.be.at.most(win.innerWidth);
					expect(rect.bottom, `${selector} bottom edge`).to.be.at.most(win.innerHeight);
				}
			});
		});

		it("closes the drawer when the button is tapped again", () => {
			cy.get(".menu-bar-toggle").click();
			cy.get(".menus").should("be.visible");
			cy.get(".menu-bar-toggle").click();
			cy.get(".menus").should("not.be.visible");
			cy.get(".menu-bar-toggle").should("have.attr", "aria-expanded", "false");
		});

		it("closes the drawer when something outside it is tapped", () => {
			cy.get(".menu-bar-toggle").click();
			cy.get(".menus").should("be.visible");
			cy.get(".canvas-area").trigger("pointerdown", { which: 1 });
			cy.get(".menus").should("not.be.visible");
		});
	});

	context("reaching the actions from a phone", () => {
		beforeEach(() => visit(PHONE_PORTRAIT));

		// The requirement the drawer exists to meet: nothing the menu bar could do before
		// became unreachable by collapsing it.
		const expectItemInMenu = (menu, item) => {
			cy.get(".menu-bar-toggle").click();
			openMenu(menu);
			cy.contains(".menu-popup:visible .menu-item-label", new RegExp(`^${item}$`))
				.should("be.visible");
		};

		it("reaches Save", () => expectItemInMenu("File", "Save"));
		it("reaches Save As", () => expectItemInMenu("File", "Save As"));
		it("reaches Export PNG", () => expectItemInMenu("File", "Export PNG"));
		it("reaches Undo", () => expectItemInMenu("Edit", "Undo"));
		it("reaches Repeat (redo)", () => expectItemInMenu("Edit", "Repeat"));

		it("gives the items in an opened menu finger-sized rows too", () => {
			cy.get(".menu-bar-toggle").click();
			openMenu("File");
			cy.get(".menu-popup:visible .menu-item").each(($item) => {
				const rect = $item[0].getBoundingClientRect();
				expect(rect.height, `"${$item.text().trim()}" row height`).to.be.at.least(FINGER_TARGET_SIZE);
			});
		});

		it("keeps a menu opened from the last row of the drawer on screen", () => {
			// Nothing in the library bounds a popup's height, and the app is
			// `overflow: hidden`, so items past the bottom edge would be unreachable.
			cy.get(".menu-bar-toggle").click();
			openMenu("Extras");
			cy.window().then((win) => {
				// `should` rather than `then`: the bound is applied on the animation frame
				// after the menu is positioned (see src/menu-bar-responsive.js for why),
				// which is one frame after the popup becomes visible.
				cy.get(".menu-popup:visible").should(($popup) => {
					const rect = $popup[0].getBoundingClientRect();
					expect(rect.bottom, "popup bottom edge vs. viewport").to.be.at.most(win.innerHeight);
					expect($popup[0].scrollHeight, "the whole menu is scrollable to")
						.to.be.at.least(Math.floor(rect.height));
				});
			});
		});

		it("steps back to the drawer when the button is tapped with a menu open", () => {
			// An open menu covers the rows below the one it came from, so the button is
			// the only way back to them; it takes one level at a time rather than
			// dismissing everything and making you start over.
			cy.get(".menu-bar-toggle").click();
			openMenu("File");
			cy.contains(".menu-item-label", /^Save$/).should("be.visible");

			cy.get(".menu-bar-toggle").click();
			cy.contains(".menu-item-label", /^Save$/).should("not.be.visible");
			cy.get(".menus").should("be.visible");
			cy.get(".menu-bar-toggle").should("have.attr", "aria-expanded", "true");

			// ...and from there, straight into another menu.
			openMenu("Edit");
			cy.contains(".menu-popup:visible .menu-item-label", /^Undo$/).should("be.visible");
		});

		it("closes the drawer on the tap after that", () => {
			cy.get(".menu-bar-toggle").click();
			openMenu("File");
			cy.get(".menu-bar-toggle").click(); // back to the drawer
			cy.get(".menu-bar-toggle").click(); // and shut
			cy.get(".menus").should("not.be.visible");
			cy.get(".menu-bar-toggle").should("have.attr", "aria-expanded", "false");
		});

		it("closes the drawer once a command has been run", () => {
			cy.get(".menu-bar-toggle").click();
			openMenu("Edit");
			cy.contains(".menu-popup:visible .menu-item-label", /^Select All$/)
				.click({ force: true });
			cy.get(".menus").should("not.be.visible");
			cy.get(".menu-bar-toggle").should("have.attr", "aria-expanded", "false");
		});
	});

	context("driving the drawer from the keyboard", () => {
		beforeEach(() => visit(PHONE_PORTRAIT));

		// Activating the toggle is the browser's job -- it's a real <button>, so Enter and
		// Space click it -- and Cypress's `type("{enter}")` doesn't synthesize that click,
		// so these open it with `click()` and test the part that isn't the browser's: what
		// the arrow keys do once the drawer is open.
		const openDrawer = () => cy.get(".menu-bar-toggle").click();

		it("puts the hamburger button in the tab order, as a real button", () => {
			// The menu bar is classically reached with Alt and an access key, which a
			// phone's keyboard doesn't have; collapsed, it's a single tab stop.
			cy.get(".menu-bar-toggle")
				.should("have.attr", "tabindex", "0")
				.and("match", "button")
				.and("have.attr", "type", "button");
		});

		it("lands on the first menu when the drawer opens", () => {
			openDrawer();
			cy.get(".menus").should("be.visible");
			cy.focused().should("have.text", "File");
		});

		it("moves between menus with Up and Down, wrapping around", () => {
			openDrawer();
			cy.focused().type("{downarrow}");
			cy.focused().should("have.text", "Edit");
			cy.focused().type("{downarrow}");
			cy.focused().should("have.text", "View");
			cy.focused().type("{uparrow}");
			cy.focused().should("have.text", "Edit");
			cy.focused().type("{uparrow}{uparrow}");
			cy.focused().should("have.text", "Extras"); // wrapped past the top
		});

		it("jumps to the first and last menu with Home and End", () => {
			openDrawer();
			cy.focused().type("{end}");
			cy.focused().should("have.text", "Extras");
			cy.focused().type("{home}");
			cy.focused().should("have.text", "File");
		});

		it("opens the focused menu with Right, the way it opens on screen", () => {
			openDrawer();
			cy.focused().type("{rightarrow}");
			cy.contains(".menu-popup:visible .menu-item-label", /^Save$/).should("be.visible");
		});

		it("closes the drawer with Escape, putting focus back on the button", () => {
			openDrawer();
			cy.focused().type("{esc}");
			cy.get(".menus").should("not.be.visible");
			cy.focused().should("have.class", "menu-bar-toggle");
		});
	});

	context("crossing the breakpoint", () => {
		it("collapses and expands as the window is resized", () => {
			visit(DESKTOP);
			cy.get(".menu-bar-toggle").should("not.be.visible");

			cy.viewport(PHONE_PORTRAIT[0], PHONE_PORTRAIT[1]);
			cy.get(".menu-bar-toggle").should("be.visible");
			cy.get(".menus").should("not.be.visible");

			cy.viewport(DESKTOP[0], DESKTOP[1]);
			cy.get(".menu-bar-toggle").should("not.be.visible");
			cy.get(".menus").should("be.visible").and("not.have.attr", "aria-orientation");
		});

		it("doesn't leave the drawer open when the window is widened", () => {
			visit(PHONE_PORTRAIT);
			cy.get(".menu-bar-toggle").click();
			cy.get(".menus").should("be.visible");

			cy.viewport(DESKTOP[0], DESKTOP[1]);
			cy.get(".menu-bar-toggle").should("have.attr", "aria-expanded", "false");
			cy.get(".menu-button").should(($buttons) => {
				const tops = new Set($buttons.toArray().map((el) =>
					Math.round(el.getBoundingClientRect().top)));
				expect(tops.size, "rows the menu bar is laid out in").to.equal(1);
			});
		});
	});

	context("on a small phone", () => {
		beforeEach(() => visit(SMALL_PHONE_PORTRAIT));

		it("still fits the drawer and every menu in it on screen", () => {
			cy.get(".menu-bar-toggle").click();
			cy.window().then((win) => {
				const menus = win.document.querySelector(".menus").getBoundingClientRect();
				expect(menus.right, "drawer right edge vs. viewport").to.be.at.most(win.innerWidth);
				expect(menus.bottom, "drawer bottom edge vs. viewport").to.be.at.most(win.innerHeight);
			});
			cy.get(".menu-button").each(($button) => {
				const rect = $button[0].getBoundingClientRect();
				expect(rect.height, `${$button.text()} target height`).to.be.at.least(FINGER_TARGET_SIZE);
			});
		});
	});
});
