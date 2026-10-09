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
A commitment to Spend — either recurring (held as a per-fortnight, per-month and per-year
figure at once) or one-time (a single amount with an expected consumption date).
_Avoid_: bill, cost, outgoing, standing

**Unplanned**:
A Spend Transaction not linked to any Expense — a classification by absence, never a stored
record.
_Avoid_: unbudgeted, untracked, uncategorised

**Receipt**:
An evidence document — image, PDF or e-receipt — attributed to a Member, holding line items
and matched to at most one Transaction.
_Avoid_: invoice, attachment, upload

**Member**:
A person in the Household with a login; Receipts and Allowed Senders belong to a
Member. (An Income's "person" is a name, not a login — not the same thing.)
_Avoid_: user, account

**Allowed Sender**:
An email address a Member has approved to send in Receipts by email; the allowlist is the
whole set of them.
_Avoid_: whitelist

**Planned**:
A Spend Transaction linked to an Expense — the opposite of Unplanned; the Expenses page
carries this label in the nav.
_Avoid_: budgeted

**Income**:
An expectation of Inflow — recurring or one-time — attributed to a person and a named source.
_Avoid_: salary, earnings

**Category**:
A named grouping kept by the household, used to file Expenses, Transactions and Receipt line
items.
_Avoid_: expense category, type, bucket, tag

### Attributes

**Basis**:
The cadence a figure was entered at — fortnight, month or year. An Expense or Income is
entered against one Basis, and the other two figures are derived from it.
_Avoid_: period, interval, term

**Timing**:
When a commitment lands — an optional due day and due month on an Expense or Income, distinct
from Basis; an untimed commitment is treated as spread evenly.
_Avoid_: schedule

**Priority**:
How essential a Transaction was, from "Must Have" down to "Nice to Have", plus two
non-ranking values: "Fix" for something to correct, and "VERIFY - possible fraud" for
something to investigate.
_Avoid_: importance, severity

**Frequency**:
Whether a Transaction is "Recurring" or "One-off".

**Consumed**:
The net Spend of the Transactions linked to a one-time Expense, refunds netted.
_Avoid_: used, spent-to-date

**Remaining**:
A one-time Expense's amount minus its Consumed; below zero means over.
_Avoid_: left, balance

**Group**:
The household's own rough label on a Transaction, kept from the spreadsheet import to filter
and sort the imported data; not a Category.
_Avoid_: category (for this field)

**Provenance**:
Which system a Transaction lives in — hand-entered, statement import, bank sync or PayPal.
One purchase can surface in several systems (a PayPal purchase also lands as a bank
transaction), so consolidation keys on Provenance.
_Avoid_: source, origin

**Channel**:
How a Receipt arrived — upload or email. A Receipt lives only here, so it has a Channel,
not a Provenance.
_Avoid_: source

## Relationships

- A **Household** owns every **Expense**, **Income**, **Transaction**, **Category** and
  **Receipt**
- An **Expense** is filed under exactly one **Category**
- A **Transaction** is filed under at most one **Category** and may carry one **Group**
- A **Transaction** or **Receipt** line item linked to an **Expense** is filed under that
  Expense's **Category** and cannot be filed separately; only one with no Expense (for a
  Transaction, an **Unplanned** one) is filed under a Category directly
- A **Receipt** line item is filed under at most one **Category**
- Deleting a **Category** unfiles its **Transactions** and **Receipt** line items; it is
  refused while any **Expense** is filed under it
- An **Income** belongs to exactly one person
- A **Transaction** carries one **Priority** and one **Frequency**
- A recurring **Expense** or **Income** carries three figures derived from a single **Basis**;
  a one-time one carries a single amount and an expected date
- A **Transaction** may link to at most one **Expense**; a Spend **Transaction** with no link
  is **Unplanned**
- A one-time **Expense** has one **Consumed** and one **Remaining**, both derived from its
  linked **Transactions**, never stored
- A **Receipt** is attributed to at most one **Member** and matches at most one
  **Transaction**; a **Transaction** has at most one **Receipt**. The **Household**
  owns the Receipt; Member attribution is optional and detaches (to none) if that
  Member is removed, because a Receipt is kept as tax evidence.

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
> **Dev:** "And the **Category** on a **Transaction** — is that the same list your
> **Expenses** are filed under?"
>
> **Domain expert:** "Same list, yes. I maintain it in one place. If a purchase doesn't fit
> anything, I add the category there first, then file the purchase under it."
>
> **Dev:** "So I can't invent one while entering a purchase?"
>
> **Domain expert:** "No, and I don't want to — that's how I ended up with 'groceries',
> 'Groceries' and 'food shop' meaning the same thing."
>
> **Dev:** "If I link a **Transaction** to the 'Weekly shop' **Expense**, can I still file it
> under Household?"
>
> **Domain expert:** "No. Once it's linked, it sits wherever 'Weekly shop' sits. I only pick a
> **Category** myself for **Unplanned** purchases. If I move 'Weekly shop' to another
> Category, everything linked to it moves too."

## Flagged ambiguities

- **"positive"** was used for both the sign of an amount and for money coming in — and they
  mean opposite things. A positive `amount` is a **Spend**. Resolved: **Inflow** is the term
  for money arriving; "positive" refers only to the sign of a number, never to direction.
- **"category"** was used for both **Category** and the label on a **Transaction**.
  Resolved: there is one list, and **Category** is it. Expenses, Transactions and Receipt
  line items are all filed under a Category chosen from the list — new ones are created on
  the Categories page, never invented mid-entry. Every Expense is filed under exactly one
  Category, a Category an Expense uses cannot be deleted, and renaming a Category shows on
  every record filed under it.
- **"Expense Category"** was the old name for **Category**, a historical narrowing from when
  only Expenses were filed. Resolved: say **Category**; "expense category" suggests a second,
  Expense-only list that does not exist.
- **"category" on a Transaction** named two fields: the linked **Category** and a free text
  label from the spreadsheet import, both shown as "Category" at some point. Resolved: the
  link is the filing; the text label is the **Group**, not a Category. Renaming a Category
  leaves every Group alone.
- **"Uncategorised"** is the placeholder **Group** on a Transaction with no Group of its own.
  Resolved: it means "no Group" and says nothing about the **Category**; a Transaction showing
  Group "Uncategorised" may still be filed under a Category. Do not name a Category
  "Uncategorised".
- **"amount"** on an **Expense** or **Income** is three figures, not one. Resolved: they are
  derived from a single entered figure and its **Basis**, so they never disagree; there is no
  independent "fortnightly amount" to set.
- **"recurring"** appears on two records — a **Transaction**'s Frequency ("Recurring") and an
  **Expense**'s kind (`recurring`). Deliberate, not a collision: it is the same everyday
  adjective ("this repeats") applied to different records. "Standing" was rejected as the
  Expense-kind word — not user-friendly language for an expense.
- **"source"** was heading for three meanings: an **Income**'s named payer, which system a
  **Transaction** lives in, and how a **Receipt** arrived. Resolved: **Provenance** for
  Transactions (column `provenance`), **Channel** for Receipts (column `channel`); "source"
  survives only as the Income payer attribute.
- **Household** is domain language today, not a boundary in the data — the records are
  unscoped, and household scoping is planned. Resolved: use the term freely in conversation;
  do not assume it is enforced.
- **Receipt ownership vs attribution** — the glossary said both "attributed to a Member"
  (Records) and "belongs to one Member" (Relationships), which disagree. The schema settles
  it: `receipt.userId` is nullable and detaches (`on delete set null`) so a Receipt outlives
  the Member as tax evidence. Resolved: the **Household owns** every Receipt (mandatory); a
  Receipt is **attributed to at most one Member** (optional, soft). "belongs to one Member"
  was too strong.
- **"attribute"** was used both for a Receipt's **Member** and for tying a Receipt line item
  to an **Expense** or **Category**. Resolved: "attribute" is for Members only. A line item is
  **linked** to an Expense and **filed** under a Category, the same words as a Transaction.
- **"user" / "person"** arrive with the analytics and auth tooling (PostHog shows "persons",
  better-auth's table is `user`) and both mean **Member**. Resolved: activity, errors and AI
  spend are attributed to a **Member**, and to the **Household** once scoping exists;
  dashboards, alerts and cost reports say Member and Household, never "user".
