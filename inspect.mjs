import { read, utils } from "xlsx";
import { readFileSync } from "node:fs";

const buf = readFileSync("docs/budget.xlsx");
const wb = read(buf, { cellDates: true });

for (const name of ["Expenses", "Income", "Transaction History"]) {
	const rows = utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, blankrows: false });
	console.log(`\n===== SHEET: ${name} (${rows.length} rows) =====`);
	const limit = name === "Transaction History" ? 15 : rows.length;
	rows.slice(0, limit).forEach((r, i) => {
		// trim trailing nulls
		let end = r.length;
		while (end > 0 && r[end - 1] === null) end--;
		console.log(i, JSON.stringify(r.slice(0, end)));
	});
	if (name === "Transaction History") console.log(`... (${rows.length} total rows)`);
}
