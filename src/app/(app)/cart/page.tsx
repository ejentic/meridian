'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { list as listProducts, type Product } from '../../../api/products';
import {
  applyDiscount,
  checkout,
  findCart,
  read,
  type OrderDetail,
} from '../../../api/orders';
import { ErrorBanner, type Refusal } from '../../../components/ErrorBanner';
import { Field } from '../../../components/Field';
import { Money } from '../../../components/Money';
import { useSession } from '../../../components/SessionProvider';
import { isContentEditable } from '../../../rules/storefront';

/**
 * The cart, which is the caller's order still in Cart status per MR-STO-06.
 *
 * The totals are shown as MR-STO-02's six composed steps and never as a single total. That
 * is not a presentation preference. MR-STO-04's truncation case reaches the correct order
 * total by two compensating errors, one cent wrong at the discount step and one cent wrong
 * the other way at the tax step, so a screen showing only the total makes the defect that
 * rule exists to teach invisible to the eye.
 *
 * Every number here was computed by the server. Nothing on this screen does arithmetic on
 * money, because a second implementation of MR-STO-02 in the interface is a second thing
 * that can be wrong and no test covers it.
 */
export default function CartPage() {
  const router = useRouter();
  const { principal } = useSession();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [loading, setLoading] = useState(true);
  // Every control on this screen is disabled while a write is in flight. Checking out while
  // a discount code is still being applied would submit an order whose total on screen is
  // not the total the server is about to capture, and MR-STO-03 makes the code an order
  // content edit, so the two writes race for the same order.
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (principal === null) return;

    const cart = await findCart(principal.userId);
    if (!cart.ok) {
      setRefusal(cart);
      setLoading(false);
      return;
    }
    if (cart.data === null) {
      setOrder(null);
      setLoading(false);
      return;
    }

    const detail = await read(cart.data);
    if (detail.ok) setOrder(detail.data);
    else setRefusal(detail);
    setLoading(false);
  }, [principal]);

  useEffect(() => {
    void load();
    void (async () => {
      const result = await listProducts();
      if (result.ok) setProducts(result.data.products);
    })();
  }, [load]);

  const nameOf = (productId: number) =>
    products.find((product) => product.id === productId)?.name ?? `Product ${productId}`;

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (order === null) return;
    setRefusal(null);
    setCodeError(null);
    setBusy(true);

    try {
      const result = await applyDiscount(order.id, code);
      if (!result.ok) {
        // A 422 from this endpoint always concerns the code, which is the only field the
        // request carries, so it lands on the field rather than in the banner.
        if (result.status === 422) setCodeError(result.message);
        else setRefusal(result);
        return;
      }

      await load();
    } finally {
      setBusy(false);
    }
  }

  async function submitCheckout() {
    if (order === null) return;
    setRefusal(null);
    setBusy(true);

    try {
      const result = await checkout(order.id);
      if (!result.ok) {
        setRefusal(result);
        return;
      }

      router.push(`/orders/${order.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="note">Loading.</p>;

  if (order === null) {
    return (
      <>
        <h1>Cart</h1>
        <ErrorBanner refusal={refusal} />
        <p className="note">Your cart is empty. Add something from Products.</p>
      </>
    );
  }

  // MR-STO-06's write lock, drawn on the client. The server refuses the same writes with 409
  // whether or not this screen offers them, which is the MR-PLT-02 pairing.
  const editable = isContentEditable(order.status);

  return (
    <>
      <h1>Cart</h1>
      <ErrorBanner refusal={refusal} />

      <table>
        <caption className="note">Order {order.id}.</caption>
        <thead>
          <tr>
            <th>Product</th>
            <th className="numeric">Unit price</th>
            <th className="numeric">Quantity</th>
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
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Total</h2>
      <table>
        <caption className="note">
          MR-STO-02 composes an order total in this order, and the order matters.
        </caption>
        <tbody>
          <tr>
            <th>Order subtotal</th>
            <td className="numeric" data-testid="order-subtotal">
              <Money cents={order.totals.orderSubtotalCents} />
            </td>
          </tr>
          <tr>
            <th>Discount</th>
            <td className="numeric" data-testid="discount">
              {order.totals.discountCents === 0 ? (
                <Money cents={0} />
              ) : (
                <Money cents={-order.totals.discountCents} />
              )}
            </td>
          </tr>
          <tr>
            <th>Discounted subtotal</th>
            <td className="numeric" data-testid="discounted-subtotal">
              <Money cents={order.totals.discountedSubtotalCents} />
            </td>
          </tr>
          <tr>
            <th>Tax at 8.25%</th>
            <td className="numeric" data-testid="tax">
              <Money cents={order.totals.taxCents} />
            </td>
          </tr>
          <tr>
            <th>Shipping</th>
            <td className="numeric" data-testid="shipping">
              <Money cents={order.totals.shippingCents} />
            </td>
          </tr>
          <tr>
            <th>Order total</th>
            <td className="numeric" data-testid="total">
              <Money cents={order.totals.totalCents} />
            </td>
          </tr>
        </tbody>
      </table>

      {editable ? (
        <>
          <form onSubmit={submitCode} className="panel">
            <Field label="Discount code" htmlFor="discount-code" error={codeError}>
              <input
                id="discount-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            {/* MR-STO-03: at most one code per order. A second replaces the first. */}
            <button type="submit" disabled={busy}>
              Apply code
            </button>
          </form>

          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void submitCheckout()}
            >
              Check out
            </button>
          </div>
        </>
      ) : (
        <p className="note">
          Order contents are editable only in Cart, per MR-STO-06. This order is in{' '}
          {order.status}.
        </p>
      )}
    </>
  );
}
