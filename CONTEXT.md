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

**Group**:
A named set of Categories kept by the household, such as Housing or Food.
_Avoid_: parent category, section, category group

### Filing

**Unfiled**:
A Transaction linked to no Expense and filed under no Category — a classification by absence,
never a stored record. Not the same as Unplanned: an Unplanned row may be filed under a
Category, and an Inflow can be Unfiled.
_Avoid_: uncategorised, unassigned, to review

**Bank category**:
The bank feed's own category on a bank Transaction, mapped to at most one Category.
_Avoid_: Redbark category, provider category

**Bank code**:
The Open Banking code beneath a Bank category, such as `FOOD_AND_DRINK`.
_Avoid_: provider category, bank category (for the code)

**Rule**:
A standing instruction, kept by the Household and saved by a Member, to file Transactions that
match given words, and optionally an amount and account, under one Expense or one Category.
_Avoid_: filter, automation

**Suggestion**:
A proposed filing for an Unfiled Transaction, saved with its Clues and Strength, for a Member
to accept or change.
_Avoid_: prediction, recommendation, guess

**Clue**:
One independent reason behind a Suggestion: the Bank category, past matches, an Expense name,
the Old group, or the AI.
_Avoid_: signal, feature, vote

**Strength**:
How far a Suggestion's Clues agree: Strong, Weak, Split or None.
_Avoid_: confidence, score

**Auto-filed**:
Filed by a Rule or an exact repeat, not by a Member; a Member can undo it.
_Avoid_: auto-categorised, auto-assigned

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

**Old group**:
The household's own rough label on a Transaction, kept from the statement import; read-only,
used once as a Clue, then removed. Not a Category or a Group.
_Avoid_: group, category (for this field)

**Provenance**:
Which system a Transaction lives in — hand-entered, statement import, bank sync or PayPal.
One purchase can surface in several systems (a PayPal purchase also lands as a bank
transaction), so consolidation keys on Provenance.
_Avoid_: source, origin

**Bank import**:
A Member-run fetch of older history from the bank feed, years back; its rows have bank sync
Provenance.
_Avoid_: history import, backfill, import (alone)

**Adopt**:
The bank sync takes a household Transaction as its own when a bank row has the same day, the
same amount to the cent and a description that means the same purchase. The row keeps every
Member edit; its date and amount then come from the bank. (Description test: adr029.)
_Avoid_: link (an Expense), match (a Receipt), merge

**Possible duplicate**:
A bank row with the same amount to the cent as a household Transaction within 7 days, but not
an Adopt, held until a Member keeps theirs, uses the bank's, or says both are real. (Same-day
pairs: adr029.)
_Avoid_: conflict, dupe

**Answer**:
A Member's pick on one Possible duplicate: Keep mine, Use bank's or Both are real.
_Avoid_: choice, resolution, decision

**Apply**:
One send of a Member's Answers, saved in the background and counted as it goes.
_Avoid_: job, batch, task, run

**Channel**:
How a Receipt arrived — upload or email. A Receipt lives only here, so it has a Channel,
not a Provenance.
_Avoid_: source

**Balance source**:
Who recorded a balance snapshot — the member, or the bank sync. A label only: the newest
as-of time wins either way. The one place "source" is the term; a snapshot is not a
Transaction, so it has no Provenance.
_Avoid_: provenance (for a balance)

## Relationships

- A **Household** owns every **Expense**, **Income**, **Transaction**, **Category**, **Group**,
  **Rule** and **Receipt**
- An **Expense** is filed under exactly one **Category**
- A **Transaction** is filed under at most one **Category** and may carry one **Old group**
- A **Category** sits in exactly one **Group**; a Group cannot be deleted while it holds a
  Category
- A **Bank category** maps to at most one **Category**, and many may map to the same one;
  deleting a Category unmaps them
- A bank **Transaction** carries at most one **Bank category** and one **Bank code**
- A **Rule** files under exactly one **Expense** or one **Category**
- A **Rule** is saved by at most one **Member**; removing that Member clears the note and
  keeps the Rule
- An **Unfiled** **Transaction** has at most one **Suggestion**; filing it removes the Suggestion
- **Rules** and **Suggestions** act only on **Unfiled** Transactions; they never change a
  Member's filing
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
- A **Transaction** is adopted by at most one bank row; a **Possible duplicate** points at
  exactly one **Transaction**
- A **Possible duplicate** has at most one **Answer**; an Answer that didn't apply stays on
  the row until the Member applies again
- An **Apply** carries one or more **Answers**; at most one Apply runs at a time

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
>
> **Dev:** "The bank already says this Woolworths row is Groceries. Is that its **Category**?"
>
> **Domain expert:** "No, that's the **Bank category**. It's one **Clue**. Ours lives in our
> list, and the bank gets about one in five wrong."
>
> **Dev:** "So the row gets a **Suggestion**. If the bank and the past matches both say
> Groceries, it's **Strong**?"
>
> **Domain expert:** "Yes, but I still tick it. Only a **Rule** I saved, or the same purchase
> I've filed the same way three times, gets **Auto-filed**."

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
  label from the statement import, both shown as "Category" at some point. Resolved: the
  link is the filing; the text label is the **Old group**, not a Category. Renaming a Category
  leaves every Old group alone.
- **"Uncategorised"** is the placeholder **Old group** on a Transaction with no label of its
  own. Resolved: it means "no Old group" and says nothing about the **Category**; a
  Transaction showing "Uncategorised" may still be filed under a Category. Do not name a
  Category "Uncategorised".
- **"group"** meant the spreadsheet label until Categories gained parents. Resolved: a
  **Group** is the parent of Categories (Housing, Food); the spreadsheet label is the **Old
  group**, read-only until it is removed.
- **"bank category"** — the bank feed's own screens use it for Open Banking codes. Resolved:
  a **Bank category** is the feed's category on a row; the code beneath it is a **Bank
  code**.
- **"confidence"** of a guess. Resolved: **Strength** counts agreeing **Clues**; the AI's own
  confidence is never used.
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
- **"import"** named three things: the spreadsheet import (Old group), the statement import
  (Provenance `import`) and the "Import from bank" page. Resolved: the spreadsheet import is the
  statement import, one thing; the page is a **Bank import**, and its rows have bank sync
  Provenance, never `import`.
