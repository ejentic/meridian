# Meridian System Specification

This document is the source of truth for every worked example, exercise, and the training application built around Meridian. Where a deck, exercise, or the training app states a Meridian fact, it must agree with what is declared here.

## 1. What Meridian is

Meridian is a fictional ERP used across the whole training program. It requires no prior knowledge of any real system. Trainees never test a real client system; every scenario, screenshot, and exercise in this program runs against Meridian.

**Companion documents.** This spec cites companion training material by name: `docs/Test-Artifacts-Reference.md`, the Deck 01 to 07 slide decks and their facilitator guides, and the working notes behind them. Those are facilitator materials and are not published in this repository. The citations stay so every fact keeps its provenance, but you do not need any of them to build, run, or test Meridian.

## 2. Modules

| Module | Status | Used by |
|---|---|---|
| Procurement and Payables | Established in shipped decks | Decks 01 to 07 |
| Inventory | Established in shipped decks | Decks 01 to 07 |
| Finance and GL | Established in shipped decks | Decks 01 to 07 |
| People | New | Exercises |
| Storefront | New | Exercises and the training app |
| Reviews | New | Exercises and the training app |
| Platform | New | Exercises and the training app |

**Implementation scope.** The training application implements three of the seven modules: Platform, Storefront, and Reviews. The other four are documentation only: Procurement and Payables, Inventory, Finance and GL, and People exist for worked examples, decks, and paper exercises, and no code implements them. Each business rule in Section 5 repeats this on its own `Source:` line so a rule can be read in isolation without checking back here.

## 3. Roles

| Role | Module | What it can do | What it must not do | Source |
|---|---|---|---|---|
| Submitter | Procurement and Payables | Is one of the three roles Meridian smoke tests exercise before system-test execution begins: log in, confirm the invoice list is visible, confirm one posting action is reachable. | Not stated beyond the smoke-test role list; the harvested courseware does not give Submitter a distinct capability description in this module. | Deck 01, Slide 21 "STLC Phase 4: Test Environment Setup"; Deck 01 Facilitator Guide, same slide |
| Approver | Procurement and Payables | Approves invoices under a requirement-defined dollar limit. Deck 03's fault-attack list names an approver being deactivated while holding pending invoice approvals as a case worth testing; the courseware does not assert what Meridian actually does in that case. | The courseware's own example leaves this open deliberately: whether the dollar limit is enforced in code or only in the UI is the ambiguity the Approver-role exercise asks learners to raise before development starts. | Deck 01, Slide 18 "STLC Phase 1: Requirement Analysis"; Deck 03, Slide 24 "Error Guessing: Meridian Fault Attack List" |
| Finance Manager | Procurement and Payables | Approves invoices up to $10,000. | Approve an invoice above the $10,000 limit. | Deck 01, Slide 10 "Verification vs Validation in Meridian Practice"; Deck 01 Facilitator Guide, Slide 10 |
| Stock Adjuster | Inventory | Submits stock adjustments for approval. | A user who holds both Stock Adjuster and Stock Approver must not be able to approve an adjustment they themselves submitted; this self-approval block is the behavior DEF-0051 in `docs/Test-Artifacts-Reference.md` Section 10 depends on. | Deck 04, Slide 25 "Worked Example — Test Case 1 (Negative)"; `docs/Test-Artifacts-Reference.md` Section 10 |
| Stock Approver | Inventory | Approves a stock adjustment submitted by a different user. | Approve an adjustment it submitted itself, under the same segregation-of-duties rule as Stock Adjuster when one user holds both roles. | Deck 04, Slide 26 "Worked Example — Test Case 2 (Positive)"; `docs/Test-Artifacts-Reference.md` Section 7 (Test Cases) |

**Naming note.** Deck 01's $10,000 invoice-approval example is told twice with two different role names for the same limit: Slide 10 (and its Facilitator Guide) calls the role "Finance Manager," while Slide 18 calls the same $10,000 example an "Approver role." Both mentions agree on the dollar amount, so this is not a value conflict; it is recorded here as naming looseness in one worked example, not two competing facts. Deck 04's scenario table (`SCN-STK-012-04`, Slide 24) shows the same looseness in the Inventory module: it describes "a user with Approver role but no Submitter rights," while that scenario's own test-case preconditions (Slides 25 to 26) name the concrete roles as Stock Approver and Stock Adjuster.

## 4. Environments and test data

**Environment name:** `QA2`. Used for the DEF-0051 defect example ("Environment: Build 2026.6.3, QA2, masked production copy") and for the month-end batch-job NFR evidence example ("Conditions: QA2, 100,000-line data set, single scheduled run").
Source: `docs/Test-Artifacts-Reference.md` Section 10 (Defect / Bug Report) and Section 11 (NFR Evidence).

**Build identifier format:** `Build 2026.6.3`.
Source: `docs/Test-Artifacts-Reference.md` Section 10, the DEF-0051 worked example.

**Data practice:** Before executing Meridian system tests, restore a masked copy of the production database to the test server, deploy the release build, create user accounts for each role in scope, and run a smoke test; if the smoke test fails, execution does not start.
Source: Deck 01, Slide 21 "STLC Phase 4: Test Environment Setup"; Deck 01 Facilitator Guide, same slide. `docs/Test-Artifacts-Reference.md` Section 10 records this same QA2 practice as "masked production copy."

**Named test accounts:**
- `adjuster01` holds the Stock Adjuster role. In the self-approval negative test case, `adjuster01` also holds Stock Approver, which is what makes the self-approval attempt possible to test.
- `approver02` holds the Stock Approver role and did not submit the adjustment under test. Exercises that reference `approver02` rely on that precondition holding.
Source: Deck 04, Slide 25 "Worked Example — Test Case 1 (Negative)"; Slide 26 "Worked Example — Test Case 2 (Positive)"; `docs/Test-Artifacts-Reference.md` Section 7 (Test Cases).

## 5. Business rules

Rule IDs in this section (`MR-PP-##`, `MR-INV-##`, `MR-FIN-##`, `MR-PEO-##`, `MR-STO-##`, `MR-REV-##`, `MR-PLT-##`) are Meridian business-rule identifiers for this system spec. They are a separate namespace from the artifact identifiers fixed by `docs/Test-Artifacts-Reference.md` Section 3 (`BR-##`, `MODULE-TS-###`, `MODULE-TC-###`, `DEF-####`), which govern test artifacts, not system-spec rules. The two schemes coexist; neither replaces the other.

### Procurement and Payables

**MR-PP-01.** Meridian's invoice posting uses a three-way match: purchase order, goods receipt, and invoice. It is not a two-way match.
Source: Deck 07, Slide 21 "Hard Limits: System Knowledge and Data Privacy," and its Facilitator Guide, which name the three-way match rule without listing its elements. The three matched elements are spelled out in Deck 07 Facilitator Guide, Slide 20 "Hard Limit: Hallucination": "System posts the invoice when PO, receipt, and invoice amounts match exactly."

*Deliberate counter-example, not a conflict:* Deck 07 Facilitator Guide, Slide 26 "What To Do With AI Output," uses "two-way match" once, on purpose, as the wrong answer in an example about AI producing a plausible but incorrect expected result ("the AI scenario that assumes Meridian uses a two-way match when your Meridian implementation uses a three-way match"). That sentence is teaching material illustrating an AI mistake, not a second assertion about Meridian's own behavior.

**MR-PP-02.** The Approver role (told in one telling of the same worked example as "Finance Manager," see Section 3 naming note) approves invoices up to $10,000.
Source: Deck 01, Slide 10 "Verification vs Validation in Meridian Practice"; Slide 18 "STLC Phase 1: Requirement Analysis"; Deck 01 Facilitator Guide, Slide 10.

**MR-PP-03.** The invoice discount field accepts 0 to 100 percent, so boundary testing exercises -1, 0, 1, 99, 100, and 101.
Source: Deck 04, Slide 17 "Positive, Negative, and Boundary Test Cases."

**MR-PP-04.** An early payment discount on a vendor invoice applies when payment arrives within 10 days of the invoice date.
Source: Deck 04, Slide 17 "Positive, Negative, and Boundary Test Cases"; Deck 07, Slide 29 "Hands-on Capstone"; Deck 07 Facilitator Guide, same slide.

### Inventory

**MR-INV-01.** Approving a stock adjustment produces three verifiable outcomes: status becomes Approved, the inventory quantity updates, and the audit log records the approver's user ID, timestamp, adjustment ID, and the before and after quantities.
Source: Deck 04, Slide 26 "Worked Example — Test Case 2 (Positive)"; Deck 04 Facilitator Guide, Slide 16 "The Most Common Quality Defect in Test Cases."

**MR-INV-02.** When a stock adjustment is submitted for approval, the system must prevent the submitting user from approving their own adjustment. A self-approval attempt is blocked with the message "Self-approval is not permitted. Please assign a different approver," the adjustment stays in Pending Approval status, and no approval is recorded.
Source: Deck 04, Slide 23 "Worked Example — REQ-STK-012"; Deck 04, Slide 25 "Worked Example — Test Case 1 (Negative)."

### Finance and GL

**MR-FIN-01.** A line-item discount on a Meridian sales order depends on two conditions: whether the customer is Preferred, and whether order quantity is 10 or more units. A preferred customer with a large order (quantity >= 10) gets 15%; a preferred customer with a small order gets 5%, not 15%.
Source: Deck 03, Slide 12 "Building the Meridian Discount Table"; Deck 03 Facilitator Guide, same slide.

**MR-FIN-02.** A closed accounting period cannot accept new postings.
Source: Deck 04, Slide 9 "The Methodical Checklist for ERP Standing Controls"; Deck 04 Facilitator Guide, same slide.

### People

People is documentation only. Nothing below is implemented by the training application; these rules exist so paper exercises have a system with real validation rules and a real calculation to test.

**MR-PEO-01.** An employee record has nine fields, each with a fixed validation rule. A create or update that fails any rule is rejected in full: no partial write, and the response names the failing field.

| Field | Rule |
|---|---|
| Employee ID | Format `EMP-#####`, exactly five digits. Unique. Assigned at creation and immutable afterwards. |
| Full name | Required. 2 to 80 characters inclusive. |
| Work email | Required. Unique. Must end in `@meridian-corp.test`. |
| Date of hire | Required. Must not be later than today. |
| Employment type | Exactly one of: Regular, Probationary, Contractual, Part-time. |
| Manager | An Employee ID of an employee whose status is Active. Must not equal this employee's own ID. The reporting chain must not form a cycle. |
| Basic monthly rate | Greater than 0.00, at most two decimal places. |
| Status | Exactly one of: Active, On Leave, Suspended, Separated. |
| Separation date | Required when status is Separated, forbidden otherwise. Must not be earlier than the date of hire. |

Boundary values the field rules make available: full name at 1, 2, 80, and 81 characters; basic monthly rate at 0.00, 0.01, and at three decimal places; date of hire at today and tomorrow; Employee ID at four, five, and six digits.
Source: This specification. Documentation only; not implemented by the training application.

**MR-PEO-02.** Meridian grants two leave types. Vacation leave accrues monthly. Sick leave is a fixed annual grant of 5.00 days credited on 1 January, does not accrue, and does not carry over: any unused sick leave is zeroed on 31 December. A mid-year hire receives a pro-rated sick grant of `5.00 * M / 12` rounded half-up to two decimals, where `M` is the number of calendar months that begin on or after the date of hire in that year.

Vacation leave accrues at 1.25 days per completed month of service. A month of service completes on the calendar day matching the hire day-of-month, or on the last day of the month when that day does not exist (a hire on the 31st completes its February month on 28 or 29 February). The first 6 completed months are probation and accrue nothing. The first credit of 1.25 days posts on the last calendar day of the month in which the sixth month of service completes, and 1.25 days posts on the last calendar day of every month after that.

Available balance = credited - used - pending, where pending is the day count of leave requests still in Pending status.

Two caps apply. The balance may not exceed 15.00 days at any time: a month-end credit that would push the balance past 15.00 credits only the part that fits and drops the rest, which is not carried forward. On 31 December, any vacation balance above 5.00 days is forfeited and the next year opens at 5.00; a balance of exactly 5.00 carries in full.

Worked example. Hired 2026-01-15, employment type Probationary then Regular. The sixth month of service completes 2026-07-15, so the first credit of 1.25 posts 2026-07-31. Credits then post 08-31, 09-30, 10-31, 11-30, and 12-31, so 2026 credits 6 x 1.25 = 7.50 days. Sick leave for 2026 is 5.00 * 11 / 12 = 4.5833, rounded to 4.58 days, because 11 calendar months (February through December) begin on or after 15 January.

- Used 2.00 vacation days: balance at 2026-12-31 is 7.50 - 2.00 = 5.50. Forfeiture is 5.50 - 5.00 = 0.50 and 2027 opens at 5.00.
- Used 2.50 vacation days: balance is exactly 5.00, nothing is forfeited, and 2027 opens at 5.00. This is the boundary case.
- Cap example: a balance of 14.50 on a month end credits 0.50, not 1.25, and drops the remaining 0.75.

Source: This specification. Documentation only; not implemented by the training application.

**MR-PEO-03.** A leave request is validated against six conditions, evaluated in the order listed, and rejected at the first failure with that failure's reason:

1. Start date is not later than end date.
2. The requested day count is the number of working days (Monday to Friday) in the inclusive date range. A half day is allowed only when start date equals end date, and counts as 0.50.
3. Vacation requests must be filed at least 3 working days before the start date. Sick requests are exempt and may be filed on or after the start date.
4. The requested day count must not exceed the available balance for that leave type as defined in MR-PEO-02.
5. The date range must not overlap another request by the same employee that is in Pending or Approved status.
6. The employee's status must be Active or On Leave. Suspended and Separated employees cannot file.

Leave request statuses are Pending, Approved, Rejected, and Cancelled. Only the employee's manager, or an employee record holding the manager position above them in the reporting chain, may approve. An employee may never approve their own request, including a manager filing their own leave, which follows the same segregation-of-duties principle as MR-INV-02 in Inventory. Approved days move from pending to used on approval. Cancelling an Approved request returns its days to the available balance.
Source: This specification. Documentation only; not implemented by the training application.

### Storefront

Storefront is implemented by the training application. Its rules are arithmetic and are meant to be computable: given a cart and these rules, exactly one total is correct.

**Status codes.** Storefront answers a refused request on the same terms Reviews does, stated once here rather than in each rule. A request refused because the caller's role does not permit it returns 403, per MR-PLT-02. A request refused by the current state of the order or one of its lines returns 409: every transition MR-STO-06 does not list, every content edit outside Cart, and a refund targeting a line that is already refunded. A request refused by its own content returns 422: an unknown, inactive, or expired discount code, a checkout on an order holding no lines, a line id that does not belong to the order, and a refund executed past MR-STO-08's window. In every case no money moves, no inventory moves, and no stored value changes.

**MR-STO-01.** Money in Storefront is held to exactly two decimal places in the system currency, written here with `$` to match the existing worked examples in Procurement and Payables. Amounts are computed in integer cents or in a decimal type, never in binary floating point. Rounding is half-up, away from zero, to two decimals, and it happens at exactly two points in an order calculation: the discount amount and the tax amount. Nothing else in the calculation rounds, because every other input and intermediate is already an exact number of cents.

Storefront stores instants, and two rules compare an instant against a calendar date: MR-STO-03's discount code expiry and MR-STO-08's refund window. Both use the UTC calendar date of the instant. The timezone is fixed here, once, rather than in each rule, so the two cannot drift apart, and it is UTC because a fixture reset for a cohort in one timezone and run by a cohort in another has to produce the same boundary result.
Source: This specification. Implemented by the training application.

**MR-STO-02.** An order total is composed in this order, and the order matters:

1. Line subtotal = unit price x quantity, per order line. Exact, no rounding.
2. Order subtotal = sum of the line subtotals. Exact.
3. Discount amount = order subtotal x discount rate, rounded half-up to two decimals. Applied to the order subtotal, before tax.
4. Discounted subtotal = order subtotal - discount amount.
5. Tax amount = discounted subtotal x 8.25%, rounded half-up to two decimals. Computed once, on the discounted subtotal, at order level.
6. Shipping = $0.00 when the discounted subtotal is greater than or equal to $200.00, otherwise a flat $12.00. Shipping is not taxed.
7. Order total = discounted subtotal + tax amount + shipping.

Two facts about an order line that the steps above assume rather than state. A line carries the unit price in effect when the line was added, not the product's current price, so changing a product's price never alters an order already in progress. And a product appears on at most one line of an order: adding a product already on the order increases that line's quantity rather than creating a second line. The second fact is observable through MR-STO-08, which refunds whole lines, so two units on one line are refunded together while two lines of one unit each can be refunded separately.

Worked example. A cart holding three separate products at $49.90 each, quantity 1 per line, with a 10% discount code applied:

| Step | Value |
|---|---|
| Order subtotal | 3 x 49.90 = $149.70 |
| Discount amount | 149.70 x 0.10 = $14.97 |
| Discounted subtotal | 149.70 - 14.97 = $134.73 |
| Tax amount | 134.73 x 0.0825 = 11.115225, rounded to $11.12 |
| Shipping | 134.73 is below 200.00, so $12.00 |
| Order total | 134.73 + 11.12 + 12.00 = **$157.85** |

Source: This specification. Implemented by the training application.

**MR-STO-03.** A discount code carries a percentage rate that must be an integer from 1 to 50 inclusive, an active flag, and an expiry date. A code is usable on and including its expiry date and unusable the day after, compared against the UTC calendar date fixed by MR-STO-01. At most one code applies per order; a second code replaces the first rather than stacking, and the recalculated total reflects only the surviving code. The discount applies to the order subtotal before tax, per step 3 of MR-STO-02, and never to shipping.

Applying or replacing a code is an order content edit, so it is permitted only while the status is Cart, per MR-STO-06. Read on its own this rule describes replacement without mentioning status, which is a reading that permits replacing a code on a paid order; MR-STO-06 governs and forbids it.

Applying the discount after tax instead of before it is the failure this rule exists to catch. On the MR-STO-02 cart, taxing the pre-discount subtotal gives 149.70 x 0.0825 = 12.35025, rounded to $12.35, and a total of 134.73 + 12.35 + 12.00 = $159.08, which overcharges the customer by $1.23 while every line on the screen still looks right.

Boundary values for the rate: 0, 1, 50, and 51.
Source: This specification. Implemented by the training application.

**MR-STO-04.** Tax is computed once on the order-level discounted subtotal, never per line and then summed. The two methods do not always agree, and the order-level result is the correct one.

Worked example 1, per line against order level. Three separate products at $12.10 each, quantity 1 per line, no discount code. Per line, 12.10 x 0.0825 = 0.99825, which rounds to $1.00, and three lines sum to $3.00. At order level, 36.30 x 0.0825 = 2.99475, which rounds to $2.99. The per-line method overcharges by $0.01 on a cart this small and scales with line count.

Worked example 2, a discount and a tax rounding boundary interacting. Neither operand above is an exact half-cent tie, so they resolve the same way under any round-to-nearest mode. This cart ties at both rounding points and therefore decides the rounding mode, which is the case MR-STO-01 exists to fix.

A cart holding one product at $49.90 and one at $14.55, quantity 1 per line, with a 10% discount code. The order subtotal is $64.45.

| Step | Exact value | Correct result under MR-STO-01 |
|---|---|---|
| Discount amount | 64.45 x 0.10 = 6.445, an exact half-cent tie | Half-up away from zero gives **$6.45** |
| Discounted subtotal | 64.45 - 6.45 | $58.00 |
| Tax amount | 58.00 x 0.0825 = 4.785, again an exact half-cent tie | Half-up away from zero gives **$4.79** |
| Shipping | 58.00 is below 200.00 | $12.00 |
| Order total | 58.00 + 4.79 + 12.00 | **$74.79** |

What the wrong modes produce on this same cart:

| Rounding used | Discount | Discounted subtotal | Tax | Order total |
|---|---|---|---|---|
| Half-up at both points (correct) | $6.45 | $58.00 | $4.79 | $74.79 |
| Half-even at the tax point only | $6.45 | $58.00 | $4.78 | $74.78, undercharged by $0.01 |
| Half-even at the discount point | $6.44 | $58.01 | $4.79 | $74.80, overcharged by $0.01 |
| Truncation at both points | $6.44 | $58.01 | $4.78 | $74.79 |

The truncation row is the trap worth pointing out in review. It reaches the correct order total of $74.79 by two compensating errors, so a reconciliation that compares only totals passes it while the discount and tax lines are both wrong by a cent. Comparing the composed lines, not the total, is what catches it.
Source: This specification. Implemented by the training application.

**MR-STO-05.** Free shipping applies when the discounted subtotal is greater than or equal to $200.00. Exactly $200.00 qualifies. The threshold is tested against the discounted subtotal, not the order subtotal, so a discount can move an order back into paid shipping.

Boundary values: $199.99 pays $12.00, $200.00 pays $0.00, $200.01 pays $0.00. An order with a $210.00 subtotal and a 10% code has a discounted subtotal of $189.00 and therefore pays $12.00 shipping.
Source: This specification. Implemented by the training application.

**MR-STO-06.** An order holds exactly one of seven statuses: Cart, Pending Payment, Paid, Payment Failed, Partially Refunded, Refunded, Cancelled. The allowed transitions are:

| From | Event | To | Guard |
|---|---|---|---|
| Cart | Submit checkout | Pending Payment | Every line's quantity is available on hand |
| Cart | Cancel | Cancelled | none |
| Pending Payment | Capture succeeds | Paid | Every line's quantity is still available on hand |
| Pending Payment | Capture declines | Payment Failed | none |
| Pending Payment | Capture succeeds but a line went out of stock first | Payment Failed | The capture is rolled back and no money is taken |
| Pending Payment | Cancel | Cancelled | none |
| Payment Failed | Retry payment | Pending Payment | Every line's quantity is still available on hand |
| Payment Failed | Cancel | Cancelled | none |
| Paid | Refund some lines | Partially Refunded | At least one line remains unrefunded |
| Paid | Refund all lines | Refunded | none |
| Partially Refunded | Refund some lines | Partially Refunded | At least one line remains unrefunded |
| Partially Refunded | Refund last lines | Refunded | none |

Refunded and Cancelled are terminal and have no outgoing transitions. Every transition not listed above is invalid: the request is rejected with HTTP 409, the status is unchanged, no money moves, and no inventory moves. Invalid transitions worth testing include Cart to Paid, Pending Payment to Refunded, Refunded to Paid, and any transition out of Cancelled.

Order contents are editable only while the status is Cart. Adding, removing, or changing an order line, and applying or replacing a discount code under MR-STO-03, are permitted in Cart and in no other status. Attempted in Pending Payment, Paid, Payment Failed, Partially Refunded, Refunded, or Cancelled, the write is rejected with HTTP 409 and changes nothing, including a write that would set an identical value. This matters most on Paid, because MR-STO-07 puts the inventory decrement and the Paid write in one transaction: an order line edited after that transaction commits would leave the captured money and the stock movement disagreeing with the order. Refunds are not content edits; they are the transitions listed above and are governed by MR-STO-08.
Source: This specification. Implemented by the training application.

**MR-STO-07.** Adding an item to a cart does not reserve stock. Availability is checked at checkout submission, and on-hand quantity is decremented only when payment capture returns success, in the same database transaction that writes the order status Paid. If capture declines, on-hand quantity is unchanged.

On-hand quantity is an integer and may never go below 0. When two checkouts compete for the last unit of a SKU, exactly one reaches Paid and decrements the stock; the other is rejected with an out-of-stock error, leaves the order in Payment Failed or Cart, and captures no money. A successful capture paired with a failed decrement is not an acceptable outcome: the transaction rolls back and the customer is not charged.

Payment capture is simulated in the training application. There is no gateway and no payment record: the capture step is told whether it succeeded or declined, which is what lets a facilitator produce the Payment Failed path on demand for an exercise. The out-of-stock outcome is not selectable and is decided by the server against on-hand quantity, because that outcome is the one this rule exists to constrain.
Source: This specification. Implemented by the training application.

**MR-STO-08.** A refund targets whole order lines. Every unit on a refunded line is refunded together; a partial-quantity refund inside one line is not supported. A refund is accepted when it is executed no later than the tenth calendar day after the capture date, so day 10 is accepted and day 11 is rejected. The window is measured between two stored timestamps on the order, the capture and the refund, so the boundary is executable as written.

Requesting and executing a refund are one action. Meridian holds no refund-request record and MR-STO-06 has no "refund requested" status: the status transition, the money movement, and the restock all fire together at the moment the refund is executed. A customer who wants a refund asks for it outside the system, and the refund exists in Meridian only once someone with the authority below executes it.

Who may execute a refund, stated in the same terms MR-PLT-01 uses so the two rules cannot drift apart:

- An **Associate** may not execute a refund on any order, including one they placed themselves.
- A **Manager** may execute a refund on an order placed by one of their direct reports, and on no other. They may not refund an order they placed themselves, for the same segregation-of-duties reason MR-INV-02 blocks self-approval: it would let one person both receive the money and authorize its movement. An order a Manager placed is refunded by an Administrator.
- An **Administrator** may execute a refund on any order except one they placed themselves. The exclusion is the Manager's, for the same segregation-of-duties reason MR-INV-02 blocks self-approval: it would let one person both receive the money and authorize its movement, and the role of the person doing it does not change that. An order an Administrator placed is refunded by a different Administrator.

Nobody refunds an order they placed, whatever their role. One consequence follows and is intended rather than an oversight: an installation with a single Administrator cannot refund an order that Administrator placed, because there is no second Administrator to execute it. The alternative is a rule with an exception for the most privileged role, which is the shape of exception this specification exists to keep out.

A Manager's refund scope is therefore a strict subset of the order-read scope MR-PLT-01 gives them, so a Manager can never refund an order they are not permitted to read. Permission is checked before any transition check, per MR-PLT-02: a refund attempted by a caller whose role does not permit it on that order is refused with HTTP 403, no money moves, and no inventory moves, whatever status the order is in.

The refund amount is computed by recomputing the order total over the remaining unrefunded lines using MR-STO-02, then taking the difference from the current captured total. Two constraints govern the recomputation:

- The shipping charge is held at the amount captured on the original order. Refunds never recompute the free-shipping threshold, so a refund can never make a customer owe shipping they were not charged.
- Shipping is refunded only on the refund that leaves no unrefunded lines, at which point the order status becomes Refunded.

Restocking is immediate: the refunded lines' quantities are added back to on-hand quantity when the refund is executed.

Worked example, continuing the MR-STO-02 cart with a captured total of $157.85:

| Refund | Remaining lines | Recomputed total | Refund amount |
|---|---|---|---|
| Line 1 | 2 x 49.90 = 99.80; discount 9.98; discounted 89.82; tax 7.41015 to $7.41; shipping 12.00 | $109.23 | 157.85 - 109.23 = **$48.62** |
| Line 2 | 1 x 49.90 = 49.90; discount 4.99; discounted 44.91; tax 3.705075 to $3.71; shipping 12.00 | $60.62 | 109.23 - 60.62 = **$48.61** |
| Line 3 | none; shipping refunded here | $0.00 | **$60.62** |

The invariant this produces is the one to test: 48.62 + 48.61 + 60.62 = $157.85, exactly the captured total, with no residue. The naive alternative of refunding each line as its own discounted price plus its own tax gives 44.91 + 3.71 = $48.62 for both line 1 and line 2, and a three-line sum of $157.86, which over-refunds the customer by one cent that no screen displays.
Source: This specification. Implemented by the training application.

### Reviews

Reviews is implemented by the training application. Its rules are shaped for the three techniques Deck 03 teaches: a rating scale with real boundaries, an evaluation status workflow with an explicit transition list, and an eligibility rule that reduces to a decision table.

**MR-REV-01.** An evaluation rates exactly four fixed competencies: Quality of Work, Reliability, Collaboration, Initiative. Each rating is an integer from 1 to 5 inclusive. A Draft evaluation may hold unrated competencies; submitting requires all four to carry a valid rating.

A rating outside the range, a non-integer, a string, or a null on submit is rejected with HTTP 422, names the offending competency, and changes no stored value. Boundary and equivalence values the scale makes available: 0, 1, 2, 4, 5, 6, plus 3.5, "4" as a string, and null.
Source: This specification. Implemented by the training application.

**MR-REV-02.** The overall score is the sum of the four ratings divided by 4, rounded half-up to one decimal place. Its range is 1.0 to 5.0. It is defined only when all four competencies carry a rating: a Draft holding any unrated competency has an overall score of null and no outcome band, and null is neither displayed as 0.0 nor treated as a rating of zero in the mean.

Because the input is four integers, only 17 overall values are reachable: 1.0, 1.3, 1.5, 1.8, 2.0, 2.3, 2.5, 2.8, 3.0, 3.3, 3.5, 3.8, 4.0, 4.3, 4.5, 4.8, 5.0. A test case expecting an overall of 4.4 or 3.1 is testing a value the system cannot produce, which is itself worth catching in review.

Worked values: ratings 4, 4, 4, 3 give 15 / 4 = 3.75, which rounds half-up to **3.8**. Ratings 3, 3, 3, 4 give 13 / 4 = 3.25, which rounds to **3.3**. Ratings 4, 3, 5, 4 give 16 / 4 = **4.0** exactly.

The overall score maps to one of three outcome bands:

| Band | Condition |
|---|---|
| Needs Improvement | Overall below 3.0 |
| Meets Expectations | Overall from 3.0 to 4.4 inclusive |
| Exceeds Expectations | Overall 4.5 and above |

Both band edges are inclusive on the lower side. Ratings 3, 3, 3, 3 give exactly 3.0 and land in Meets Expectations, not Needs Improvement. Ratings 5, 5, 4, 4 give exactly 4.5 and land in Exceeds Expectations. These two cases are where a `>` written in place of `>=` changes an employee's rating outcome, which is why they are the required boundary tests.
Source: This specification. Implemented by the training application.

**MR-REV-03.** An evaluation holds exactly one of six statuses: Draft, Submitted, Returned, Approved, Acknowledged, Cancelled. The allowed transitions are:

| From | Event | To | Who may fire it | Guard |
|---|---|---|---|---|
| Draft | Submit | Submitted | The evaluator | All four competencies rated per MR-REV-01, and a comment of at least 20 characters |
| Draft | Cancel | Cancelled | Administrator | none |
| Submitted | Return | Returned | The subject's manager, or an Administrator | A return reason of at least 10 characters, and the person returning it is not the evaluator |
| Submitted | Approve | Approved | The subject's manager, or an Administrator | The approver is not the evaluator |
| Submitted | Cancel | Cancelled | Administrator | none |
| Returned | Submit | Submitted | The evaluator | Same guard as Draft to Submitted |
| Returned | Cancel | Cancelled | Administrator | none |
| Approved | Acknowledge | Acknowledged | The subject only | none |
| Approved | Cancel | Cancelled | Administrator | none |

Return and Approve carry the same "not the evaluator" guard, and the consequence is worth stating plainly because it decides who the training application must let act on a submitted evaluation. On a Manager-type evaluation the evaluator is the subject's manager, so that manager can neither return nor approve their own submission; only an Administrator can, and an Administrator is also the only route by which a manager who submitted a mistake gets that evaluation back into an editable status. On a Self evaluation the evaluator is the subject, so the subject's manager both returns and approves it. In every case two different people are involved.

Return needs the guard for the same reason Approve does. Ratings and comments are editable in Returned, so an evaluator permitted to return their own submission could return it, edit it, and resubmit it without anyone else reading it, which defeats the two-person rule by a longer route than approving it outright.

Acknowledged and Cancelled are terminal. Every transition not listed is invalid: the request is rejected with HTTP 409 and no stored value changes. Invalid transitions worth testing include Draft to Approved, Submitted to Acknowledged, Approved back to Draft, Acknowledged to Returned, and any transition out of Cancelled.

Ratings and comments are editable only while the status is Draft or Returned, and they are edited by the evaluator or by an Administrator. A write attempted in Submitted, Approved, Acknowledged, or Cancelled is rejected with HTTP 409 and changes nothing, including a write that would set an identical value.

An evaluation carries a comment and a return reason. Both are text fields on the evaluation, one of each, not one per competency. The comment is the field the submit guard measures at 20 characters and the return reason is the field the return guard measures at 10; neither has a maximum, and both may be null. Each Return stores its reason, replacing any earlier one, and resubmitting does not clear it, so the most recent return reason stays readable for as long as the evaluation exists.

**Check order.** A request to fire a transition is evaluated in this order, so the code a caller sees is deterministic: the cycle first, per MR-REV-06, then whether the requested transition appears in the table above at all, then who may fire it, then the guard. A transition absent from the table is 409 before anyone's permission is considered, because "who may fire it" is a property of a transition and there is nothing to check it against for a transition that does not exist. This is the opposite of the order MR-STO-08 fixes for refunds, where permission is checked first. The difference follows from the shape of the two rules: refund authority is a property of the caller and the order, and can be decided without knowing the transition, while here it cannot.
Source: This specification. Implemented by the training application.

**MR-REV-04.** An evaluation has one of two types: Self, where the evaluator and the subject are the same person, and Manager, where they are not. Eligibility to create an evaluation is decided by five conditions, and the checks run in this precedence order so the error a caller sees is deterministic: cycle state first, then permission, then duplication.

Conditions:

- **C1** The cycle status is Open (see MR-REV-06).
- **C2** The evaluator's role: Associate, Manager, or Administrator.
- **C3** The subject is the evaluator.
- **C4** The subject's `managerId` is the evaluator's user ID, meaning the subject is a direct report.
- **C5** An evaluation that is not Cancelled already exists for this combination of cycle, subject, evaluator, and type. A Cancelled evaluation does not occupy the combination. Cancelling is therefore the route by which an Administrator lets a mistaken evaluation be created again, which is what makes the Cancel transitions in MR-REV-03 useful rather than merely terminal.

| Rule | C1 Cycle Open | C2 Role | C3 Self | C4 Direct report | C5 Duplicate | Result |
|---|---|---|---|---|---|---|
| 1 | N | any | any | any | any | Reject, 422, cycle is not Open |
| 2 | Y | any | Y | any | N | Permit, type Self |
| 3 | Y | any | Y | any | Y | Reject, 409, duplicate |
| 4 | Y | Associate | N | any | any | Reject, 403 |
| 5 | Y | Manager | N | Y | N | Permit, type Manager |
| 6 | Y | Manager | N | Y | Y | Reject, 409, duplicate |
| 7 | Y | Manager | N | N | any | Reject, 403 |
| 8 | Y | Administrator | N | any | N | Permit, type Manager |
| 9 | Y | Administrator | N | any | Y | Reject, 409, duplicate |

Rule 7 is the one that matters most: a Manager may evaluate a direct report only. A skip-level report, a peer, and their own manager are all rejected, and the rejection must come from the server, not from an absent button.
Source: This specification. Implemented by the training application.

**MR-REV-05.** Read access to an evaluation depends on who is asking and what status the evaluation is in.

| Reader | May read |
|---|---|
| The evaluator | Their own evaluation, in every status |
| The subject, on a Manager-type evaluation | Only when the status is Approved or Acknowledged |
| The subject's manager | Every status except Draft, Returned, and Cancelled |
| Administrator | Every status |
| Anyone else | Nothing |

A read that is not permitted returns HTTP 403 and a body containing no ratings, no comments, and no overall score. Returning the record with the fields blanked in the interface is not compliance with this rule; the data must not leave the server.

The subject's manager is excluded from Draft and Returned deliberately, not by omission. Both are statuses in which the evaluator is still working, and the rule keeps a reader out of unfinished work for the same reason it keeps the subject out of a Manager-type evaluation before it is Approved. One consequence is worth stating outright because it surprises people who meet it in the application: a manager who returns an evaluation cannot then read the return reason they just wrote, because returning it is what moves the evaluation into the status their read access excludes. That is the intended behaviour, and an Administrator can read it in every status.
Source: This specification. Implemented by the training application.

**MR-REV-06.** A review cycle has a name, a start date, an end date, and one of three statuses: Planned, Open, Closed. Only an Administrator changes cycle status. The allowed transitions are Planned to Open and Open to Closed. Closed is terminal and a cycle cannot be reopened; every other transition is rejected with HTTP 409.

The start and end dates are descriptive and constrain nothing. A Planned cycle may be opened before its start date, and an Open cycle stays open past its end date until an Administrator closes it. The dates look like controls and are not, which is worth stating because a test plan written against this rule will otherwise assume they are.

Evaluations may be created and modified only while their cycle is Open. Once the cycle is Closed, every write to an evaluation in that cycle is rejected with HTTP 422 and nothing changes, including transitions that MR-REV-03 would otherwise allow. The cycle check runs before the transition check, in the same way MR-REV-04 fixes its own check order, so an invalid transition attempted inside a Closed cycle returns 422 for the closed cycle and not the 409 that MR-REV-03 would return on its own. There is exactly one correct status code for that request. An Approved evaluation in a Closed cycle can no longer be Acknowledged. This is deliberate and mirrors MR-FIN-02 in Finance and GL: a closed period stops accepting writes regardless of what the record-level workflow would permit. The interaction between the two state machines is the point.
Source: This specification. Implemented by the training application.

### Platform

Platform is implemented by the training application and supplies the authentication, roles, and sessions that Storefront and Reviews depend on.

**MR-PLT-01.** The training application ships with exactly three roles, and every user holds exactly one. These are the application's own roles and are distinct from the ERP roles in Section 3 (Submitter, Approver, Finance Manager, Stock Adjuster, Stock Approver): the two sets share no names, no inheritance, and no implicit mapping. Holding an ERP role grants nothing in the training application, and the reverse is equally true.

| Role | Storefront | Reviews | Platform |
|---|---|---|---|
| Associate | Browse products, manage their own cart, check out, view their own orders. No refund authority on any order, including their own, per MR-STO-08 | Create and submit a Self evaluation, read their own evaluations under MR-REV-05 | Change their own password, end their own session, read their own direct reports |
| Manager | Everything an Associate can do, plus view orders placed by their direct reports and execute a refund on a direct report's order, per MR-STO-08. Not on an order they placed themselves | Everything an Associate can do, plus create Manager evaluations for direct reports, and Return or Approve their direct reports' evaluations, in both cases only those they did not author themselves, under the MR-REV-03 guards | Nothing beyond Associate |
| Administrator | All orders, all refunds, product and stock maintenance | All evaluations in every status, cycle status changes, cancel any evaluation | Create and deactivate users, assign roles, maintain `managerId`, end any user's session |

**The user record carries a `managerId`.** It is a single reference to another user, or null when that user has no manager. This is the field MR-REV-04 condition C4 tests, the field MR-REV-03 and MR-REV-05 mean by "the subject's manager", and the field this rule and MR-STO-08 mean by "direct reports". A user whose `managerId` is null has no manager, so every check phrased as "the subject's manager" fails closed for them rather than matching one null against another. Only an Administrator sets it.

**The three capability lists above are complete.** A capability not listed is not held, and that is the answer to the question this rule otherwise leaves open. Two consequences follow that are easy to assume otherwise: deactivation is one way, since no role holds a reactivate capability, and a Manager holds nothing in Platform beyond what an Associate holds.

**Credentials are deliberately unspecified.** A user signs in with an email address and a password, and an Associate may change their own. Nothing else about credentials is a Meridian rule: no storage scheme, no complexity requirement, and no lockout after repeated failures. The training application stores a salted digest that is adequate for a fixture and is not a scheme to copy, and no exercise in this program is written against password strength. An exercise that needs an authentication defect uses MR-PLT-02, MR-PLT-03, or MR-PLT-05, which are specified and testable.

**Changing a password, stated only as far as it needs to be.** The request carries the current password and the new one. The current password is verified before the change is written, and a request that fails that check is refused, changes no stored value, and leaves the session it arrived on untouched. No complexity rule is enforced, which follows from the paragraph above rather than being a separate decision. Existing sessions survive a password change, including the caller's own: MR-PLT-03 governs session lifetime and names two limits, and a password change is neither of them. A user who wants their other sessions ended asks an Administrator to end them, which MR-PLT-01 grants.

The refusal for a wrong current password is 401, matching what sign-in returns for the same mistake, and it is the one place in the application where 401 answers something other than the session state MR-PLT-02 describes. It is called out here rather than left to be inferred, because a test written from MR-PLT-02 alone would expect 422 and be wrong for a reason nothing else in the specification explains.

**A user may read who reports to them.** Any authenticated user may read their own direct reports, meaning the users whose `managerId` is the caller. The read returns each report's id, full name, and role, and nothing else. It grants nothing about any other user and it is not user administration, which stays Administrator-only: a Manager reading their own reports learns who they already hold capabilities over, while an Administrator creating a user, assigning a role, or setting a `managerId` is changing the organisation. A caller with no reports gets an empty list and not a refusal, because having nobody report to you is an ordinary fact about an organisation rather than an error.

This exists because two capabilities this specification already grants cannot be exercised without it. A Manager is granted "view orders placed by their direct reports" here and is required by MR-REV-04 to create evaluations for direct reports, and both need the Manager to know who those people are. The three capability lists above stay complete as a statement of what each role may do; this adds the read that makes two of the Manager's entries reachable.
Source: This specification. Implemented by the training application.

**MR-PLT-02.** Every request to `/api/v1` re-checks the caller's session and role on the server before it does any work. Hiding or disabling a control in the interface is presentation, not enforcement, and a request issued directly against the API must be refused on exactly the same terms as one issued through the interface.

Two endpoints are exempt, and only two: sign-in, which has no session to re-check, and sign-out, which is discarding the one it was given and must work even when that session has already expired. Every other request under `/api/v1` is covered without exception.

The two refusals are distinct and must not be interchanged. A missing, unknown, or expired session returns HTTP 401. A valid session whose role does not permit the action returns HTTP 403. In both cases no state changes, nothing is written to the database, and the response body carries no record data that the caller was not already entitled to read.

This is the rule that makes "it looks correct in the interface but the API allows it" a defect rather than a design choice. The paired test is always two-sided: confirm the control is absent for the role, then call the endpoint directly with that role's session and confirm the server refuses it.
Source: This specification. Implemented by the training application.

**MR-PLT-03.** A session expires on whichever of two limits is reached first. The idle limit is 30 minutes with no authenticated request. The absolute limit is 12 hours from sign-in and is not extended by activity. Both limits expire on being reached, not on being exceeded: elapsed time equal to the limit is already expired, so the test is `elapsed >= limit` and not `elapsed > limit`.

Every authenticated request resets the idle clock. A sign-in at 09:00:00 followed by a request at 09:29:59 keeps the session alive and moves the idle deadline to 09:59:59. The same sign-in with no request until exactly 09:30:00 finds the session already expired: that request returns 401, as does one at 09:30:01, and the interface returns the user to sign-in. The idle boundary values are therefore 09:29:59 alive, 09:30:00 expired, 09:30:01 expired. Regardless of how continuously the session is used, it ends at 21:00:00, 12 hours after sign-in, and a request timestamped exactly 21:00:00 returns 401.

Expiry is decided by the server against the stored session record. A client-side timer that clears the interface without invalidating the server session does not satisfy this rule.
Source: This specification. Implemented by the training application.

**MR-PLT-04.** Signing out deletes the server-side session record, not only the browser cookie. After sign-out, a request that presents the old session token returns 401 even if that token is still held by another open tab.

Sign-out is global to the session, so every open tab reaches the sign-in screen on its next authenticated request. Nothing moves a tab there sooner. The server has no channel to a tab that is not asking it anything, so a rule promising the tab responds within a fixed number of seconds would be a requirement no test could be traced to.

Two tabs signed in as different users are not supported. The rule is stated in terms the server can act on, because the server cannot observe browsers: a sign-in request that presents an existing session token deletes that session as part of signing in. The first tab is then holding a token whose record is gone, so its next request returns 401 rather than acting as the wrong user.
Source: This specification. Implemented by the training application.

**MR-PLT-05.** A role change or a deactivation takes effect on the user's next request, not at their next sign-in. Sessions carry a user reference, not a cached copy of the role, so the server reads the current role on every request.

Demoting a Manager to Associate mid-session means their next call to a Manager-only endpoint returns 403 even though the interface has not been reloaded. Deactivating a user ends their active sessions immediately and their next request returns 401. A deactivated user who is mid-workflow, such as a Manager holding evaluations in Submitted status, loses access at once; those evaluations stay in Submitted and are reachable by an Administrator, who may Return, Approve, or Cancel them under MR-REV-03.
Source: This specification. Implemented by the training application.

## 6. Conflicts found in the courseware

None recorded yet.

## 7. Canonical facts

`npm run check:canon` enforces the facts declared in the fenced block below against the top level of `Training Decks/` and `docs/`, plus `docs/research/`. Each line is `id | expected | pattern`, where `pattern` is a JavaScript regular expression; capture group 1 (or the whole match, if there is no group) must equal `expected` at every occurrence.

**Rules for editing this block.** All three exist because breaking one of them is how a checker that verifies nothing still passes.

1. **A value mismatch is a defect in the courseware or a defect in this spec, and is fixed by correcting whichever side is wrong.** It is never fixed by editing courseware to satisfy the pattern, and never by loosening the pattern's anchor until the disagreeing occurrence stops matching. Both make the run green while leaving the disagreement in place.
2. **The capture group must capture a variable, never the literal expected value.** An entry whose capture group contains its own expected value can only ever compare that value to itself, so it reports presence or absence and can never report a disagreement between two files. Such an entry is a presence test and must be labeled as one, both here and in `HANDOFF.md` Section 3.
3. **A literal `|` cannot appear in a pattern. Write `\x7C` instead.** The row parser splits each line on `|` before the pattern reaches the regex engine, so a literal pipe corrupts the row on rejoin. `\x7C` is the regex hex escape for the same character and survives the split. The `defect-id-format` entry below is the worked example: it anchors to a markdown table row, so every pipe in it is written `\x7C`.

```canon
# id | expected | pattern (capture group 1 is compared against expected)
# A literal | cannot appear in a pattern: the parser splits every row on | before the
# pattern reaches the regex engine. Write \x7C instead, as defect-id-format does below.
# Lines starting with # are comments and are skipped. See the editing rules above.
# Presence tests per rule 2, where the capture group can only appear or vanish and can
# never disagree: defect-id-format, discount-field-range, period-lock-rejection,
# self-approval-message, stock-adjustment-approved-status, pending-approval-status.
defect-id-format | DEF-0042 | \x7C Defect \x7C `DEF-####` \x7C `(DEF-\d{4})` \x7C
approver-limit | 10,000 | approve invoices up to \$([\d,]+)
three-way-match | three | Meridian(?:'s|\shas a|\simplementation uses a)\s(two|three)-way match
discount-field-range | 0 to 100 | discount field (?:that )?accepts (0 to 100)
early-payment-window | 10 | (?:payment (?:arrives|is)|\bpaid)\s+within (\d+) days
preferred-discount-small | 5 | small order gets (\d+)%
preferred-discount-full | 15 | small order gets \d+%, not (\d+)%
period-lock-rejection | closed accounting period cannot accept new postings | (closed accounting period cannot accept new postings)
self-approval-message | Self-approval is not permitted | (Self-approval is not permitted)
stock-adjustment-approved-status | Approved | status changes to (Approved)
pending-approval-status | Pending Approval | (Pending Approval) status
```

## 8. Freeze and amendment protocol

**This specification is frozen as of 2026-08-11**, at the close of Phase C.0. Phase B, the deck instructional overhaul, and Phase C, the Meridian training application, both build against the version frozen here and run in parallel on that basis.

**Owner.** ejsimoy owns this file. Phase C proposes amendments, the owner applies them, and both tracks are told. Two tracks editing the source of truth at once is the failure the freeze exists to prevent.

**Phase B owns the canon block in Section 7, and Phase C never edits it.** A canon entry for a new module rule fails with "matched nothing" until a deck states that rule, so those entries are added as Phase B writes the decks. If Phase C wants a fact enforced, it asks Phase B. The application is not in the checker's scanned set, so nothing Phase C writes can be checked by it in any case.

**Amending after the freeze is not forbidden, it is visible.** An amendment lands as a dated entry below, naming the rule, what changed, and which track raised it. Phase B checks this list before writing any deck content that touches an amended rule, and Phase C checks it before implementing one.

### Amendments after freeze

**2026-08-11, MR-STO-08, Administrator self-refund. Raised by Phase C.** The rule permitted an Administrator to refund any order including one they placed themselves, while barring a Manager from the same thing. Phase A flagged the asymmetry and C.0 implemented the rule as written. C.1 forced the question, because an interface has to decide whether to draw a Refund control on an Administrator's own order and there is no way to defer that decision. The rule now excludes an Administrator's own order on the same segregation-of-duties grounds the Manager bullet already gave, and states the consequence for a single-Administrator installation rather than leaving it to be discovered.

**2026-08-11, MR-PLT-01, password change behaviour. Raised by Phase C.** The rule granted an Associate the ability to change their own password while also stating that credentials are deliberately unspecified, which left an implementer with no behaviour to build. The rule now states the minimum: the request carries the current password and the new one, the current password is verified, no complexity rule is enforced, and existing sessions are unaffected because MR-PLT-03 governs session lifetime and a password change is not one of its limits. The 401 returned for a wrong current password is named explicitly, because it is the one place 401 answers something other than session state and a test written from MR-PLT-02 alone would expect 422.

**2026-08-11, MR-PLT-01, a user may read their own direct reports. Raised by Phase C.** The rule granted a Manager the ability to view orders placed by their direct reports, and MR-REV-04 requires a Manager to create evaluations for direct reports, but user administration is Administrator-only and the capability lists were frozen as complete. As written, a Manager held two capabilities they could not exercise, because nothing in the specification let them enumerate the people those capabilities are about. The rule now grants every authenticated user a read of their own direct reports, limited to id, full name, and role, and states that this is not user administration. It is recorded on the Associate row so that "a Manager holds nothing in Platform beyond what an Associate holds" stays true, and because an Associate calling it succeeds with an empty list rather than being refused.

This third one is worth noting beyond its own content. It was found by building an interface. Phase A's paper review did not find it and neither did C.0, which read every rule as an implementer and built a working API, because an API-only skeleton never has to render a list of people to choose from. That is evidence about what each kind of review actually catches, and it is recorded in `HANDOFF.md` alongside the CRLF and `node-gyp` findings for the same reason.

### What the Phase C.0 batch changed

Phase C.0 built a walking skeleton through Platform, Storefront, and Reviews to find what the specification left an implementer guessing at. Every ambiguity it found, the reading the skeleton chose, and the amendment proposed are recorded in that phase's ambiguity log, a facilitator note not published here. The amendments applied here:

| Rule | What changed |
|---|---|
| MR-PLT-01 | Declares the `managerId` field and who maintains it; states that the three capability lists are complete and that deactivation is one way; states that credentials are deliberately unspecified |
| MR-PLT-02 | Names the two exempt endpoints, sign-in and sign-out |
| MR-PLT-04 | Restates the second sign-in rule in terms the server can act on; drops the 5 second clause, which no test could be traced to |
| Storefront preamble | Adds the status code convention the module previously left unstated |
| MR-STO-01 | Fixes UTC as the timezone for every date comparison in the module |
| MR-STO-02 | States that a line snapshots its unit price, and that a product appears on at most one line |
| MR-STO-03 | Cross-references MR-STO-06's write lock, and the UTC date comparison |
| MR-STO-07 | States that payment capture is simulated and how the outcome is chosen |
| MR-REV-03 | Declares the comment and return reason fields and the return reason's lifecycle; names who may edit content; fixes the check order and says why it differs from MR-STO-08 |
| MR-REV-04 | Condition C5 now excludes Cancelled, so cancelling frees the combination |
| MR-REV-05 | States that excluding Draft and Returned from the subject manager's read set is deliberate, and names the consequence |
| MR-REV-06 | States that the cycle start and end dates are descriptive and constrain nothing |

No rule in Procurement and Payables, Inventory, Finance and GL, or People was touched, and neither was the canon block.
