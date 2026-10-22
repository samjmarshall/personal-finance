import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CdrConnectionNotice } from "./cdr-connection-notice";

describe("CdrConnectionNotice", () => {
	it("renders a warn notice as a status", () => {
		render(
			<CdrConnectionNotice
				notice={{
					detail: "Everyday hasn't synced yet.",
					title: "Bank sync is behind",
					tone: "warn",
				}}
			/>,
		);
		const status = screen.getByRole("status");
		expect(status).toHaveTextContent("Bank sync is behind");
		expect(status).toHaveTextContent("Everyday hasn't synced yet.");
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("renders an alert notice as an alert with the account names and reauthorize copy", () => {
		render(
			<CdrConnectionNotice
				notice={{
					detail: "Syncing has stopped for Everyday, Savings. Reauthorize it.",
					title: "Reauthorize your bank connection",
					tone: "alert",
				}}
			/>,
		);
		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent("Reauthorize your bank connection");
		expect(alert).toHaveTextContent("Everyday, Savings");
		expect(screen.queryByRole("status")).toBeNull();
	});
});
