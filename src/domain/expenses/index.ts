import {
	type ExpenseCreateInput,
	type ExpenseUpdateInput,
	expenseCreateDto,
	expenseUpdateDto,
} from "./expense.dto";
import type { Expense } from "./expense.interface";

export type { Expense, ExpenseCreateInput, ExpenseUpdateInput };
export { expenseCreateDto, expenseUpdateDto };
