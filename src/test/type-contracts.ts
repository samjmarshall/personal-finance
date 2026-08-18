/**
 * Compile-time type-contract assertions shared by the schema and DTO contract
 * tests. Type-only: erased at runtime, and this is not a *.test.ts so vitest never
 * collects it. A failing assertion errors under `tsc --noEmit` (`make check`), not
 * at runtime.
 */

// Expect<false> violates the `extends true` constraint, so tsc --noEmit errors.
export type Expect<T extends true> = T;

// Exact type-equality: resolves `false` on any structural or nullability drift
// between the two sides. Distinguishes optional/nullable and extra/missing keys.
export type Equal<X, Y> =
	(<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
		? true
		: false;

// A parsed create/update DTO must be writable into its interface: every DTO key is
// an interface key (no phantom input field) and each field's parsed type fits the
// interface field. Optionality-agnostic — DTOs make fields optional and omit
// server-managed columns — so the interface side is Partial<>; this pins field
// types, not requiredness. On drift (e.g. an enum loosened to string) WritesInto
// resolves false, making the Expect<> element error under `make check` typecheck.
export type WritesInto<Dto, Iface> = keyof Dto extends keyof Iface
	? Dto extends Partial<Pick<Iface, keyof Dto & keyof Iface>>
		? true
		: false
	: false;
