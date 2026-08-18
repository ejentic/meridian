'use client';

/**
 * A labelled control with room for a field-level message.
 *
 * The label is associated by `htmlFor` and the caller puts the matching `id` on the control.
 * Wrapping the control in the label instead would be less typing and is wrong here: a
 * wrapped <select> contributes its option text to the label's accessible name, so a Role
 * select whose options include "Manager" becomes indistinguishable from the Manager select
 * next to it, and every test addressing either one matches both.
 *
 * Addressing controls by their visible label rather than by a test id is deliberate. It
 * keeps the end-to-end specs honest about what a person can actually see and read.
 *
 * `error` carries a 422 that named this field. Per the design, a 422 lands on the offending
 * field where the message names one and raises the banner otherwise.
 */
export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
