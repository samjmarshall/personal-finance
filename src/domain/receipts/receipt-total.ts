// Absorbs floating-point/rounding drift when summing line items; a real
// discrepancy (missed or misread item) is dollars, far past this.
const TOLERANCE = 0.01;

interface PricedItem {
	price: number;
	quantity: number;
}

/**
 * True when the line items don't add up to the receipt total — a soft heads-up
 * badge, never a failure (design error-handling). With no total or no items there
 * is nothing to reconcile, so it never badges.
 */
export function itemsTotalMismatch(
	total: number | null,
	items: PricedItem[],
): boolean {
	if (total === null || items.length === 0) return false;
	const sum = items.reduce((acc, i) => acc + i.price * i.quantity, 0);
	return Math.abs(sum - total) > TOLERANCE;
}
