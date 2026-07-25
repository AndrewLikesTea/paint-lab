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
			cy.get(`#export-png-scale-${scale}`).should("be.visible").check().should("be.checked");
			cy.contains("button", /^Export$/).click();
			cy.get("@saveDialog").should("have.been.calledOnce");
			cy.window().then((win) => cy.wrap(win.pngExportPromise));
		});
	}

	it("labels the scale controls and supports keyboard navigation", () => {
		clickMenuItem(".menu-button", "File");
		clickMenuItem(".menu-item-label", "Export PNG");

		cy.get("fieldset legend").should("have.text", "Scale");
		cy.get("#export-png-scale-1").should("be.focused");
		cy.get("#export-png-scale-1").type("{rightarrow}");
		cy.get("#export-png-scale-2").should("be.checked");
		cy.get("#export-png-scale-2").type("{rightarrow}");
		cy.get("#export-png-scale-4").should("be.checked");
		cy.get("#export-png-scale-4").type("{esc}");
		cy.contains(".window-title", "Export PNG").should("not.exist");
	});
});
