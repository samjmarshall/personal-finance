import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CdrConnectionStatus } from "~/lib/constants";
import { formatDate } from "~/lib/utils";
import {
	CdrConnectionNotice,
	ClientConnectionNotice,
} from "./cdr-connection-notice";

describe("ClientConnectionNotice", () => {
	it("builds the notice in the browser, with the last sync in local time", () => {
		const lastSyncedAt = new Date("2026-10-21T18:00:00Z");
		render(
			<ClientConnectionNotice
				states={[
					{
						accountId: "acc_1",
						accountName: "Everyday",
						accountNumber: null,
						balance: null,
						balanceAsOf: null,
						connectionId: "con_1",
						connectionStatus: CdrConnectionStatus.Active,
						createdAt: new Date("2026-10-01T00:00:00Z"),
						highWaterMark: null,
						id: 1,
						inBalance: true,
						institutionName: null,
						lastError: "boom",
						lastSyncedAt,
						nickname: null,
						updatedAt: null,
					},
				]}
			/>,
		);
		expect(screen.getByRole("status")).toHaveTextContent(
			`Everyday hasn't synced since ${formatDate(lastSyncedAt)}.`,
		);
	});

	it("renders nothing when every account is healthy", () => {
		const { container } = render(<ClientConnectionNotice states={[]} />);
		expect(container).toBeEmptyDOMElement();
	});
});

describe("CdrConnectionNotice", () => {
	it("renders a warn notice as a status", () => {
		render(
			<CdrConnectionNotice
				notice={{
					detail: "Everyday hasn't synced yet.",
					inRedBark: false,
					title: "Bank sync is behind",
					tone: "warn",
				}}
			/>,
		);
		const status = screen.getByRole("status");
		expect(status).toHaveTextContent("Bank sync is behind");
		expect(status).toHaveTextContent("Everyday hasn't synced yet.");
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("renders an alert notice as a status with the account names and reauthorize copy", () => {
		render(
			<CdrConnectionNotice
				notice={{
					detail:
						"Syncing has stopped for Everyday and Savings. Reauthorize in RedBark's dashboard and it picks up where it left off.",
					inRedBark: true,
					title: "Reauthorize your bank connection",
					tone: "alert",
				}}
			/>,
		);
		const status = screen.getByRole("status");
		expect(status).toHaveTextContent("Reauthorize your bank connection");
		expect(status).toHaveTextContent("Everyday and Savings");
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.getByRole("link", { name: "Open RedBark" })).toHaveAttribute(
			"href",
			"https://app.redbark.com",
		);
	});
});
