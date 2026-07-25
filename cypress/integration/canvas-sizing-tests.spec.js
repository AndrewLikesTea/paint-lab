/// <reference types="Cypress" />

// New documents open at 683x384 on a desktop, and at whatever fits on a phone.
// See `src/canvas-sizing.js` for the rules; the first half of this file tests
// them directly (they're a pure function), and the second half checks that the
// app actually applies them, and doesn't apply them to people who've chosen a
// canvas size for themselves.

import {
	CANVAS_SIZING_SCHEMA_VERSION,
	DESKTOP_CANVAS_HEIGHT,
	DESKTOP_CANVAS_WIDTH,
	MIN_AUTO_CANVAS_HEIGHT,
	MIN_AUTO_CANVAS_WIDTH,
	classify_device,
	decide_initial_canvas_size
} from "../../src/canvas-sizing.js";

const IPHONE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const DESKTOP_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_ASPECT_RATIO = DESKTOP_CANVAS_WIDTH / DESKTOP_CANVAS_HEIGHT;

const desktop_signals = { user_agent: DESKTOP_USER_AGENT, coarse_pointer: false, max_touch_points: 0 };
const phone_signals = { user_agent: IPHONE_USER_AGENT, coarse_pointer: true, max_touch_points: 5 };

context("canvas sizing rules", () => {
	describe("device classification", () => {
		it("classifies a phone by its user agent", () => {
			const { device_class, reasons } = classify_device(phone_signals);
			expect(device_class).to.equal("mobile");
			expect(reasons).to.include("user-agent-matches-mobile");
		});

		it("classifies a desktop browser as desktop", () => {
			expect(classify_device(desktop_signals).device_class).to.equal("desktop");
		});

		it("catches an iPad, which claims to be a desktop Mac", () => {
			// The only thing separating iPadOS Safari from macOS Safari here is
			// the pointer type and the touch points.
			const { device_class, reasons } = classify_device({
				user_agent: IPAD_USER_AGENT,
				coarse_pointer: true,
				max_touch_points: 5,
			});
			expect(device_class).to.equal("mobile");
			expect(reasons).to.include("coarse-pointer-with-touch");
		});

		it("doesn't call a touchscreen laptop mobile", () => {
			// A desktop UA with touch points but a mouse as the primary pointer.
			expect(classify_device({
				user_agent: DESKTOP_USER_AGENT,
				coarse_pointer: false,
				max_touch_points: 10,
			}).device_class).to.equal("desktop");
		});

		it("reports 'unknown' rather than guessing when it has no signals", () => {
			const { device_class, warnings } = classify_device({
				user_agent: "",
				coarse_pointer: null,
				max_touch_points: 0,
			});
			expect(device_class).to.equal("unknown");
			expect(warnings).to.include("user-agent-unavailable");
			expect(warnings).to.include("pointer-media-query-unavailable");
		});
	});

	describe("choosing a size", () => {
		it("gives a desktop the size it's always had", () => {
			const decision = decide_initial_canvas_size({
				signals: desktop_signals,
				available_area: { width: 1200, height: 700 },
				stored_dimensions: { width: null, height: null },
			});
			expect(decision.schema_version).to.equal(CANVAS_SIZING_SCHEMA_VERSION);
			expect(decision.width).to.equal(DESKTOP_CANVAS_WIDTH);
			expect(decision.height).to.equal(DESKTOP_CANVAS_HEIGHT);
			expect(decision.source).to.equal("desktop-default");
			expect(decision.warnings).to.deep.equal([]);
		});

		it("keeps the default on a desktop in a window too small for it", () => {
			// This is the pre-existing behavior — a scrollable canvas — and
			// shrinking it would be a regression for anyone who works in a
			// half-width window.
			const decision = decide_initial_canvas_size({
				signals: desktop_signals,
				available_area: { width: 400, height: 300 },
				stored_dimensions: { width: null, height: null },
			});
			expect(decision.width).to.equal(DESKTOP_CANVAS_WIDTH);
			expect(decision.height).to.equal(DESKTOP_CANVAS_HEIGHT);
			expect(decision.reasons).to.include("non-mobile-keeps-default");
		});

		it("scales the canvas down to fit a phone, keeping the aspect ratio", () => {
			const available_area = { width: 360, height: 420 };
			const decision = decide_initial_canvas_size({
				signals: phone_signals,
				available_area,
				stored_dimensions: { width: null, height: null },
			});
			expect(decision.source).to.equal("fit-available");
			expect(decision.device_class).to.equal("mobile");
			expect(decision.width).to.be.at.most(available_area.width);
			expect(decision.height).to.be.at.most(available_area.height);
			expect(decision.width / decision.height).to.be.closeTo(DEFAULT_ASPECT_RATIO, 0.02);
			expect(decision.scale).to.be.lessThan(1);
		});

		it("fits a tall, narrow phone by width", () => {
			// Plenty of vertical room; the width is what's binding.
			const decision = decide_initial_canvas_size({
				signals: phone_signals,
				available_area: { width: 320, height: 2000 },
				stored_dimensions: { width: null, height: null },
			});
			expect(decision.width).to.be.at.most(320);
			expect(decision.width).to.be.greaterThan(280); // uses the width it's given
			expect(decision.width / decision.height).to.be.closeTo(DEFAULT_ASPECT_RATIO, 0.02);
		});

		it("gives a large tablet the default rather than an odd near-default size", () => {
			const decision = decide_initial_canvas_size({
				signals: { user_agent: IPAD_USER_AGENT, coarse_pointer: true, max_touch_points: 5 },
				available_area: { width: 1000, height: 700 },
				stored_dimensions: { width: null, height: null },
			});
			expect(decision.device_class).to.equal("mobile");
			expect(decision.width).to.equal(DESKTOP_CANVAS_WIDTH);
			expect(decision.height).to.equal(DESKTOP_CANVAS_HEIGHT);
			expect(decision.reasons).to.include("default-fits-available-area");
		});

		it("won't shrink past the point of being drawable", () => {
			const decision = decide_initial_canvas_size({
				signals: phone_signals,
				available_area: { width: 90, height: 90 },
				stored_dimensions: { width: null, height: null },
			});
			expect(decision.width).to.equal(MIN_AUTO_CANVAS_WIDTH);
			expect(decision.height).to.equal(MIN_AUTO_CANVAS_HEIGHT);
			// Overflowing is the honest outcome here, and it's flagged.
			expect(decision.warnings).to.include("min-size-exceeds-available-area");
		});

		it("always returns positive integers", () => {
			for (const width of [90, 200, 321, 480, 683, 1000]) {
				const decision = decide_initial_canvas_size({
					signals: phone_signals,
					available_area: { width, height: width },
					stored_dimensions: { width: null, height: null },
				});
				expect(decision.width, `width for a ${width}px area`).to.equal(Math.floor(decision.width));
				expect(decision.height, `height for a ${width}px area`).to.equal(Math.floor(decision.height));
				expect(decision.width).to.be.greaterThan(0);
				expect(decision.height).to.be.greaterThan(0);
			}
		});
	});

	describe("a size the user chose", () => {
		it("wins over the device, on every device", () => {
			for (const signals of [desktop_signals, phone_signals]) {
				const decision = decide_initial_canvas_size({
					signals,
					available_area: { width: 320, height: 400 },
					stored_dimensions: { width: "1024", height: "768" },
				});
				expect(decision.source).to.equal("stored");
				expect(decision.width).to.equal(1024);
				expect(decision.height).to.equal(768);
			}
		});

		it("accepts numbers as well as the strings localStorage returns", () => {
			const decision = decide_initial_canvas_size({
				signals: desktop_signals,
				available_area: { width: 1200, height: 700 },
				stored_dimensions: { width: 500, height: 500 },
			});
			expect([decision.width, decision.height]).to.deep.equal([500, 500]);
		});
	});

	describe("bad input", () => {
		/** Every request below must still produce a usable canvas. */
		const bad_requests = {
			"no stored dimensions at all": { stored_dimensions: null },
			"a half-written pair": { stored_dimensions: { width: "800", height: null } },
			"garbage in storage": { stored_dimensions: { width: "not a number", height: "{}" } },
			"a negative size": { stored_dimensions: { width: "-5", height: "-5" } },
			"a zero size": { stored_dimensions: { width: "0", height: "0" } },
			"an unmeasurable area": { available_area: null },
			"a zero-sized area": { available_area: { width: 0, height: 0 } },
			"a NaN area": { available_area: { width: NaN, height: NaN } },
			"missing signals": { signals: undefined },
		};

		for (const [description, overrides] of Object.entries(bad_requests)) {
			it(`falls back to the default given ${description}`, () => {
				const decision = decide_initial_canvas_size({
					signals: desktop_signals,
					available_area: { width: 1200, height: 700 },
					stored_dimensions: { width: null, height: null },
					...overrides,
				});
				expect(decision.width).to.equal(DESKTOP_CANVAS_WIDTH);
				expect(decision.height).to.equal(DESKTOP_CANVAS_HEIGHT);
				expect(decision.source).to.equal("desktop-default");
			});
		}

		it("discards a half-written pair instead of inventing the other axis", () => {
			const decision = decide_initial_canvas_size({
				signals: desktop_signals,
				available_area: { width: 1200, height: 700 },
				stored_dimensions: { width: "800", height: null },
			});
			expect(decision.warnings).to.include("stored-dimensions-incomplete");
			expect(decision.width).to.equal(DESKTOP_CANVAS_WIDTH);
		});

		it("throws on a request that isn't a request, rather than pretending", () => {
			// Bad data is handled; a bad call is a bug and should be loud.
			for (const not_a_request of [null, undefined, "683x384", 683]) {
				let thrown;
				try {
					decide_initial_canvas_size(not_a_request);
				} catch (error) {
					thrown = error;
				}
				expect(thrown, `thrown for ${JSON.stringify(not_a_request)}`).to.be.an.instanceOf(TypeError);
			}
		});

		it("is deterministic: the same request gives the same decision", () => {
			const request = () => ({
				signals: phone_signals,
				available_area: { width: 375, height: 500 },
				stored_dimensions: { width: null, height: null },
			});
			expect(decide_initial_canvas_size(request())).to.deep.equal(decide_initial_canvas_size(request()));
		});
	});
});

context("canvas sizing in the app", () => {
	/**
	 * Loads the app pretending to be a given device, optionally with a canvas
	 * size already saved. The overrides have to be installed before the app's
	 * scripts run, which is what `onBeforeLoad` is for.
	 */
	const visit_as = ({ user_agent, max_touch_points = 0, stored = null }) => {
		cy.visit("/", {
			onBeforeLoad(win) {
				if (user_agent !== undefined) {
					Object.defineProperty(win.navigator, "userAgent", { value: user_agent, configurable: true });
				}
				Object.defineProperty(win.navigator, "maxTouchPoints", { value: max_touch_points, configurable: true });
				if (stored) {
					win.localStorage.setItem("width", JSON.stringify(String(stored.width)));
					win.localStorage.setItem("height", JSON.stringify(String(stored.height)));
				}
			},
		});
		cy.window().should("have.property", "api_for_cypress_tests");
	};

	const get_decision = () => cy.window().then((win) => win.api_for_cypress_tests.get_canvas_sizing_decision());

	it("opens a desktop at the size it always has", () => {
		cy.viewport(1280, 800);
		visit_as({ user_agent: DESKTOP_USER_AGENT });
		get_decision().then((decision) => {
			expect(decision.source).to.equal("desktop-default");
			expect(decision.device_class).to.equal("desktop");
		});
		cy.get(".main-canvas").should(($canvas) => {
			expect($canvas[0].width).to.equal(DESKTOP_CANVAS_WIDTH);
			expect($canvas[0].height).to.equal(DESKTOP_CANVAS_HEIGHT);
		});
	});

	it("opens at the default in the viewport the other specs run at", () => {
		// The screenshot specs compare against images taken at the default
		// viewport, so this is what stops this feature from quietly rewriting
		// every snapshot in the repo.
		visit_as({ user_agent: DESKTOP_USER_AGENT });
		cy.get(".main-canvas").should(($canvas) => {
			expect($canvas[0].width).to.equal(DESKTOP_CANVAS_WIDTH);
			expect($canvas[0].height).to.equal(DESKTOP_CANVAS_HEIGHT);
		});
	});

	it("opens a phone at a canvas that fits on screen", () => {
		cy.viewport(375, 667);
		visit_as({ user_agent: IPHONE_USER_AGENT, max_touch_points: 5 });
		get_decision().then((decision) => {
			expect(decision.device_class).to.equal("mobile");
			expect(decision.source).to.equal("fit-available");
		});
		cy.get(".main-canvas").should(($canvas) => {
			const canvas = $canvas[0];
			expect(canvas.width, "canvas width").to.be.lessThan(DESKTOP_CANVAS_WIDTH);
			expect(canvas.width).to.be.at.least(MIN_AUTO_CANVAS_WIDTH);
			expect(canvas.width / canvas.height, "aspect ratio").to.be.closeTo(DEFAULT_ASPECT_RATIO, 0.02);
			// The whole canvas is on screen, which is the point of the feature.
			expect(canvas.getBoundingClientRect().right).to.be.at.most(375);
		});
	});

	it("doesn't overrule a canvas size the user saved, even on a phone", () => {
		cy.viewport(375, 667);
		visit_as({ user_agent: IPHONE_USER_AGENT, max_touch_points: 5, stored: { width: 640, height: 480 } });
		get_decision().then((decision) => {
			expect(decision.source).to.equal("stored");
		});
		cy.get(".main-canvas").should(($canvas) => {
			expect($canvas[0].width).to.equal(640);
			expect($canvas[0].height).to.equal(480);
		});
	});

	it("exports an auto-sized canvas at its own dimensions", () => {
		cy.viewport(375, 667);
		visit_as({ user_agent: IPHONE_USER_AGENT, max_touch_points: 5 });
		cy.window().then((win) => {
			const canvas = win.document.querySelector(".main-canvas");
			const data_url = canvas.toDataURL("image/png");
			expect(data_url.startsWith("data:image/png")).to.equal(true);
			return new Cypress.Promise((resolve, reject) => {
				const image = new win.Image();
				image.onload = () => resolve({ image, canvas });
				image.onerror = () => reject(new Error("exported PNG failed to decode"));
				image.src = data_url;
			});
		}).then(({ image, canvas }) => {
			expect(image.naturalWidth, "exported PNG width").to.equal(canvas.width);
			expect(image.naturalHeight, "exported PNG height").to.equal(canvas.height);
		});
	});

	it("gives File > New the same size, so a new document isn't oversized again", () => {
		// Menus need pointer events currently, so this doesn't trigger click events.
		const clickMenuItem = (selector, label) => {
			cy.contains(selector, new RegExp(`^${label}$`))
				.trigger("pointerdown", { which: 1 })
				.trigger("pointerup", { force: true });
		};

		cy.viewport(375, 667);
		visit_as({ user_agent: IPHONE_USER_AGENT, max_touch_points: 5 });
		cy.get(".main-canvas").then(($canvas) => {
			const { width, height } = $canvas[0];
			// A screen this narrow collapses the menu bar behind the hamburger button
			// (see cypress/integration/menu-bar-responsive-tests.spec.js), so the File
			// menu is one tap further in than it is on a desktop.
			cy.get(".menu-bar-toggle").click();
			clickMenuItem(".menu-button", "File");
			clickMenuItem(".menu-item-label", "New");
			cy.get(".main-canvas").should(($canvas_after) => {
				expect($canvas_after[0].width).to.equal(width);
				expect($canvas_after[0].height).to.equal(height);
			});
		});
	});
});
