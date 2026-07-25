/// <reference types="Cypress" />

// Coming back to the app without a hash reopens the drawing you left, instead of handing you a
// blank canvas and leaving the old one reachable only through File > Manage Storage.
// The mechanism is in `session_id_to_resume` in src/sessions.js: the newest autosave's session ID
// is adopted into the URL, so the restored document is the *same* session, still autosaving to the
// same record — not a copy of it.

context("persistent canvas restore", () => {
	const AUTOSAVE_KEY_PREFIX = "paint-session#autosave:";

	/** 1x1 PNGs, so a seeded record is unambiguous when read back a pixel at a time. */
	const RED_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
	const BLUE_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==";

	const autosaveRecord = (id, data_url, saved_at) => JSON.stringify({
		format: 1, kind: "autosave", id, name: "", data_url, width: 1, height: 1, saved_at,
	});

	/** Loads the app with localStorage already holding `records`, keyed by session ID. */
	const visitWithStoredSessions = (records, path = "/") => {
		cy.clearLocalStorage();
		cy.visit(path, {
			onBeforeLoad(win) {
				for (const [id, json] of Object.entries(records)) {
					win.localStorage.setItem(`${AUTOSAVE_KEY_PREFIX}${id}`, json);
				}
			},
		});
		cy.window().should("have.property", "api_for_cypress_tests");
	};

	const waitForAutosave = () => {
		cy.window().should((win) => {
			const session_id = win.location.hash.replace(/^#local:/, "");
			const stored = win.localStorage.getItem(`${AUTOSAVE_KEY_PREFIX}${session_id}`);
			expect(stored, "current autosave record").to.be.a("string");
			expect(JSON.parse(stored).data_url).to.equal(
				win.document.querySelector(".main-canvas").toDataURL("image/png")
			);
		});
	};

	const paintTopLeftRed = () => {
		cy.window().then((win) => {
			const canvas = win.document.querySelector(".main-canvas");
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#ff0000";
			ctx.fillRect(0, 0, 8, 8);
			win.$G.triggerHandler("session-update");
		});
		waitForAutosave();
	};

	const expectTopLeftPixel = (expected) => {
		cy.get(".main-canvas").should(($canvas) => {
			const pixel = [...$canvas[0].getContext("2d").getImageData(0, 0, 1, 1).data];
			expect(pixel).to.deep.equal(expected);
		});
	};

	const openFileMenuItem = (label) => {
		cy.contains(".menu-button", /^File$/)
			.trigger("pointerdown", { which: 1 })
			.trigger("pointerup", { force: true });
		cy.contains(".menu-item-label", new RegExp(`^${label}$`))
			.trigger("pointerdown", { which: 1 })
			.trigger("pointerup", { force: true });
	};

	beforeEach(() => {
		cy.clearLocalStorage();
		cy.visit("/");
		cy.window().should("have.property", "api_for_cypress_tests");
	});

	it("restores the newest autosaved canvas when visiting without a hash", () => {
		paintTopLeftRed();
		cy.location("hash").then((previous_hash) => {
			cy.visit("/");
			cy.window().should("have.property", "api_for_cypress_tests");
			cy.location("hash").should("equal", previous_hash);
		});
		expectTopLeftPixel([255, 0, 0, 255]);
	});

	it("starts clean when there is no saved canvas", () => {
		cy.clearLocalStorage();
		cy.visit("/");
		cy.window().should("have.property", "api_for_cypress_tests");
		cy.location("hash").should("match", /^#local:.+/);
		expectTopLeftPixel([255, 255, 255, 255]);
	});

	it("keeps an explicit New canvas fresh on the next hashless visit", () => {
		paintTopLeftRed();
		cy.location("hash").then((drawing_hash) => {
			openFileMenuItem("New");
			cy.location("hash").should("not.equal", drawing_hash);
		});
		expectTopLeftPixel([255, 255, 255, 255]);
		waitForAutosave();

		cy.location("hash").then((new_hash) => {
			cy.visit("/");
			cy.window().should("have.property", "api_for_cypress_tests");
			cy.location("hash").should("equal", new_hash);
		});
		expectTopLeftPixel([255, 255, 255, 255]);
	});

	it("restores without logging errors or warnings", () => {
		paintTopLeftRed();
		cy.visit("/", {
			onBeforeLoad(win) {
				cy.spy(win.console, "error").as("console_error");
				cy.spy(win.console, "warn").as("console_warn");
			},
		});
		cy.window().should("have.property", "api_for_cypress_tests");
		expectTopLeftPixel([255, 0, 0, 255]);
		cy.get("@console_error").should("not.have.been.called");
		cy.get("@console_warn").should("not.have.been.called");
	});

	it("resumes the newest session whose ID survives a round trip through the URL", () => {
		// localStorage is shared with everything else that has run on this origin, and the autosave
		// keys go back to a format that was a prefix plus whatever was in the hash — so an ID here
		// is not automatically one we can put in the URL. Adopting this one would percent-encode the
		// space, start a *different* session under the mangled ID, and show a blank canvas.
		visitWithStoredSessions({
			"not a valid id": autosaveRecord("not a valid id", BLUE_PNG, 2000),
			"legitimate-session": autosaveRecord("legitimate-session", RED_PNG, 1000),
		});
		cy.location("hash").should("equal", "#local:legitimate-session");
		expectTopLeftPixel([255, 0, 0, 255]);
	});

	it("starts fresh rather than resuming when the hash is unrecognized", () => {
		// A hash we can't parse isn't a request for the last drawing; it's most likely someone
		// else's fragment, or a link that went stale. Answer it with a blank canvas, not a document
		// the user didn't ask for.
		visitWithStoredSessions({ "legitimate-session": autosaveRecord("legitimate-session", RED_PNG, 2000) }, "/#some-page-anchor");
		cy.location("hash").should("match", /^#local:.+/);
		cy.location("hash").should("not.equal", "#local:legitimate-session");
		expectTopLeftPixel([255, 255, 255, 255]);
	});
});
