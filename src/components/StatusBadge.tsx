'use client';

/**
 * Renders a status exactly as the server spelled it.
 *
 * No abbreviation and no re-wording. MR-STO-06 and MR-REV-03 name their statuses precisely,
 * and a worksheet that says "confirm the order reaches Payment Failed" has to be checkable
 * against the words on the screen.
 */
export function StatusBadge({ status }: { status: string }) {
  return <span className="badge">{status}</span>;
}
