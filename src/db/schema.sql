-- Meridian schema, Phase C.0 walking skeleton.
--
-- Covers only the three modules the training application implements: Platform,
-- Storefront, and Reviews. Procurement and Payables, Inventory, Finance and GL, and
-- People are documentation only and have no tables here, per docs/Meridian-System-Spec.md
-- Section 2.
--
-- Every table and column below is derived from a rule in Section 5. Columns the rules
-- depend on but never declare carry a comment saying so and have a row in the spec's
-- ambiguity log, a facilitator note not published here. Names follow the spec's own
-- vocabulary rather than synonyms, because Tasks 3 to 5 read them as a contract.
--
-- Money is INTEGER cents throughout, never a float, per MR-STO-01.
-- Instants are INTEGER milliseconds since the Unix epoch. Calendar dates that the rules
-- state as dates rather than instants are TEXT in ISO 8601 (YYYY-MM-DD).

-- Platform -------------------------------------------------------------------------

-- MR-PLT-01: exactly three roles, every user holds exactly one.
-- MR-PLT-05: a session carries a user reference, not a cached role, so role and active
-- are read from here on every request.
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  full_name     TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('Associate', 'Manager', 'Administrator')),
  -- Undeclared in the spec. MR-REV-04 condition C4, MR-REV-03's "the subject's manager",
  -- MR-PLT-01's Manager scoping, and MR-STO-08's "direct reports" all depend on it.
  manager_id    INTEGER REFERENCES users(id),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  -- Undeclared in the spec. MR-PLT-01 gives an Associate "change their own password", so
  -- credentials exist, but no rule states a storage or complexity scheme.
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL
);

-- MR-PLT-03: two independent expiry limits, both decided server side against this record.
-- created_at_ms carries the 12 hour absolute limit; last_seen_at_ms carries the 30 minute
-- idle limit and is reset by every authenticated request.
-- MR-PLT-04: sign-out deletes the row, so a token held by another tab stops working.
CREATE TABLE sessions (
  token           TEXT    PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  created_at_ms   INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL
);

-- Storefront -----------------------------------------------------------------------

-- MR-STO-07: on_hand_qty is an integer and may never go below 0.
CREATE TABLE products (
  id               INTEGER PRIMARY KEY,
  sku              TEXT    NOT NULL UNIQUE,
  name             TEXT    NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  on_hand_qty      INTEGER NOT NULL CHECK (on_hand_qty >= 0)
);

-- MR-STO-03: an integer rate from 1 to 50 inclusive, an active flag, and an expiry date.
-- A code is usable on and including expires_on.
CREATE TABLE discount_codes (
  id           INTEGER PRIMARY KEY,
  code         TEXT    NOT NULL UNIQUE,
  rate_percent INTEGER NOT NULL CHECK (rate_percent BETWEEN 1 AND 50),
  active       INTEGER NOT NULL CHECK (active IN (0, 1)),
  expires_on   TEXT    NOT NULL
);

-- MR-STO-06: exactly one of seven statuses.
-- MR-STO-03: at most one discount code per order, so this is a column and not a join table.
-- MR-STO-08: the refund amount is the difference from the current captured total, and the
-- shipping charge is held at the amount captured on the original order, so both are stored
-- rather than recomputed. captured_at_ms is one of the two timestamps the refund window is
-- measured between.
CREATE TABLE orders (
  id                      INTEGER PRIMARY KEY,
  user_id                 INTEGER NOT NULL REFERENCES users(id),
  status                  TEXT    NOT NULL CHECK (status IN (
                            'Cart', 'Pending Payment', 'Paid', 'Payment Failed',
                            'Partially Refunded', 'Refunded', 'Cancelled')),
  discount_code_id        INTEGER REFERENCES discount_codes(id),
  captured_total_cents    INTEGER,
  captured_shipping_cents INTEGER,
  captured_at_ms          INTEGER
);

-- MR-STO-08: a refund targets whole order lines, so refunded state lives on the line and
-- there is no partial-quantity refund. refunded_at_ms is the second of the two timestamps
-- the refund window is measured between.
-- unit_price_cents is a snapshot taken when the line is added. The spec does not say whether
-- a price change between Cart and capture applies; see the ambiguity log.
CREATE TABLE order_lines (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders(id),
  product_id       INTEGER NOT NULL REFERENCES products(id),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  refunded_at_ms   INTEGER
);

-- Reviews --------------------------------------------------------------------------

-- MR-REV-06: three statuses, Planned to Open and Open to Closed, Closed terminal.
-- start_date and end_date are recorded because the rule names them. No rule ties either
-- date to a status transition; see the ambiguity log.
CREATE TABLE review_cycles (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('Planned', 'Open', 'Closed'))
);

-- MR-REV-03: exactly one of six statuses.
-- MR-REV-04: type is Self when subject and evaluator are the same person, Manager otherwise.
-- MR-REV-04 condition C5 makes (cycle, subject, evaluator, type) the duplicate key, and
-- excludes Cancelled from it: a cancelled evaluation does not occupy the combination, so
-- cancelling is how an Administrator lets a mistaken evaluation be created again. That is
-- why this is a partial index and not a table-level UNIQUE constraint.
-- comment and return_reason are declared by MR-REV-03: one of each per evaluation, both
-- nullable, no maximum length.
CREATE TABLE evaluations (
  id            INTEGER PRIMARY KEY,
  cycle_id      INTEGER NOT NULL REFERENCES review_cycles(id),
  subject_id    INTEGER NOT NULL REFERENCES users(id),
  evaluator_id  INTEGER NOT NULL REFERENCES users(id),
  type          TEXT    NOT NULL CHECK (type IN ('Self', 'Manager')),
  status        TEXT    NOT NULL CHECK (status IN (
                  'Draft', 'Submitted', 'Returned', 'Approved', 'Acknowledged', 'Cancelled')),
  comment       TEXT,
  return_reason TEXT
);

CREATE UNIQUE INDEX evaluations_live_combination
  ON evaluations (cycle_id, subject_id, evaluator_id, type)
  WHERE status <> 'Cancelled';

-- MR-REV-01: exactly four fixed competencies, each an integer from 1 to 5 inclusive.
-- rating is nullable because a Draft may hold unrated competencies. All four rows exist
-- from creation so that "unrated" is a null rating rather than a missing row, which keeps
-- MR-REV-02's null overall score a single condition to evaluate.
CREATE TABLE competency_ratings (
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id),
  competency    TEXT    NOT NULL CHECK (competency IN (
                  'Quality of Work', 'Reliability', 'Collaboration', 'Initiative')),
  rating        INTEGER CHECK (rating BETWEEN 1 AND 5),
  PRIMARY KEY (evaluation_id, competency)
);
