'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fire, read, writeContent, type EvaluationDetail } from '../../../../api/evaluations';
import { myReports } from '../../../../api/users';
import { ErrorBanner, type Refusal } from '../../../../components/ErrorBanner';
import { Field } from '../../../../components/Field';
import { StatusBadge } from '../../../../components/StatusBadge';
import { useSession } from '../../../../components/SessionProvider';
import { isContentEditable, permittedEvents } from '../../../../rules/reviews';
import { COMPETENCIES, type EvaluationEvent } from '../../../../shared/types';

const RETURN_REASON_PROMPT = 'Please expand the ratings and resubmit.';

export default function EvaluationDetailPage() {
  const params = useParams<{ id: string }>();
  const evaluationId = Number(params.id);
  const { principal } = useSession();

  const [evaluation, setEvaluation] = useState<EvaluationDetail | null>(null);
  const [reportIds, setReportIds] = useState<number[]>([]);
  /** Pending edits, kept separate from the record so a refetch cannot overwrite them. */
  const [ratingEdits, setRatingEdits] = useState<Record<string, string>>({});
  const [commentEdit, setCommentEdit] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    const result = await read(evaluationId);
    if (result.ok) {
      setEvaluation(result.data);
      setRefusal(null);
    } else {
      setEvaluation(null);
      setRefusal(result);
    }
  }, [evaluationId]);

  useEffect(() => {
    void load();
    void (async () => {
      const reports = await myReports();
      if (reports.ok) setReportIds(reports.data.reports.map((report) => report.id));
    })();
  }, [load]);

  function run(action: () => Promise<{ ok: boolean } & Record<string, unknown>>, confirmation?: string) {
    queue.current = queue.current.then(async () => {
      setRefusal(null);
      setSaved(null);
      setBusy(true);

      try {
        const result = await action();
        if (!result.ok) {
          setRefusal(result as Refusal);
          return;
        }
        setRatingEdits({});
        setCommentEdit(null);
        await load();
        if (confirmation !== undefined) setSaved(confirmation);
      } finally {
        setBusy(false);
      }
    });
  }

  if (evaluation === null || principal === null) {
    return (
      <>
        <h1>Evaluation {params.id}</h1>
        <ErrorBanner refusal={refusal} />
      </>
    );
  }

  /**
   * The subject's manager, per MR-REV-03's "who may fire it".
   *
   * Derived from the caller's own reports: if the subject is one of them, the caller is the
   * subject's manager. A caller who is not gets null, which fails closed exactly as
   * MR-PLT-01 says a null `managerId` should. Nothing asks the server who the subject's
   * manager is, because that would be the server deciding what this screen may draw.
   */
  const subjectManagerId = reportIds.includes(evaluation.subjectId) ? principal.userId : null;

  const events = permittedEvents(
    {
      status: evaluation.status,
      evaluatorId: evaluation.evaluatorId,
      subjectId: evaluation.subjectId,
      subjectManagerId,
    },
    principal
  );

  const editable = isContentEditable(evaluation, principal);

  const ratingValue = (competency: string, index: number) =>
    ratingEdits[competency] ?? (evaluation.ratings[index] === null ? '' : String(evaluation.ratings[index]));

  const commentValue = commentEdit ?? evaluation.comment ?? '';

  function saveContent() {
    const ratings: Record<string, number> = {};
    for (const [competency, value] of Object.entries(ratingEdits)) {
      if (value !== '') ratings[competency] = Number(value);
    }
    run(() => writeContent(evaluation!.id, { ratings, comment: commentValue }), 'Content saved.');
  }

  return (
    <>
      <h1>Evaluation {evaluation.id}</h1>
      <ErrorBanner refusal={refusal} />
      {saved === null ? null : (
        <p className="note" data-testid="saved">
          {saved}
        </p>
      )}

      <div className="panel">
        <p>
          Status: <span data-testid="evaluation-status">{evaluation.status}</span>{' '}
          <StatusBadge status={evaluation.status} />
        </p>
        <p>
          {evaluation.type} evaluation. Subject {evaluation.subjectId}, evaluator{' '}
          {evaluation.evaluatorId}.
        </p>
        <p>
          {/* MR-REV-02: null is neither displayed as 0.0 nor treated as a rating of zero. */}
          Overall:{' '}
          <span data-testid="overall">
            {evaluation.overall === null ? 'Not yet scored' : evaluation.overall.toFixed(1)}
          </span>{' '}
          &middot; Band: <span data-testid="band">{evaluation.band ?? 'Not yet scored'}</span>
        </p>
        {evaluation.returnReason === null ? null : (
          <p className="note">Return reason: {evaluation.returnReason}</p>
        )}
      </div>

      <h2>Content</h2>
      {/* MR-REV-03: ratings and comments are editable only in Draft or Returned, by the
          evaluator or an Administrator. Outside that the server refuses the write with 409. */}
      {editable ? (
        <div className="panel">
          {COMPETENCIES.map((competency, index) => (
            <Field key={competency} label={competency} htmlFor={`rating-${index}`}>
              <select
                id={`rating-${index}`}
                value={ratingValue(competency, index)}
                onChange={(event) =>
                  setRatingEdits({ ...ratingEdits, [competency]: event.target.value })
                }
              >
                {/* MR-REV-01: an integer from 1 to 5 inclusive, and nothing else. A Draft
                    may hold unrated competencies, which is what the empty option is. */}
                <option value="">Unrated</option>
                {[1, 2, 3, 4, 5].map((rating) => (
                  <option key={rating} value={rating}>
                    {rating}
                  </option>
                ))}
              </select>
            </Field>
          ))}

          <Field label="Comment" htmlFor="comment">
            <textarea
              id="comment"
              value={commentValue}
              onChange={(event) => setCommentEdit(event.target.value)}
            />
          </Field>

          <button type="button" className="primary" disabled={busy} onClick={saveContent}>
            Save content
          </button>
        </div>
      ) : (
        <div className="panel">
          <table>
            <tbody>
              {COMPETENCIES.map((competency, index) => (
                <tr key={competency}>
                  <th>{competency}</th>
                  <td className="numeric">{evaluation.ratings[index] ?? 'Unrated'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{evaluation.comment ?? 'No comment.'}</p>
          <p className="note">
            Content is editable only in Draft or Returned, per MR-REV-03. This evaluation is
            in {evaluation.status}.
          </p>
        </div>
      )}

      <h2>Transitions</h2>
      <p className="note">
        Exactly the events MR-REV-03 lets you fire from {evaluation.status}. The guards, such
        as a complete set of ratings before Submit, are checked by the server, so a control
        being present does not mean the transition will be accepted.
      </p>
      <div className="actions">
        {events.length === 0 ? (
          <span className="note">Nothing you may do from this status.</span>
        ) : (
          events.map((event: EvaluationEvent) => (
            <button
              key={event}
              type="button"
              disabled={busy}
              onClick={() =>
                run(() =>
                  fire(evaluation.id, event, event === 'Return' ? RETURN_REASON_PROMPT : undefined)
                )
              }
            >
              {event}
            </button>
          ))
        )}
      </div>
    </>
  );
}
