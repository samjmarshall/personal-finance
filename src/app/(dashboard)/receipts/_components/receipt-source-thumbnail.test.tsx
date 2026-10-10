import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText, ImageOff, Mail } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import {
	previewIcon,
	ReceiptSourceThumbnail,
} from "./receipt-source-thumbnail";

const SRC = "/api/receipts/7/image";

function renderThumbnail(contentType: string | null) {
	const onOpen = vi.fn();
	render(
		<ReceiptSourceThumbnail
			contentType={contentType}
			onOpen={onOpen}
			src={SRC}
		/>,
	);
	return { onOpen };
}

describe("previewIcon", () => {
	it.each([
		["image/jpeg", null],
		["application/pdf", FileText],
		["text/html", Mail],
		[null, ImageOff],
		["image/gif", ImageOff],
	])("%s → %o", (contentType, icon) => {
		expect(previewIcon(contentType)).toBe(icon);
	});
});

describe("ReceiptSourceThumbnail", () => {
	it("image: a button holding the real image opens the viewer", async () => {
		const user = userEvent.setup();
		const { onOpen } = renderThumbnail("image/jpeg");

		const button = screen.getByRole("button", { name: "Open full receipt" });
		expect(button.querySelector("img")).toHaveAttribute("src", SRC);

		await user.click(button);
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("image: a failed load says so in place of the image, keeping the button", () => {
		renderThumbnail("image/jpeg");
		const button = screen.getByRole("button", { name: "Open full receipt" });

		fireEvent.error(button.querySelector("img") as HTMLImageElement);

		expect(button.querySelector("img")).toBeNull();
		expect(button).toHaveTextContent("Preview unavailable");
		expect(
			screen.getByRole("button", {
				name: "Preview unavailable. Open full receipt",
			}),
		).toBeInTheDocument();
	});

	it.each([
		["application/pdf", "Open PDF receipt", "PDF receipt"],
		["text/html", "Open email receipt", "Email receipt"],
	])(
		"%s: a named button with a label and no image",
		async (contentType, name, label) => {
			const user = userEvent.setup();
			const { onOpen } = renderThumbnail(contentType);

			const button = screen.getByRole("button", { name });
			expect(button).toHaveTextContent(label);
			expect(button.querySelector("img")).toBeNull();

			await user.click(button);
			expect(onOpen).toHaveBeenCalledTimes(1);
		},
	);

	it.each([null, "image/gif"])(
		"%s: no preview and nothing to open",
		(contentType) => {
			renderThumbnail(contentType);

			expect(screen.queryByRole("button")).toBeNull();
			expect(screen.getByText("No preview")).toBeInTheDocument();
		},
	);

	it("image: the open-in-viewer overlay is hidden from assistive tech", () => {
		renderThumbnail("image/jpeg");
		const button = screen.getByRole("button", { name: "Open full receipt" });

		const icons = button.querySelectorAll("svg");
		expect(icons).toHaveLength(1);
		expect(icons[0]).toHaveAttribute("aria-hidden", "true");
	});

	it("is reachable by Tab", async () => {
		const user = userEvent.setup();
		renderThumbnail("application/pdf");

		await user.tab();

		expect(
			screen.getByRole("button", { name: "Open PDF receipt" }),
		).toHaveFocus();
	});
});
