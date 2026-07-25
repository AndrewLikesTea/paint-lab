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

	// Reads a blob's real dimensions by decoding it, so these assert what an
	// image viewer would see, not just what the export claimed.
	const measureBlob = async (blob) => {
		const image = new Image();
		const url = URL.createObjectURL(blob);
		image.src = url;
		try {
			await image.decode();
			return { width: image.naturalWidth, height: image.naturalHeight };
		} finally {
			URL.revokeObjectURL(url);
		}
	};

	// The Clipboard API is permission-gated, and the real ClipboardItem doesn't
	// expose what it was constructed with, so both are replaced with recorders.
	// `write` resolves or rejects depending on what the test is checking.
	const stubClipboard = (win, { fail = false } = {}) => {
		const recorded = [];
		win.ClipboardItem = class ClipboardItem {
			constructor(dict) { recorded.push(dict); }
		};
		Object.defineProperty(win.navigator, "clipboard", {
			value: {
				write: () => (fail ?
					Promise.reject(new Error("clipboard write denied")) :
					Promise.resolve()),
			},
			configurable: true,
		});
		return recorded;
	};

	it("copies the exported image to the clipboard at the chosen scale", () => {
		cy.window().then((win) => {
			const recorded = stubClipboard(win);

			clickMenuItem(".menu-button", "File");
			clickMenuItem(".menu-item-label", "Export PNG");
			cy.contains("label", /^2x /).click();
			cy.contains("button", /^Copy$/).click();

			// The handler is async, so wait for the ClipboardItem to be built.
			cy.wrap(null).should(() => expect(recorded).to.have.lengthOf(1));
			cy.then(() => {
				const canvas = win.document.querySelector(".canvas-area > canvas");
				// Keyed by MIME type, which the export pipeline guarantees even
				// though the PNG encoder produces an untyped blob.
				expect(Object.keys(recorded[0])).to.deep.equal(["image/png"]);
				const blob = recorded[0]["image/png"];
				expect(blob.type).to.equal("image/png");
				return cy.wrap(measureBlob(blob).then(({ width, height }) => {
					expect(width).to.equal(canvas.width * 2);
					expect(height).to.equal(canvas.height * 2);
				}));
			});
		});
	});

	it("reports a clipboard failure instead of failing silently", () => {
		cy.window().then((win) => stubClipboard(win, { fail: true }));

		clickMenuItem(".menu-button", "File");
		clickMenuItem(".menu-item-label", "Export PNG");
		cy.contains("button", /^Copy$/).click();

		// show_error_message renders the text into a plain div with no class of
		// its own, so match on the text rather than a selector.
		cy.contains("Failed to copy to the Clipboard.").should("exist");
	});

	it("shares a typed PNG file, and treats a dismissed share sheet as a non-error", () => {
		// Share is only offered when the platform can share files, which the test
		// browser generally can't, so both capabilities are stubbed before load.
		cy.visit("/", {
			onBeforeLoad(win) {
				win.sharedFiles = [];
				Object.defineProperty(win.navigator, "canShare", {
					value: () => true, configurable: true,
				});
				Object.defineProperty(win.navigator, "share", {
					value: (data) => {
						win.sharedFiles.push(data.files[0]);
						// Simulate the user dismissing the share sheet, which must
						// not surface as an error.
						const abort = new Error("dismissed");
						abort.name = "AbortError";
						return Promise.reject(abort);
					},
					configurable: true,
				});
			},
		});
		cy.window().should("have.property", "api_for_cypress_tests");

		clickMenuItem(".menu-button", "File");
		clickMenuItem(".menu-item-label", "Export PNG");
		cy.contains("label", /^4x /).click();
		cy.contains("button", /^Share$/).click();

		cy.window().then((win) => {
			cy.wrap(null).should(() => expect(win.sharedFiles).to.have.lengthOf(1));
			cy.then(() => {
				const canvas = win.document.querySelector(".canvas-area > canvas");
				const file = win.sharedFiles[0];
				expect(file.type).to.equal("image/png");
				expect(file.name).to.match(/@4x\.png$/);
				return cy.wrap(measureBlob(file).then(({ width, height }) => {
					expect(width).to.equal(canvas.width * 4);
					expect(height).to.equal(canvas.height * 4);
				}));
			});
			// AbortError must not produce an error dialog.
			cy.contains("Failed to share the image.").should("not.exist");
		});
	});

	it("falls back to the clipboard when file sharing is unavailable", () => {
		cy.visit("/", {
			onBeforeLoad(win) {
				Object.defineProperty(win.navigator, "canShare", {
					value: () => false, configurable: true,
				});
				win.sharedClipboardItems = [];
				win.ClipboardItem = class ClipboardItem {
					constructor(dict) { win.sharedClipboardItems.push(dict); }
				};
				Object.defineProperty(win.navigator, "clipboard", {
					value: { write: () => Promise.resolve() },
					configurable: true,
				});
			},
		});
		cy.window().should("have.property", "api_for_cypress_tests");

		clickMenuItem(".menu-button", "File");
		clickMenuItem(".menu-item-label", "Export PNG");
		cy.contains("button", /^Share$/).click();
		cy.window().its("sharedClipboardItems").should("have.length", 1);
	});

	it("falls back to a download when sharing and clipboard access fail", () => {
		cy.visit("/", {
			onBeforeLoad(win) {
				Object.defineProperty(win.navigator, "canShare", {
					value: () => false, configurable: true,
				});
				win.ClipboardItem = class ClipboardItem {};
				Object.defineProperty(win.navigator, "clipboard", {
					value: { write: () => Promise.reject(new Error("denied")) },
					configurable: true,
				});
			},
		});
		cy.window().should("have.property", "api_for_cypress_tests");
		cy.window().then((win) => {
			cy.stub(win, "saveAs").as("download");
		});

		clickMenuItem(".menu-button", "File");
		clickMenuItem(".menu-item-label", "Export PNG");
		cy.contains("button", /^Share$/).click();
		cy.get("@download").should("have.been.calledOnce");
		cy.get("@download").its("firstCall.args.0.type").should("equal", "image/png");
		cy.get("@download").its("firstCall.args.1").should("match", /\.png$/);
	});

	it("offers a one-tap, accessible native share action in the phone layout", () => {
		cy.viewport(390, 844);
		cy.visit("/#phone-layout", {
			onBeforeLoad(win) {
				win.sharedFiles = [];
				Object.defineProperty(win.navigator, "canShare", {
					value: () => true, configurable: true,
				});
				Object.defineProperty(win.navigator, "share", {
					value: ({ files }) => {
						win.sharedFiles.push(...files);
						return Promise.resolve();
					},
					configurable: true,
				});
			},
		});
		cy.window().should("have.property", "api_for_cypress_tests");

		cy.get(".mobile-share-button")
			.should("be.visible")
			.and("have.attr", "aria-label", "Share drawing")
			.and("have.attr", "aria-describedby", "mobile-share-status")
			.should(($button) => {
				const rect = $button[0].getBoundingClientRect();
				expect(rect.width, "share target width").to.be.at.least(44);
				expect(rect.height, "share target height").to.be.at.least(44);
			})
			.click();

		cy.window().its("sharedFiles").should("have.length", 1);
		cy.window().then((win) => {
			const file = win.sharedFiles[0];
			const canvas = win.document.querySelector(".main-canvas");
			expect(file.type).to.equal("image/png");
			expect(file.name).to.match(/\.png$/);
			return cy.wrap(measureBlob(file).then(({ width, height }) => {
				expect(width).to.equal(canvas.width);
				expect(height).to.equal(canvas.height);
			}));
		});
		cy.get("#mobile-share-status").should("have.text", "Shared");
		cy.get(".mobile-share-button").should("not.be.disabled");
	});

	it("keeps the phone share action out of the classic desktop layout", () => {
		cy.get(".mobile-share-button").should("not.be.visible");
	});

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
