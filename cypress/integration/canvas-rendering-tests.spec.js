/// <reference types="Cypress" />

// The document is stored in image pixels (one image pixel is one image pixel — that's the
// point of a pixel editor), while the views of it on screen — the helper layer and the
// thumbnail — are backed by device pixels. `src/canvas-rendering.js` owns the arithmetic
// that converts between the two. This file tests that arithmetic directly at a range of
// device pixel ratios (it's pure functions, so it can be checked at ratios the machine
// running the tests doesn't have), then checks that the app applies it.

import {
	apply_canvas_sizing,
	calculate_canvas_sizing,
	calculate_view_source_size
} from "../../src/canvas-rendering.js";

// 1 is the historical assumption, 2 and 3 are Retina and Android phones,
// and 1.25/1.5 are Windows display scaling, which is where fractions come from.
const DEVICE_PIXEL_RATIOS = [1, 1.25, 1.5, 2, 3];

// The thumbnail canvas's CSS size (`make_canvas(108, 92)` in `toggle_thumbnail`).
const THUMBNAIL_CSS_WIDTH = 108;
const THUMBNAIL_CSS_HEIGHT = 92;

// What the ResizeObserver in `toggle_thumbnail` sizes the backing store to.
const backing_store_for = (pixel_ratio) => ({
	width: Math.round(THUMBNAIL_CSS_WIDTH * pixel_ratio),
	height: Math.round(THUMBNAIL_CSS_HEIGHT * pixel_ratio),
});

context("high-DPI scaling rules", () => {
	describe("sizing a view's backing store", () => {
		DEVICE_PIXEL_RATIOS.forEach((pixel_ratio) => {
			it(`asks for ${pixel_ratio}x the device pixels at devicePixelRatio ${pixel_ratio}`, () => {
				const sizing = calculate_canvas_sizing(
					{ logicalWidth: 300, logicalHeight: 200 },
					{ pixelRatio: pixel_ratio, magnification: 1 },
				);

				// The logical (CSS) size is untouched: the view occupies the same space on
				// screen, it just has more pixels to draw with.
				expect(sizing.canvas.logicalWidth, "logical width").to.equal(300);
				expect(sizing.canvas.logicalHeight, "logical height").to.equal(200);
				expect(sizing.canvas.backingWidth, "backing width").to.equal(Math.round(300 * pixel_ratio));
				expect(sizing.canvas.backingHeight, "backing height").to.equal(Math.round(200 * pixel_ratio));
				expect(sizing.renderScale, "render scale").to.equal(pixel_ratio);
			});
		});

		it("composes the pixel ratio with the zoom level", () => {
			const sizing = calculate_canvas_sizing(
				{ logicalWidth: 100, logicalHeight: 50 },
				{ pixelRatio: 2, magnification: 4 },
			);

			expect(sizing.renderScale).to.equal(8);
			expect(sizing.canvas.backingWidth).to.equal(800);
			expect(sizing.canvas.backingHeight).to.equal(400);
		});

		it("lands on whole device pixels at fractional ratios", () => {
			const sizing = calculate_canvas_sizing(
				{ logicalWidth: 301, logicalHeight: 201 },
				{ pixelRatio: 1.5, magnification: 1 },
			);

			// 451.5 and 301.5 device pixels don't exist; a fractional backing store would be
			// resampled by the browser, which is the blurriness this whole path avoids.
			expect(sizing.canvas.backingWidth).to.equal(452);
			expect(sizing.canvas.backingHeight).to.equal(302);
			expect(sizing.canvas.backingWidth % 1).to.equal(0);
			expect(sizing.canvas.backingHeight % 1).to.equal(0);
		});

		it("refuses a nonsense pixel ratio instead of sizing a canvas to NaN", () => {
			// Unlike the render-loop arithmetic below, this runs while setting up a canvas,
			// where a bad value should surface rather than silently draw wrong.
			[0, -1, NaN, Infinity, undefined].forEach((pixel_ratio) => {
				expect(() => calculate_canvas_sizing(
					{ logicalWidth: 100, logicalHeight: 100 },
					{ pixelRatio: pixel_ratio, magnification: 1 },
				), `pixelRatio ${pixel_ratio}`).to.throw(RangeError);
			});
		});
	});

	describe("choosing how much of the document a view shows", () => {
		DEVICE_PIXEL_RATIOS.forEach((pixel_ratio) => {
			it(`reads ${THUMBNAIL_CSS_WIDTH}x${THUMBNAIL_CSS_HEIGHT} image pixels at devicePixelRatio ${pixel_ratio}`, () => {
				const view = calculate_view_source_size(backing_store_for(pixel_ratio), pixel_ratio);

				// The source rectangle is in image pixels, so it must not grow with the
				// backing store, or the thumbnail shows more of the drawing at a smaller
				// size the sharper your screen is.
				expect(view.sourceWidth, "source width").to.equal(THUMBNAIL_CSS_WIDTH);
				expect(view.sourceHeight, "source height").to.equal(THUMBNAIL_CSS_HEIGHT);
				expect(view.renderScale, "render scale").to.equal(pixel_ratio);
			});
		});

		it("shows the same part of the document on every device", () => {
			const areas = DEVICE_PIXEL_RATIOS.map((pixel_ratio) => {
				const view = calculate_view_source_size(backing_store_for(pixel_ratio), pixel_ratio);
				return view.sourceWidth * view.sourceHeight;
			});

			expect(new Set(areas).size, `areas were ${areas.join(", ")}`).to.equal(1);
		});

		it("is unchanged at 1x, where the old 1:1 code was already right", () => {
			const backing_store = backing_store_for(1);
			const view = calculate_view_source_size(backing_store, 1);

			expect(view.sourceWidth).to.equal(backing_store.width);
			expect(view.sourceHeight).to.equal(backing_store.height);
		});

		it("rejects an invalid render scale instead of silently drawing the wrong view", () => {
			const backing_store = backing_store_for(2);

			// The runtime inputs come from devicePixelRatio and the validated sizing model.
			// If that contract is broken, surface the failure at its boundary: a silent 1x
			// fallback produces a plausible but incorrect thumbnail and hides the cause.
			[0, -2, NaN, Infinity, undefined, null, "2"].forEach((bad_scale) => {
				expect(
					() => calculate_view_source_size(backing_store, bad_scale),
					`scale ${bad_scale}`,
				).to.throw(RangeError);
			});
		});

		it("hands back something the render loop can't corrupt", () => {
			expect(Object.isFrozen(calculate_view_source_size(backing_store_for(2), 2))).to.equal(true);
		});
	});

	describe("resizing a canvas for the device it's on", () => {
		const sizing_at = (pixel_ratio) => calculate_canvas_sizing(
			{ logicalWidth: THUMBNAIL_CSS_WIDTH, logicalHeight: THUMBNAIL_CSS_HEIGHT },
			{ pixelRatio: pixel_ratio, magnification: 1 },
		);

		it("resizes when the pixel ratio changes, e.g. dragging to another monitor", () => {
			const view_canvas = document.createElement("canvas");
			apply_canvas_sizing(view_canvas, sizing_at(1));

			expect(apply_canvas_sizing(view_canvas, sizing_at(2)), "reported a resize").to.equal(true);
			expect(view_canvas.width).to.equal(THUMBNAIL_CSS_WIDTH * 2);
			expect(view_canvas.height).to.equal(THUMBNAIL_CSS_HEIGHT * 2);
		});

		it("leaves the canvas alone when the pixel ratio hasn't changed", () => {
			const view_canvas = document.createElement("canvas");
			apply_canvas_sizing(view_canvas, sizing_at(2));
			view_canvas.getContext("2d").fillRect(0, 0, 4, 4);

			// Assigning width/height clears the canvas even when the value is the same, so
			// this both saves work every frame and keeps the view from flickering.
			expect(apply_canvas_sizing(view_canvas, sizing_at(2))).to.equal(false);
			expect(view_canvas.getContext("2d").getImageData(0, 0, 1, 1).data[3], "still painted").to.be.greaterThan(0);
		});
	});
});

context("canvas rendering", () => {
	const clickMenuItem = (selector, label) => {
		cy.contains(selector, new RegExp(`^${label}$`))
			.trigger("pointerdown", { which: 1 })
			.trigger("pointerup", { force: true });
	};

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

	// The thumbnail's backing store is sized in device pixels by a ResizeObserver, so the
	// document has to be drawn at devicePixelRatio to cover the same part of the drawing on
	// every display density. Drawing it 1:1 against the backing store (as it used to) shows
	// four times the area at half the size on a 2x screen.
	// The scaling arithmetic itself lives in `calculate_view_source_size`.
	it("uses a high-DPI backing store for the thumbnail", () => {
		clickMenuItem(".menu-button", "View");
		clickMenuItem(".menu-item-label", "Zoom");
		clickMenuItem(".menu-item-label", "Show Thumbnail");

		cy.get(".thumbnail-window canvas").should("be.visible").then(($thumbnail) => {
			const thumbnail = $thumbnail[0];
			const win = thumbnail.ownerDocument.defaultView;
			const rect = thumbnail.getBoundingClientRect();

			expect(thumbnail.width, "backing store width").to.equal(Math.round(rect.width * win.devicePixelRatio));
			expect(thumbnail.height, "backing store height").to.equal(Math.round(rect.height * win.devicePixelRatio));
			// Resizing a canvas resets image smoothing, and the thumbnail now scales the
			// document up, so it has to be re-disabled or high-DPI thumbnails come out blurry
			// instead of matching the nearest-neighbor main canvas view.
			expect(thumbnail.getContext("2d").imageSmoothingEnabled, "image smoothing").to.equal(false);
		});
	});

	it("maps image pixels to a high-DPI view without changing the visible area", () => {
		cy.window().then(async (win) => {
			const mainCanvas = win.document.querySelector(".main-canvas");
			const mainContext = mainCanvas.getContext("2d");
			const view = win.document.createElement("canvas");
			view.width = 200;
			view.height = 100;
			// `render_canvas_view` receives the cached context used by the application's
			// PixelCanvas instances.
			view.ctx = view.getContext("2d");

			mainContext.fillStyle = "#ff0000";
			mainContext.fillRect(0, 0, 100, 50);
			mainContext.fillStyle = "#0000ff";
			mainContext.fillRect(100, 0, 100, 50);

			const { render_canvas_view } = await import("/src/functions.js");
			render_canvas_view(view, 2, 0, 0, false);

			// At 2x, the 200-device-pixel view covers only the first 100 image pixels.
			// A 1:1 source rectangle would incorrectly include the blue pixels.
			expect(Array.from(view.ctx.getImageData(190, 10, 1, 1).data))
				.to.deep.equal([255, 0, 0, 255]);
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
