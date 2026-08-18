'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addLine, createCart, findCart } from '../../../api/orders';
import { list, type Product } from '../../../api/products';
import { DataTable } from '../../../components/DataTable';
import { ErrorBanner, type Refusal } from '../../../components/ErrorBanner';
import { Money } from '../../../components/Money';
import { useSession } from '../../../components/SessionProvider';

/**
 * MR-PLT-01: every role browses products and manages their own cart, so nothing here is
 * hidden by role.
 *
 * Add to cart is not offered on a product with nothing on hand. MR-STO-07 means that is a
 * courtesy and not the check: adding to a cart reserves nothing, and the real availability
 * test happens at checkout and again at capture, against the quantity on hand at that
 * moment. A trainee who reaches an out-of-stock refusal has found the rule working, not a
 * screen that failed to stop them.
 */
export default function ProductsPage() {
  const { principal } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Shown on the controls while a request is in flight. This is the affordance, not the
  // guard: React state is not applied before the next click can arrive, so a disabled
  // attribute alone does not stop two adds overlapping.
  const [busy, setBusy] = useState(false);

  /**
   * Adds run one after another, whatever order the clicks arrive in.
   *
   * Meridian holds no cart record of its own. MR-STO-06 makes Cart a status an order is in,
   * so "add to cart" is really find-my-cart-or-create-one and then add a line, and that is
   * three requests with no transaction around them. Two overlapping runs both find no cart,
   * both create one, and the two lines end up on different orders, which reads to a trainee
   * as a lost item rather than as a race.
   *
   * A ref rather than state because the chain has to be updated synchronously, inside the
   * click handler, before the next click can be handled.
   */
  const queue = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    const result = await list();
    if (result.ok) setProducts(result.data.products);
    else setRefusal(result);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Queues an add. Returns once this one, and everything queued before it, has finished. */
  function add(product: Product): Promise<void> {
    queue.current = queue.current.then(() => addOne(product));
    return queue.current;
  }

  async function addOne(product: Product) {
    if (principal === null) return;
    setRefusal(null);
    setNote(null);
    setBusy(true);

    try {
      const existing = await findCart(principal.userId);
      if (!existing.ok) {
        setRefusal(existing);
        return;
      }

      let cartId = existing.data;
      if (cartId === null) {
        const created = await createCart();
        if (!created.ok) {
          setRefusal(created);
          return;
        }
        cartId = created.data.orderId;
      }

      const result = await addLine(cartId, product.id, 1);
      if (!result.ok) {
        setRefusal(result);
        return;
      }

      // Names the product and its SKU, so a person can see which click landed and a test can
      // wait for this one rather than navigating away while the request is still in flight.
      setNote(`${product.name} (${product.sku}) added to your cart.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Products</h1>
      <p className="note">
        Prices are held in integer cents, per MR-STO-01. Adding to a cart does not reserve
        stock, per MR-STO-07.
      </p>

      <ErrorBanner refusal={refusal} />
      {note === null ? null : (
        <p className="note flash" data-testid="added">
          {note}
        </p>
      )}

      <DataTable
        caption="Everything on the storefront."
        rows={products}
        rowKey={(product) => product.id}
        columns={[
          { header: 'SKU', cell: (product) => product.sku },
          { header: 'Name', cell: (product) => product.name },
          {
            header: 'Unit price',
            numeric: true,
            cell: (product) => <Money cents={product.unitPriceCents} />,
          },
          { header: 'On hand', numeric: true, cell: (product) => product.onHandQty },
          {
            header: '',
            cell: (product) =>
              product.onHandQty === 0 ? (
                <span className="note">Out of stock</span>
              ) : (
                <button type="button" disabled={busy} onClick={() => void add(product)}>
                  Add to cart
                </button>
              ),
          },
        ]}
      />
    </>
  );
}
