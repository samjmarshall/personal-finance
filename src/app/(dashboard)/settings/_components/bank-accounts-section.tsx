"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { CdrSyncState } from "~/domain/cdr";
import { api } from "~/trpc/react";
import { BankAccountRow } from "./bank-account-row";
import {
	cashTotal,
	formatBalance,
	groupByBank,
	newAccountsNote,
	totalNote,
} from "./bank-accounts.display";
import { SettingsSection } from "./settings-section";

const SAVE_QUEUE = "bank-account-settings";

export function BankAccountsSection() {
	const [accounts] = api.cdr.syncState.useSuspenseQuery();
	const utils = api.useUtils();
	const queryClient = useQueryClient();

	const putRow = (accountId: string, change: Partial<CdrSyncState>) =>
		utils.cdr.syncState.setData(undefined, (rows) =>
			rows?.map((row) =>
				row.accountId === accountId ? { ...row, ...change } : row,
			),
		);
	// One queue keeps saves in click order; only the last puts its row in, or an
	// old value flashes. On error a refetch undoes the guess (toast: src/trpc/query-client.ts).
	const settle = {
		scope: { id: SAVE_QUEUE },
		onSuccess: (row: CdrSyncState) => {
			const queued = queryClient.isMutating({
				predicate: (m) => m.options.scope?.id === SAVE_QUEUE,
			});
			if (queued === 1) putRow(row.accountId, row);
		},
		onError: () => utils.cdr.syncState.invalidate(),
	};
	const setInBalance = api.cdr.setInBalance.useMutation(settle);
	const setNickname = api.cdr.setNickname.useMutation(settle);

	// Shown at once, so the switch, the counts and the Total move with no wait.
	async function save(accountId: string, change: Partial<CdrSyncState>) {
		// Stop a refetch already on its way, or it lands the old row on top.
		await utils.cdr.syncState.cancel();
		putRow(accountId, change);
	}

	const total = cashTotal(accounts);
	const pending = newAccountsNote(accounts);

	return (
		<SettingsSection
			description="Your cash balance adds up every account switched on. Switched-off accounts still sync, they just aren't counted."
			title="Cash balance"
		>
			{accounts.length ? (
				<>
					{pending && (
						<p className="mt-4 rounded-md border border-[color:var(--badge-warn-border)] bg-[var(--badge-warn-bg)] px-3 py-2 font-medium text-[var(--badge-warn-fg)] text-sm">
							{pending}
						</p>
					)}
					<div className="mt-5 space-y-6">
						{groupByBank(accounts).map(({ bank, accounts: rows, counted }) => (
							<section aria-label={bank} key={bank}>
								<div className="flex items-baseline justify-between gap-3 px-1 pb-2">
									<h3 className="font-semibold text-foreground text-sm">
										{bank}
									</h3>
									<span className="shrink-0 text-muted-foreground text-xs">
										{counted} of {rows.length} counted
									</span>
								</div>
								<ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
									{rows.map((account) => (
										<BankAccountRow
											account={account}
											key={account.accountId}
											onInBalanceChange={async (inBalance) => {
												await save(account.accountId, { inBalance });
												setInBalance.mutate({
													accountId: account.accountId,
													inBalance,
												});
											}}
											onRename={async (nickname) => {
												await save(account.accountId, {
													nickname: nickname.trim() || null,
												});
												setNickname.mutate({
													accountId: account.accountId,
													nickname,
												});
											}}
										/>
									))}
								</ul>
							</section>
						))}
					</div>
					<div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
						<div className="min-w-0 flex-1">
							<p className="font-semibold text-foreground text-sm">Total</p>
							<p className="text-muted-foreground text-xs">
								{totalNote(accounts)}
							</p>
						</div>
						<p className="shrink-0 whitespace-nowrap font-semibold text-foreground text-sm tabular-nums">
							{total === null ? (
								<>
									<span aria-hidden="true">—</span>
									<span className="sr-only">Not counted yet</span>
								</>
							) : (
								formatBalance(total)
							)}
						</p>
						{/* Switch-wide, so the Total lines up under the balances. */}
						<span aria-hidden="true" className="w-8 shrink-0" />
					</div>
					{/* The sync writes the balance, so a change waits for its next run. */}
					<p className="mt-3 text-muted-foreground text-xs">
						Recounted at the next bank sync.
					</p>
				</>
			) : (
				<p className="mt-5 rounded-md border border-border border-dashed px-3 py-6 text-center text-muted-foreground text-sm">
					No bank accounts yet. They show here after the first bank sync.
				</p>
			)}
		</SettingsSection>
	);
}
