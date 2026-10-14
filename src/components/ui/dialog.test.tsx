import { render, screen } from "@testing-library/react";
import { Activity, useLayoutEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";

// A view that closes its dialog when its route hides, as the list views do.
function View() {
	const [open, setOpen] = useState(true);
	useLayoutEffect(() => () => setOpen(false), []);
	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogContent>
				<DialogTitle>Edit expense</DialogTitle>
			</DialogContent>
		</Dialog>
	);
}

describe("Dialog", () => {
	// A browser keeps a closing dialog until its fade ends. jsdom has no
	// animations, so it would drop it at once and hide the bug.
	beforeEach(() => {
		Element.prototype.getAnimations = () =>
			[{ finished: new Promise(() => {}) }] as unknown as Animation[];
	});
	afterEach(() => {
		delete (Element.prototype as Partial<Element>).getAnimations;
	});

	it("is gone, not fading out, when a hidden route shows again", () => {
		const route = (mode: "visible" | "hidden") => (
			<Activity mode={mode}>
				<View />
			</Activity>
		);
		const { rerender } = render(route("visible"));
		expect(screen.getByRole("dialog")).toBeInTheDocument();

		rerender(route("hidden"));
		rerender(route("visible"));

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});
