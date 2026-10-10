import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReceiptViewer } from "./receipt-viewer";

function renderViewer({
	contentType = "image/jpeg",
	open = true,
	receiptId = 7,
	vendor = "Woolies",
}: {
	contentType?: string | null;
	open?: boolean;
	receiptId?: number;
	vendor?: string | null;
} = {}) {
	const onOpenChange = vi.fn();
	const props = {
		contentType,
		onOpenChange,
		open,
		receiptId,
		vendor,
	};
	const view = render(<ReceiptViewer {...props} />);
	return { ...view, onOpenChange, props };
}

// jsdom lacks this flag, so each PDF case sets one.
function stubPdfViewer(value: boolean) {
	Object.defineProperty(navigator, "pdfViewerEnabled", {
		configurable: true,
		value,
	});
}

afterEach(() => {
	Reflect.deleteProperty(navigator, "pdfViewerEnabled");
});

describe("ReceiptViewer", () => {
	it("renders nothing while closed", () => {
		renderViewer({ open: false });

		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("image: shows the receipt with a loading status until it loads", () => {
		renderViewer({ contentType: "image/jpeg" });

		expect(screen.getByRole("dialog", { name: "Woolies" })).toBeInTheDocument();
		const img = screen.getByRole("img", { name: "Receipt from Woolies" });
		expect(img).toHaveAttribute("src", "/api/receipts/7/image");
		expect(
			screen.getByRole("status", { name: "Loading receipt" }),
		).toBeInTheDocument();

		fireEvent.load(img);

		expect(
			screen.queryByRole("status", { name: "Loading receipt" }),
		).toBeNull();
	});

	it("image: with no vendor, names it plainly rather than 'Receipt from Receipt'", () => {
		renderViewer({ contentType: "image/jpeg", vendor: " " });

		expect(screen.getByRole("dialog", { name: "Receipt" })).toBeInTheDocument();
		expect(
			screen.getByRole("img", { name: "Receipt image" }),
		).toBeInTheDocument();
	});

	it("image: a new-tab link opens it full size, for zoom", () => {
		renderViewer({ contentType: "image/jpeg" });

		const link = screen.getByRole("link", { name: "Open in new tab" });
		expect(link).toHaveAttribute("href", "/api/receipts/7/image");
		expect(link).toHaveAttribute("target", "_blank");
	});

	it("image: the scroll box takes focus, so a keyboard can scroll a tall receipt", () => {
		renderViewer({ contentType: "image/jpeg" });

		const region = screen.getByRole("region", { name: "Receipt image" });
		region.focus();

		expect(region).toHaveFocus();
	});

	it("image: a failed load says so in place of the image", () => {
		renderViewer({ contentType: "image/jpeg" });

		fireEvent.error(screen.getByRole("img", { name: "Receipt from Woolies" }));

		expect(screen.getByRole("alert")).toHaveTextContent(
			"Couldn't load this receipt.",
		);
		expect(screen.queryByRole("img")).toBeNull();
		expect(screen.queryByRole("status")).toBeNull();
		// It would open the same broken URL.
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("pdf: frames the PDF unsandboxed beside a new-tab link", () => {
		stubPdfViewer(true);
		renderViewer({ contentType: "application/pdf" });

		const frame = screen.getByTitle("Receipt PDF");
		expect(frame).toHaveAttribute("src", "/api/receipts/7/image");
		expect(frame).not.toHaveAttribute("sandbox");
		const link = screen.getByRole("link", { name: "Open in new tab" });
		expect(link).toHaveAttribute("href", "/api/receipts/7/image");
		expect(link).toHaveAttribute("target", "_blank");
	});

	// Keys pressed inside a frame never reach the dialog, so Escape would do nothing.
	it.each([
		["pdf", "application/pdf", "Receipt PDF"],
		["email", "text/html", "Emailed receipt"],
	])(
		"%s: opens with focus on the dialog, not inside the frame",
		async (_kind, contentType, title) => {
			stubPdfViewer(true);
			renderViewer({ contentType });

			await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
			expect(screen.getByTitle(title)).not.toHaveFocus();
		},
	);

	it("pdf: with no in-browser viewer, says why and offers the new-tab link", () => {
		stubPdfViewer(false);
		renderViewer({ contentType: "application/pdf" });

		expect(
			screen.getByText("Preview isn't available on this device."),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Open in new tab" }),
		).toHaveAttribute("href", "/api/receipts/7/image");
		expect(screen.queryByTitle("Receipt PDF")).toBeNull();
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("email: frames the body in a token-less sandbox, spinner until load", () => {
		renderViewer({ contentType: "text/html" });

		// New-tab and mailto links die silently in the sandbox, so say so up front.
		expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
			"Original email. Remote images, scripts and most links are blocked.",
		);
		const frame = screen.getByTitle("Emailed receipt");
		expect(frame).toHaveAttribute("src", "/api/receipts/7/html");
		// Empty, so neither allow-scripts nor allow-same-origin (adr019).
		expect(frame.getAttribute("sandbox")).toBe("");
		expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
		expect(
			screen.getByRole("status", { name: "Loading receipt" }),
		).toBeInTheDocument();

		fireEvent.load(frame);

		expect(screen.queryByRole("status")).toBeNull();
	});

	it("email: a new-tab link opens it wide enough for a phone", () => {
		renderViewer({ contentType: "text/html" });

		const link = screen.getByRole("link", { name: "Open in new tab" });
		expect(link).toHaveAttribute("href", "/api/receipts/7/html");
		expect(link).toHaveAttribute("target", "_blank");
	});

	it("unknown type: says it can't load rather than guessing", () => {
		renderViewer({ contentType: "image/gif" });

		expect(screen.getByRole("alert")).toHaveTextContent(
			"Couldn't load this receipt.",
		);
		expect(screen.queryByRole("img")).toBeNull();
	});

	it("Close asks the owner to close", async () => {
		const user = userEvent.setup();
		const { onOpenChange } = renderViewer();

		await user.click(screen.getByRole("button", { name: "Close" }));

		// Base UI passes event details too, so pin only the first argument.
		expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
	});

	it("switching receipts starts loading afresh", () => {
		const { props, rerender } = renderViewer({ contentType: "text/html" });
		fireEvent.load(screen.getByTitle("Emailed receipt"));
		expect(screen.queryByRole("status")).toBeNull();

		rerender(<ReceiptViewer {...props} receiptId={8} />);

		expect(screen.getByTitle("Emailed receipt")).toHaveAttribute(
			"src",
			"/api/receipts/8/html",
		);
		expect(
			screen.getByRole("status", { name: "Loading receipt" }),
		).toBeInTheDocument();
	});
});
