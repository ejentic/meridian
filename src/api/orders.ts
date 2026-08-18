'use client';

import type { CaptureOutcome, OrderStatus } from '../shared/types';
import { get, post, type ApiResult } from './client';

/** MR-STO-02's composed steps, in the order the rule composes them. */
export interface OrderTotals {
  orderSubtotalCents: number;
  discountCents: number;
  discountedSubtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
}

export interface OrderLine {
  id: number;
  order_id: number;
  product_id: number;
  unit_price_cents: number;
  quantity: number;
  refunded_at_ms: number | null;
}

export interface OrderDetail {
  id: number;
  userId: number;
  status: OrderStatus;
  lines: OrderLine[];
  totals: OrderTotals;
  capturedTotalCents: number | null;
  capturedShippingCents: number | null;
  capturedAtMs: number | null;
}

export interface OrderSummary {
  id: number;
  userId: number;
  status: OrderStatus;
  totalCents: number;
  capturedAtMs: number | null;
}

export const list = (): Promise<ApiResult<{ orders: OrderSummary[] }>> => get('/orders');

export const read = (id: number): Promise<ApiResult<OrderDetail>> => get(`/orders/${id}`);

export const createCart = (): Promise<ApiResult<{ orderId: number; status: OrderStatus }>> =>
  post('/orders');

export const addLine = (
  orderId: number,
  productId: number,
  quantity = 1
): Promise<ApiResult<{ totals: OrderTotals }>> =>
  post(`/orders/${orderId}/lines`, { productId, quantity });

export const applyDiscount = (
  orderId: number,
  code: string
): Promise<ApiResult<{ totals: OrderTotals }>> => post(`/orders/${orderId}/discount`, { code });

export const checkout = (orderId: number): Promise<ApiResult<{ status: OrderStatus }>> =>
  post(`/orders/${orderId}/checkout`);

/**
 * MR-STO-07: capture is simulated and the caller says whether it succeeded or declined.
 *
 * The out-of-stock outcome is not offered, because the rule says that one is decided by the
 * server against on-hand quantity and is the outcome the rule exists to constrain.
 */
export const capture = (
  orderId: number,
  outcome: CaptureOutcome
): Promise<ApiResult<{ status: OrderStatus; reason?: string; capturedTotalCents?: number }>> =>
  post(`/orders/${orderId}/capture`, { outcome });

export const refund = (
  orderId: number,
  lineIds: number[]
): Promise<ApiResult<{ status: OrderStatus; refundCents: number }>> =>
  post(`/orders/${orderId}/refund`, { lineIds });

export const cancel = (orderId: number): Promise<ApiResult<{ status: OrderStatus }>> =>
  post(`/orders/${orderId}/cancel`);

/**
 * The caller's cart, or null when they have none.
 *
 * Meridian has no separate cart record: MR-STO-06 makes Cart a status an order holds, so
 * "the cart" is the caller's order that is still in it. Nothing in the specification says a
 * user may hold only one at a time, so this takes the most recent rather than assuming
 * there is exactly one.
 */
export async function findCart(userId: number): Promise<ApiResult<number | null>> {
  const result = await list();
  if (!result.ok) return result;

  const carts = result.data.orders.filter(
    (order) => order.userId === userId && order.status === 'Cart'
  );
  return {
    ok: true,
    status: result.status,
    data: carts.length === 0 ? null : carts[carts.length - 1].id,
  };
}
