'use client';

import type { ApiResult } from '../api/client';

/**
 * Shows a refusal with its status code visible.
 *
 * The code is on the screen on purpose. Trainees have to learn to tell 401, 403, 409, and
 * 422 apart, and an interface that flattens them into "Something went wrong" removes the
 * evidence the exercises depend on.
 *
 * Reaching a 403 through the interface is itself a finding: the control should not have been
 * rendered, so a banner reading 403 is reporting a disagreement between the two checks
 * MR-PLT-02 keeps independent.
 */
export type Refusal = Extract<ApiResult<unknown>, { ok: false }>;

export function ErrorBanner({ refusal }: { refusal: Refusal | null }) {
  if (refusal === null) return null;

  // role="alert" is what a screen reader needs. The test id is there because Next's own
  // route announcer is also a role="alert" region, so addressing the banner by role alone
  // matches two elements and every spec that did it would fail on the wrong thing.
  return (
    <div className="error-banner" role="alert" data-testid="error-banner">
      <strong>{refusal.status}</strong> {refusal.error}: {refusal.message}
    </div>
  );
}
