// One home for the key, so the reader, the writer and the cash-flow query can't
// drift apart. Not in settings.schema.ts — that file is Drizzle tables only, and
// db/index.ts spreads it straight into drizzle({ schema }).
export const FORTNIGHT_ANCHOR_KEY = "fortnightAnchor";
