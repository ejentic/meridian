'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { list, setStatus, type Cycle } from '../../../api/cycles';
import { ErrorBanner, type Refusal } from '../../../components/ErrorBanner';
import { StatusBadge } from '../../../components/StatusBadge';
import { useSession } from '../../../components/SessionProvider';

/**
 * MR-REV-06. Every role reads the cycles; only an Administrator changes a status.
 *
 * The transitions are Planned to Open and Open to Closed. Closed is terminal, so a closed
 * cycle carries no control at all: a cycle cannot be reopened, and there is nothing here
 * that pretends otherwise.
 *
 * The dates are shown because the rule names them and are labelled as descriptive, because
 * they look like controls and are not. A Planned cycle may be opened before its start date
 * and an Open one stays open past its end date until somebody closes it.
 */
export default function CyclesPage() {
  const { principal } = useSession();
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    const result = await list();
    if (result.ok) setCycles(result.data.cycles);
    else setRefusal(result);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // MR-PLT-02: computed on the client from the session. The endpoint refuses a
  // non-Administrator on its own terms, and the paired tests catch the two disagreeing.
  const isAdministrator = principal?.role === 'Administrator';

  function change(cycle: Cycle, to: 'Open' | 'Closed') {
    queue.current = queue.current.then(async () => {
      setRefusal(null);
      setBusy(true);
      try {
        const result = await setStatus(cycle.id, to);
        if (!result.ok) {
          setRefusal(result);
          return;
        }
        await load();
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <>
      <h1>Review cycles</h1>
      <p className="note">
        Planned becomes Open, and Open becomes Closed. Closed is terminal, per MR-REV-06.
      </p>

      <ErrorBanner refusal={refusal} />

      <table>
        <caption className="note">
          Start and end dates are descriptive and constrain nothing.
        </caption>
        <thead>
          <tr>
            <th className="numeric">Id</th>
            <th>Name</th>
            <th>Starts</th>
            <th>Ends</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cycles.map((cycle) => (
            <tr key={cycle.id}>
              <td className="numeric">{cycle.id}</td>
              <td>{cycle.name}</td>
              <td>{cycle.startDate}</td>
              <td>{cycle.endDate}</td>
              <td>
                {cycle.status} <StatusBadge status={cycle.status} />
              </td>
              <td>
                {!isAdministrator ? null : cycle.status === 'Planned' ? (
                  <button type="button" disabled={busy} onClick={() => change(cycle, 'Open')}>
                    Open cycle
                  </button>
                ) : cycle.status === 'Open' ? (
                  <button type="button" disabled={busy} onClick={() => change(cycle, 'Closed')}>
                    Close cycle
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
