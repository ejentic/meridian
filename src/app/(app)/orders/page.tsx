'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { list, type OrderSummary } from '../../../api/orders';
import { DataTable } from '../../../components/DataTable';
import { ErrorBanner, type Refusal } from '../../../components/ErrorBanner';
import { Money } from '../../../components/Money';
import { StatusBadge } from '../../../components/StatusBadge';

/**
 * MR-PLT-01 read scope: an Associate sees their own orders, a Manager theirs and their
 * direct reports', an Administrator all of them.
 *
 * The scoping is the server's and is not repeated here. This is a read, and MR-PLT-02 says
 * a refused read returns no record data at all, so an order this caller may not see never
 * reaches the browser to be filtered out of. That is different from control visibility,
 * which is duplicated deliberately: hiding a row the server already refused to send would
 * be presentation standing in for a decision that was already made correctly.
 */
export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await list();
      if (result.ok) setOrders(result.data.orders);
      else setRefusal(result);
    })();
  }, []);

  return (
    <>
      <h1>Orders</h1>
      <p className="note">
        Every order you are permitted to read, per MR-PLT-01. The total is the captured amount
        once there is one.
      </p>

      <ErrorBanner refusal={refusal} />

      <DataTable
        caption="Orders in scope for you."
        rows={orders}
        rowKey={(order) => order.id}
        empty="No orders yet."
        columns={[
          { header: 'Id', numeric: true, cell: (order) => <Link href={`/orders/${order.id}`}>{order.id}</Link> },
          { header: 'Placed by', numeric: true, cell: (order) => order.userId },
          { header: 'Status', cell: (order) => <StatusBadge status={order.status} /> },
          { header: 'Total', numeric: true, cell: (order) => <Money cents={order.totalCents} /> },
        ]}
      />
    </>
  );
}
