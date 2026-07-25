/// <reference types="Cypress" />

context("canvas rendering", () => {
	beforeEach(() => {
		cy.visit("/");
		cy.window().should("have.property", "api_for_cypress_tests");
	});

	it("uses a high-DPI backing store for the helper canvas", () => {
		cy.get(".helper-layer canvas").should("be.visible").then(($helper) => {
			const helper = $helper[0];
			const win = helper.ownerDocument.defaultView;
			const rect = helper.getBoundingClientRect();

			expect(helper.width).to.equal(Math.round(rect.width * win.devicePixelRatio));
			expect(helper.height).to.equal(Math.round(rect.height * win.devicePixelRatio));
		});
	});

	it("prevents scrolling defaults for touch drawing but not mouse input", () => {
		cy.get(".main-canvas").then(($canvas) => {
			const canvas = $canvas[0];
			const win = canvas.ownerDocument.defaultView;
			const touch = new win.PointerEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				pointerId: 41,
				pointerType: "touch",
				buttons: 1,
			});
			const mouse = new win.PointerEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				pointerId: 42,
				pointerType: "mouse",
				buttons: 1,
			});

			canvas.dispatchEvent(touch);
			canvas.dispatchEvent(mouse);

			expect(touch.defaultPrevented).to.equal(true);
			expect(mouse.defaultPrevented).to.equal(false);
			expect(canvas.style.touchAction).to.equal("none");
		});
	});
});
