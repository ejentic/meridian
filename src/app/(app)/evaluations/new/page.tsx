'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { list as listCycles, type Cycle } from '../../../../api/cycles';
import { create } from '../../../../api/evaluations';
import { list as listUsers, myReports, type UserRow } from '../../../../api/users';
import { ErrorBanner, type Refusal } from '../../../../components/ErrorBanner';
import { Field } from '../../../../components/Field';
import { useSession } from '../../../../components/SessionProvider';
import { mayEvaluate } from '../../../../rules/reviews';

interface Candidate {
  id: number;
  fullName: string;
}

/**
 * MR-REV-04. The subject picker offers only subjects the rule permits.
 *
 * The list of people comes from GET /users for an Administrator and GET /me/reports for
 * everybody else, plus the caller themselves, who every role may evaluate. Neither endpoint
 * answers "who may I evaluate", and neither should be changed to: that is the collapse
 * MR-PLT-02 forbids, because the server would then be deciding what this screen renders and
 * C.2 could no longer plant a defect in the gap between the two decisions. The rule is
 * applied here, to the people those endpoints returned.
 *
 * The cycle picker offers Open cycles only, per MR-REV-04 condition C1. The duplicate check,
 * condition C5, is not attempted here at all: it is a property of a combination rather than
 * of a person, and the server refuses it with 409.
 */
export default function NewEvaluationPage() {
  const router = useRouter();
  const { principal } = useSession();

  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [cycleId, setCycleId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (principal === null) return;

    void (async () => {
      const cycleList = await listCycles();
      if (cycleList.ok) setCycles(cycleList.data.cycles.filter((cycle) => cycle.status === 'Open'));

      const people: Candidate[] = [];
      let reportIds: number[] = [];

      if (principal.role === 'Administrator') {
        const users = await listUsers();
        if (users.ok) {
          people.push(
            ...users.data.users.map((user: UserRow) => ({ id: user.id, fullName: user.full_name }))
          );
        }
      } else {
        // Themselves, whom rule 2 permits every role to evaluate, plus their direct reports.
        people.push({ id: principal.userId, fullName: principal.fullName });

        const reports = await myReports();
        if (reports.ok) {
          reportIds = reports.data.reports.map((report) => report.id);
          people.push(
            ...reports.data.reports.map((report) => ({ id: report.id, fullName: report.fullName }))
          );
        }
      }

      const permitted = people
        .filter((person) => mayEvaluate(principal, person.id, reportIds))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));

      setCandidates(permitted);
      // No empty option: an Associate has exactly one permitted subject, and a picker whose
      // first entry is a blank they have to change is a step with no decision in it.
      if (permitted.length > 0) setSubjectId(String(permitted[0].id));
    })();
  }, [principal]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setRefusal(null);
    setBusy(true);

    try {
      const result = await create(Number(cycleId), Number(subjectId));
      if (!result.ok) {
        setRefusal(result);
        return;
      }
      router.push(`/evaluations/${result.data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Create evaluation</h1>
      <p className="note">
        The type is decided by the rule and is never chosen here: an evaluation of yourself is
        a Self evaluation, and one of somebody else is a Manager evaluation.
      </p>

      <ErrorBanner refusal={refusal} />

      <form onSubmit={submit} className="panel">
        <Field label="Cycle" htmlFor="cycle">
          <select id="cycle" value={cycleId} onChange={(event) => setCycleId(event.target.value)}>
            <option value="">Choose a cycle</option>
            {cycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Subject" htmlFor="subject">
          <select
            id="subject"
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
          >
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.fullName}
              </option>
            ))}
          </select>
        </Field>

        <button type="submit" className="primary" disabled={busy}>
          Create evaluation
        </button>
      </form>
    </>
  );
}
