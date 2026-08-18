'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { create, list, type UserRow } from '../../../../api/users';
import { ErrorBanner, type Refusal } from '../../../../components/ErrorBanner';
import { Field } from '../../../../components/Field';
import { useSession } from '../../../../components/SessionProvider';
import type { Role } from '../../../../shared/types';

const ROLES: Role[] = ['Associate', 'Manager', 'Administrator'];

/**
 * MR-PLT-01: creating a user is Administrator only.
 *
 * There is no "active" control. A created user is active and the freeze says deactivation is
 * one way, so an inactive user is a state this screen cannot produce or undo.
 */
export default function NewUserPage() {
  const router = useRouter();
  const { principal } = useSession();
  const [candidates, setCandidates] = useState<UserRow[]>([]);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('Associate');
  const [managerId, setManagerId] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await list();
      if (result.ok) setCandidates(result.data.users);
    })();
  }, []);

  const isAdministrator = principal?.role === 'Administrator';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setRefusal(null);

    const result = await create({
      email,
      fullName,
      password,
      role,
      managerId: managerId === '' ? null : Number(managerId),
    });

    if (result.ok) {
      router.push('/users');
      return;
    }

    setRefusal(result);
    setBusy(false);
  }

  return (
    <>
      <h1>Create user</h1>
      <ErrorBanner refusal={refusal} />

      {/* MR-PLT-02: the form itself is the control, so a role that may not create users is
          not offered one. The endpoint refuses them regardless, which is the paired half. */}
      {!isAdministrator ? (
        <p className="note">Creating users is Administrator only, per MR-PLT-01.</p>
      ) : (
        <form onSubmit={submit} className="panel">
          <Field label="Email" htmlFor="email">
            <input id="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Full name" htmlFor="full-name">
            <input
              id="full-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Role" htmlFor="role">
            <select
              id="role"
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Manager" htmlFor="manager">
            <select
              id="manager"
              value={managerId}
              onChange={(event) => setManagerId(event.target.value)}
            >
              {/* MR-PLT-01: managerId is a reference to another user, or null. */}
              <option value="">None</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.full_name}
                </option>
              ))}
            </select>
          </Field>

          <button type="submit" className="primary" disabled={busy}>
            Create user
          </button>
        </form>
      )}
    </>
  );
}
