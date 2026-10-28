# Feature docs

Living, present-tense docs for shipped features. Each tells a future engineer what the feature does **today** and where in the code to look. Not design history — for that see [`thoughts/designs/`](../../thoughts/designs), [`thoughts/plans/`](../../thoughts/plans), and [`docs/adr/`](../adr).

Regenerate or add one with `/document-feature {slug}`.

## Index

- [History import](history-import.md) — pick a date range, and Ledger brings in your older bank history, up to 7 years back, without making copies of rows you already have.
- [Receipt trace diagnostics](receipt-trace-diagnostics.md) — shows a receipt's processing trace id and a one-click link to open that trace in PostHog.
