'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { deactivate, endSessions, list, update, type UserRow } from '../../../../api/users';
import { ErrorBanner, type Refusal } from '../../../../components/ErrorBanner';
import { Field } from '../../../../components/Field';
import { useSession } from '../../../../components/SessionProvider';
import type { Role } from '../../../../shared/types';

const ROLES: Role[] = ['Associate', 'Manager', 'Administrator'];

/**
 * MR-PLT-01: assigning a role, maintaining `managerId`, deactivating, and ending sessions.
 * All four are Administrator only.
 *
 * The record is read out of GET /users rather than through a per-user endpoint. That read is
 * already Administrator-only and these controls are too, so a second endpoint would add API
 * surface without adding a capability MR-PLT-01 grants, and the frozen lists are what bound
 * this application.
 */
export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = Number(params.id);
  const { principal } = useSession();

  const [user, setUser] = useState<UserRow | null>(null);
  const [everyone, setEveryone] = useState<UserRow[]>([]);
  /**
   * Edits are held separately from the fetched record, and null means "not edited".
   *
   * Seeding the form fields directly from each load looks simpler and is wrong: a refetch
   * that lands after somebody has changed the Role select overwrites their choice with the
   * value still on the server, and the screen then saves a change they did not make. It is
   * invisible when a fetch is fast and appears when it is slow, which is the worst shape a
   * defect can have in a fixture whose purpose is teaching people to trust what they see.
   */
  const [roleEdit, setRoleEdit] = useState<Role | null>(null);
  const [managerEdit, setManagerEdit] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Closed while a write is in flight, so a second click cannot overtake the first and
  // leave the screen showing a record the server never wrote.
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await list();
    if (!result.ok) {
      setRefusal(result);
      setUser(null);
      return;
    }

    const found = result.data.users.find((candidate) => candidate.id === userId) ?? null;
    setEveryone(result.data.users);
    setUser(found);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isAdministrator = principal?.role === 'Administrator';

  // What the controls show: the pending edit if there is one, otherwise the stored record.
  const role: Role = roleEdit ?? user?.role ?? 'Associate';
  const managerId =
    managerEdit ?? (user == null || user.manager_id === null ? '' : String(user.manager_id));

  async function act(
    action: () => Promise<{ ok: boolean } & Record<string, unknown>>,
    confirmation: string
  ) {
    setRefusal(null);
    setSaved(null);
    setBusy(true);

    try {
      const result = await action();
      if (!result.ok) {
        setRefusal(result as Refusal);
        return;
      }

      // No cache to invalidate, so the record is read again from the server, and the edits
      // are dropped so what shows is the record rather than what this screen believed it
      // sent. If the two differ, the difference is the finding.
      setRoleEdit(null);
      setManagerEdit(null);
      await load();
      setSaved(confirmation);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>{user === null ? `User ${params.id}` : user.full_name}</h1>

      <ErrorBanner refusal={refusal} />
      {saved === null ? null : (
        <p className="note" data-testid="saved">
          {saved}
        </p>
      )}

      {user === null ? null : (
        <>
          <div className="panel">
            <p>
              {user.email} &middot; <span data-testid="active-state">{user.active === 1 ? 'Active' : 'Inactive'}</span>
            </p>

            {/* MR-PLT-02: every control below is drawn from the caller's role held on the
                client. The API re-checks the same rule on each request and can refuse one
                this screen chose to draw, which is the disagreement the paired tests hunt. */}
            {isAdministrator ? (
              <>
                <Field label="Role" htmlFor="role">
                  <select
                    id="role"
                    value={role}
                    onChange={(event) => setRoleEdit(event.target.value as Role)}
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
                    onChange={(event) => setManagerEdit(event.target.value)}
                  >
                    <option value="">None</option>
                    {everyone
                      .filter((candidate) => candidate.id !== user.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.full_name}
                        </option>
                      ))}
                  </select>
                </Field>

                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () =>
                          update(user.id, {
                            role,
                            managerId: managerId === '' ? null : Number(managerId),
                          }),
                        'Changes saved.'
                      )
                    }
                  >
                    Save changes
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => endSessions(user.id), 'Sessions ended.')}
                  >
                    End sessions
                  </button>

                  {/* MR-PLT-01: deactivation is one way, so this disappears once used and
                      there is no control anywhere that undoes it. */}
                  {user.active === 1 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(() => deactivate(user.id), 'User deactivated.')}
                    >
                      Deactivate user
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="note">
                Changing a role, a reporting line, or a session is Administrator only, per
                MR-PLT-01.
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}
