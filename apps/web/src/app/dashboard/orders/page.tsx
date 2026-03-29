'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Client = { id: string; name: string; slug: string };

type Order = {
  id: string;
  status: 'PAYMENT_PENDING' | 'PAYMENT_SUCCESS' | 'CANCELLED';
  itemDescription: {
    items: Array<{
      productName?: string;
      packQuantity?: number | null;
      rate?: number | null;
      quantity?: number | null;
      total?: number | null;
    }>;
    grandTotal: string | number;
  };
  receiptUrl?: string | null;
  paymentVerifiedAt?: string | null;
  createdAt: string;
  lead: {
    businessName: string | null;
    displayName: string | null;
    phone: string | null;
  };
};

export default function OrdersPage() {
  const [client, setClient] = useState<Client | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [modalImage, setModalImage] = useState<string | null>(null);

  async function loadData() {
    try {
      setLoading(true);
      const clients = await apiFetch<Client[]>('/api/clients');
      if (!clients.length) return;
      const c = clients[0];
      setClient(c);

      const ords = await apiFetch<Order[]>(`/api/clients/${c.id}/orders`);
      setOrders(ords);
    } catch (err: any) {
      console.error('Failed to load orders', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []); // eslint-disable-line

  async function verifyOrder(orderId: string) {
    if (!client) return;
    try {
      setVerifying(orderId);
      const updated = await apiFetch<Order>(`/api/clients/${client.id}/orders/${orderId}/verify`, {
        method: 'PATCH'
      });
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...updated } : o));
    } catch (err: any) {
      alert(err.message || 'Failed to verify payment');
    } finally {
      setVerifying(null);
    }
  }

  function exportOrdersToCsv() {
    if (!orders.length) return;

    const headers = ['Date', 'Customer', 'Business', 'Phone', 'Items', 'Total Due', 'Status'];
    const rows = orders.map(o => [
      new Date(o.createdAt).toLocaleString(),
      o.lead?.displayName || 'Unknown',
      o.lead?.businessName || 'N/A',
      o.lead?.phone || 'N/A',
      o.itemDescription?.items?.map(i => `${i.quantity || i.packQuantity}x ${i.productName}`).join('; '),
      `₹${o.itemDescription?.grandTotal}`,
      o.status
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `orders_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function renderStatus(status: Order['status']) {
    switch (status) {
      case 'PAYMENT_PENDING':
        return <span style={{ color: '#d97706', background: 'rgba(217,119,6,0.1)', padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>PENDING</span>;
      case 'PAYMENT_SUCCESS':
        return <span style={{ color: '#16a34a', background: 'rgba(22,163,74,0.1)', padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>VERIFIED</span>;
      default:
        return <span style={{ color: '#6b7280', background: 'rgba(107,114,128,0.1)', padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{status}</span>;
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header className="hero-card">
        <p className="eyebrow">Financial Tracking</p>
        <h1 className="hero-title">Order Management</h1>
        <p className="muted" style={{ maxWidth: 600 }}>
          View new orders generated from WhatsApp Quotations. If a user uploads a receipt image, it will appear here for you to verify and mark as Payment Success.
        </p>
      </header>

      {/* Basic modal for image preview */}
      {modalImage && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setModalImage(null)}>
          <img src={`/api${modalImage}`} alt="Payment Receipt" style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: 8, boxShadow: '0 20px 40px rgba(0,0,0,0.4)', background: '#fff' }} />
        </div>
      )}

      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>All Orders</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button button-secondary" onClick={exportOrdersToCsv} disabled={loading || !orders.length} style={{ fontSize: 13, padding: '6px 14px' }}>
              ⬇ Export CSV
            </button>
            <button className="button button-secondary" onClick={loadData} disabled={loading} style={{ fontSize: 13, padding: '6px 14px' }}>
              {loading ? 'Refreshing...' : '↻ Refresh List'}
            </button>
          </div>
        </div>

        {orders.length === 0 && !loading && (
          <p className="muted" style={{ fontSize: 14 }}>No orders found for this workspace. Generate a quote from the chatbot first!</p>
        )}

        {orders.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: 800 }}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Order Items</th>
                  <th>Total Due</th>
                  <th>Status</th>
                  <th>Receipt</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{o.lead?.businessName || o.lead?.displayName || 'Unknown'}</div>
                      <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>{o.lead?.phone || 'No phone'}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, maxWidth: 200, WebkitLineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {o.itemDescription?.items?.map(i => `${i.quantity || i.packQuantity}x ${i.productName}`).join(', ') || 'No items'}
                      </div>
                      <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 4 }}>
                        {new Date(o.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600, fontSize: 14 }}>
                      ₹{o.itemDescription?.grandTotal}
                    </td>
                    <td>{renderStatus(o.status)}</td>
                    <td>
                      {o.receiptUrl ? (
                        <button 
                          className="button button-secondary"
                          style={{ fontSize: 12, padding: '4px 10px', background: '#eff6ff', color: '#2563eb', borderColor: 'rgba(37,99,235,0.2)' }}
                          onClick={() => setModalImage(o.receiptUrl!)}
                        >
                          👀 View Image
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: '#9ca3af' }}>No receipt</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {o.status === 'PAYMENT_PENDING' && (
                        <button 
                          className="button button-primary"
                          disabled={verifying === o.id}
                          style={{ fontSize: 12, padding: '6px 12px' }}
                          onClick={() => verifyOrder(o.id)}
                        >
                          {verifying === o.id ? 'Verifying...' : 'Verify Payment'}
                        </button>
                      )}
                      {o.status === 'PAYMENT_SUCCESS' && (
                        <span style={{ fontSize: 12, color: '#16a34a' }}>✓ Processed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
