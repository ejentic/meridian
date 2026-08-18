'use client';

import { get, patch, post, type ApiResult } from './client';

export interface Product {
  id: number;
  sku: string;
  name: string;
  unitPriceCents: number;
  onHandQty: number;
}

export const list = (): Promise<ApiResult<{ products: Product[] }>> => get('/products');

export const create = (body: {
  sku: string;
  name: string;
  unitPriceCents: number;
  onHandQty: number;
}): Promise<ApiResult<{ id: number }>> => post('/products', body);

export const update = (
  id: number,
  body: { name?: string; unitPriceCents?: number; onHandQty?: number }
): Promise<ApiResult<Product>> => patch(`/products/${id}`, body);
