import "server-only";

import { cache } from "react";

import { api } from "~/trpc/server";

// Sections stream apart but can share a call. Dedupe to one call per request.
export const getSummary = cache(() => api.transaction.summary());
export const getExpenses = cache(() => api.expense.list());
export const getIncome = cache(() => api.income.list());
