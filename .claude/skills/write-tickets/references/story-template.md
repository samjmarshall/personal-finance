# User Story Template

> Body principles (durability, behaviour-not-files, AC, out-of-scope) are in **[agent-brief.md](agent-brief.md)** — every ticket body must satisfy them. This template gives the type-specific structure on top.

Use this template for user-facing features, new functionality, and customer-requested capabilities.

## Template Structure

```markdown
Title: [Verb] [specific feature] for [user type]
Example: Implement password reset functionality for registered users

## Story
As a [persona with specific context],
I want to [specific goal],
So that [concrete benefit or outcome].

Example:
As a registered user who has forgotten my password,
I want to reset it via email,
So that I can regain account access without contacting support.

## Context
**Current state**: [What exists today]
**Future state**: [What will exist after this work]
**Why now**: [Business driver, user pain point, strategic importance]
**Impact**: [Number of users, revenue impact, or strategic value]

## Acceptance Criteria
See `agent-brief.md` § Acceptance criteria for the full rules.

- [ ] User can access "Forgot Password" link from login page
- [ ] Entering registered email triggers reset email within 2 minutes
- [ ] Logs `password_reset_requested` event with userId
- [ ] Reset email contains unique, secure token (expires in 24 hours)
- [ ] Token allows one-time password change
- [ ] New password must meet complexity requirements
- [ ] User receives confirmation email after successful reset
- [ ] Password reset works on mobile and desktop

## Resources
- Design mockups: [Figma link]
- Related documentation: [Confluence/Notion link]
- Similar implementation: [Ticket reference]

## Technical Notes (Optional)
[Only if guidance is needed — avoid prescribing implementation]
- Suggested approach or architecture
- Security considerations
- Performance requirements
- Known constraints or limitations
```

## Guidelines

**Title verbs (this type):** Implement, Add, Enable, Build.
Example: "Implement password reset for registered users".

**Project-specific notes:**
- Telemetry events go inline as testable AC bullets (e.g. `Logs password_reset_requested event with userId`) — never a separate Analytics/Tracking section.
- Persona must carry context, not just "user". Bad: "As a user, I want localStorage so I can save data". Good: "As a returning user, I want my preferences to persist so I don't reconfigure them each visit".
