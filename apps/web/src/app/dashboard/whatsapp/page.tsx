'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Client = { id: string; name: string; slug: string };
type WhatsappInstance = {
  id: string; instanceName: string; status: string;
  qrCode?: string | null; lastError?: string | null; createdAt: string;
};
type BlockedNumber = { id: string; phone: string; reason?: string | null; createdAt: string };

export default function WhatsappDashboardPage() {
  const [client, setClient] = useState<Client | null>(null);
  const [instances, setInstances] = useState<WhatsappInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);

  // Blocklist state
  const [blocked, setBlocked] = useState<BlockedNumber[]>([]);
  const [newPhone, setNewPhone] = useState('');
  const [newReason, setNewReason] = useState('');
  const [addingBlock, setAddingBlock] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

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
      const [inst, bl] = await Promise.all([
        apiFetch<WhatsappInstance[]>(`/api/clients/${cli.id}/instances`),
        apiFetch<BlockedNumber[]>(`/api/clients/${cli.id}/blocklist`)
      ]);
      setInstances(inst);
      setBlocked(bl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function createInstance() {
    if (!client) return;
    try {
      setLoading(true); setError(null);
      await apiFetch(`/api/clients/${client.id}/instances`, {
        method: 'POST',
        body: JSON.stringify({ instanceName: `client-${client.slug}-primary` })
      });
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create instance');
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

  async function addBlockedNumber() {
    if (!client || !newPhone.trim()) return;
    try {
      setAddingBlock(true); setBlockError(null);
      const entry = await apiFetch<BlockedNumber>(`/api/clients/${client.id}/blocklist`, {
        method: 'POST',
        body: JSON.stringify({ phone: newPhone.trim(), reason: newReason.trim() || null })
      });
      setBlocked((prev) => [entry, ...prev]);
      setNewPhone(''); setNewReason('');
    } catch (e: unknown) {
      setBlockError(e instanceof Error ? e.message : 'Failed to block number');
    } finally { setAddingBlock(false); }
  }

  async function unblockNumber(id: string) {
    if (!client) return;
    try {
      await apiFetch(`/api/clients/${client.id}/blocklist/${id}`, { method: 'DELETE' });
      setBlocked((prev) => prev.filter((b) => b.id !== id));
    } catch (e: unknown) {
      setBlockError(e instanceof Error ? e.message : 'Failed to remove');
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
            <button className="button button-primary" disabled={loading} onClick={createInstance}>
              {loading ? 'Working…' : 'Create / Refresh Instance'}
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
            <div className="cta-row" style={{ marginTop: 12 }}>
              <input type="text" placeholder="Company name" value={companyName}
                onChange={(e) => setCompanyName(e.target.value)} style={{ minWidth: 260 }} />
              <button className="button button-secondary"
                disabled={savingCompany || !companyName.trim()} onClick={saveCompanyName}>
                {savingCompany ? 'Saving…' : 'Save company name'}
              </button>
            </div>
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
                    </li>
                  );
                })}
              </ul>
              {instances[0]?.qrCode && (
                <div style={{ marginTop: 16 }}>
                  <p className="eyebrow">QR / Pairing</p>
                  {instances[0].qrCode.startsWith('data:image')
                    ? <img src={instances[0].qrCode} alt="WhatsApp QR"
                        style={{ marginTop: 8, borderRadius: 12, maxWidth: 260, background: '#fff' }} />
                    : <p className="muted" style={{ marginTop: 8 }}>{instances[0].qrCode}</p>
                  }
                </div>
              )}
            </>
          )}
        </section>

        {/* ── Blocklist ── */}
        <section className="panel">
          <p className="eyebrow" style={{ marginBottom: 12 }}>
            🚫 Number Blocklist
          </p>
          <p className="muted" style={{ marginBottom: 16, fontSize: 13 }}>
            Numbers added here will be silently ignored by the chatbot — no replies will be sent.
          </p>

          {/* Add form */}
          {client && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Phone Number *
                </label>
                <input type="text" placeholder="e.g. 919876543210"
                  value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
                  style={{ width: 200 }}
                  onKeyDown={(e) => e.key === 'Enter' && void addBlockedNumber()} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Reason (optional)
                </label>
                <input type="text" placeholder="e.g. Spam"
                  value={newReason} onChange={(e) => setNewReason(e.target.value)}
                  style={{ width: 200 }}
                  onKeyDown={(e) => e.key === 'Enter' && void addBlockedNumber()} />
              </div>
              <button className="button button-primary"
                disabled={addingBlock || !newPhone.trim()} onClick={addBlockedNumber}
                style={{ alignSelf: 'flex-end' }}>
                {addingBlock ? 'Adding…' : '+ Block Number'}
              </button>
            </div>
          )}

          {blockError && (
            <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 10 }}>{blockError}</p>
          )}

          {/* Blocked list */}
          {blocked.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>No numbers blocked yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Phone</th>
                    <th>Reason</th>
                    <th>Blocked on</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {blocked.map((b, idx) => (
                    <tr key={b.id}>
                      <td style={{ color: '#9ca3af', fontSize: 12 }}>{idx + 1}</td>
                      <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{b.phone}</td>
                      <td style={{ color: '#6b7280', fontSize: 13 }}>{b.reason || '—'}</td>
                      <td style={{ color: '#9ca3af', fontSize: 12 }}>
                        {new Date(b.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button onClick={() => void unblockNumber(b.id)}
                          style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)',
                            borderRadius: 6, color: '#dc2626', cursor: 'pointer', fontSize: 12, padding: '3px 12px' }}>
                          Unblock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
