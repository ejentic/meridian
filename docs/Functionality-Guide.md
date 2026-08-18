# Meridian Functionality Guide

This is the guided tour. It explains what each module does and why it behaves the way it does, in plain language, with pointers to the exact rules in the [System Spec](Meridian-System-Spec.md). The spec is the source of truth; when you need a precise boundary value or status code, go there. Rule identifiers look like `MR-STO-02` (Storefront rule 2), `MR-REV-03` (Reviews rule 3), `MR-PLT-01` (Platform rule 1).

One principle runs through everything: **every rule is enforced on the server**. Hiding a button is presentation, not enforcement. If the UI hides an action but a direct API call performs it anyway, that is a defect, always (MR-PLT-02). The standard test is therefore two-sided: confirm the control is absent for the role, then call the endpoint directly with that role's session and confirm the server refuses it.

## Platform: who you are and what you may do

### Roles

Every user holds exactly one of three roles (MR-PLT-01):

- **Associate** — shop for themselves, view their own orders, write a Self evaluation, change their own password.
- **Manager** — everything an Associate can, plus: see and refund their *direct reports'* orders, and create/return/approve evaluations for direct reports. Nothing extra in Platform itself.
- **Administrator** — user administration (create, deactivate, assign roles, set who reports to whom), all orders and refunds, product and stock maintenance, review-cycle control, and reading every evaluation.

The capability lists in MR-PLT-01 are **complete**: a capability not listed is not held. Two consequences that surprise people — deactivating a user is one-way (no role holds "reactivate"), and a Manager gets nothing extra in Platform beyond an Associate.

"Direct report" means one thing: the `managerId` field on the user record points at you. There is no role inheritance and no org-chart traversal beyond that single hop.

### Sessions

- Signing in gives you a session that dies at whichever comes first: **30 minutes idle** or **12 hours absolute** (MR-PLT-03). The boundary is `>=`: at exactly 30:00 idle you are already signed out.
- Signing out deletes the session **on the server**. A second tab still holding the old token gets 401 on its next request (MR-PLT-04).
- Role changes and deactivation take effect on the user's **next request**, not their next sign-in — sessions carry a user reference, not a cached role (MR-PLT-05). Demote yourself and your very next privileged call is refused.

The two refusal codes matter and are never interchangeable (MR-PLT-02): **401** means "no valid session" (missing, expired, signed out); **403** means "valid session, but your role does not permit this."

### Password change

Carries the current password and the new one; a wrong current password returns **401** (the one place 401 means something other than session state — MR-PLT-01 explains why). No complexity rules, by design. Existing sessions survive a password change.

## Storefront: exact-to-the-cent commerce

### The order calculation (MR-STO-02)

An order total is composed in a fixed sequence, and the sequence is the point:

1. Line subtotal = unit price × quantity (exact)
2. Order subtotal = sum of lines (exact)
3. **Discount** = subtotal × rate, rounded half-up to 2 decimals
4. Discounted subtotal = subtotal − discount
5. **Tax** = discounted subtotal × 8.25%, rounded half-up, computed once at order level
6. Shipping = free at a discounted subtotal ≥ $200.00, otherwise flat $12.00 (never taxed)
7. Total = discounted subtotal + tax + shipping

Rounding happens at exactly two points (discount and tax) and is **half-up, away from zero** (MR-STO-01). The seed products are chosen so you can watch the wrong implementations fail: tax-before-discount overcharges $1.23 on the worked-example cart; per-line tax overcharges $0.01 on three $12.10 lines; and the $49.90 + $14.55 cart ties at both rounding points, so it distinguishes half-up from banker's rounding (see [Test-Data.md](Test-Data.md)).

Two quiet facts: a line snapshots the unit price at the moment it was added (later price changes never touch an in-progress order), and a product appears on at most one line — adding it again bumps the quantity.

### Discount codes (MR-STO-03)

Integer rate 1–50, an active flag, an expiry date. Usable **on** the expiry date, refused the day after, compared on the UTC calendar date. One code per order; a second replaces the first. Bad codes are 422s.

### The order state machine (MR-STO-06)

Seven statuses: Cart, Pending Payment, Paid, Payment Failed, Partially Refunded, Refunded, Cancelled. The spec lists every allowed transition; **everything not listed is a 409** that changes nothing. Content edits (lines, discount codes) are legal only in Cart — in any other status the write is a 409, even a write that would set an identical value.

### Stock and payment (MR-STO-07)

Adding to cart reserves nothing. Availability is checked at checkout, and stock is decremented only when capture succeeds — in the same database transaction that writes Paid. Capture is **simulated**: the person checking out chooses success or decline (that's how a facilitator produces the failure path on demand), but the out-of-stock outcome is decided by the server. When two checkouts race for the last unit, exactly one wins; the loser is not charged.

### Refunds (MR-STO-08)

Refunds are whole-line, requested-and-executed in one action, within **10 calendar days** of capture (day 10 accepted, day 11 refused). The refund amount is computed by *recomputing the order total over the remaining lines* and taking the difference from the captured total — which is what makes a multi-step refund sum to exactly the captured total with no leftover cent. Shipping is held at the captured amount and refunded only with the last line.

Who may refund is pure segregation of duties: **nobody refunds an order they placed**, whatever their role. An Associate refunds nothing; a Manager refunds direct reports' orders only; an Administrator refunds anything except their own orders.

## Reviews: evaluations under two state machines

### Ratings and the overall score (MR-REV-01, MR-REV-02)

An evaluation rates four fixed competencies, each an integer 1–5. The overall score is the mean, rounded half-up to one decimal — only 17 values are reachable, so a test expecting 4.4 is testing a value the system cannot produce. Three outcome bands with **inclusive lower edges**: exactly 3.0 is Meets Expectations, exactly 4.5 is Exceeds Expectations. Those two boundaries are where a `>` written for a `>=` changes someone's rating.

### The evaluation workflow (MR-REV-03)

Six statuses: Draft, Submitted, Returned, Approved, Acknowledged, Cancelled. Submitting requires all four ratings plus a comment of ≥ 20 characters. Return requires a reason of ≥ 10 characters. The load-bearing guard: **neither Return nor Approve may be fired by the evaluator** — the two-person rule. Returning your own submission would let you edit and resubmit unread, which is approving yourself by a longer route. Acknowledge belongs to the subject alone. Cancel is Administrator-only, and Cancelled/Acknowledged are terminal.

### Who may create an evaluation (MR-REV-04)

A nine-row decision table over five conditions: cycle open, role, self-or-not, direct-report-or-not, duplicate-or-not. The row that matters most: **a Manager may evaluate direct reports only** — a skip-level report, a peer, or their own manager is a 403, and the refusal must come from the server, not from a missing button. A Cancelled evaluation frees the slot for a retry; anything else counts as a duplicate (409).

### Who may read an evaluation (MR-REV-05)

Read access depends on who asks and what status it is in. The subject of a Manager-type evaluation sees it only once Approved. The subject's manager is deliberately excluded from Draft and Returned — with the documented consequence that a manager who returns an evaluation can no longer read the return reason they just wrote. A refused read is a 403 carrying **no data**; blanking fields client-side does not comply.

### Cycles (MR-REV-06)

Planned → Open → Closed, Administrator-only, Closed is forever. The start/end dates look like controls and are not — they constrain nothing. Once a cycle closes, **every** write to its evaluations returns 422, checked *before* the transition check, so an illegal transition in a closed cycle gets the cycle's 422, not the transition's 409. There is exactly one correct status code for every refused request in this app, and tests are expected to assert which.

## The status-code contract, in one table

| Code | Means | Examples |
|---|---|---|
| 401 | No valid session (or wrong current password on a password change) | Expired session, replayed token after sign-out |
| 403 | Valid session, role does not permit it | Associate refunding, Manager evaluating a non-report, refused read |
| 409 | Refused by current state | Illegal transition, content edit outside Cart/Draft/Returned, duplicate evaluation, re-refunding a line |
| 422 | Refused by the request's own content or a closed container | Bad discount code, rating of 6, empty-cart checkout, refund past day 10, any write in a Closed cycle |

In every refusal: no state changes, no money moves, no inventory moves.

## Where the rules live in the code

| Concern | File |
|---|---|
| Pricing arithmetic | `src/lib/pricing.ts` |
| Order state machine, checkout, refunds | `src/lib/order.ts` |
| Evaluations, scoring, transitions | `src/lib/evaluation.ts` |
| Sessions and expiry | `src/lib/session.ts` |
| Role checks | `src/lib/authz.ts` |
| What controls the UI draws (never enforcement) | `src/rules/storefront.ts`, `src/rules/reviews.ts` |
| API endpoints | `src/app/api/v1/**` |

The data layer is hand-written SQL rather than an ORM, on purpose: the SQL a rule produces is meant to be readable next to the rule it implements.
