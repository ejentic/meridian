'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { list, type UserRow } from '../../../api/users';
import { DataTable } from '../../../components/DataTable';
import { ErrorBanner, type Refusal } from '../../../components/ErrorBanner';
import { useSession } from '../../../components/SessionProvider';

/**
 * MR-PLT-01: the user list is Administrator only.
 *
 * The screen always issues the request and shows whatever comes back. It does not check the
 * role first and skip the call, because a 403 arriving here is a finding worth seeing: the
 * navigation entry should not have been rendered, and hiding the refusal would hide the
 * disagreement between the two checks MR-PLT-02 keeps independent.
 */
export default function UsersPage() {
  const { principal } = useSession();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await list();
      if (result.ok) {
        setUsers(result.data.users);
        setRefusal(null);
      } else {
        setUsers(null);
        setRefusal(result);
      }
    })();
  }, []);

  const isAdministrator = principal?.role === 'Administrator';

  return (
    <>
      <h1>Users</h1>
      <p className="note">
        Creating users, assigning roles, and maintaining reporting lines. Administrator only,
        per MR-PLT-01.
      </p>

      <ErrorBanner refusal={refusal} />

      {/* MR-PLT-02: drawn from the session on the client, never from a server permissions
          response. The server decides the request; this decides the screen. */}
      {isAdministrator ? (
        <p>
          <Link href="/users/new">Create user</Link>
        </p>
      ) : null}

      {users === null ? null : (
        <DataTable
          caption="Every user in this installation."
          rows={users}
          rowKey={(user) => user.id}
          columns={[
            { header: 'Id', numeric: true, cell: (user) => user.id },
            { header: 'Name', cell: (user) => <Link href={`/users/${user.id}`}>{user.full_name}</Link> },
            { header: 'Email', cell: (user) => user.email },
            { header: 'Role', cell: (user) => user.role },
            {
              header: 'Manager',
              cell: (user) =>
                user.manager_id === null
                  ? 'None'
                  : (users.find((u) => u.id === user.manager_id)?.full_name ?? user.manager_id),
            },
            { header: 'State', cell: (user) => (user.active === 1 ? 'Active' : 'Inactive') },
          ]}
        />
      )}
    </>
  );
}
