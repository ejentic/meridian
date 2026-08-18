# Meridian Test Data

Everything in the seed fixture is deterministic: every id, price, date, and salt is fixed, and nothing reads the wall clock. That is deliberate. Boundary tests assert against these exact values, and a fixture that drifted with the calendar would make tests fail on a Tuesday for no reason a tester could act on.

`npm run db:reset` restores everything on this page. The source of truth is `src/db/seed.ts`; if this page and that file ever disagree, the file wins and this page has a defect.

## Users

Password for every account: **`meridian`**.

| ID | Email | Full name | Role | Manager |
|---|---|---|---|---|
| 1 | `admin01@meridian-corp.test` | Avery Cruz | Administrator | none |
| 2 | `manager01@meridian-corp.test` | Blair Santos | Manager | admin01 |
| 3 | `associate01@meridian-corp.test` | Casey Lim | Associate | manager01 |
| 4 | `associate02@meridian-corp.test` | Devon Reyes | Associate | manager01 |
| 5 | `associate03@meridian-corp.test` | Emery Tan | Associate | admin01 |

**Why the shape matters:**

- `manager01` has exactly two direct reports: `associate01` and `associate02`. Those are the only orders they may refund and the only people they may evaluate.
- `associate03` reports to the **Administrator**, not to `manager01`. This user exists to make the negative cases testable: `manager01` attempting to evaluate or refund for `associate03` must be refused with 403 (spec rules MR-REV-04 rule 7 and MR-STO-08). Without this user, "a Manager may act only on direct reports" would have no reachable counter-example.
- There is exactly **one Administrator**. Combined with the rule that nobody refunds an order they placed themselves, this means an order placed by `admin01` cannot be refunded at all in the seed data. The spec (MR-STO-08) states this is intended, not an oversight.

## Products

All quantities are on-hand stock; carts do not reserve stock (MR-STO-07).

| ID | SKU | Name | Unit price | On hand |
|---|---|---|---|---|
| 1 | STO-0001 | Harmony Studio Monitor | $49.90 | 100 |
| 2 | STO-0002 | Harmony Field Recorder | $49.90 | 100 |
| 3 | STO-0003 | Harmony Cable Kit | $49.90 | 100 |
| 4 | STO-0004 | Harmony Pop Filter | $14.55 | 100 |
| 5 | STO-0005 | Harmony Console | $210.00 | 100 |
| 6 | STO-0006 | Harmony Cable, Short | $12.10 | 100 |
| 7 | STO-0007 | Harmony Cable, Long | $12.10 | 100 |
| 8 | STO-0008 | Harmony Cable, Coiled | $12.10 | 100 |
| 9 | STO-0009 | Harmony Case, Last Unit | $99.00 | **1** |

The prices are not arbitrary. Each exists to reproduce a worked example published in the [System Spec](Meridian-System-Spec.md):

- **Three lines at $49.90** (products 1–3) with code `SAVE10` reproduce the MR-STO-02 worked example exactly: order total **$157.85**, and the three-step refund sequence $48.62 + $48.61 + $60.62 that sums back to it without a cent of residue (MR-STO-08).
- **$49.90 + $14.55** (products 1 and 4) with `SAVE10` produce a subtotal of $64.45, whose discount (6.445) and tax (4.785) are both **exact half-cent ties**. This cart decides the rounding mode: only half-up at both points gives the correct $74.79 with the correct line values (MR-STO-04, worked example 2).
- **Three lines at $12.10** (products 6–8) prove tax must be computed at order level: per-line tax sums to $3.00, order-level tax is $2.99 (MR-STO-04, worked example 1).
- **$210.00** (product 5) with `SAVE10` lands the discounted subtotal at $189.00 — above the $200 free-shipping threshold before the discount, below it after. It exists to show the threshold is tested against the *discounted* subtotal (MR-STO-05).
- **One unit on hand** (product 9) is the "two checkouts compete for the last unit" race from MR-STO-07: exactly one order may reach Paid.

## Discount codes

| Code | Rate | Active | Expires | Purpose |
|---|---|---|---|---|
| `SAVE10` | 10% | yes | 2026-12-31 | The workhorse code used by all the worked examples |
| `SAVE01` | 1% | yes | 2026-12-31 | Lower boundary of the valid rate range (1–50) |
| `SAVE50` | 50% | yes | 2026-12-31 | Upper boundary of the valid rate range |
| `LAPSED` | 10% | yes | 2026-01-01 | Expired: usable **on** its expiry date, refused the day after, compared on the UTC calendar date (MR-STO-03 / MR-STO-01) |
| `SWITCHEDOFF` | 10% | **no** | 2026-12-31 | Inactive: refused with 422 regardless of dates |

An unknown, inactive, or expired code returns **422**. At most one code per order; applying a second replaces the first (MR-STO-03).

## Review cycles

| ID | Name | Start | End | Status |
|---|---|---|---|---|
| 1 | 2026 Annual Review | 2026-01-01 | 2026-12-31 | **Open** |
| 2 | 2025 Annual Review | 2025-01-01 | 2025-12-31 | **Closed** |
| 3 | 2027 Annual Review | 2027-01-01 | 2027-12-31 | **Planned** |

One cycle in each status, so every cycle-state rule is reachable immediately:

- Evaluations can be created only in the **Open** cycle (MR-REV-04 condition C1).
- Any write into the **Closed** cycle returns **422** — including transitions that would otherwise be legal, and *before* the transition check runs, so you never see the 409 the transition alone would give (MR-REV-06). This mirrors a closed accounting period.
- The **Planned** cycle can be opened by the Administrator; note the start/end dates are descriptive only and constrain nothing (MR-REV-06).

## What is deliberately empty

The fixture seeds **no orders, no evaluations, and no sessions**. Every workflow starts from a clean slate, so whatever state you find mid-exercise is state you (or a fellow trainee on the same machine) created. `npm run db:reset` prints the row count of every table precisely so you can verify you are starting from zero.

## Databases the app uses

| File | Used by | Notes |
|---|---|---|
| `meridian.db` | `npm run dev` and `npm run db:reset` | Your working data |
| `meridian-e2e.db` | `npm run e2e` | The test suite's own file, so a test run never wipes your demo data |
| in-memory | `npm test` | Each unit test file gets its own throwaway database |

Both files are gitignored; the schema (`src/db/schema.sql`) and seed (`src/db/seed.ts`) are the durable record.

## Looking inside the database

`meridian.db` is an ordinary SQLite file sitting in the repository root (it appears after your first `npm run db:reset`). Being able to open it and check what a test actually wrote is a core QA skill — the UI shows you what the app *chooses* to display, the database shows you what is *true*.

Two easy ways to open it:

- **DB Browser for SQLite** — a free desktop app for Windows, macOS, and Linux, from [sqlitebrowser.org](https://sqlitebrowser.org). Install it, choose **Open Database**, pick `meridian.db`, and use the **Browse Data** tab to inspect tables or the **Execute SQL** tab to run queries.
- **VS Code** — if you already use VS Code, install the **SQLite Viewer** extension from the marketplace, then click `meridian.db` in the file explorer.

The table layout is defined in `src/db/schema.sql`, which is short and readable — table names match what you would guess: `users`, `products`, `discount_codes`, `orders`, `order_lines`, `evaluations`, `competency_ratings`, `review_cycles`, `sessions`.

A query worth trying after you place an order in the app:

```sql
SELECT o.id, o.status, u.email, l.quantity, p.name
FROM orders o
JOIN users u ON u.id = o.user_id
JOIN order_lines l ON l.order_id = o.id
JOIN products p ON p.id = l.product_id;
```

Two rules of the road:

- **Reading while `npm run dev` is running is fine.** Keeping the file open in a viewer that holds a write lock can occasionally make the app's own writes fail, so if you see database errors in the app, close the viewer (or its transaction) and retry.
- **Don't fix data by hand.** Editing rows in a viewer puts the database in a state no rule produced, and every test you run afterwards is testing that invented state. When your data is a mess, `npm run db:reset` (with the dev server stopped) returns you to the known fixture — that is what it is for.
