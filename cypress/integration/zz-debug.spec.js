/// <reference types="Cypress" />

// Scratch spec: captures the collapsed menu bar for a visual once-over.
// Not part of the suite's coverage -- delete this file and cypress/screenshots/zz-debug.spec.js/.
context("zz debug", () => {
	const shot = (name) => cy.screenshot(name, { capture: "viewport", overwrite: true });

	it("captures the drawer in the classic theme", () => {
		cy.viewport(390, 844);
		cy.visit("/");
		cy.window().should("have.property", "api_for_cypress_tests");
		shot("1-collapsed");
		cy.get(".menu-bar-toggle").click();
		shot("2-drawer-open");
		cy.contains(".menu-button", /^File$/)
			.trigger("pointerdown", { which: 1 })
			.trigger("pointerup", { force: true });
		cy.wait(300);
		shot("3-menu-open");
		cy.get(".menu-bar-toggle").click(); // step back to the drawer
		cy.contains(".menu-button", /^Extras$/)
			.trigger("pointerdown", { which: 1 })
			.trigger("pointerup", { force: true });
		cy.wait(300);
		shot("4-long-menu-clamped");
	});
});
