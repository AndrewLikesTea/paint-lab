/// <reference types="Cypress" />

// Touch drawing, and the browser defaults that fight it.
// See `src/canvas-interaction.js` for the policy these tests pin down, and the `pointercancel`
// handler in `src/app.js` for the gesture's abort boundary.

context("touch drawing", () => {
	const TOUCH_ID = 41;

	beforeEach(() => {
		// A fresh page per test, so the touch policy's counters start from a known state.
		cy.visit("/");
		cy.window().should("have.property", "api_for_cypress_tests");
		cy.window().then((win) => {
			win.api_for_cypress_tests.reset_for_next_test();
		});
	});

	/** Points inside the canvas, in client coordinates. */
	const canvas_points = (canvas) => {
		const rect = canvas.getBoundingClientRect();
		return {
			start: { clientX: rect.left + rect.width * 0.2, clientY: rect.top + rect.height * 0.2 },
			middle: { clientX: rect.left + rect.width * 0.4, clientY: rect.top + rect.height * 0.4 },
			end: { clientX: rect.left + rect.width * 0.6, clientY: rect.top + rect.height * 0.6 },
		};
	};

	const dispatch_pointer_event = (win, target, type, { pointerId = TOUCH_ID, pointerType = "touch", ...props } = {}) => {
		const event = new win.PointerEvent(type, {
			view: win,
			bubbles: true,
			cancelable: true,
			isPrimary: true,
			pointerId,
			pointerType,
			// `pointermove` reports no button change; the app treats a change mid-stroke as a cancel
			button: type === "pointermove" ? -1 : 0,
			buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
			...props,
		});
		target.dispatchEvent(event);
		return event;
	};

	const dispatch_touch_event = (win, target, type, points) => {
		const touches = points.map((point, index) => new win.Touch({
			identifier: TOUCH_ID + index,
			target,
			clientX: point.clientX,
			clientY: point.clientY,
		}));
		const event = new win.TouchEvent(type, {
			bubbles: true,
			cancelable: true,
			touches,
			targetTouches: touches,
			changedTouches: touches,
		});
		target.dispatchEvent(event);
		return event;
	};

	it("draws with one finger without letting the browser scroll or zoom", () => {
		cy.get(".tool[title='Pencil']").click();
		cy.window().then((win) => {
			const canvas = win.$(".main-canvas")[0];
			const points = canvas_points(canvas);
			const blank = canvas.toDataURL();

			const down = dispatch_pointer_event(win, canvas, "pointerdown", points.start);
			const move = dispatch_pointer_event(win, canvas, "pointermove", points.middle);
			// The gesture is what the browser would have turned into a scroll or a pinch.
			const touch_move = dispatch_touch_event(win, canvas, "touchmove", [points.middle]);
			dispatch_pointer_event(win, canvas, "pointerup", points.end);

			expect(canvas.toDataURL(), "touch stroke reaches the document").not.to.equal(blank);
			expect(down.defaultPrevented, "pointerdown prevented").to.equal(true);
			expect(move.defaultPrevented, "pointermove prevented").to.equal(true);
			expect(touch_move.defaultPrevented, "touchmove prevented").to.equal(true);
			expect(canvas.style.touchAction).to.equal("none");

			const state = win.api_for_cypress_tests.get_interaction_state();
			expect(state.pointer_active, "gesture closed").to.equal(false);
			expect(state.drawing_pointer_id, "no gesture owner left over").to.equal(undefined);
			expect(state.canvas_touch_policy.active_touch_count, "no touch left open").to.equal(0);
			expect(state.canvas_touch_policy.failure_count, "no reported failures").to.equal(0);
		});
	});

	it("claims two-finger gestures in the canvas area but leaves one-finger scrolling alone", () => {
		cy.window().then((win) => {
			const canvas_area = win.$(".canvas-area")[0];
			const points = canvas_points(win.$(".main-canvas")[0]);

			const one_finger = dispatch_touch_event(win, canvas_area, "touchmove", [points.start]);
			const two_fingers = dispatch_touch_event(win, canvas_area, "touchmove", [points.start, points.end]);

			// One finger on the canvas area background scrolls it, as it always has; two fingers
			// are the app's own pan/zoom, and a native scroll on top of that would double it.
			expect(one_finger.defaultPrevented, "one-finger scrolling left to the browser").to.equal(false);
			expect(two_fingers.defaultPrevented, "two-finger gesture claimed by the app").to.equal(true);
			expect(canvas_area.style.touchAction, "canvas area stays scrollable").to.equal("");
		});
	});

	it("aborts the stroke when the browser takes the touch away", () => {
		cy.get(".tool[title='Pencil']").click();
		cy.window().then((win) => {
			const canvas = win.$(".main-canvas")[0];
			const points = canvas_points(canvas);
			const blank = canvas.toDataURL();

			dispatch_pointer_event(win, canvas, "pointerdown", points.start);
			dispatch_pointer_event(win, canvas, "pointermove", points.middle);
			expect(canvas.toDataURL(), "stroke in progress").not.to.equal(blank);

			dispatch_pointer_event(win, canvas, "pointercancel", points.middle);

			expect(canvas.toDataURL(), "canceled stroke is rolled back").to.equal(blank);

			// The gesture must be fully unbound: this used to keep painting, because the
			// window-level `pointermove` handler was only removed on `pointerup`.
			dispatch_pointer_event(win, canvas, "pointermove", points.end);
			expect(canvas.toDataURL(), "no painting after the gesture was canceled").to.equal(blank);

			const state = win.api_for_cypress_tests.get_interaction_state();
			expect(state.pointer_active).to.equal(false);
			expect(state.drawing_pointer_id).to.equal(undefined);
			expect(state.canvas_touch_policy.active_touch_count).to.equal(0);
		});
	});

	it("stops the airbrush timer when the touch is canceled", () => {
		cy.get(".tool[title='Airbrush']").click();
		cy.window().then((win) => {
			const canvas = win.$(".main-canvas")[0];
			const points = canvas_points(canvas);
			const blank = canvas.toDataURL();

			dispatch_pointer_event(win, canvas, "pointerdown", points.start);
			// Airbrush paints on a 5ms interval rather than per pointer event.
			cy.wait(150);
			cy.then(() => {
				expect(canvas.toDataURL(), "airbrush is spraying").not.to.equal(blank);
				dispatch_pointer_event(win, canvas, "pointercancel", points.start);
			});
			cy.wait(250);
			cy.then(() => {
				// A leaked interval would have sprayed over the rolled-back document by now.
				expect(canvas.toDataURL(), "spraying stopped and rolled back").to.equal(blank);
			});
		});
	});

	it("does not abort a stroke when an unrelated pointer is canceled", () => {
		cy.get(".tool[title='Pencil']").click();
		cy.window().then((win) => {
			const canvas = win.$(".main-canvas")[0];
			const points = canvas_points(canvas);
			const blank = canvas.toDataURL();

			dispatch_pointer_event(win, canvas, "pointerdown", points.start);
			dispatch_pointer_event(win, canvas, "pointermove", points.middle);
			const drawn = canvas.toDataURL();
			expect(drawn).not.to.equal(blank);

			// A finger resting on a toolbar, canceled while you draw with another pointer.
			dispatch_pointer_event(win, win.$(".tools")[0], "pointercancel", { ...points.start, pointerId: TOUCH_ID + 99 });

			expect(canvas.toDataURL(), "the stroke survives").to.equal(drawn);
			expect(win.api_for_cypress_tests.get_interaction_state().pointer_active).to.equal(true);

			dispatch_pointer_event(win, canvas, "pointermove", points.end);
			dispatch_pointer_event(win, canvas, "pointerup", points.end);
			expect(canvas.toDataURL(), "and is still committed on release").not.to.equal(drawn);
		});
	});

	it("reports a touch that ends without ever having begun", () => {
		cy.window().then((win) => {
			const canvas = win.$(".main-canvas")[0];
			const points = canvas_points(canvas);
			expect(win.api_for_cypress_tests.get_interaction_state().canvas_touch_policy.failure_count).to.equal(0);

			dispatch_pointer_event(win, canvas, "pointerup", { ...points.start, pointerId: TOUCH_ID + 7 });

			const { canvas_touch_policy } = win.api_for_cypress_tests.get_interaction_state();
			expect(canvas_touch_policy.failure_count, "the mismatched pointer id is counted").to.equal(1);
			expect(canvas_touch_policy.last_failure.message).to.match(/never began/);
			expect(canvas_touch_policy.active_touch_count).to.equal(0);
		});
	});

	it("leaves mouse drawing alone", () => {
		cy.get(".tool[title='Pencil']").click();
		cy.window().then((win) => {
			const canvas = win.$(".main-canvas")[0];
			const points = canvas_points(canvas);
			const blank = canvas.toDataURL();

			const down = dispatch_pointer_event(win, canvas, "pointerdown", { ...points.start, pointerType: "mouse" });
			dispatch_pointer_event(win, canvas, "pointermove", { ...points.middle, pointerType: "mouse" });
			dispatch_pointer_event(win, canvas, "pointerup", { ...points.end, pointerType: "mouse" });

			expect(canvas.toDataURL(), "mouse stroke reaches the document").not.to.equal(blank);
			expect(down.defaultPrevented, "mouse defaults are untouched").to.equal(false);

			const { canvas_touch_policy } = win.api_for_cypress_tests.get_interaction_state();
			expect(canvas_touch_policy.active_touch_count).to.equal(0);
			expect(canvas_touch_policy.prevented_count, "the touch policy stayed out of it").to.equal(0);
			expect(canvas_touch_policy.failure_count).to.equal(0);
		});
	});
});
