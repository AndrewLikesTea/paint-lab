/// <reference types="Cypress" />

// The app ships in several shells (browser tab, installed PWA, embedded frame, Electron desktop app).
// Cypress exercises the plain browser tab, which is the shell where desktop-only commands
// either can't work or would lie about what they do. See the platform capability flags in src/menus.js.
context("menus in a browser tab", () => {
	const escapeRegExp = (string) =>
		string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string

	// Menus need pointer events currently, so this doesn't trigger click events.
	const clickElementWithExactText = (selector, text) => {
		cy.contains(selector, new RegExp(`^${escapeRegExp(text)}$`))
			.trigger("pointerdown", { which: 1 })
			.trigger("pointerup", { force: true });
	};

	const isDivider = (row) => row.querySelector(".menu-hr") !== null;

	beforeEach(() => {
		cy.visit("/");
		cy.window().should("have.property", "api_for_cypress_tests");
		clickElementWithExactText(".menu-button", "File");
		// make sure the menu actually opened before asserting things are absent from it
		cy.contains(".menu-item-label", /^Print$/).should("be.visible");
	});

	it("doesn't offer desktop-only commands", () => {
		for (const label of ["Exit", "Recent File", "Set As Wallpaper (Tiled)", "Set As Wallpaper (Centered)"]) {
			cy.contains(".menu-item-label", new RegExp(`^${escapeRegExp(label)}$`)).should("not.exist");
		}
	});

	it("doesn't leave dangling separators where items were omitted", () => {
		cy.get(".menu-popup:visible .menu-row").then(($rows) => {
			const rows = $rows.toArray();
			expect(isDivider(rows[0]), "menu starts with a separator").to.equal(false);
			expect(isDivider(rows[rows.length - 1]), "menu ends with a separator").to.equal(false);
			for (let i = 1; i < rows.length; i++) {
				expect(isDivider(rows[i]) && isDivider(rows[i - 1]), `two separators in a row at row ${i}`).to.equal(false);
			}
		});
	});

	it("presents every remaining File menu item as usable", () => {
		cy.get(".menu-popup:visible .menu-item").each(($item) => {
			cy.wrap($item).should("not.have.attr", "aria-disabled", "true");
		});
	});
});
