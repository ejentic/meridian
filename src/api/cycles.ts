'use client';

import type { CycleStatus } from '../shared/types';
import { get, post, type ApiResult } from './client';

export interface Cycle {
  id: number;
  name: string;
  /** Descriptive. MR-REV-06 says the dates constrain nothing. */
  startDate: string;
  endDate: string;
  status: CycleStatus;
}

export const list = (): Promise<ApiResult<{ cycles: Cycle[] }>> => get('/cycles');

/** MR-REV-06. Planned to Open and Open to Closed. Closed is terminal. Administrator only. */
export const setStatus = (
  id: number,
  status: CycleStatus
): Promise<ApiResult<{ status: CycleStatus }>> => post(`/cycles/${id}/status`, { status });
