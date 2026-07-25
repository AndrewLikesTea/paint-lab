// @ts-check

import { OnCanvasObject } from "./OnCanvasObject.js";
import { make_canvas } from "./helpers.js";

class OnCanvasHelperLayer extends OnCanvasObject {
	/**
	 * @param {number} x
	 * @param {number} y
	 * @param {number} width
	 * @param {number} height
	 * @param {boolean} hideMainCanvasHandles
	 */
	constructor(x, y, width, height, hideMainCanvasHandles) {
		super(x, y, width, height, hideMainCanvasHandles);

		this.$el.addClass("helper-layer");
		this.$el.css({
			pointerEvents: "none",
		});
		this.position();
		this.canvas = make_canvas(this.width, this.height);
		this.$el.append(this.canvas);
	}
}

export { OnCanvasHelperLayer };
