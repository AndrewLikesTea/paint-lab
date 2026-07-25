/// <reference types="Cypress" />

context("beforeunload guard", () => {
	const importGuard = (win, fresh = false) => (
		win.eval(`import('/src/beforeunload-guard.js${fresh ? `?test=${Date.now()}` : ""}')`)
	);

	const makeEventTarget = () => {
		const listeners = new Set();
		return {
			addEventListener(type, listener) {
				expect(type).to.equal("beforeunload");
				listeners.add(listener);
			},
			removeEventListener(type, listener) {
				expect(type).to.equal("beforeunload");
				listeners.delete(listener);
			},
			dispatch(event) {
				listeners.forEach((listener) => listener(event));
			},
			listeners,
		};
	};

	const makeBeforeUnloadEvent = () => ({
		defaultPrevented: false,
		returnValue: undefined,
		preventDefault() {
			this.defaultPrevented = true;
		},
	});

	beforeEach(() => {
		cy.visit("/");
		cy.window().should("have.property", "api_for_cypress_tests");
	});

	it("can be imported without attaching a listener", () => {
		cy.window().then(async (win) => {
			const addEventListener = cy.spy(win, "addEventListener");
			await importGuard(win, true);
			expect(addEventListener).to.have.callCount(0);
		});
	});

	it("does not block navigation while the document is idle", () => {
		cy.window().then(async (win) => {
			const { installBeforeUnloadGuard } = await importGuard(win);
			const target = makeEventTarget();
			const event = makeBeforeUnloadEvent();

			installBeforeUnloadGuard(target, () => false);
			target.dispatch(event);

			expect(event.defaultPrevented).to.equal(false);
			expect(event.returnValue).to.equal(undefined);
		});
	});

	it("requests confirmation when active changes exist", () => {
		cy.window().then(async (win) => {
			const { installBeforeUnloadGuard } = await importGuard(win);
			const target = makeEventTarget();
			const event = makeBeforeUnloadEvent();

			installBeforeUnloadGuard(target, () => true);
			target.dispatch(event);

			expect(event.defaultPrevented).to.equal(true);
			expect(event.returnValue).to.equal("");
		});
	});

	it("reads current state for each navigation attempt", () => {
		cy.window().then(async (win) => {
			const { installBeforeUnloadGuard } = await importGuard(win);
			const target = makeEventTarget();
			let dirty = false;
			installBeforeUnloadGuard(target, () => dirty);

			const idleEvent = makeBeforeUnloadEvent();
			target.dispatch(idleEvent);
			expect(idleEvent.defaultPrevented).to.equal(false);

			dirty = true;
			const dirtyEvent = makeBeforeUnloadEvent();
			target.dispatch(dirtyEvent);
			expect(dirtyEvent.defaultPrevented).to.equal(true);
		});
	});

	it("can be detached safely for rollback", () => {
		cy.window().then(async (win) => {
			const { installBeforeUnloadGuard } = await importGuard(win);
			const target = makeEventTarget();
			const detach = installBeforeUnloadGuard(target, () => true);

			detach();
			detach();
			const event = makeBeforeUnloadEvent();
			target.dispatch(event);

			expect(target.listeners.size).to.equal(0);
			expect(event.defaultPrevented).to.equal(false);
		});
	});

	it("integrates with drawing state without guarding a fresh canvas", () => {
		cy.window().then((win) => {
			const freshEvent = new win.Event("beforeunload", { cancelable: true });
			win.dispatchEvent(freshEvent);
			expect(freshEvent.defaultPrevented).to.equal(false);
		});

		cy.get(".main-canvas").then(($canvas) => {
			const canvas = $canvas[0];
			const win = canvas.ownerDocument.defaultView;
			const rect = canvas.getBoundingClientRect();
			const point = {
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2,
			};
			for (const [type, buttons] of [["pointerdown", 1], ["pointerup", 0]]) {
				canvas.dispatchEvent(new win.PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					isPrimary: true,
					pointerId: 1,
					pointerType: "mouse",
					button: 0,
					buttons,
					...point,
				}));
			}

			const changedEvent = new win.Event("beforeunload", { cancelable: true });
			win.dispatchEvent(changedEvent);
			expect(changedEvent.defaultPrevented).to.equal(true);
		});
	});
});
