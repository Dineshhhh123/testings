'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Client = { 
  id: string; 
  name: string; 
  slug: string; 
  businessProfile?: { paymentQrPath?: string | null };
};
type WhatsappInstance = {
  id: string; instanceName: string; status: string;
  qrCode?: string | null; lastError?: string | null; createdAt: string;
};

export default function WhatsappDashboardPage() {
  const [client, setClient] = useState<Client | null>(null);
  const [instances, setInstances] = useState<WhatsappInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  const [newInstanceSuffix, setNewInstanceSuffix] = useState('');
  const [uploadingQr, setUploadingQr] = useState(false);
  const [qrMessage, setQrMessage] = useState('');
  const [qrError, setQrError] = useState('');

  async function loadDefaultClient() {
    const all = await apiFetch<Client[]>('/api/clients');
    if (!all.length) {
      return await apiFetch<Client>('/api/clients', {
        method: 'POST',
        body: JSON.stringify({ name: 'My First Workspace', slug: `workspace-${Date.now()}` })
      });
    }
    return all[0]!;
  }

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const cli = await loadDefaultClient();
      setClient(cli);
      setCompanyName(cli.name);
      
      const inst = await apiFetch<WhatsappInstance[]>(`/api/clients/${cli.id}/instances`);
      setInstances(inst);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function createInstance() {
    if (!client) return;
    const suffix = newInstanceSuffix.trim() || 'primary';
    const instanceName = `client-${client.slug}-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    
    try {
      setLoading(true); setError(null);
      await apiFetch(`/api/clients/${client.id}/instances`, {
        method: 'POST',
        body: JSON.stringify({ instanceName })
      });
      setNewInstanceSuffix('');
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create instance');
    } finally { setLoading(false); }
  }

  async function reconnectInstance(instanceName: string) {
    if (!client) return;
    try {
      setLoading(true); setError(null);
      await apiFetch(`/api/clients/${client.id}/instances`, {
        method: 'POST',
        body: JSON.stringify({ instanceName })
      });
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to reconnect instance');
    } finally { setLoading(false); }
  }

  async function disconnectInstance(instanceName: string) {
    if (!client) return;
    try {
      setLoading(true); setError(null);
      await apiFetch(`/api/clients/${client.id}/instances/${instanceName}/connection`, {
        method: 'DELETE'
      });
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect instance');
    } finally { setLoading(false); }
  }

  async function saveCompanyName() {
    if (!client || !companyName.trim()) return;
    try {
      setSavingCompany(true); setError(null);
      const updated = await apiFetch<Client>(`/api/clients/${client.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: companyName.trim() })
      });
      setClient(updated); setCompanyName(updated.name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update company name');
    } finally { setSavingCompany(false); }
  }

  async function handlePaymentQrUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!client || !e.target.files?.[0]) return;
    try {
      setUploadingQr(true);
      setQrError('');
      setQrMessage('');

      const formData = new FormData();
      formData.append('qrImage', e.target.files[0]);

      const token = window.localStorage.getItem('authToken');
      const res = await fetch(`/api/clients/${client.id}/payment-qr`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }

      setClient({
        ...client,
        businessProfile: { ...client.businessProfile, paymentQrPath: 'uploaded' }
      });

      setQrMessage('Payment QR successfully active!');
      setTimeout(() => setQrMessage(''), 3000);
    } catch (err: unknown) {
      setQrError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingQr(false);
      // Reset input value to allow uploading same file again
      e.target.value = '';
    }
  }

  async function removePaymentQr() {
    if (!client) return;
    try {
      setUploadingQr(true);
      setQrError('');
      setQrMessage('');
      
      const token = window.localStorage.getItem('authToken');
      const res = await fetch(`/api/clients/${client.id}/payment-qr`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (!res.ok) throw new Error('Failed to remove');
      
      setClient({
        ...client,
        businessProfile: { ...client.businessProfile, paymentQrPath: null }
      });
      setQrMessage('Payment QR removed successfully.');
      setTimeout(() => setQrMessage(''), 3000);
    } catch (err: unknown) {
      setQrError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setUploadingQr(false);
    }
  }

  useEffect(() => { void loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusColor = (s: string) => {
    const u = s.toUpperCase();
    if (u === 'CONNECTED') return '#16a34a';
    if (u === 'WAITING_QR' || u === 'CONNECTING') return '#d97706';
    if (u === 'ERROR') return '#dc2626';
    return '#6b7280';
  };

  return (
    <main className="page-shell">
      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Header ── */}
        <section className="hero-card">
          <p className="eyebrow">WhatsApp Connection</p>
          <h1 className="hero-title">Connect your WhatsApp number</h1>
          <p className="muted">
            Create an Evolution instance for your workspace, scan the QR code, and start automating replies.
          </p>
          <div className="cta-row" style={{ marginTop: 20 }}>
            <input 
              type="text" 
              placeholder="Instance name (e.g. sales)" 
              value={newInstanceSuffix}
              onChange={(e) => setNewInstanceSuffix(e.target.value)}
              style={{ minWidth: 260 }}
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && void createInstance()}
            />
            <button className="button button-primary" disabled={loading || !newInstanceSuffix.trim()} onClick={createInstance}>
              {loading ? 'Working…' : '+ Create New Instance'}
            </button>
            <button className="button button-secondary" disabled={loading} onClick={loadData}>
              Reload Status
            </button>
          </div>
          {error && <p style={{ marginTop: 10, color: '#dc2626', fontSize: 13 }}>{error}</p>}
        </section>

        {/* ── Business Profile ── */}
        <section className="panel">
          <p className="eyebrow">Business Profile</p>
          {client ? (
            <>
              <div className="cta-row" style={{ marginTop: 12 }}>
                <input type="text" placeholder="Company name" value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)} style={{ minWidth: 260 }} />
                <button className="button button-secondary"
                  disabled={savingCompany || !companyName.trim()} onClick={saveCompanyName}>
                  {savingCompany ? 'Saving…' : 'Save company name'}
                </button>
              </div>

              <div style={{ marginTop: 24, padding: 16, background: 'rgba(0,0,0,0.02)', borderRadius: 12, border: '1px solid rgba(0,0,0,0.05)' }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#4b5563', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  💳 Payment QR Code
                </label>
                <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  This image will be automatically sent to the user immediately after their Quotation PDF is delivered.
                </p>

                {client.businessProfile?.paymentQrPath ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>✅ QR Code Active</span>
                    <button className="button button-secondary" style={{ padding: '4px 12px', fontSize: 12, color: '#dc2626', borderColor: 'rgba(220,38,38,0.2)' }} onClick={removePaymentQr} disabled={uploadingQr}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <input 
                    type="file" 
                    accept="image/png, image/jpeg" 
                    onChange={handlePaymentQrUpload} 
                    disabled={uploadingQr} 
                    style={{ fontSize: 14 }}
                  />
                )}

                {uploadingQr && <p style={{ fontSize: 13, color: '#3b82f6', marginTop: 8 }}>Working...</p>}
                {qrMessage && <p style={{ fontSize: 13, color: '#16a34a', marginTop: 8 }}>{qrMessage}</p>}
                {qrError && <p style={{ fontSize: 13, color: '#dc2626', marginTop: 8 }}>{qrError}</p>}
              </div>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 8 }}>No client loaded yet.</p>
          )}
        </section>

        {/* ── Instances ── */}
        <section className="panel">
          <p className="eyebrow">Instances</p>
          {instances.length === 0 ? (
            <p className="muted" style={{ marginTop: 8 }}>
              No instances yet. Click &quot;Create / Refresh Instance&quot; to get started.
            </p>
          ) : (
            <>
              <ul className="list" style={{ marginTop: 8 }}>
                {instances.map((inst) => {
                  const col = statusColor(inst.status);
                  return (
                    <li key={inst.id}>
                      <strong>{inst.instanceName}</strong>{' '}
                      <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 8,
                        padding: '2px 8px', borderRadius: 999, fontSize: 12,
                        background: `${col}18`, border: `1px solid ${col}66`, color: col }}>
                        {inst.status.toUpperCase()}
                      </span>
                      {inst.lastError && (
                        <span style={{ display: 'block', color: '#dc2626', marginTop: 4, fontSize: 13 }}>
                          Error: {inst.lastError}
                        </span>
                      )}
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <button className="button button-secondary" style={{ padding: '4px 12px', fontSize: 13 }} disabled={loading} onClick={() => reconnectInstance(inst.instanceName)}>
                          Reconnect
                        </button>
                        <button className="button button-secondary" style={{ padding: '4px 12px', fontSize: 13, color: '#dc2626', borderColor: 'rgba(220,38,38,0.2)' }} disabled={loading} onClick={() => disconnectInstance(inst.instanceName)}>
                          Disconnect
                        </button>
                      </div>
                      
                      {inst.qrCode && inst.status.toUpperCase() !== 'CONNECTED' && (
                        <div style={{ marginTop: 12, padding: '12px', background: 'rgba(0,0,0,0.02)', borderRadius: 8, border: '1px solid rgba(0,0,0,0.05)' }}>
                          <p className="eyebrow" style={{ marginBottom: 4 }}>Scan QR to Connect: {inst.instanceName}</p>
                          {inst.qrCode.startsWith('data:image')
                            ? <img src={inst.qrCode} alt={`QR for ${inst.instanceName}`}
                                style={{ borderRadius: 8, maxWidth: 220, background: '#fff' }} />
                            : <p className="muted" style={{ fontSize: 13 }}>{inst.qrCode}</p>
                          }
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

      </div>
    </main>
  );
}
