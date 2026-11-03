// adr025: a linked Expense sets the Category. The form picks Category first,
// so each pick below keeps the pair agreeing with that rule.

type Linkable = { id: number; categoryId: number };

export type CategoryLink = {
	categoryId: number | null;
	expenseId: number | null;
};

/** Expenses filed under `categoryId`; all of them when it is null. */
export function expensesInCategory<T extends Linkable>(
	expenses: readonly T[],
	categoryId: number | null,
): T[] {
	if (categoryId === null) return [...expenses];

	return expenses.filter((e) => e.categoryId === categoryId);
}

/** Drops a linked Expense that is not in the picked Category. */
export function pickCategory(
	link: CategoryLink,
	categoryId: number | null,
	expenses: readonly Linkable[],
): CategoryLink {
	const linked = expenses.find((e) => e.id === link.expenseId);
	const stays = linked !== undefined && linked.categoryId === categoryId;

	return { categoryId, expenseId: stays ? link.expenseId : null };
}

/** Takes the picked Expense's Category. Unlinking keeps the Category shown. */
export function pickExpense(
	link: CategoryLink,
	expenseId: number | null,
	expenses: readonly Linkable[],
): CategoryLink {
	const picked = expenses.find((e) => e.id === expenseId);

	return {
		categoryId: picked?.categoryId ?? link.categoryId,
		expenseId,
	};
}
