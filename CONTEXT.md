# Household Finance

A private ledger for one household: what money is committed to go out, what is expected to
come in, and what actually moved.

## Language

### Money direction

**Inflow**:
Money arriving in the household.
_Avoid_: positive, credit, revenue

**Spend**:
Money leaving the household.
_Avoid_: negative, debit, cost

**Destructive**:
An irreversible operation on a record. Unrelated to money direction — deleting a Category is
destructive, buying groceries is not.
_Avoid_: danger, danger-zone

### Records

**Transaction**:
A dated record of money that actually moved.

**Expense**:
A standing commitment to Spend, held as a per-fortnight, per-month and per-year figure at once.
_Avoid_: bill, cost, outgoing

**Income**:
A standing expectation of Inflow, attributed to a person and a named source.
_Avoid_: salary, earnings

**Expense Category**:
A named grouping maintained by the household, used to file both Expenses and Transactions.
Despite the name it is the single category vocabulary, not an Expense-only one.
_Avoid_: type, bucket, tag

### Attributes

**Basis**:
The cadence a figure was entered at — fortnight, month or year. An Expense or Income is
entered against one Basis, and the other two figures are derived from it.
_Avoid_: period, interval, term

**Priority**:
How essential a Transaction was, from "Must Have" down to "Nice to Have", plus two
non-ranking values: "Fix" for something to correct, and "VERIFY - possible fraud" for
something to investigate.
_Avoid_: importance, severity

**Frequency**:
Whether a Transaction is "Recurring" or "One-off".

## Relationships

- A **Household** owns every **Expense**, **Income**, **Transaction** and **Expense Category**
- An **Expense** is filed under exactly one **Expense Category**
- A **Transaction** is filed under exactly one **Expense Category**
- An **Income** belongs to exactly one person
- A **Transaction** carries one **Priority** and one **Frequency**
- An **Expense** and an **Income** each carry three figures derived from a single **Basis**

## Example dialogue

> **Dev:** "A **Transaction** has an amount. If someone refunds me forty dollars, do I store
> that as forty or minus forty?"
>
> **Domain expert:** "Minus forty. The ledger reads from the household's side, so an ordinary
> purchase is a positive number — money going out. A refund runs the other way, so it's
> negative."
>
> **Dev:** "So a positive amount is a **Spend**, and a negative amount is an **Inflow**?"
>
> **Domain expert:** "Right. Which is why I don't call the green one 'positive' — a positive
> amount is the red one."
>
> **Dev:** "And the category on a **Transaction** — is that the same list as the
> **Expense Categories**?"
>
> **Domain expert:** "Same list, yes. I maintain it in one place. If a purchase doesn't fit
> anything, I add the category there first, then file the purchase under it."
>
> **Dev:** "So I can't invent one while entering a purchase?"
>
> **Domain expert:** "No, and I don't want to — that's how I ended up with 'groceries',
> 'Groceries' and 'food shop' meaning the same thing."

## Flagged ambiguities

- **"positive"** was used for both the sign of an amount and for money coming in — and they
  mean opposite things. A positive `amount` is a **Spend**. Resolved: **Inflow** is the term
  for money arriving; "positive" refers only to the sign of a number, never to direction.
- **"category"** was used for both **Expense Category** and the label on a **Transaction**.
  Resolved: there is one vocabulary, and **Expense Category** is it. A Transaction is filed
  under an **Expense Category**, chosen from the maintained list — new categories are created
  on the Categories page, never invented mid-entry. The name "Expense Category" is a
  historical narrowing; it governs Transactions too.
  The list governs what can be *chosen*, not what is *held* — categories are stored as text
  labels, so "filed under" is a rule the household keeps, not one the database enforces.
- **"amount"** on an **Expense** or **Income** is three figures, not one. Resolved: they are
  derived from a single entered figure and its **Basis**, so they never disagree; there is no
  independent "fortnightly amount" to set.
- **Household** is domain language today, not a boundary in the data — the records are
  unscoped, and household scoping is planned. Resolved: use the term freely in conversation;
  do not assume it is enforced.
