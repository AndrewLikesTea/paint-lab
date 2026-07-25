/// <reference types="Cypress" />

// Everything the app saves for you lives under one prefix, in one record shape: the drawings you
// name with File > Save to Browser are "manual", and the automatic per-session backups that
// File > Manage Storage lists are "autosave". See src/session-storage.js.
context("saving drawings in the browser", () => {
	const STORAGE_KEY_PREFIX = "paint-session#manual:";
	const AUTOSAVE_KEY_PREFIX = "paint-session#autosave:";
	// What the two paths wrote before they were unified, still out there in people's browsers.
	const LEGACY_MANUAL_PREFIX = "saved-drawing#";
	const LEGACY_AUTOSAVE_PREFIX = "image#";

	// Menus need pointer events currently, so this doesn't trigger click events.
	const clickMenuItem = (selector, label) => {
		cy.contains(selector, new RegExp(`^${label}$`))
			.trigger("pointerdown", { which: 1 })
			.trigger("pointerup", { force: true });
	};
	const openMenuItem = (label) => {
		clickMenuItem(".menu-button", "File");
		clickMenuItem(".menu-item-label", label);
	};

	/** Every saved drawing in localStorage, keyed by name. */
	const getSavedDrawings = (win) => {
		const drawings = {};
		for (let index = 0; index < win.localStorage.length; index += 1) {
			const key = win.localStorage.key(index);
			if (key.indexOf(STORAGE_KEY_PREFIX) === 0) {
				const value = JSON.parse(win.localStorage.getItem(key));
				drawings[value.name] = { ...value, storage_key: key };
			}
		}
		return drawings;
	};

	/** A tiny image with known pixels, to check that opening restores the drawing exactly. */
	const makeTestImageDataURL = (win) => {
		const canvas = win.document.createElement("canvas");
		canvas.width = 3;
		canvas.height = 2;
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#00ff00";
		ctx.fillRect(0, 0, 3, 2);
		ctx.fillStyle = "#ff0000";
		ctx.fillRect(0, 0, 1, 1);
		return canvas.toDataURL("image/png");
	};

	const seedSavedDrawing = (win, { name, data_url, saved_at = 1700000000000 }) => {
		win.localStorage.setItem(`${STORAGE_KEY_PREFIX}${name}`, JSON.stringify({
			format: 1,
			kind: "manual",
			id: name,
			name,
			data_url: data_url ?? makeTestImageDataURL(win),
			width: 3,
			height: 2,
			saved_at,
		}));
	};

	beforeEach(() => {
		cy.visit("/");
		cy.window().should("have.property", "api_for_cypress_tests");
	});

	it("saves the canvas to local storage under a name the user chooses", () => {
		cy.window().then((win) => {
			win.setDocumentEdited = cy.stub().as("setDocumentEdited");
			win.setRepresentedFilename = cy.stub().as("setRepresentedFilename");
		});
		cy.window().then((win) => {
			// Draw directly on the canvas, so the document stays "saved"
			// and opening later doesn't prompt to save changes.
			const canvas = win.document.querySelector(".main-canvas");
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#ff00ff";
			ctx.fillRect(0, 0, 20, 10);
		});

		openMenuItem("Save to Browser");
		cy.get("#saved-drawing-name").should("be.focused").clear().type("Magenta Corner");
		cy.contains(".save-to-browser-window button", /^Save$/).click();
		cy.get(".save-to-browser-window").should("not.exist");

		cy.window().then((win) => {
			const canvas = win.document.querySelector(".main-canvas");
			const saved = getSavedDrawings(win);
			expect(Object.keys(saved)).to.deep.equal(["Magenta Corner"]);
			expect(saved["Magenta Corner"].data_url).to.equal(canvas.toDataURL("image/png"));
			expect(saved["Magenta Corner"].width).to.equal(canvas.width);
			expect(saved["Magenta Corner"].height).to.equal(canvas.height);
			expect(saved["Magenta Corner"].saved_at).to.be.greaterThan(0);
		});
		// The document takes on the name, like Save As does.
		cy.title().should("include", "Magenta Corner.png");
		cy.get("@setDocumentEdited").should("have.been.calledWith", false);
		// A browser save is not attached to a desktop file handle.
		cy.get("@setRepresentedFilename").should("have.been.calledWith", "");
	});

	it("opens a saved drawing back onto the canvas", () => {
		cy.window().then((win) => {
			seedSavedDrawing(win, { name: "Test Drawing" });
		});

		openMenuItem("Open from Browser");
		cy.contains(".open-from-browser-window .saved-drawing", "Test Drawing")
			.find(".open-button").click();
		cy.get(".open-from-browser-window").should("not.exist");

		// The dialog closes before the image finishes decoding, so this has to be able to retry.
		cy.get(".main-canvas").should(($canvas) => {
			const canvas = $canvas[0];
			expect(canvas.width).to.equal(3);
			expect(canvas.height).to.equal(2);
			const { data } = canvas.getContext("2d").getImageData(0, 0, 3, 2);
			expect([data[0], data[1], data[2], data[3]], "top-left pixel is red").to.deep.equal([255, 0, 0, 255]);
			expect([data[4], data[5], data[6], data[7]], "next pixel is green").to.deep.equal([0, 255, 0, 255]);
		});
		cy.title().should("include", "Test Drawing.png");
	});

	it("asks before replacing a drawing with the same name", () => {
		cy.window().then((win) => {
			seedSavedDrawing(win, { name: "Test Drawing" });
			const canvas = win.document.querySelector(".main-canvas");
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#0000ff";
			ctx.fillRect(0, 0, 20, 10);
		});

		openMenuItem("Save to Browser");
		cy.get("#saved-drawing-name").clear().type("test drawing"); // matching is case-insensitive
		cy.contains(".save-to-browser-window button", /^Save$/).click();

		// The first Save doesn't overwrite anything; it explains and offers Replace.
		cy.get("#save-to-browser-message").should("contain.text", '"Test Drawing" already exists');
		cy.contains(".save-to-browser-window button", /^Replace$/).should("be.focused");
		cy.window().then((win) => {
			const saved = getSavedDrawings(win);
			expect(Object.keys(saved)).to.deep.equal(["Test Drawing"]);
			expect(saved["Test Drawing"].width, "not overwritten yet").to.equal(3);
		});

		// Editing the name takes back the offer to replace.
		cy.get("#saved-drawing-name").type("2");
		cy.contains(".save-to-browser-window button", /^Save$/).should("exist");
		cy.get("#save-to-browser-message").should("have.text", "");

		cy.get("#saved-drawing-name").clear().type("test drawing");
		cy.contains(".save-to-browser-window button", /^Save$/).click();
		cy.contains(".save-to-browser-window button", /^Replace$/).click();
		cy.get(".save-to-browser-window").should("not.exist");
		cy.window().then((win) => {
			const saved = getSavedDrawings(win);
			const canvas = win.document.querySelector(".main-canvas");
			expect(Object.keys(saved), "replaced rather than added a second entry").to.have.length(1);
			expect(saved["test drawing"].data_url).to.equal(canvas.toDataURL("image/png"));
		});
	});

	it("deletes a saved drawing, and can undo the delete", () => {
		cy.window().then((win) => {
			seedSavedDrawing(win, { name: "Keep Me", saved_at: 1700000001000 });
			seedSavedDrawing(win, { name: "Delete Me", saved_at: 1700000000000 });
		});

		openMenuItem("Open from Browser");
		cy.get(".open-from-browser-window .saved-drawing").should("have.length", 2);
		cy.contains(".open-from-browser-window .saved-drawing", "Delete Me")
			.find(".remove-button").click();

		cy.window().then((win) => {
			expect(Object.keys(getSavedDrawings(win))).to.deep.equal(["Keep Me"]);
		});
		// The row stays put, offering Undo on the same button, so focus doesn't jump.
		cy.contains(".open-from-browser-window .saved-drawing.deleted", 'Deleted "Delete Me".')
			.find(".remove-button")
			.should("have.text", "Undo")
			.should("have.attr", "aria-label", 'Undo Delete "Delete Me"')
			.should("be.focused");
		cy.contains(".open-from-browser-window .saved-drawing.deleted", 'Deleted "Delete Me".')
			.find(".open-button").should("be.disabled");
		cy.contains(".open-from-browser-window .saved-drawing.deleted .remove-button", /^Undo$/).click();

		// Undo puts it back, exactly as it was.
		cy.get(".open-from-browser-window .saved-drawing.deleted").should("not.exist");
		cy.contains(".open-from-browser-window .saved-drawing", "Delete Me")
			.find(".remove-button").should("have.text", "Delete").should("be.focused");
		cy.window().then((win) => {
			const saved = getSavedDrawings(win);
			expect(Object.keys(saved).sort()).to.deep.equal(["Delete Me", "Keep Me"]);
			expect(saved["Delete Me"].saved_at).to.equal(1700000000000);
		});
	});

	it("lists the newest drawings first and ignores unreadable entries", () => {
		cy.window().then((win) => {
			seedSavedDrawing(win, { name: "Older", saved_at: 1600000000000 });
			seedSavedDrawing(win, { name: "Newer", saved_at: 1700000000000 });
			win.localStorage.setItem(`${STORAGE_KEY_PREFIX}corrupted`, "{not valid JSON");
			win.localStorage.setItem(`${STORAGE_KEY_PREFIX}wrong-shape`, JSON.stringify({ name: "No Image" }));
		});

		openMenuItem("Open from Browser");
		cy.get(".open-from-browser-window .saved-drawing-name").then(($names) => {
			expect($names.toArray().map((element) => element.textContent)).to.deep.equal(["Newer", "Older"]);
		});
	});

	it("explains when nothing is saved yet", () => {
		openMenuItem("Open from Browser");
		cy.get(".open-from-browser-window .saved-drawings-list").should("not.exist");
		cy.contains(".open-from-browser-window .saved-drawings-message", "No drawings are saved in this browser yet")
			.should("be.visible");
	});

	it("requires a name, without losing what you typed", () => {
		openMenuItem("Save to Browser");
		cy.get("#saved-drawing-name").clear().type("   ");
		cy.contains(".save-to-browser-window button", /^Save$/).click();

		cy.get("#save-to-browser-message")
			.should("have.attr", "role", "alert")
			.and("contain.text", "Please enter a name");
		cy.get(".save-to-browser-window").should("exist");
		cy.get("#saved-drawing-name").should("be.focused");
		cy.window().then((win) => {
			expect(Object.keys(getSavedDrawings(win))).to.have.length(0);
		});
	});

	it("labels its controls and supports keyboard navigation", () => {
		cy.window().then((win) => {
			seedSavedDrawing(win, { name: "Test Drawing" });
		});

		openMenuItem("Save to Browser");
		cy.contains("label[for='saved-drawing-name']", "Name").should("be.visible");
		cy.get("#saved-drawing-name")
			.should("be.focused")
			.should("have.attr", "aria-describedby", "save-to-browser-message")
			.type("{esc}");
		cy.get(".save-to-browser-window").should("not.exist");

		openMenuItem("Open from Browser");
		// Focus starts on the first drawing's Open button, so it's reachable without a pointer.
		cy.get(".open-from-browser-window .open-button").first().should("be.focused");
		// Accessible names include the drawing name, and start with the visible label
		// so voice control still works.
		cy.get(".open-from-browser-window .open-button").first()
			.should("have.attr", "aria-label", 'Open "Test Drawing"');
		cy.get(".open-from-browser-window .remove-button").first()
			.should("have.attr", "aria-label", 'Delete "Test Drawing"');
		cy.get(".open-from-browser-window .saved-drawing-thumbnail")
			.should("have.attr", "alt", ""); // decorative; the name is right beside it
		cy.get(".open-from-browser-window .open-button").first().type("{esc}");
		cy.get(".open-from-browser-window").should("not.exist");
	});

	it("stores automatic and explicit saves under one key structure", () => {
		cy.window().then((win) => {
			const canvas = win.document.querySelector(".main-canvas");
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#ff00ff";
			ctx.fillRect(0, 0, 20, 10);
		});

		openMenuItem("Save to Browser");
		cy.get("#saved-drawing-name").clear().type("Both Paths");
		cy.contains(".save-to-browser-window button", /^Save$/).click();
		cy.get(".save-to-browser-window").should("not.exist");

		cy.window().then((win) => {
			const keys = [];
			for (let index = 0; index < win.localStorage.length; index += 1) {
				keys.push(win.localStorage.key(index));
			}
			expect(keys.filter((key) => key.indexOf(AUTOSAVE_KEY_PREFIX) === 0), "autosave").to.have.length(1);
			expect(keys.filter((key) => key.indexOf(STORAGE_KEY_PREFIX) === 0), "explicit save").to.have.length(1);
			// Same envelope whichever path wrote it, so one reader can handle both.
			for (const key of keys.filter((key) => key.indexOf("paint-session#") === 0)) {
				const record = JSON.parse(win.localStorage.getItem(key));
				expect(record, key).to.include.keys("format", "kind", "id", "name", "data_url", "width", "height", "saved_at");
				expect(key).to.equal(`paint-session#${record.kind}:${record.id}`);
			}
			// Nothing left under the pre-unification prefixes.
			expect(keys.filter((key) => key.indexOf(LEGACY_MANUAL_PREFIX) === 0)).to.have.length(0);
			expect(keys.filter((key) => key.indexOf(LEGACY_AUTOSAVE_PREFIX) === 0)).to.have.length(0);
		});
	});

	it("migrates drawings saved before the storage paths were unified", () => {
		// Explicitly index.html, not "/": beforeEach already left us on a "/#local:..." URL, and a
		// visit that differs only by hash wouldn't reload the page (or run onBeforeLoad).
		cy.visit("/index.html", {
			onBeforeLoad(win) {
				// Exactly what the old File > Save to Browser wrote.
				win.localStorage.setItem(`${LEGACY_MANUAL_PREFIX}old-one`, JSON.stringify({
					name: "Old One",
					data_url: makeTestImageDataURL(win),
					width: 3,
					height: 2,
					saved_at: 1600000000000,
				}));
			},
		});
		cy.window().should("have.property", "api_for_cypress_tests");

		cy.window().then((win) => {
			expect(win.localStorage.getItem(`${LEGACY_MANUAL_PREFIX}old-one`), "old entry removed").to.equal(null);
			const record = JSON.parse(win.localStorage.getItem(`${STORAGE_KEY_PREFIX}old-one`));
			expect(record.kind).to.equal("manual");
			expect(record.name).to.equal("Old One");
			expect(record.saved_at, "keeps when it was saved").to.equal(1600000000000);
		});

		// And it's still one drawing, not two.
		openMenuItem("Open from Browser");
		cy.get(".open-from-browser-window .saved-drawing").should("have.length", 1);
		cy.contains(".open-from-browser-window .saved-drawing", "Old One").should("exist");
	});

	it("recovers an autosave written before the storage paths were unified", () => {
		cy.visit("/index.html#local:legacy-session", {
			onBeforeLoad(win) {
				// The old autosave format: just the data URL, JSON-encoded, under "image#<session ID>".
				win.localStorage.setItem(`${LEGACY_AUTOSAVE_PREFIX}legacy-session`, JSON.stringify(makeTestImageDataURL(win)));
			},
		});
		cy.window().should("have.property", "api_for_cypress_tests");

		// The backup is still restored onto the canvas, which is the whole point of having it.
		cy.get(".main-canvas").should(($canvas) => {
			expect($canvas[0].width).to.equal(3);
			expect($canvas[0].height).to.equal(2);
			const { data } = $canvas[0].getContext("2d").getImageData(0, 0, 3, 2);
			expect([data[0], data[1], data[2], data[3]], "top-left pixel is red").to.deep.equal([255, 0, 0, 255]);
		});

		cy.window().then((win) => {
			expect(win.localStorage.getItem(`${LEGACY_AUTOSAVE_PREFIX}legacy-session`), "old entry removed").to.equal(null);
			const record = JSON.parse(win.localStorage.getItem(`${AUTOSAVE_KEY_PREFIX}legacy-session`));
			expect(record.kind).to.equal("autosave");
			expect(record.id, "the ID is the session ID, so the backup links back to its session").to.equal("legacy-session");
			expect(record.data_url).to.match(/^data:image\/png/);
		});

		// Manage Storage lists it, still linking to the session it belongs to.
		// (There's a second row for the session beforeEach started; this test is about this one.)
		openMenuItem("Manage Storage");
		cy.get(".storage-manager a[href='#local:legacy-session']").should("exist");
	});

	it("keeps a recoverable legacy save when its unified key is corrupt", () => {
		cy.visit("/index.html", {
			onBeforeLoad(win) {
				win.localStorage.setItem(`${LEGACY_MANUAL_PREFIX}recoverable`, JSON.stringify({
					name: "Recoverable",
					data_url: makeTestImageDataURL(win),
					width: 3,
					height: 2,
					saved_at: 1600000000000,
				}));
				win.localStorage.setItem(`${STORAGE_KEY_PREFIX}recoverable`, "{not valid json");
			},
		});
		cy.window().should("have.property", "api_for_cypress_tests");

		cy.window().then((win) => {
			expect(
				win.localStorage.getItem(`${LEGACY_MANUAL_PREFIX}recoverable`),
				"last readable copy is retained"
			).not.to.equal(null);
		});

		openMenuItem("Open from Browser");
		cy.contains(".open-from-browser-window .saved-drawing", "Recoverable").should("exist");
	});
});
