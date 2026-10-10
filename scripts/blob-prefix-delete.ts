// Empties a branch's Blob prefix on teardown (adr028): `make db_branch_delete`
// and teardown.yml. Run as `node scripts/blob-prefix-delete.ts <prefix>...`;
// Node strips the types, so imports keep their `.ts` extension.
import { del, list } from "@vercel/blob";

import { isBranchPrefix } from "../src/server/blob-store/blob-prefix.ts";

// `local/` and `preview/` alone empty every branch of that kind (`delete --all`).
// Anything else, `""` above all, reaches production's files.
function deletable(prefix: string): boolean {
	return isBranchPrefix(prefix) || prefix === "local/" || prefix === "preview/";
}

const prefixes = process.argv.slice(2);
if (prefixes.length === 0 || !prefixes.every(deletable)) {
	console.error(
		`[blob-prefix-delete] refusing ${JSON.stringify(prefixes)}: each prefix must be local/<branch>/, preview/<branch>/, local/ or preview/`,
	);
	process.exit(1);
}

for (const prefix of prefixes) {
	let deleted = 0;
	let cursor: string | undefined;
	do {
		const page = await list({ prefix, cursor });
		if (page.blobs.length > 0) {
			await del(page.blobs.map((blob) => blob.url));
			deleted += page.blobs.length;
		}
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	console.log(`[blob-prefix-delete] ${prefix}: deleted ${deleted} blob(s)`);
}
