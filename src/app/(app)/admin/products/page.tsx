'use client';

import { useCallback, useEffect, useState } from 'react';
import { create, list, update, type Product } from '../../../../api/products';
import { ErrorBanner, type Refusal } from '../../../../components/ErrorBanner';
import { Field } from '../../../../components/Field';
import { Money } from '../../../../components/Money';
import { useSession } from '../../../../components/SessionProvider';

/**
 * MR-PLT-01: product and stock maintenance is Administrator only.
 *
 * Stock is maintained here and nowhere else in the interface. MR-STO-07 says on-hand
 * quantity may never go below 0, and the input carries min="0" as a courtesy while the
 * server refuses a negative value with 422 regardless, which is the check that counts.
 */
export default function AdminProductsPage() {
  const { principal } = useSession();

  const [products, setProducts] = useState<Product[]>([]);
  /**
   * Pending stock edits, keyed by product id. A key that is absent means that row is showing
   * the stored quantity. Seeding this from every load instead would let a refetch overwrite
   * a number somebody is still typing, and the row would then save a value they never chose.
   */
  const [stockEdits, setStockEdits] = useState<Record<number, string>>({});
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [unitPriceCents, setUnitPriceCents] = useState('');
  const [onHandQty, setOnHandQty] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // Disabled while a write is in flight, so a second click cannot overtake the first and
  // leave the table showing a value the server never received.
  const [busy, setBusy] = useState(false);
  // Shown once a write has come back. Without it there is no moment a person can point at
  // and say the change reached the server, which is the difference between reading a screen
  // and trusting it.
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await list();
    if (!result.ok) {
      setRefusal(result);
      return;
    }
    setProducts(result.data.products);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // MR-PLT-02: computed on the client from the session, never from a server permissions
  // response. The endpoints refuse a non-Administrator on their own terms.
  const isAdministrator = principal?.role === 'Administrator';

  /** The pending edit for a row if there is one, otherwise the stored quantity. */
  const stockValue = (product: Product) =>
    stockEdits[product.id] ?? String(product.onHandQty);

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setRefusal(null);
    setBusy(true);

    try {
      const result = await create({
        sku,
        name,
        // Cents are entered as cents. A dollars field would need the interface to multiply,
        // and MR-STO-01 keeps money integral precisely so nothing has to.
        unitPriceCents: Number(unitPriceCents),
        onHandQty: Number(onHandQty),
      });

      if (!result.ok) {
        setRefusal(result);
        return;
      }

      setSku('');
      setName('');
      setUnitPriceCents('');
      setOnHandQty('');
      await load();
      setSaved('Product created.');
    } finally {
      setBusy(false);
    }
  }

  async function saveStock(product: Product) {
    setRefusal(null);
    setSaved(null);
    setBusy(true);

    try {
      const result = await update(product.id, { onHandQty: Number(stockValue(product)) });
      if (!result.ok) {
        setRefusal(result);
        return;
      }
      // Drop the pending edit so the row shows what the server stored, not what was typed.
      setStockEdits((edits) => {
        const next = { ...edits };
        delete next[product.id];
        return next;
      });
      await load();
      setSaved(`Stock saved for ${product.sku}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Product maintenance</h1>
      <p className="note">
        Creating products and maintaining stock. Administrator only, per MR-PLT-01.
      </p>

      <ErrorBanner refusal={refusal} />
      {saved === null ? null : (
        <p className="note" data-testid="saved">
          {saved}
        </p>
      )}

      {!isAdministrator ? (
        <p className="note">Product and stock maintenance is Administrator only.</p>
      ) : (
        <form onSubmit={submitCreate} className="panel">
          <h2>Create product</h2>
          <Field label="SKU" htmlFor="sku">
            <input id="sku" value={sku} onChange={(event) => setSku(event.target.value)} />
          </Field>
          <Field label="Name" htmlFor="name">
            <input id="name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Unit price in cents" htmlFor="unit-price">
            <input
              id="unit-price"
              type="number"
              min="0"
              value={unitPriceCents}
              onChange={(event) => setUnitPriceCents(event.target.value)}
            />
          </Field>
          <Field label="On hand" htmlFor="on-hand">
            <input
              id="on-hand"
              type="number"
              min="0"
              value={onHandQty}
              onChange={(event) => setOnHandQty(event.target.value)}
            />
          </Field>
          <button type="submit" className="primary" disabled={busy}>
            Create product
          </button>
        </form>
      )}

      <h2>Stock</h2>
      <table>
        <caption className="note">
          On-hand quantity is an integer and may never go below 0, per MR-STO-07.
        </caption>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Name</th>
            <th className="numeric">Unit price</th>
            <th>On hand</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id}>
              <td>{product.sku}</td>
              <td>{product.name}</td>
              <td className="numeric">
                <Money cents={product.unitPriceCents} />
              </td>
              <td>
                {isAdministrator ? (
                  <>
                    {/* One id per row, so a test can scope "Stock" to the row it means. */}
                    <label htmlFor={`stock-${product.id}`}>Stock</label>
                    <input
                      id={`stock-${product.id}`}
                      type="number"
                      value={stockValue(product)}
                      onChange={(event) =>
                        setStockEdits({ ...stockEdits, [product.id]: event.target.value })
                      }
                    />
                  </>
                ) : (
                  product.onHandQty
                )}
              </td>
              <td>
                {isAdministrator ? (
                  <button type="button" disabled={busy} onClick={() => void saveStock(product)}>
                    Save stock
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
