'use client';

import type { Role } from '../shared/types';

/**
 * Every call returns one of these. A refusal is a value, not an exception, because in this
 * application a refusal is frequently the thing an exercise is about and a caller must not
 * be able to ignore one by forgetting a try block.
 */
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; message: string };

/**
 * The only place fetch is called.
 *
 * No caching, no revalidation, no retry. In a fixture whose purpose is teaching people to
 * trust evidence, a cache showing data the server no longer holds is indistinguishable from
 * a planted defect.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    cache: 'no-store',
  });

  if (response.status === 204) {
    return { ok: true, status: 204, data: undefined as T };
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: (body as { error?: string }).error ?? 'error',
      message: (body as { message?: string }).message ?? `Request failed with ${response.status}`,
    };
  }

  return { ok: true, status: response.status, data: body as T };
}

export const get = <T>(path: string) => apiFetch<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' });

export type { Role };
