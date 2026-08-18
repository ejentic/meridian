'use client';

import { useState } from 'react';
import { changeOwnPassword } from '../../../../api/users';
import { ErrorBanner, type Refusal } from '../../../../components/ErrorBanner';
import { Field } from '../../../../components/Field';
import { useSession } from '../../../../components/SessionProvider';

/**
 * MR-PLT-01 as amended 2026-08-11. Every role changes their own password, so there is no
 * role check here and no control to hide.
 *
 * The session survives the change, per MR-PLT-03, so nothing here signs the user out. A
 * screen that bounced them to sign-in would be enforcing a session limit the rule does not
 * state.
 */
export default function ChangePasswordPage() {
  const { principal } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setRefusal(null);
    setSaved(false);

    const result = await changeOwnPassword(currentPassword, newPassword);
    if (result.ok) {
      setSaved(true);
      setCurrentPassword('');
      setNewPassword('');
    } else {
      setRefusal(result);
    }
    setBusy(false);
  }

  return (
    <>
      <h1>Change password</h1>
      <p className="note">
        Signed in as {principal?.email ?? 'nobody'}. No complexity rule is enforced, per
        MR-PLT-01.
      </p>

      <ErrorBanner refusal={refusal} />
      {saved ? (
        <p className="note" data-testid="saved">
          Password changed. Your session is unaffected.
        </p>
      ) : null}

      <form onSubmit={submit} className="panel">
        <Field label="Current password" htmlFor="current-password">
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field label="New password" htmlFor="new-password">
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        <button type="submit" className="primary" disabled={busy}>
          Change password
        </button>
      </form>
    </>
  );
}
