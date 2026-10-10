import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Globals are off, so the test library skips its auto-cleanup and act flag.
// Without the flag, React stays silent on updates made outside act.
afterEach(cleanup);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
