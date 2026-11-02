"use client";

import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { importEarliestDay, importRangeError } from "~/domain/cdr";
import { HOUSEHOLD_TIME_ZONE } from "~/lib/constants";
import { dayKeyInZone } from "~/lib/utils";
import { api } from "~/trpc/react";

/** The server re-checks the range; its refusals show as a global toast. */
export function ImportForm({ locked }: { locked: boolean }) {
	// The server's "today", so the To day's limit agrees with its check; fixed zone, so SSR agrees too.
	const [today] = useState(() => dayKeyInZone(new Date(), HOUSEHOLD_TIME_ZONE));
	const earliest = importEarliestDay(today);
	const [from, setFrom] = useState("");
	const [to, setTo] = useState(today);
	const [error, setError] = useState<string | null>(null);
	const importButton = useRef<HTMLButtonElement>(null);

	const utils = api.useUtils();
	// The status only polls while a run is active, so it needs a nudge to see the new one.
	// A refusal nudges too: "already running" means a run this page hasn't seen yet.
	const start = api.cdr.startImport.useMutation({
		// Show the new run now, not the last one until the refetch lands.
		onSuccess: (run) =>
			utils.cdr.latestImport.setData(undefined, { ...run, active: true }),
		onSettled: () => utils.cdr.latestImport.invalidate(),
	});
	// Lock from the click, not from the first refetch.
	const busy = locked || start.isPending;

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const rangeError = importRangeError(from, to, today);
		if (rangeError) return setError(rangeError);
		// TODO(observability): capture an import-started event, and alert when a run
		// ends Failed. Today a failure only shows on this page and in the logs.
		// Enter in a date field submits too, and the fields lock once the run starts:
		// without this, focus falls to the page.
		importButton.current?.focus();
		start.mutate({ from, to });
	}

	const clearError = () => {
		if (error) setError(null);
	};

	return (
		<form noValidate onSubmit={onSubmit}>
			<div className="grid gap-3 min-[22.5rem]:grid-cols-2">
				<Field>
					<FieldLabel htmlFor="import-from">From</FieldLabel>
					<Input
						aria-describedby={error ? "import-range-error" : undefined}
						aria-invalid={error ? true : undefined}
						disabled={busy}
						id="import-from"
						max={to || today}
						min={earliest}
						onChange={(e) => {
							setFrom(e.target.value);
							clearError();
						}}
						required
						type="date"
						value={from}
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor="import-to">To</FieldLabel>
					<Input
						aria-describedby={error ? "import-range-error" : undefined}
						aria-invalid={error ? true : undefined}
						disabled={busy}
						id="import-to"
						max={today}
						min={from || earliest}
						onChange={(e) => {
							setTo(e.target.value);
							clearError();
						}}
						required
						type="date"
						value={to}
					/>
				</Field>
			</div>
			<FieldError className="mt-2" id="import-range-error">
				{error}
			</FieldError>
			<div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
				<Button
					aria-describedby="import-note"
					className="w-24"
					disabled={busy}
					// Stays focusable while locked: keeps focus after a start and lets a keyboard user hear why.
					focusableWhenDisabled
					loading={start.isPending}
					ref={importButton}
					type="submit"
				>
					Import
				</Button>
				<p className="text-xs text-muted-foreground" id="import-note">
					{busy
						? "An import is running. You can start another when it's done."
						: "Safe to run again. It only adds what's missing, and it never deletes."}
				</p>
			</div>
		</form>
	);
}
