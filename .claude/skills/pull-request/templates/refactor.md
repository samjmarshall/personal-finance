<!--
TEMPLATE: refactor — structural change with no behaviour change.

FILL RULES:
- "Behaviour preserved" is required — explicitly assert that no user-visible or API behaviour changed.
- Frame "Why now" around architectural friction (coupling, testability, deep module, duplicate logic), not user value.
-->

## Linked issue

<!-- `Closes #N` if linked, otherwise omit and use "Why now" below. -->

## Why now

<!-- 2-3 lines on the architectural friction this resolves: coupling, testability, duplication, shallow module, etc. Skip if an issue is linked. -->

## What changed

<!-- 3-5 bullets describing the before→after structure. -->

-

## Behaviour preserved

<!-- Required. One paragraph asserting no user-visible or API behaviour change. Note any tests that lock the contract. -->

## Out of scope

<!-- Refactors leak scope. Files touched but not changed in spirit, deferred follow-up, things explicitly NOT changed. "None" if genuinely none. -->

-

## Manual verification

<!-- Optional. Rare for refactors. If CI covers everything, delete this section. -->

- [ ]

## Callouts

<!-- Regression risk a reviewer should pay extra attention to. Subtle behaviour edges (ordering, error wrapping, log shape) that may have shifted. "None" if genuinely none. -->
