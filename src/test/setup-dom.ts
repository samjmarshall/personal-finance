import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// RTL auto-cleans and sets the act flag only when Vitest globals are on; they're
// off. Without the flag, a stray update outside act (load handler) warns nothing.
afterEach(cleanup);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
