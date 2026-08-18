'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { cancel, capture, read, refund, type OrderDetail } from '../../../../api/orders';
import { list as listProducts, type Product } from '../../../../api/products';
import { myReports } from '../../../../api/users';
import { ErrorBanner, type Refusal } from '../../../../components/ErrorBanner';
import { Money } from '../../../../components/Money';
import { StatusBadge } from '../../../../components/StatusBadge';
import { useSession } from '../../../../components/SessionProvider';
import { mayRefundOrder } from '../../../../rules/storefront';
import type { CaptureOutcome } from '../../../../shared/types';

/** MR-STO-06. The statuses a Cancel transition exists from. */
const CANCELLABLE = ['Cart', 'Pending Payment', 'Payment Failed'];

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);
  const { principal } = useSession();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [reportIds, setReportIds] = useState<number[]>([]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // Every action here is a state transition on one order, and MR-STO-06 allows each of them
  // from one status only. Two clicks in flight at once would send the second against a
  // status the first has already changed, so the controls close while one is running.
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await read(orderId);
    if (result.ok) {
      setOrder(result.data);
      setRefusal(null);
    } else {
      setOrder(null);
      setRefusal(result);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
    void (async () => {
      const [productList, reports] = await Promise.all([listProducts(), myReports()]);
      if (productList.ok) setProducts(productList.data.products);
      // MR-PLT-01 as amended: this returns people, not permissions. The refund rule below is
      // applied to that list here, on the client, and is not asked of the server.
      if (reports.ok) setReportIds(reports.data.reports.map((report) => report.id));
    })();
  }, [load]);

  const nameOf = (productId: number) =>
    products.find((product) => product.id === productId)?.name ?? `Product ${productId}`;

  async function act(action: () => Promise<{ ok: boolean } & Record<string, unknown>>) {
    setRefusal(null);
    setBusy(true);

    try {
      const result = await action();
      if (!result.ok) {
        setRefusal(result as Refusal);
        return;
      }
      // Refetched rather than patched in place. There is no cache, so what is on the screen
      // after a write is what the server holds.
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (order === null) {
    return (
      <>
        <h1>Order {params.id}</h1>
        <ErrorBanner refusal={refusal} />
      </>
    );
  }

  // MR-STO-08 as amended 2026-08-11, decided on the client from the caller's role and the
  // order's owner. The server decides the request independently, and the paired tests in
  // e2e/storefront.spec.ts are what catch the two disagreeing.
  const mayRefund =
    principal !== null && mayRefundOrder(principal, { userId: order.userId }, reportIds);

  // MR-STO-06: capture applies to a Pending Payment order and to no other.
  const awaitingCapture = order.status === 'Pending Payment';

  // MR-PLT-01 gives an Associate the management of their own cart, and an Administrator all
  // orders. Cancelling somebody else's order is neither.
  const mayCancel =
    principal !== null &&
    CANCELLABLE.includes(order.status) &&
    (order.userId === principal.userId || principal.role === 'Administrator');

  return (
    <>
      <h1>Order {order.id}</h1>
      <ErrorBanner refusal={refusal} />

      <div className="panel">
        <p>
          Status: <span data-testid="order-status">{order.status}</span>{' '}
          <StatusBadge status={order.status} />
        </p>
        <p>Placed by user {order.userId}.</p>

        {order.capturedTotalCents === null ? (
          <p className="note">Nothing has been captured on this order.</p>
        ) : (
          <p>
            Captured total:{' '}
            <span data-testid="captured-total">
              <Money cents={order.capturedTotalCents} />
            </span>
          </p>
        )}
      </div>

      {awaitingCapture ? (
        <div className="panel">
          <h2>Capture</h2>
          <p className="note">
            Payment capture is simulated, per MR-STO-07. The out-of-stock outcome is not
            offered here: the server decides that one against on-hand quantity.
          </p>
          <div className="actions">
            {(['success', 'decline'] as CaptureOutcome[]).map((outcome) => (
              <button
                key={outcome}
                type="button"
                className={outcome === 'success' ? 'primary' : undefined}
                disabled={busy}
                onClick={() => void act(() => capture(order.id, outcome))}
              >
                {outcome === 'success' ? 'Capture success' : 'Capture decline'}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <h2>Lines</h2>
      <table>
        <caption className="note">
          A refund targets whole lines, per MR-STO-08. Every unit on a line is refunded
          together.
        </caption>
        <thead>
          <tr>
            <th>Product</th>
            <th className="numeric">Unit price</th>
            <th className="numeric">Quantity</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td>{nameOf(line.product_id)}</td>
              <td className="numeric">
                <Money cents={line.unit_price_cents} />
              </td>
              <td className="numeric">{line.quantity}</td>
              <td>{line.refunded_at_ms === null ? 'Held' : 'Refunded'}</td>
              <td>
                {mayRefund && line.refunded_at_ms === null ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => refund(order.id, [line.id]))}
                  >
                    Refund line
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {mayCancel ? (
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void act(() => cancel(order.id))}>
            Cancel order
          </button>
        </div>
      ) : null}
    </>
  );
}
