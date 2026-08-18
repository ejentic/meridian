// Types both the server and the browser need. This module imports nothing, deliberately:
// src/lib/ reaches better-sqlite3 through getDb, and a client component that imported a
// type from there could pull a native module into the browser bundle.

export type Role = 'Associate' | 'Manager' | 'Administrator';

export interface Principal {
  userId: number;
  role: Role;
  managerId: number | null;
}

/**
 * What GET /api/v1/me returns: the principal the server authorises with, plus the identity
 * the shell header displays.
 *
 * Principal itself stays exactly what authz needs, so nothing on the server can start making
 * a decision out of a display field. The name and address are the caller's own record, which
 * every role may read under MR-PLT-01, so this grants nothing new.
 */
export interface Me extends Principal {
  fullName: string;
  email: string;
}

export type OrderStatus =
  | 'Cart'
  | 'Pending Payment'
  | 'Paid'
  | 'Payment Failed'
  | 'Partially Refunded'
  | 'Refunded'
  | 'Cancelled';

export type CaptureOutcome = 'success' | 'decline';

export type EvaluationStatus =
  | 'Draft'
  | 'Submitted'
  | 'Returned'
  | 'Approved'
  | 'Acknowledged'
  | 'Cancelled';

export type EvaluationType = 'Self' | 'Manager';
export type EvaluationEvent = 'Submit' | 'Cancel' | 'Return' | 'Approve' | 'Acknowledge';
export type CycleStatus = 'Planned' | 'Open' | 'Closed';
export type Band = 'Needs Improvement' | 'Meets Expectations' | 'Exceeds Expectations';

export const COMPETENCIES = [
  'Quality of Work',
  'Reliability',
  'Collaboration',
  'Initiative',
] as const;

export type Competency = (typeof COMPETENCIES)[number];
