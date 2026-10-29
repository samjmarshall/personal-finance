import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LatestImport } from "~/domain/cdr";
import { CdrImportStatus } from "~/lib/constants";
import { ImportStatus } from "./import-status";

const RUN: LatestImport = {
	id: 7,
	fromDate: new Date("2026-01-01T00:00:00.000Z"),
	toDate: new Date("2026-03-31T00:00:00.000Z"),
	status: CdrImportStatus.Running,
	added: 1204,
	adopted: 3,
	flagged: 2,
	known: 40,
	error: null,
	createdAt: new Date("2026-10-28T00:00:00.000Z"),
	finishedAt: null,
	active: true,
};

describe("ImportStatus", () => {
	it("says there's no import yet", () => {
		render(<ImportStatus latest={null} />);

		expect(screen.getByText(/No imports yet/)).toBeInTheDocument();
	});

	it("shows a running import's range and counts so far", () => {
		render(<ImportStatus latest={RUN} />);

		expect(screen.getByText("Importing")).toBeInTheDocument();
		expect(screen.getByText("01 Jan 2026 – 31 Mar 2026")).toBeInTheDocument();
		for (const count of [
			"Added 1,204",
			"Matched to yours 3",
			"To review 2",
			"Already here 40",
		])
			expect(screen.getByText(count)).toBeInTheDocument();
	});

	// Counts change every poll; reading them out each time would drown the status.
	it("reads out only the status and any reason, never the counts", () => {
		const { rerender } = render(<ImportStatus latest={RUN} />);

		expect(screen.getByRole("status")).toHaveTextContent(
			/^Import status: Importing\.$/,
		);

		rerender(
			<ImportStatus
				latest={{
					...RUN,
					status: CdrImportStatus.Failed,
					active: false,
					error: "Bank sync isn't set up",
				}}
			/>,
		);

		expect(screen.getByRole("status")).toHaveTextContent(
			/^Import status: Failed\. Bank sync isn't set up$/,
		);
	});

	it("hides the counts while it waits to start", () => {
		render(
			<ImportStatus latest={{ ...RUN, status: CdrImportStatus.Queued }} />,
		);

		expect(screen.getByText("Waiting to start")).toBeInTheDocument();
		expect(screen.queryByText(/^Added/)).not.toBeInTheDocument();
	});

	it("shows why an import failed", () => {
		render(
			<ImportStatus
				latest={{
					...RUN,
					status: CdrImportStatus.Failed,
					active: false,
					error: "Bank sync isn't set up",
				}}
			/>,
		);

		expect(screen.getByText("Failed")).toBeInTheDocument();
		expect(screen.getByText("Bank sync isn't set up")).toBeInTheDocument();
	});

	it("skips the counts when a stopped import counted nothing", () => {
		render(
			<ImportStatus
				latest={{
					...RUN,
					status: CdrImportStatus.Failed,
					active: false,
					added: 0,
					adopted: 0,
					flagged: 0,
					known: 0,
				}}
			/>,
		);

		expect(screen.queryByText(/^Added/)).not.toBeInTheDocument();
	});

	it("keeps the counts when a stopped import got partway", () => {
		render(
			<ImportStatus
				latest={{ ...RUN, status: CdrImportStatus.Failed, active: false }}
			/>,
		);

		expect(screen.getByText("Added 1,204")).toBeInTheDocument();
	});

	it("calls a run that stopped without finishing what it is", () => {
		render(<ImportStatus latest={{ ...RUN, active: false }} />);

		expect(screen.getByText("Didn't finish")).toBeInTheDocument();
	});
});
