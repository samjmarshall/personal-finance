import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Expect, WritesInto } from "~/test/type-contracts";
import {
	allowedSenderCreateDto,
	allowedSenderRefDto,
} from "./allowed-sender.dto";
import type { AllowedSender } from "./allowed-sender.interface";

// userId is server-set from the session, so it joins the parsed DTO to make the row.
type Contracts = [
	Expect<
		WritesInto<
			z.infer<typeof allowedSenderCreateDto> & { userId: string },
			AllowedSender
		>
	>,
];

describe("allowedSenderCreateDto", () => {
	it("accepts a valid address", () => {
		expect(
			allowedSenderCreateDto.safeParse({ email: "sam@example.com" }).success,
		).toBe(true);
	});

	// The stored value, the unique index and the webhook's lookup key are all this
	// shape, so normalising at the boundary is what makes them comparable.
	it("lower-cases and trims the address", () => {
		expect(
			allowedSenderCreateDto.parse({ email: "  Sam.M@Example.COM  " }).email,
		).toBe("sam.m@example.com");
	});

	it("rejects an empty address", () => {
		expect(allowedSenderCreateDto.safeParse({ email: "" }).success).toBe(false);
	});

	it("rejects non-email input", () => {
		expect(
			allowedSenderCreateDto.safeParse({ email: "not-an-email" }).success,
		).toBe(false);
		expect(allowedSenderCreateDto.safeParse({ email: "sam@" }).success).toBe(
			false,
		);
		expect(
			allowedSenderCreateDto.safeParse({ email: "@example.com" }).success,
		).toBe(false);
	});

	// Trim runs before validation, so whitespace alone can't sneak past z.email().
	it("rejects whitespace-only input", () => {
		expect(allowedSenderCreateDto.safeParse({ email: "   " }).success).toBe(
			false,
		);
	});

	it("requires the email field", () => {
		expect(allowedSenderCreateDto.safeParse({}).success).toBe(false);
	});
});

describe("allowedSenderRefDto", () => {
	it("accepts an integer id", () => {
		expect(allowedSenderRefDto.safeParse({ id: 1 }).success).toBe(true);
	});

	it("rejects a fractional or missing id", () => {
		expect(allowedSenderRefDto.safeParse({ id: 1.5 }).success).toBe(false);
		expect(allowedSenderRefDto.safeParse({}).success).toBe(false);
	});
});

describe("allowed sender DTO ↔ interface contract", () => {
	it("keeps the create DTO writable into the AllowedSender interface", () => {
		const aligned: Contracts = [true];
		expect(aligned).toHaveLength(1);
	});
});
