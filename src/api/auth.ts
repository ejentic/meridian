'use client';

import type { Me } from '../shared/types';
import { get, post, type ApiResult } from './client';

export const signIn = (
  email: string,
  password: string
): Promise<ApiResult<{ userId: number; role: string }>> => post('/auth/signin', { email, password });

export const signOut = (): Promise<ApiResult<void>> => post('/auth/signout');

export const me = (): Promise<ApiResult<Me>> => get('/me');
