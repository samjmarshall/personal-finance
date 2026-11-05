import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster, toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentApply } from "~/domain/transactions";
import { DuplicateApplyStatus } from "~/lib/constants";
import { ApplyToasts } from "./apply-progress";

// Sonner's store outlives a test and replays live toasts to a new <Toaster />.
afterEach(() => {
	toast.dismiss();
});

// A close dismisses a frame later, so a shared id could hit the next test's toast.
let nextId = 0;
beforeEach(() => {
	nextId += 1;
});

function running(overrides: Partial<CurrentApply> = {}): CurrentApply {
	return {
		id: nextId,
		status: DuplicateApplyStatus.Running,
		total: 200,
		applied: 50,
		taken: 0,
		gone: 0,
		error: null,
		createdAt: new Date("2026-11-04T00:00:00.000Z"),
		updatedAt: new Date("2026-11-04T00:01:00.000Z"),
		finishedAt: null,
		active: true,
		pending: 150,
		...overrides,
	};
}

const done = (overrides: Partial<CurrentApply> = {}) =>
	running({
		status: DuplicateApplyStatus.Done,
		active: false,
		applied: 200,
		pending: 0,
		...overrides,
	});

function renderToasts(apply: CurrentApply | null) {
	const onFinished = vi.fn();
	const view = render(
		<>
			<ApplyToasts apply={apply} onFinished={onFinished} />
			<Toaster theme="light" />
		</>,
	);

	return {
		onFinished,
		tick: (next: CurrentApply | null) =>
			view.rerender(
				<>
					<ApplyToasts apply={next} onFinished={onFinished} />
					<Toaster theme="light" />
				</>,
			),
	};
}

// Sonner adds and drops toasts on a timer, so a missing one needs a beat to be sure.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("ApplyToasts", () => {
	it("shows a running Apply and updates it in place", async () => {
		const first = running();
		const { tick } = renderToasts(first);

		expect(
			await screen.findByRole("progressbar", { name: "Applying answers" }),
		).toHaveAttribute("aria-valuetext", "50 of 200");

		tick({ ...first, applied: 120, pending: 80 });

		await waitFor(() =>
			expect(screen.getByRole("progressbar")).toHaveAttribute(
				"aria-valuetext",
				"120 of 200",
			),
		);
		expect(screen.getAllByRole("progressbar")).toHaveLength(1);
	});

	it("shows at the top, clear of the Import page's sticky Apply bar", async () => {
		renderToasts(running());

		const toastItem = (await screen.findByRole("progressbar")).closest(
			"[data-sonner-toast]",
		);

		expect(toastItem).toHaveAttribute("data-y-position", "top");
		expect(toastItem).toHaveAttribute("data-x-position", "center");
	});

	it("keeps a closed toast closed on later ticks, then still shows the finish", async () => {
		const first = running();
		const { tick } = renderToasts(first);

		await userEvent
			.setup()
			.click(await screen.findByRole("button", { name: "Close" }));
		await waitFor(() =>
			expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(),
		);

		tick({ ...first, applied: 120, pending: 80 });
		await settle();
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

		tick(done({ id: first.id }));
		expect(await screen.findByText("Applied 200 answers.")).toBeInTheDocument();
	});

	it.each([
		["success", {}, "Applied 200 answers."],
		[
			"warning",
			{ applied: 199, taken: 1 },
			"Applied 199 answers. 1 still needs an answer: the bank's row is already in your transactions.",
		],
		[
			"error",
			{ status: DuplicateApplyStatus.Failed, applied: 120, pending: 80 },
			"Stopped at 120 of 200. 80 answers didn't apply.",
		],
	] as const)(
		"shows the %s finish once it saw the Apply run",
		async (_, end, copy) => {
			const first = running();
			const { tick, onFinished } = renderToasts(first);
			await screen.findByRole("progressbar");

			tick(done({ id: first.id, ...end }));

			expect(await screen.findByText(copy)).toBeInTheDocument();
			expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
			expect(onFinished).toHaveBeenCalledOnce();

			// A later poll of the same finished Apply changes nothing.
			tick(done({ id: first.id, ...end }));
			expect(onFinished).toHaveBeenCalledOnce();
		},
	);

	it("shows nothing for an Apply that finished before this render", async () => {
		const { onFinished } = renderToasts(done());

		await settle();

		expect(screen.queryByText("Applied 200 answers.")).not.toBeInTheDocument();
		expect(onFinished).not.toHaveBeenCalled();
	});

	// Another tab can start the next Apply before this one's end is polled.
	it("drops a running toast once a newer Apply takes over", async () => {
		const first = running();
		const { tick, onFinished } = renderToasts(first);
		await screen.findByRole("progressbar");

		tick(running({ id: first.id + 1000, applied: 0, pending: 200 }));

		await waitFor(() =>
			expect(screen.getByRole("progressbar")).toHaveAttribute(
				"aria-valuetext",
				"0 of 200",
			),
		);
		expect(screen.getAllByRole("progressbar")).toHaveLength(1);
		expect(onFinished).toHaveBeenCalledOnce();
	});
});
