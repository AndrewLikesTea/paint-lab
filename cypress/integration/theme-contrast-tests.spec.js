/// <reference types="Cypress" />

// Contrast checks for the dark themes.
//
// There are two layers here, on purpose:
//
//  1. `sweepContrast` walks the *rendered* DOM and measures each text-bearing element's
//     computed `color` against the background it actually composites onto. This is the layer
//     that catches hardcoded colors in rules no theme variable feeds into.
//  2. `expectContrast` compares theme variables directly. It can't catch a component that
//     ignores the variable, but it does pin down colors whose only consumer is a state the
//     sweep can't reach: Cypress can't trigger a real CSS `:hover`, and no disabled control
//     is on screen at load to exercise `--GrayText`.
//
// Neither layer is sufficient alone.
context("dark theme contrast", () => {
	// WCAG 2.1 SC 1.4.3.
	const AA_NORMAL_TEXT = 4.5;
	const AA_LARGE_TEXT = 3;

	// Computed colors are always rgb()/rgba() functional notation, so this only has to handle those.
	const parseComputedColor = (color) => {
		const channels = (color || "").match(/[\d.]+/g);
		if (!channels || channels.length < 3) {
			return null; // "none", or an empty string for an unsupported property
		}
		return {
			r: Number(channels[0]),
			g: Number(channels[1]),
			b: Number(channels[2]),
			a: channels.length > 3 ? Number(channels[3]) : 1,
		};
	};

	// Custom properties hold raw text: `#9a9a9a`, `rgb(32, 32, 32)`, or even
	// `var(--accent-color-hover)`. Let the browser resolve it rather than reimplementing
	// CSS color parsing, which is how a naive regex reads `#9a9a9a` as rgb(9, 9, 9).
	const resolveColor = (document, value) => {
		const probe = document.createElement("span");
		probe.style.display = "none";
		probe.style.color = value;
		if (!probe.style.color) {
			return null; // CSSOM rejected it as an invalid color
		}
		document.body.appendChild(probe); // must be in the tree to inherit :root custom properties
		const computed = getComputedStyle(probe).color;
		probe.remove();
		return parseComputedColor(computed);
	};

	// Composite a possibly-translucent color over an opaque one.
	const composite = (top, bottom) => ({
		r: top.r * top.a + bottom.r * (1 - top.a),
		g: top.g * top.a + bottom.g * (1 - top.a),
		b: top.b * top.a + bottom.b * (1 - top.a),
		a: 1,
	});

	const relativeLuminance = ({ r, g, b }) => {
		const [red, green, blue] = [r, g, b].map((channel) => {
			const value = channel / 255;
			return value <= 0.03928 ?
				value / 12.92 :
				((value + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
	};

	const contrastRatio = (foreground, background) => {
		const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
		const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
		return (lighter + 0.05) / (darker + 0.05);
	};

	const formatColor = ({ r, g, b, a }) =>
		a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;

	// Elements can be transparent over their ancestors, and translucent over them,
	// so walk up until something opaque is found and composite back down.
	const effectiveBackground = (element) => {
		const layers = [];
		for (let node = element; node; node = node.parentElement) {
			const background = parseComputedColor(getComputedStyle(node).backgroundColor);
			if (background && background.a > 0) {
				layers.push(background);
				if (background.a === 1) {
					return layers.reduceRight((under, over) => composite(over, under));
				}
			}
		}
		return null; // nothing opaque underneath; the canvas or an image shows through
	};

	// A background image means the text sits on pixels we can't sample, so the computed
	// background-color would be a confidently wrong answer rather than an unknown one.
	const hasBackgroundImage = (element) => {
		for (let node = element; node; node = node.parentElement) {
			const style = getComputedStyle(node);
			if (style.backgroundImage !== "none") {
				return true;
			}
			const background = parseComputedColor(style.backgroundColor);
			if (background && background.a === 1) {
				return false;
			}
		}
		return false;
	};

	const isRendered = (element) => {
		const style = getComputedStyle(element);
		if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) {
			return false;
		}
		const { width, height } = element.getBoundingClientRect();
		return width > 0 && height > 0;
	};

	// Only elements that render text themselves; a wrapper's `color` may never be seen.
	const hasOwnText = (element) =>
		Array.prototype.some.call(element.childNodes, (node) =>
			node.nodeType === 3 /* Node.TEXT_NODE */ && node.textContent.trim().length > 0);

	// WCAG 2.1 large text: 18pt (24px), or 14pt (18.66px) bold.
	const requiredRatio = (style) => {
		const fontSize = parseFloat(style.fontSize);
		const bold = Number(style.fontWeight) >= 700 || style.fontWeight === "bold";
		return (fontSize >= 24 || (bold && fontSize >= 18.66)) ? AA_LARGE_TEXT : AA_NORMAL_TEXT;
	};

	// Reports every violation at once; failing on the first is painful to act on.
	const sweepContrast = (selector, { minimumChecked = 5 } = {}) => {
		cy.get(selector).should("exist");
		cy.get(selector).then(($roots) => {
			const violations = [];
			let checked = 0;
			for (const root of $roots.toArray()) {
				for (const element of [root, ...root.querySelectorAll("*")]) {
					if (!hasOwnText(element) || !isRendered(element) || hasBackgroundImage(element)) {
						continue;
					}
					const style = getComputedStyle(element);
					const foregroundColor = parseComputedColor(style.color);
					const backgroundColor = effectiveBackground(element);
					if (!foregroundColor || !backgroundColor || foregroundColor.a === 0) {
						continue;
					}
					checked++;
					const foreground = composite(foregroundColor, backgroundColor);
					const ratio = contrastRatio(foreground, backgroundColor);
					const minimum = requiredRatio(style);
					if (ratio < minimum) {
						const text = element.textContent.trim().replace(/\s+/g, " ").slice(0, 40);
						violations.push(
							`${ratio.toFixed(2)}:1 (needs ${minimum}:1) — ` +
							`${formatColor(foreground)} on ${formatColor(backgroundColor)} — ` +
							`<${element.tagName.toLowerCase()} class="${element.className}"> "${text}"`,
						);
					}
				}
			}
			// Guard against the sweep measuring nothing and "passing".
			expect(checked, `text elements measured under ${selector}`).to.be.at.least(minimumChecked);
			expect(violations.join("\n"), `contrast violations under ${selector}`).to.equal("");
		});
	};

	const expectContrast = (document, foregroundProperty, backgroundProperty, minimum = AA_NORMAL_TEXT) => {
		const styles = getComputedStyle(document.documentElement);
		const background = resolveColor(document, styles.getPropertyValue(backgroundProperty));
		const foreground = resolveColor(document, styles.getPropertyValue(foregroundProperty));
		expect(background, `resolve ${backgroundProperty}`).to.not.equal(null);
		expect(foreground, `resolve ${foregroundProperty}`).to.not.equal(null);
		expect(
			contrastRatio(composite(foreground, background), background),
			`${foregroundProperty} on ${backgroundProperty}`,
		).to.be.at.least(minimum);
	};

	// Menus need pointer events currently, so this doesn't trigger click events.
	const openMenu = (label) => {
		cy.contains(".menu-button", new RegExp(`^${label}$`))
			.trigger("pointerdown", { which: 1 })
			.trigger("pointerup", { force: true });
	};

	const useTheme = (theme) => {
		cy.window().then((win) => {
			win.api_for_cypress_tests.set_theme(theme);
		});
		cy.get("#theme-link").should("have.attr", "href", `styles/themes/${theme}`);
		cy.get("html").should(($html) => {
			const styles = getComputedStyle($html[0]);
			expect(styles.getPropertyValue("--theme-loaded").replace(/['"]+/g, "").trim()).to.equal(theme);
		});
	};

	const themes = [
		{
			file: "dark.css",
			// classic.css supplies the hyperlink-style hover color used by history entries,
			// help topics, and disclosure summaries.
			hoverColorProperty: "--link-hover-color",
			hoverSurfaces: ["--Window", "--ButtonFace"],
		},
		{
			file: "modern-dark.css",
			// modern.css routes the same hover states through its accent color.
			hoverColorProperty: "--accent-color-hover",
			hoverSurfaces: ["--Window", "--window-background-color"],
		},
	];

	beforeEach(() => {
		cy.visit("/");
		cy.window().should("have.property", "api_for_cypress_tests");
	});

	for (const { file, hoverColorProperty, hoverSurfaces } of themes) {
		describe(file, () => {
			beforeEach(() => {
				useTheme(file);
			});

			it("styles built-in controls as dark", () => {
				cy.window().then((win) => {
					// `color-scheme` is what styles built-in controls (scrollbars, native inputs).
					// Cypress 4 runs Electron 80 / Chromium 80, which predates the property, so it
					// can only be asserted where the browser understands it.
					if (!win.CSS.supports("color-scheme", "dark")) {
						cy.log("skipping color-scheme assertion: unsupported in this browser");
						return;
					}
					const styles = win.getComputedStyle(win.document.documentElement);
					expect(styles.getPropertyValue("color-scheme").trim()).to.equal("dark");
				});
			});

			it("renders the main UI with readable text", () => {
				sweepContrast(".jspaint");
			});

			// Covers the menu popup surface, and exercises disabled-item color on a real
			// element rather than only as a variable. WCAG exempts inactive controls from
			// 1.4.3, but both dark themes clear 4.5:1 there, so hold them to it.
			it("renders menu text readably, including disabled items", () => {
				openMenu("Edit"); // has disabled items (Undo/Repeat) on a fresh document
				cy.get(".menu-popup:visible").should("be.visible");
				cy.get(".menu-popup:visible [aria-disabled='true']").should("exist");
				sweepContrast(".menu-popup:visible");
			});

			it("renders dialog text readably", () => {
				cy.get("body").type("{ctrl}e"); // Image Attributes: labels, radio groups, buttons
				cy.get(".window:visible").should("be.visible");
				sweepContrast(".window:visible");
			});

			it("keeps colors used in unreachable states readable", () => {
				cy.document().then((document) => {
					// Disabled text. No disabled control is on screen at load.
					expectContrast(document, "--GrayText", "--ButtonFace");
					// Hover color for history entries, help topics, and disclosure summaries.
					for (const surface of hoverSurfaces) {
						expectContrast(document, hoverColorProperty, surface);
					}
				});
			});
		});
	}
});
