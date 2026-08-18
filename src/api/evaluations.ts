'use client';

import type {
  Band,
  EvaluationEvent,
  EvaluationStatus,
  EvaluationType,
} from '../shared/types';
import { get, post, type ApiResult } from './client';

export interface EvaluationSummary {
  id: number;
  cycleId: number;
  subjectId: number;
  evaluatorId: number;
  type: EvaluationType;
  status: EvaluationStatus;
}

export interface EvaluationDetail extends EvaluationSummary {
  comment: string | null;
  returnReason: string | null;
  /** Four entries in COMPETENCIES order. Null is unrated, and is not a rating of zero. */
  ratings: (number | null)[];
  overallTenths: number | null;
  overall: number | null;
  band: Band | null;
}

export const list = (): Promise<ApiResult<{ evaluations: EvaluationSummary[] }>> =>
  get('/evaluations');

export const read = (id: number): Promise<ApiResult<EvaluationDetail>> => get(`/evaluations/${id}`);

/** MR-REV-04. The type is decided by the rule and is never supplied by the caller. */
export const create = (
  cycleId: number,
  subjectId: number
): Promise<ApiResult<{ id: number }>> => post('/evaluations', { cycleId, subjectId });

export const writeContent = (
  id: number,
  content: { ratings?: Record<string, number>; comment?: string }
): Promise<ApiResult<unknown>> => post(`/evaluations/${id}/content`, content);

export const fire = (
  id: number,
  event: EvaluationEvent,
  returnReason?: string
): Promise<ApiResult<{ status: EvaluationStatus }>> =>
  post(`/evaluations/${id}/transitions`, { event, returnReason });
