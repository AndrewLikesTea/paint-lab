/// <reference types="Cypress" />

// The first load: how long until there's a canvas you can draw on, and whether
// anything went wrong on the way there.
// See `src/optional-resources.js` for which libraries are deliberately kept off
// the critical path, and `src/error-handling-basic.js` for what happens when the
// load fails (the loading screen covers the page, so it has to explain itself).

context("first load", () => {
	/**
	 * How long the app gets to become interactive, from navigation start.
	 * This is measured through Cypress's proxy, over HTTP/1.1, with no caching,
	 * so it's a pessimistic figure — a real visit is well under it. Treat a
	 * failure here as "something big went back onto the critical path", and see
	 * the two tests below, which pin down what that something is likely to be.
	 */
	const READY_BUDGET_MS = 2000;

	/**
	 * Resources that must not block the first canvas.
	 * Each belongs to something you reach through a dialog or an opt-in mode,
	 * so it can load when it's asked for. Together they were most of the app's
	 * weight, which is what made the first load slow.
	 * (Deliberately absent: pako and UPNG.js, the PNG codec. PNG is the default
	 * format, so it stays on the critical path — see index.html.)
	 */
	const off_critical_path = [
		"anypalette", // palette files (Colors > Get/Save Colors)
		"UTIF.js", "bmp.js", // TIFF and BMP codecs (File > Open/Save As)
		"gif.js", "pdf.js", // animated history export, PDF import
		"imagetracer", "tracky-mouse", // speech recognition drawing, eye gaze mode
		"chord.wav", // the message box sound, the largest single asset
	];

	/** Console output and load timing, captured from before the first script runs. */
	const visit_and_instrument = () => {
		cy.visit("/", {
			onBeforeLoad(win) {
				cy.spy(win.console, "error").as("console_error");
				cy.spy(win.console, "warn").as("console_warn");
				win.addEventListener("jspaint-ready", () => {
					win.ready_at_ms = win.performance.now();
				});
			},
		});
		cy.window().should("have.property", "api_for_cypress_tests");
		cy.window().should("have.property", "ready_at_ms");
	};

	beforeEach(visit_and_instrument);

	it(`becomes interactive within ${READY_BUDGET_MS}ms`, () => {
		cy.window().then((win) => {
			expect(win.ready_at_ms, "time from navigation start to jspaint-ready (ms)")
				.to.be.lessThan(READY_BUDGET_MS);
		});
	});

	it("logs no errors or warnings while loading", () => {
		// The loading screen turns into a "couldn't finish loading" message on
		// anything that would otherwise leave it covering the page, so if it's
		// gone, nothing fatal happened.
		cy.get("#initial-loading").should("not.exist");
		cy.get("@console_error").should("not.have.been.called");
		cy.get("@console_warn").should("not.have.been.called");
	});

	it("keeps optional resources off the critical path", () => {
		cy.window().then((win) => {
			const blocking = win.performance.getEntriesByType("resource")
				.filter((entry) => entry.startTime < win.ready_at_ms)
				.map((entry) => entry.name)
				.filter((name) => off_critical_path.some((resource) => name.includes(resource)));

			expect(blocking, "optional resources requested before the app was interactive").to.deep.equal([]);
		});
	});

	it("doesn't fetch the News dialog's images until it's opened", () => {
		// The News dialog is hidden markup with dozens of screenshots in it,
		// some hosted off-site. Fetching them all on load crowded out the app
		// itself, and told other servers about every visit.
		cy.window().then((win) => {
			const news_images = [...win.document.querySelectorAll("#news img")];
			expect(news_images.length, "number of images in the News dialog").to.be.greaterThan(0);
			const eager = news_images.filter((img) => img.loading !== "lazy");
			expect(eager.map((img) => img.getAttribute("src")), "eagerly loaded News images").to.deep.equal([]);

			const requested = win.performance.getEntriesByType("resource")
				.filter((entry) => entry.startTime < win.ready_at_ms)
				.map((entry) => entry.name);
			const fetched_early = news_images
				.map((img) => img.src)
				.filter((src) => requested.includes(src));
			expect(fetched_early, "News images fetched before the app was interactive").to.deep.equal([]);
		});
	});

	it("hands off from the loading screen without leaving the page busy", () => {
		cy.get("body").should("not.have.attr", "aria-busy");
		cy.get("#initial-loading").should("not.exist");
		// The real UI, which the loading screen was standing in for.
		cy.get(".main-canvas").should("be.visible");
		cy.get(".tools").should("be.visible");
	});

	it("presents a default canvas you can draw on right away", () => {
		cy.get(".main-canvas").should("be.visible").then(($canvas) => {
			const canvas = $canvas[0];
			const win = canvas.ownerDocument.defaultView;
			const ctx = canvas.getContext("2d");

			expect(canvas.width, "default canvas width").to.be.greaterThan(0);
			expect(canvas.height, "default canvas height").to.be.greaterThan(0);

			const rect = canvas.getBoundingClientRect();
			const point = (fraction) => ({
				clientX: rect.left + rect.width * fraction,
				clientY: rect.top + rect.height * fraction,
			});
			const dispatch = (type, fraction, buttons) => {
				canvas.dispatchEvent(new win.PointerEvent(type, {
					view: win,
					bubbles: true,
					cancelable: true,
					isPrimary: true,
					pointerId: 1,
					pointerType: "mouse",
					button: type === "pointermove" ? -1 : 0,
					buttons,
					...point(fraction),
				}));
			};

			// The default tool (pencil) on the default canvas, with no setup.
			dispatch("pointerdown", 0.25, 1);
			dispatch("pointermove", 0.5, 1);
			dispatch("pointerup", 0.5, 0);

			const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			let drawn_pixels = 0;
			for (let i = 0; i < data.length; i += 4) {
				if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
					drawn_pixels++;
				}
			}
			expect(drawn_pixels, "non-white pixels after a drag across the canvas").to.be.greaterThan(0);
		});
	});
});
