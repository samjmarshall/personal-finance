import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CurrentApply } from "~/domain/transactions";
import { DuplicateApplyStatus } from "~/lib/constants";
import { ApplyToast } from "./apply-toast";

const APPLY: CurrentApply = {
	id: 7,
	status: DuplicateApplyStatus.Running,
	total: 200,
	applied: 120,
	taken: 0,
	gone: 0,
	error: null,
	createdAt: new Date("2026-11-04T00:00:00.000Z"),
	updatedAt: new Date("2026-11-04T00:01:00.000Z"),
	finishedAt: null,
	active: true,
	pending: 80,
};

describe("ApplyToast", () => {
	it("shows a running Apply's progress without announcing each tick", () => {
		render(<ApplyToast apply={APPLY} onClose={() => {}} phase="running" />);

		expect(screen.getByText("Applying answers")).toBeInTheDocument();
		const bar = screen.getByRole("progressbar", { name: "Applying answers" });
		expect(bar).toHaveAttribute("aria-valuemin", "0");
		expect(bar).toHaveAttribute("aria-valuenow", "120");
		expect(bar).toHaveAttribute("aria-valuemax", "200");
		expect(bar).toHaveAttribute("aria-valuetext", "120 of 200");
		expect(screen.getByText("120 of 200")).toHaveAttribute(
			"aria-hidden",
			"true",
		);
	});

	it.each([
		[
			"success",
			{ applied: 200, pending: 0, status: DuplicateApplyStatus.Done },
			"Applied 200 answers.",
		],
		[
			"warning",
			{
				applied: 198,
				gone: 2,
				pending: 0,
				status: DuplicateApplyStatus.Done,
			},
			"Applied 198 answers. 2 no longer needed an answer.",
		],
	] as const)("shows the %s copy", (phase, counts, copy) => {
		render(
			<ApplyToast
				apply={{ ...APPLY, ...counts, active: false }}
				onClose={() => {}}
				phase={phase}
			/>,
		);

		expect(screen.getByText(copy)).toBeInTheDocument();
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
	});

	it("says where a failed Apply stopped and links to the rows left", () => {
		render(
			<ApplyToast
				apply={{
					...APPLY,
					status: DuplicateApplyStatus.Failed,
					active: false,
				}}
				onClose={() => {}}
				phase="error"
			/>,
		);

		expect(
			screen.getByText("Stopped at 120 of 200. 80 answers didn't apply."),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute(
			"href",
			"/transactions/import",
		);
	});

	// Its rows came back blank, so the Member is told where to find them.
	it("links a warning with taken rows to them", () => {
		render(
			<ApplyToast
				apply={{
					...APPLY,
					applied: 199,
					taken: 1,
					pending: 0,
					status: DuplicateApplyStatus.Done,
					active: false,
				}}
				onClose={() => {}}
				phase="warning"
			/>,
		);

		expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute(
			"href",
			"/transactions/import",
		);
	});

	it("closes when the Member follows Review", async () => {
		const onClose = vi.fn();
		render(
			<ApplyToast
				apply={{
					...APPLY,
					status: DuplicateApplyStatus.Failed,
					active: false,
				}}
				onClose={onClose}
				phase="error"
			/>,
		);

		await userEvent.setup().click(screen.getByRole("link", { name: "Review" }));

		expect(onClose).toHaveBeenCalledOnce();
	});

	it.each(["running", "success", "error"] as const)(
		"closes from the %s state",
		async (phase) => {
			const onClose = vi.fn();
			render(<ApplyToast apply={APPLY} onClose={onClose} phase={phase} />);

			await userEvent
				.setup()
				.click(screen.getByRole("button", { name: "Close" }));

			expect(onClose).toHaveBeenCalledOnce();
		},
	);
});
