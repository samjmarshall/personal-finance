import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CdrSyncState } from "~/domain/cdr";
import { CdrConnectionStatus } from "~/lib/constants";
import { formatDate } from "~/lib/utils";
import {
	CdrConnectionNotice,
	ClientConnectionNotice,
} from "./cdr-connection-notice";

function account(overrides: Partial<CdrSyncState> = {}): CdrSyncState {
	return {
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
		lastError: null,
		lastSyncedAt: new Date(),
		nickname: null,
		updatedAt: null,
		...overrides,
	};
}

describe("ClientConnectionNotice", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("leaves the server HTML empty and builds the notice once hydrated", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const lastSyncedAt = new Date("2026-10-21T18:00:00Z");
		const ui = (
			<ClientConnectionNotice
				states={[account({ lastError: "boom", lastSyncedAt })]}
			/>
		);
		const container = document.createElement("div");
		container.innerHTML = renderToString(ui);
		expect(container).toBeEmptyDOMElement();
		document.body.appendChild(container);

		await act(async () => render(ui, { container, hydrate: true }));

		expect(screen.getByRole("status")).toHaveTextContent(
			`Everyday hasn't synced since ${formatDate(lastSyncedAt)}.`,
		);
		expect(errors).not.toHaveBeenCalled();
	});

	it("renders nothing when every account is healthy", () => {
		const { container } = render(
			<ClientConnectionNotice
				states={[account(), account({ accountId: "acc_2", id: 2 })]}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});
});

describe("CdrConnectionNotice", () => {
	it("renders a warn notice as a status", () => {
		render(
			<CdrConnectionNotice
				notice={{
					behind: "Everyday hasn't synced yet.",
					reauthorize: null,
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
					behind: null,
					reauthorize:
						"Syncing has stopped for Everyday and Savings. Reauthorize in RedBark's dashboard and it picks up where it left off.",
					title: "Reauthorize your bank connection",
					tone: "alert",
				}}
			/>,
		);
		const status = screen.getByRole("status");
		expect(status).toHaveTextContent("Reauthorize your bank connection");
		expect(status).toHaveTextContent("Everyday and Savings");
		expect(screen.queryByRole("alert")).toBeNull();
		expect(
			screen.getByRole("link", { name: "Open RedBark (opens in new tab)" }),
		).toHaveAttribute("href", "https://app.redbark.com");
	});

	it("puts the link with the reauthorize line and the behind lines after it", () => {
		render(
			<CdrConnectionNotice
				notice={{
					behind: "Savings hasn't synced yet.",
					reauthorize: "Everyday will lose access soon.",
					title: "Bank connection expiring",
					tone: "warn",
				}}
			/>,
		);
		const link = screen.getByRole("link", { name: /^Open RedBark/ });
		expect(link.closest("p")).toHaveTextContent(
			"Everyday will lose access soon.",
		);
		expect(link.closest("p")).not.toHaveTextContent("Savings");
		expect(screen.getByText("Savings hasn't synced yet.")).toBeInTheDocument();
	});
});
