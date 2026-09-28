import { createAuthClient } from "better-auth/react";

// Default fetch, no traceparent: the server span is the trace root (adr020).
export const authClient = createAuthClient();

export type Session = typeof authClient.$Infer.Session;
