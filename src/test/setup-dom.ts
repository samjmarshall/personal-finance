import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// RTL registers both of these itself only when Vitest `globals` is on, and it is
// off here. Without the flag, a state update outside RTL's own `act` (a Base UI
// transition, an img/iframe load handler) logs no "not wrapped in act" warning.
afterEach(cleanup);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
