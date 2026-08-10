---
paths:
  - src/**/*.ts
  - src/**/*.tsx
---

# Concise JSDoc

Structured JSDoc / doc blocks in `src` stay extremely terse. One-line summary;
sacrifice grammar for concision.

- **Don't restate the signature.** Drop `@param name` / `@returns` lines that add
  nothing over the parameter's name and type — a typed signature already carries
  them. `@param userId The user id` is noise.
- **Do keep what a signature can't encode.** Bound inclusivity, units, error /
  edge behaviour, invariants, an assumed precondition — the contract detail a
  caller needs to write a correct call *without reading the body*. Cut
  restatement, never the contract.
- No changelog / journal / byline blocks; version control owns history.

Free-prose comments (`//`, `/* */` prose, trailing) are governed by the
`code-comment` skill, not this rule.
