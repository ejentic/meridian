'use client';

import type { Role } from '../shared/types';
import { del, get, patch, post, type ApiResult } from './client';

/** The shape GET /users returns, in the database's own column names. */
export interface UserRow {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  manager_id: number | null;
  active: number;
}

export interface DirectReport {
  id: number;
  fullName: string;
  role: Role;
}

export const list = (): Promise<ApiResult<{ users: UserRow[] }>> => get('/users');

export const create = (body: {
  email: string;
  fullName: string;
  password: string;
  role: Role;
  managerId: number | null;
}): Promise<ApiResult<{ id: number }>> => post('/users', body);

export const update = (
  id: number,
  body: { role?: Role; managerId?: number | null }
): Promise<ApiResult<UserRow>> => patch(`/users/${id}`, body);

export const deactivate = (id: number): Promise<ApiResult<void>> => post(`/users/${id}/deactivate`);

/**
 * Ends every session the named user holds. A DELETE, matching the route, and deliberately
 * not the same thing as deactivation: the user stays active and may sign in again.
 */
export const endSessions = (id: number): Promise<ApiResult<void>> => del(`/users/${id}/sessions`);

export const changeOwnPassword = (
  currentPassword: string,
  newPassword: string
): Promise<ApiResult<void>> => post('/me/password', { currentPassword, newPassword });

/** MR-PLT-01 as amended 2026-08-11. Empty for a caller with no reports, never a refusal. */
export const myReports = (): Promise<ApiResult<{ reports: DirectReport[] }>> => get('/me/reports');
