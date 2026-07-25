/// <reference types="Cypress" />

// Who gets the touch layout, what it changes, and what it leaves exactly as it was.
// See `src/mobile-layout.js` for the detection, and the "Touch and phone layout" section
// of `styles/layout.css` for what the classes do.
//
// Cypress drives a desktop browser, which reports `pointer: fine`, so a real touch device
// can't be emulated here. The `touch-device` and `phone-layout` URL hash params force the
// same code path the media queries otherwise take (see `param_types` in `src/functions.js`),
// which is what these tests use — and what you'd use to check the layout by hand.

context("touch and phone layout", () => {
	/** WCAG 2.5.5 (AAA): what a target should measure to be hit with a fingertip. */
	const FINGER_TARGET_SIZE = 44;
	/** What every target on a touch device should reach when the screen has room for it. */
	const TOUCH_TARGET_SIZE = 40;
	/** WCAG 2.5.8 (AA) minimum: the floor, for screens too small to afford the above. */
	const MINIMUM_TARGET_SIZE = 24;
	/** The classic MS Paint document size, which anything with a mouse keeps getting. */
	const CLASSIC_CANVAS_SIZE = { width: 683, height: 384 };

	const PHONE_PORTRAIT = [390, 844];
	const PHONE_LANDSCAPE = [844, 390];
	/** Short *and* narrow, where the landscape reflow would be the wrong answer. */
	const SMALL_PHONE_PORTRAIT = [320, 568];

	const visit = (hash = "", viewport = null) => {
		if (viewport) {
			cy.viewport(viewport[0], viewport[1]);
		}
		cy.visit(`/${hash}`);
		cy.window().should("have.property", "api_for_cypress_tests");
	};

	/** How many rows the palette wrapped into, by counting distinct swatch tops. */
	const palette_rows = (win) =>
		new Set(
			[...win.document.querySelectorAll(".palette .color-button")]
				.map((el) => Math.round(el.getBoundingClientRect().top))
		).size;

	const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

	/** Every color reachable: all of them present, and none of them off the edge of the
	 * screen — where `overflow: hidden` on the app means there's no scrolling to them. */
	const expect_whole_palette_on_screen = (win) => {
		const swatches = [...win.document.querySelectorAll(".palette .color-button")];
		expect(swatches.length, "swatches in the palette").to.equal(win.default_palette.length);
		const palette = win.document.querySelector(".palette").getBoundingClientRect();
		expect(palette.right, "palette right edge vs. viewport").to.be.at.most(win.innerWidth);
		expect(palette.bottom, "palette bottom edge vs. viewport").to.be.at.most(win.innerHeight);
		expect(palette.left, "palette left edge vs. viewport").to.be.at.least(0);
	};

	context("with a mouse", () => {
		beforeEach(() => visit());

		it("leaves the classic layout alone, down to the pixel", () => {
			cy.get("html").should("not.have.class", "touch-device").and("not.have.class", "phone-layout");
			cy.window().then((win) => {
				expect(win.is_touch_device(), "is_touch_device()").to.equal(false);
				expect(win.is_phone_layout(), "is_phone_layout()").to.equal(false);
			});
			// The measurements the rest of the classic layout is built around.
			cy.get(".tool").first().should(($tool) => {
				const rect = $tool[0].getBoundingClientRect();
				expect(rect.width, "tool button width").to.equal(25);
				expect(rect.height, "tool button height").to.equal(25);
			});
			cy.get(".color-button").first().should(($swatch) => {
				const rect = $swatch[0].getBoundingClientRect();
				expect(rect.width, "palette swatch width").to.equal(15);
				expect(rect.height, "palette swatch height").to.equal(15);
			});
		});

		it("lays the palette out in two rows, as MS Paint does", () => {
			cy.window().then((win) => {
				expect(palette_rows(win), "palette rows").to.equal(2);
			});
		});

		it("opens the classic 683x384 document", () => {
			cy.get(".main-canvas").should(($canvas) => {
				expect($canvas[0].width, "canvas width").to.equal(CLASSIC_CANVAS_SIZE.width);
				expect($canvas[0].height, "canvas height").to.equal(CLASSIC_CANVAS_SIZE.height);
			});
		});
	});

	context("on a touch device", () => {
		beforeEach(() => visit("#touch-device"));

		it("grows every tool button to a finger-sized target", () => {
			cy.get(".tool").should("have.length.greaterThan", 0);
			cy.get(".tool").each(($tool) => {
				const rect = $tool[0].getBoundingClientRect();
				expect(rect.width, `${$tool.attr("title")} target width`).to.be.at.least(FINGER_TARGET_SIZE);
				expect(rect.height, `${$tool.attr("title")} target height`).to.be.at.least(FINGER_TARGET_SIZE);
			});
		});

		it("keeps each tool icon centered in the bigger button", () => {
			// The icon is placed with inline styles measured for a 25px button, so the
			// override has to actually win — otherwise the icons sit in the top-left corner.
			cy.get(".tool").each(($tool) => {
				const button = center($tool[0].getBoundingClientRect());
				const icon = center($tool[0].querySelector(".tool-icon").getBoundingClientRect());
				expect(icon.x, `${$tool.attr("title")} icon center x`).to.be.closeTo(button.x, 1);
				expect(icon.y, `${$tool.attr("title")} icon center y`).to.be.closeTo(button.y, 1);
			});
		});

		it("grows every palette swatch to a finger-sized target", () => {
			cy.get(".color-button").each(($swatch) => {
				const rect = $swatch[0].getBoundingClientRect();
				expect(rect.width, "palette swatch width").to.be.at.least(TOUCH_TARGET_SIZE);
				expect(rect.height, "palette swatch height").to.be.at.least(TOUCH_TARGET_SIZE);
			});
		});

		it("pads each swatch, so the color is smaller than the target around it", () => {
			// The padding is what makes a near-miss land on the color you were aiming at
			// rather than the one beside it. It has to be real padding and not a gap
			// between swatches, or the space between colors would select nothing at all.
			cy.get(".color-button").first().should(($swatch) => {
				const target = $swatch[0].getBoundingClientRect();
				const color = $swatch[0].querySelector("canvas").getBoundingClientRect();
				expect(color.width, "color width vs. target width").to.be.lessThan(target.width);
				expect(color.width, "color width").to.be.greaterThan(0);
				expect(center(color).x, "color center x").to.be.closeTo(center(target).x, 1);
				expect(center(color).y, "color center y").to.be.closeTo(center(target).y, 1);
			});
			cy.window().then((win) => {
				// Contiguous: consecutive targets in a row touch, give or take the 1px
				// margin the palette has always had.
				const [first, second] = [...win.document.querySelectorAll(".palette .color-button")]
					.map((el) => el.getBoundingClientRect());
				expect(second.left - first.right, "gap between adjacent swatch targets").to.be.at.most(1);
			});
		});

		it("selects the color when the padding around it is tapped, not just the color", () => {
			// The point of the padding: it's target, not decoration. A tap in the corner of
			// a swatch, well outside the color itself, still picks that color.
			const swatch_index = 5;
			cy.get(".color-button").eq(swatch_index).click(2, 2);
			cy.window().should((win) => {
				const expected = win.$(".color-button").eq(swatch_index).data("swatch");
				expect(win.api_for_cypress_tests.selected_colors.foreground, "foreground color")
					.to.equal(expected);
			});
		});

		it("makes the current-colors indicator a finger-sized target too", () => {
			// Tapping it swaps the foreground and background colors.
			cy.get(".current-colors").first().should(($indicator) => {
				const rect = $indicator[0].getBoundingClientRect();
				expect(rect.width, "current colors width").to.be.at.least(TOUCH_TARGET_SIZE);
				expect(rect.height, "current colors height").to.be.at.least(TOUCH_TARGET_SIZE);
			});
		});

		it("keeps the whole palette on screen", () => {
			cy.window().then(expect_whole_palette_on_screen);
		});

		it("keeps MS Paint's two-row palette where the screen is wide enough for it", () => {
			// Muscle memory: the palette only gets deeper when the colors genuinely don't
			// fit across, which on a screen this wide they do.
			cy.window().then((win) => {
				expect(palette_rows(win), "palette rows").to.equal(2);
			});
		});

		it("still opens the classic document, since the screen is a desktop's", () => {
			// Bigger targets are about the finger; the document size is about the screen.
			cy.get(".main-canvas").should(($canvas) => {
				expect($canvas[0].width, "canvas width").to.equal(CLASSIC_CANVAS_SIZE.width);
				expect($canvas[0].height, "canvas height").to.equal(CLASSIC_CANVAS_SIZE.height);
			});
		});
	});

	context("with the colors box docked to the side", () => {
		// The other half of the palette-wrapping code: docked vertically, it's the columns
		// that are fixed in CSS and the height that gets measured. (This is the arrangement
		// Enlarge UI mode uses.)
		beforeEach(() => visit("#touch-device,vertical-color-box-mode"));

		it("wraps the palette into columns without running off the screen", () => {
			cy.window().then((win) => {
				const swatches = [...win.document.querySelectorAll(".palette .color-button")];
				expect(swatches.length, "swatches in the palette").to.equal(win.default_palette.length);
				const columns = new Set(swatches.map((el) => Math.round(el.getBoundingClientRect().left))).size;
				expect(columns, "palette columns").to.be.greaterThan(1);
				const palette = win.document.querySelector(".palette").getBoundingClientRect();
				expect(palette.bottom, "palette bottom edge vs. viewport").to.be.at.most(win.innerHeight);
			});
		});
	});

	context("on a phone", () => {
		it("implies a touch device", () => {
			visit("#phone-layout", PHONE_PORTRAIT);
			cy.get("html").should("have.class", "phone-layout").and("have.class", "touch-device");
			cy.window().then((win) => {
				expect(win.is_phone_layout(), "is_phone_layout()").to.equal(true);
				expect(win.is_touch_device(), "is_touch_device()").to.equal(true);
			});
		});

		it("opens a document sized to the screen, and small enough to see all of", () => {
			visit("#phone-layout", PHONE_PORTRAIT);
			cy.get(".main-canvas").should(($canvas) => {
				expect($canvas[0].width, "canvas width").to.be.lessThan(CLASSIC_CANVAS_SIZE.width);
				expect($canvas[0].width, "canvas width").to.be.greaterThan(0);
				expect($canvas[0].height, "canvas height").to.be.at.most(CLASSIC_CANVAS_SIZE.height);
			});
			cy.window().then((win) => {
				// The point of shrinking it: you start looking at the whole document,
				// not scrolled away from three of its corners.
				const canvas = win.$(".main-canvas")[0].getBoundingClientRect();
				const area = win.$(".canvas-area")[0].getBoundingClientRect();
				expect(canvas.right, "canvas right edge vs. canvas area").to.be.at.most(area.right);
				expect(canvas.bottom, "canvas bottom edge vs. canvas area").to.be.at.most(area.bottom);
			});
		});

		it("re-flows the toolbox wide with the phone on its side, so nothing is clipped", () => {
			// Landscape is the tight case: two columns of 44px buttons are taller than the
			// space between the menu bar and the colors box, and the last tools would be
			// cut off with no way to scroll to them.
			visit("#phone-layout", PHONE_LANDSCAPE);
			cy.window().then((win) => {
				const toolbox = win.$(".tools-component")[0].getBoundingClientRect();
				expect(toolbox.width, "toolbox width (wider than two columns)")
					.to.be.greaterThan(FINGER_TARGET_SIZE * 2);
				expect(toolbox.bottom, "toolbox bottom edge vs. viewport").to.be.at.most(win.innerHeight);
				const colors = win.$(".colors-component")[0].getBoundingClientRect();
				expect(colors.right, "colors box right edge vs. viewport").to.be.at.most(win.innerWidth);
				expect(colors.bottom, "colors box bottom edge vs. viewport").to.be.at.most(win.innerHeight);
			});
		});

		it("keeps the toolbox narrow on a small phone held upright", () => {
			// Short as well, but re-flowing it wide here would swallow half the screen;
			// the two-row palette is what makes room instead.
			visit("#phone-layout", SMALL_PHONE_PORTRAIT);
			cy.window().then((win) => {
				const toolbox = win.$(".tools-component")[0].getBoundingClientRect();
				expect(toolbox.width, "toolbox width vs. viewport").to.be.at.most(win.innerWidth / 3);
				expect(toolbox.bottom, "toolbox bottom edge vs. viewport").to.be.at.most(win.innerHeight);
				const canvas = win.$(".main-canvas")[0].getBoundingClientRect();
				const area = win.$(".canvas-area")[0].getBoundingClientRect();
				expect(canvas.right, "canvas right edge vs. canvas area").to.be.at.most(area.right);
				expect(canvas.bottom, "canvas bottom edge vs. canvas area").to.be.at.most(area.bottom);
			});
		});

		it("still reaches a finger-sized swatch in portrait, deepening the palette to do it", () => {
			visit("#phone-layout", PHONE_PORTRAIT);
			cy.window().then((win) => {
				expect_whole_palette_on_screen(win);
				expect(palette_rows(win), "palette rows").to.be.greaterThan(2);
			});
			cy.get(".color-button").each(($swatch) => {
				const rect = $swatch[0].getBoundingClientRect();
				expect(rect.width, "palette swatch width").to.be.at.least(TOUCH_TARGET_SIZE);
			});
		});

		it("keeps the palette on screen with the phone on its side", () => {
			visit("#phone-layout", PHONE_LANDSCAPE);
			cy.window().then(expect_whole_palette_on_screen);
		});

		it("settles for smaller swatches on a small phone rather than losing colors off the edge", () => {
			// 320px can't hold 28 swatches at a full touch size without a palette so deep
			// it pushes the toolbox off the bottom of the screen, so the swatches give way
			// instead — down to WCAG 2.5.8's minimum, but no further, and never at the cost
			// of a color you can't reach. (This is what a row count fixed in CSS got wrong:
			// it left the palette 105px wider than the screen.)
			visit("#phone-layout", SMALL_PHONE_PORTRAIT);
			cy.window().then((win) => {
				expect_whole_palette_on_screen(win);
				const toolbox = win.$(".tools-component")[0].getBoundingClientRect();
				expect(toolbox.bottom, "toolbox bottom edge vs. viewport").to.be.at.most(win.innerHeight);
			});
			cy.get(".color-button").each(($swatch) => {
				const rect = $swatch[0].getBoundingClientRect();
				expect(rect.width, "palette swatch width").to.be.at.least(MINIMUM_TARGET_SIZE);
				expect(rect.height, "palette swatch height").to.be.at.least(MINIMUM_TARGET_SIZE);
			});
		});

		it("leaves the status text more room than the coordinate fields", () => {
			// The status text carries every tool description and gesture hint; classically
			// the two coordinate fields reserve 228px, most of a phone's width.
			visit("#phone-layout", PHONE_PORTRAIT);
			cy.window().then((win) => {
				const status_text = win.$(".status-text")[0].getBoundingClientRect().width;
				const coordinates = [...win.document.querySelectorAll(".status-coordinates")]
					.reduce((total, el) => total + el.getBoundingClientRect().width, 0);
				expect(status_text, "status text width").to.be.greaterThan(coordinates);
			});
		});
	});
});
