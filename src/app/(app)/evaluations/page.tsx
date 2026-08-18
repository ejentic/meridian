'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { list, type EvaluationSummary } from '../../../api/evaluations';
import { list as listCycles, type Cycle } from '../../../api/cycles';
import { DataTable } from '../../../components/DataTable';
import { ErrorBanner, type Refusal } from '../../../components/ErrorBanner';
import { StatusBadge } from '../../../components/StatusBadge';

/**
 * MR-REV-05 decides which rows arrive, and it decides that on the server.
 *
 * Nothing is filtered here. The scope is status-dependent, so which evaluations a caller can
 * see changes as they move: a subject sees a Manager-type evaluation only once it is
 * Approved, and a manager who returns one can no longer read it. A row that is missing from
 * this screen is missing because the server did not send it, which is what MR-REV-05 means
 * by the data not leaving the server.
 */
export default function EvaluationsPage() {
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  useEffect(() => {
    void (async () => {
      const [found, cycleList] = await Promise.all([list(), listCycles()]);
      if (found.ok) setEvaluations(found.data.evaluations);
      else setRefusal(found);
      if (cycleList.ok) setCycles(cycleList.data.cycles);
    })();
  }, []);

  const cycleName = (cycleId: number) =>
    cycles.find((cycle) => cycle.id === cycleId)?.name ?? `Cycle ${cycleId}`;

  return (
    <>
      <h1>Evaluations</h1>
      <p className="note">
        Every evaluation you are permitted to read, per MR-REV-05. Ratings and comments are
        on the evaluation itself.
      </p>

      <ErrorBanner refusal={refusal} />

      <p>
        <Link href="/evaluations/new">Create evaluation</Link>
      </p>

      <DataTable
        caption="Evaluations in scope for you."
        rows={evaluations}
        rowKey={(evaluation) => evaluation.id}
        empty="No evaluations you may read."
        columns={[
          {
            header: 'Id',
            numeric: true,
            cell: (evaluation) => (
              <Link href={`/evaluations/${evaluation.id}`}>{evaluation.id}</Link>
            ),
          },
          { header: 'Cycle', cell: (evaluation) => cycleName(evaluation.cycleId) },
          { header: 'Subject', numeric: true, cell: (evaluation) => evaluation.subjectId },
          { header: 'Evaluator', numeric: true, cell: (evaluation) => evaluation.evaluatorId },
          { header: 'Type', cell: (evaluation) => evaluation.type },
          {
            header: 'Status',
            cell: (evaluation) => <StatusBadge status={evaluation.status} />,
          },
        ]}
      />
    </>
  );
}
