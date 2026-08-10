# Bug Report Template

> Body principles (durability, behaviour-not-files, AC, out-of-scope) are in **[agent-brief.md](agent-brief.md)** — every ticket body must satisfy them. This template gives the type-specific structure on top.

Use this template for defects, unexpected behavior, regressions, and production issues.

## Template Structure

```markdown
Title: [Specific issue] [location/component] [platform if relevant]
Example: Login button unresponsive after autofill on Safari iOS 17

## Impact Assessment
**Severity**: [L1: App crash | L2: Core feature blocked | L3: Minor issue | L4: Cosmetic]
**Affected users**: [Quantity and description]
**Business impact**: [Revenue, reputation, blocking work]

## Description
Clear summary of what's broken and the user impact.

## Steps to Reproduce
[Detailed, chronological, numbered steps that reliably reproduce the issue]

1. Open Safari on iOS 17.1
2. Navigate to login page (https://app.example.com/login)
3. Tap on username field
4. Allow password manager to autofill credentials
5. Tap Submit button
6. **Expected**: Login proceeds to dashboard.
7. **Actual**: Nothing happens; submit button is greyed out and unresponsive.

## Environment
**Required details**:
- Device: [iPhone 13, iPad Pro, etc.]
- OS: [iOS 17.1, macOS Ventura 13.5, Windows 11]
- Browser: [Safari 17.0, Chrome 118, etc.]
- App version: [3.2.1]
- Network: [WiFi, cellular, VPN]

**Additional context**:
- First observed: [Date/time]
- Frequency: [Always, 80% of time, once]
- User actions before bug: [Relevant history]

## Workaround (if any)
[Temporary solution users can use]

## Visual Evidence
[Screenshots, annotated images, Loom video, GIF]
- Attach: Screenshot of the bug.
- Attach: Console logs showing errors.
- Attach: Network request showing failed API call.

## Acceptance Criteria
See `agent-brief.md` § Acceptance criteria for the full rules.

- [ ] Submit button remains active and clickable after autofill on Safari iOS 17.
- [ ] Login completes within the existing latency budget.
- [ ] `make check` passes.

## Related Information
- Similar bugs: [Ticket references]
- When introduced: [Recent deploy, specific commit]
- Related Slack discussion: [Link]
- Support tickets: [Reference numbers]
```

## Guidelines

**Title verbs (this type):** Fix, Resolve, Correct.
Example: "Fix login button unresponsive after autofill on Safari iOS 17".

**Severity levels:**
- **L1 (Critical)**: App crash, data loss, security breach, complete feature failure.
- **L2 (High)**: Core feature blocked, major functionality unavailable.
- **L3 (Medium)**: Minor feature broken, workaround exists.
- **L4 (Low)**: Cosmetic issue, typo, minor UI glitch.

**Project-specific notes:**
- Screenshots are mandatory for UI bugs; include console logs / network tab if technical.
- Never mix multiple bugs in one ticket — split them.
