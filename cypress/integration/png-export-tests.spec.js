/// <reference types="Cypress" />

context("PNG export", () => {
	const clickMenuItem = (selector, label) => {
		cy.contains(selector, new RegExp(`^${label}$`))
			.trigger("pointerdown", { which: 1 })
			.trigger("pointerup", { force: true });
	};

	beforeEach(() => {
		cy.visit("/");
		cy.window().should("have.property", "api_for_cypress_tests");
	});

	for (const scale of [1, 2, 4]) {
		it(`exports at exactly ${scale}x`, () => {
			cy.window().then((win) => {
				cy.stub(win.systemHooks, "showSaveFileDialog").callsFake(({ getBlob }) => {
					win.pngExportPromise = (async () => {
						const canvas = win.document.querySelector(".canvas-area > canvas");
						const blob = await getBlob("image/png");
						const image = new Image();
						const url = URL.createObjectURL(blob);
						image.src = url;
						await image.decode();
						expect(image.naturalWidth).to.equal(canvas.width * scale);
						expect(image.naturalHeight).to.equal(canvas.height * scale);
						URL.revokeObjectURL(url);
					})();
					return win.pngExportPromise;
				}).as("saveDialog");
			});

			clickMenuItem(".menu-button", "File");
			clickMenuItem(".menu-item-label", "Export PNG");
			// The radio input itself is visually hidden; 98.css draws the control on the label,
			// which is what a user clicks.
			cy.contains("label", new RegExp(`^${scale}x `)).click();
			cy.get(`#export-png-scale-${scale}`).should("be.checked");
			cy.contains("button", /^Export$/).click();
			cy.get("@saveDialog").should("have.been.calledOnce");
			cy.window().then((win) => cy.wrap(win.pngExportPromise));
		});
	}

	it("labels the scale controls and supports keyboard navigation", () => {
		clickMenuItem(".menu-button", "File");
		clickMenuItem(".menu-item-label", "Export PNG");

		cy.get("fieldset legend").should("have.text", "Scale");
		// Each option's visible label is tied to its input, so clicking or reading it works.
		for (const scale of [1, 2, 4]) {
			cy.contains("label", new RegExp(`^${scale}x `))
				.should("have.attr", "for", `export-png-scale-${scale}`);
		}
		cy.get("#export-png-scale-1").should("be.focused").should("be.checked");

		// The shortcuts the options advertise with aria-keyshortcuts.
		// (force: the inputs are focusable but visually hidden, as noted above.)
		cy.get("#export-png-scale-1").type("2", { force: true });
		cy.get("#export-png-scale-2").should("be.checked").should("be.focused");
		cy.get("#export-png-scale-2").type("{alt}4", { force: true });
		cy.get("#export-png-scale-4").should("be.checked").should("be.focused");

		cy.get("#export-png-scale-4").type("{esc}", { force: true });
		cy.contains(".window-title", "Export PNG").should("not.exist");
	});
});
