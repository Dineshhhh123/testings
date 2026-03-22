'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, getAuthToken, API_BASE } from '@/lib/api';


type Client = { id: string; name: string; slug: string };
type PricingItem = {
  id: string;
  category: string;
  product: string;
  variant?: string | null;
  packQuantity?: number | null;
  rate?: number | null;
  discount?: number | null;   // percentage (e.g. 10 = 10%)
};

const EMPTY_FORM = { category: '', product: '', variant: '', packQuantity: '', rate: '', discount: '' };

/* CSV export helper */
function exportToCsv(items: PricingItem[]) {
  const rows = [
    ['Category', 'Product', 'Variant', 'Pack Quantity', 'Rate (INR)', 'Discount (%)'],
    ...items.map((it) => [
      it.category, it.product, it.variant ?? '', it.packQuantity ?? '', it.rate ?? '', it.discount ?? ''
    ])
  ];
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: 'pricing_items.csv'
  });
  a.click();
}

export default function PricingPage() {
  const [client, setClient] = useState<Client | null>(null);
  const [items, setItems] = useState<PricingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  // Create form
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addLoading, setAddLoading] = useState(false);

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editLoading, setEditLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');

  /* ── helpers ── */
  async function loadClient() {
    const all = await apiFetch<Client[]>('/api/clients');
    if (!all.length) {
      return await apiFetch<Client>('/api/clients', {
        method: 'POST',
        body: JSON.stringify({ name: 'My Workspace', slug: `ws-${Date.now()}` })
      });
    }
    return all[0]!;
  }

  async function loadItems(cli?: Client) {
    try {
      setLoading(true);
      setError(null);
      const c = cli ?? client ?? (await loadClient());
      if (!client) setClient(c);
      const json = await apiFetch<PricingItem[]>(`/api/clients/${c.id}/pricing/items`);
      setItems(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }

  async function uploadSheet() {
    if (!client || !file) return;
    try {
      setUploading(true);
      setError(null);
      const form = new FormData();
      form.append('file', file);
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/clients/${client.id}/pricing/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form
      });
      if (!res.ok) throw new Error(await res.text() || 'Upload failed');
      setFile(null);
      await loadItems(client);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function createItem() {
    if (!client || !addForm.category.trim() || !addForm.product.trim()) return;
    try {
      setAddLoading(true);
      setError(null);
      await apiFetch(`/api/clients/${client.id}/pricing/items`, {
        method: 'POST',
        body: JSON.stringify({
          category: addForm.category.trim(),
          product: addForm.product.trim(),
          variant: addForm.variant.trim() || null,
          packQuantity: addForm.packQuantity ? Number(addForm.packQuantity) : null,
          rate: addForm.rate ? Number(addForm.rate) : null,
          discount: addForm.discount ? Number(addForm.discount) : null
        })
      });
      setAddForm(EMPTY_FORM);
      setShowAdd(false);
      await loadItems(client);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create item');
    } finally {
      setAddLoading(false);
    }
  }

  function startEdit(item: PricingItem) {
    setEditId(item.id);
    setEditForm({
      category: item.category,
      product: item.product,
      variant: item.variant ?? '',
      packQuantity: item.packQuantity != null ? String(item.packQuantity) : '',
      rate: item.rate != null ? String(item.rate) : '',
      discount: item.discount != null ? String(item.discount) : ''
    });
  }

  async function saveEdit() {
    if (!client || !editId) return;
    try {
      setEditLoading(true);
      setError(null);
      const url = `/api/clients/${client.id}/pricing/items/${editId}`;
      const body = {
        category: editForm.category.trim(),
        product: editForm.product.trim(),
        variant: editForm.variant.trim() || null,
        packQuantity: editForm.packQuantity ? Number(editForm.packQuantity) : null,
        rate: editForm.rate ? Number(editForm.rate) : null,
        discount: editForm.discount !== '' ? Number(editForm.discount) : null
      };
      console.log('[saveEdit] PATCH', url, body);
      const result = await apiFetch(url, { method: 'PATCH', body: JSON.stringify(body) });
      console.log('[saveEdit] success', result);
      setEditId(null);
      await loadItems(client);
    } catch (e: unknown) {
      console.error('[saveEdit] error:', e);
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setEditLoading(false);
    }
  }


  async function deleteItem(id: string) {
    if (!client) return;
    try {
      setError(null);
      await apiFetch(`/api/clients/${client.id}/pricing/items/${id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  }

  async function deleteAll() {
    if (!client) return;
    if (!window.confirm(`Delete ALL ${items.length} pricing items? This cannot be undone.`)) return;
    try {
      setLoading(true);
      setError(null);
      await apiFetch(`/api/clients/${client.id}/pricing/items`, { method: 'DELETE' });
      setItems([]);
      setEditId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete all');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const c = await loadClient();
      setClient(c);
      await loadItems(c);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((it) => {
      if (catFilter && it.category !== catFilter) return false;
      if (!q) return true;
      return it.product.toLowerCase().includes(q) || it.category.toLowerCase().includes(q) || (it.variant ?? '').toLowerCase().includes(q);
    });
  }, [items, search, catFilter]);

  /* ── shared input style (light theme) ── */
  const inp: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: 7,
    color: '#111827',
    padding: '6px 10px',
    fontSize: 13,
    width: '100%'
  };

  return (
    <main className="page-shell">
      <div className="container">

        {/* ── Header ── */}
        <section className="hero-card">
          <p className="eyebrow">Pricing</p>
          <h1 className="hero-title">Pricing Items</h1>
          <p className="muted">
            Upload an Excel/CSV file or add items manually. All items are stored in the database
            and used for WhatsApp quotations.
          </p>
          {client && (
            <p className="muted" style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>
              Workspace: <strong>{client.name}</strong>
            </p>
          )}

          <div className="cta-row" style={{ marginTop: 18, flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            {/* File picker */}
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
              border: '1px solid #d1d5db', background: '#f9fafb', color: '#374151'
            }}>
              📎 {file ? file.name : 'Choose file…'}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={uploading} />
            </label>
            <button className="button button-primary" disabled={!file || uploading} onClick={uploadSheet}>
              {uploading ? '⏳ Uploading…' : '⬆ Upload Sheet'}
            </button>
            <button className="button button-secondary" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? '✕ Cancel' : '＋ Add Item'}
            </button>
            <button className="button button-secondary" disabled={loading} onClick={() => void loadItems()}>
              ↺ Reload
            </button>
          </div>

          {error && <p style={{ marginTop: 10, color: '#dc2626', fontSize: 13 }}>{error}</p>}
        </section>

        {/* ── Add Item Form ── */}
        {showAdd && (
          <section className="panel" style={{ marginTop: 16 }}>
            <p className="eyebrow" style={{ marginBottom: 12 }}>New Item</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 10 }}>
              {(['category', 'product', 'variant'] as const).map((f) => (
                <div key={f}>
                  <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}{f !== 'variant' ? ' *' : ''}
                  </label>
                  <input style={inp} value={addForm[f]}
                    onChange={(e) => setAddForm((p) => ({ ...p, [f]: e.target.value }))}
                    placeholder={f === 'variant' ? 'optional' : f} />
                </div>
              ))}
              {(['packQuantity', 'rate'] as const).map((f) => (
                <div key={f}>
                  <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                    {f === 'packQuantity' ? 'Pack Qty' : 'Rate (₹)'}
                  </label>
                  <input style={inp} type="number" value={addForm[f]}
                    onChange={(e) => setAddForm((p) => ({ ...p, [f]: e.target.value }))}
                    placeholder="0" min="0" />
                </div>
              ))}
              <div>
                <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                  Discount (%)
                </label>
                <input style={inp} type="number" value={addForm.discount}
                  onChange={(e) => setAddForm((p) => ({ ...p, discount: e.target.value }))}
                  placeholder="e.g. 10" min="0" max="100" />
              </div>

            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="button button-primary"
                disabled={!addForm.category.trim() || !addForm.product.trim() || addLoading}
                onClick={createItem}>
                {addLoading ? 'Saving…' : 'Save Item'}
              </button>
              <button className="button button-secondary" onClick={() => { setShowAdd(false); setAddForm(EMPTY_FORM); }}>
                Cancel
              </button>
            </div>
          </section>
        )}

        {/* ── Items Table ── */}
        <section className="panel" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <p className="eyebrow">{items.length} Items Total</p>
            <div style={{ display: 'flex', gap: 8 }}>
              {filtered.length > 0 && (
                <button className="button button-secondary" style={{ fontSize: 12, padding: '6px 14px' }}
                  onClick={() => exportToCsv(filtered)}>
                  ⬇ Export CSV ({filtered.length})
                </button>
              )}
              {items.length > 0 && (
                <button onClick={deleteAll}
                  style={{ fontSize: 12, padding: '6px 14px', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 8, color: '#dc2626', cursor: 'pointer' }}>
                  🗑 Delete All
                </button>
              )}
            </div>
          </div>

          {items.length > 0 && (
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <input type="text" placeholder="🔍 Search…" value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...inp, flex: 1, minWidth: 160 }} />
              <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
                style={{ ...inp, width: 'auto', minWidth: 150 }}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {loading ? (
            <p className="muted" style={{ marginTop: 14 }}>Loading…</p>
          ) : items.length === 0 ? (
            <p className="muted" style={{ marginTop: 14 }}>
              No pricing items yet. Upload a spreadsheet or click "＋ Add Item" above.
            </p>
          ) : filtered.length === 0 ? (
            <p className="muted" style={{ marginTop: 14 }}>No items match your search.</p>
          ) : (
            <div style={{ marginTop: 14, overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Category</th>
                    <th>Product</th>
                    <th>Variant</th>
                    <th style={{ textAlign: 'right' }}>Pack Qty</th>
                    <th style={{ textAlign: 'right' }}>Rate (₹)</th>
                    <th style={{ textAlign: 'right' }}>Discount</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, idx) =>
                    editId === item.id ? (
                      /* ── Inline edit row ── */
                      <tr key={item.id} style={{ background: 'rgba(79,70,229,0.05)' }}>
                        <td style={{ color: '#6b7280', fontSize: 12 }}>{idx + 1}</td>
                        {(['category', 'product', 'variant'] as const).map((f) => (
                          <td key={f}>
                            <input style={{ ...inp, padding: '4px 8px' }}
                              value={editForm[f]}
                              onChange={(e) => setEditForm((p) => ({ ...p, [f]: e.target.value }))} />
                          </td>
                        ))}
                        {(['packQuantity', 'rate', 'discount'] as const).map((f) => (
                          <td key={f} style={{ textAlign: 'right' }}>
                            <input style={{ ...inp, padding: '4px 8px', textAlign: 'right', width: 80 }}
                              type="number" value={editForm[f]}
                              onChange={(e) => setEditForm((p) => ({ ...p, [f]: e.target.value }))} />
                          </td>
                        ))}
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button className="button button-primary"
                            style={{ fontSize: 12, padding: '4px 12px', marginRight: 4 }}
                            disabled={editLoading} onClick={saveEdit}>
                            {editLoading ? '…' : '✓ Save'}
                          </button>
                          <button className="button button-secondary"
                            style={{ fontSize: 12, padding: '4px 10px' }}
                            onClick={() => setEditId(null)}>
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ) : (
                      /* ── Normal row ── */
                      <tr key={item.id}>
                        <td style={{ color: '#9ca3af', fontSize: 12 }}>{idx + 1}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: 'rgba(124,58,237,0.1)', color: '#7c3aed', fontSize: 12, fontWeight: 600 }}>
                            {item.category}
                          </span>
                        </td>
                        <td style={{ fontWeight: 500, color: '#111827' }}>{item.product}</td>
                        <td style={{ color: '#6b7280', fontSize: 13 }}>{item.variant ?? '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#374151' }}>
                          {item.packQuantity != null ? item.packQuantity : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#16a34a' }}>
                          {item.rate != null ? `₹${Number(item.rate).toFixed(2)}` : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {item.discount != null && Number(item.discount) > 0 ? (
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                              background: 'rgba(22,163,74,0.1)', color: '#16a34a', fontSize: 12, fontWeight: 600 }}>
                              {Number(item.discount)}% OFF
                            </span>
                          ) : (
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                              background: 'rgba(220,38,38,0.07)', color: '#dc2626', fontSize: 11 }}>
                              No discount
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button onClick={() => startEdit(item)}
                            style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 6, color: '#7c3aed', cursor: 'pointer', fontSize: 12, padding: '3px 10px', marginRight: 4 }}>
                            ✏ Edit
                          </button>
                          <button onClick={() => void deleteItem(item.id)}
                            style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 6, color: '#dc2626', cursor: 'pointer', fontSize: 12, padding: '3px 10px' }}>
                            🗑
                          </button>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>

              {filtered.length < items.length && (
                <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  Showing {filtered.length} of {items.length} items
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
