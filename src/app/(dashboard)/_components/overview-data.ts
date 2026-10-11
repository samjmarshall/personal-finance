import "server-only";

import { cache } from "react";

import { api } from "~/trpc/server";

// Sections stream on their own, so two can need the same call. `cache` makes it
// one call per request.
export const getSummary = cache(() => api.transaction.summary());
export const getExpenses = cache(() => api.expense.list());
export const getIncome = cache(() => api.income.list());
