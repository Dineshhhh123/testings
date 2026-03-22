'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch, getAuthToken, API_BASE } from '@/lib/api';

type Client = {
  id: string;
  name: string;
  slug: string;
};

type Lead = {
  id: string;
  displayName: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
};

type BlockedNumber = {
  id: string;
  phone: string;
  reason: string | null;
  createdAt: string;
};

export default function LeadsDashboardPage() {
  const [client, setClient] = useState<Client | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedNumber[]>([]);
  const [newBlockedPhone, setNewBlockedPhone] = useState('');
  const [newBlockedReason, setNewBlockedReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

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
      const json = await apiFetch<Lead[]>(`/api/clients/${cli.id}/leads`);
      setLeads(json);
      const blockedJson = await apiFetch<BlockedNumber[]>(`/api/clients/${cli.id}/blocked-numbers`);
      setBlocked(blockedJson);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }

  async function addBlockedNumber() {
    if (!client || !newBlockedPhone.trim()) return;
    try {
      setLoading(true);
      setError(null);
      await apiFetch(`/api/clients/${client.id}/blocked-numbers`, {
        method: 'POST',
        body: JSON.stringify({ phone: newBlockedPhone, reason: newBlockedReason || undefined })
      });
      setNewBlockedPhone('');
      setNewBlockedReason('');
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add blocked number');
    } finally {
      setLoading(false);
    }
  }

  async function removeBlockedNumber(id: string) {
    if (!client) return;
    try {
      setLoading(true);
      setError(null);
      await apiFetch(`/api/clients/${client.id}/blocked-numbers/${id}`, { method: 'DELETE' });
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove blocked number');
    } finally {
      setLoading(false);
    }
  }

  async function uploadBlocklistCsv() {
    if (!client || !file) return;
    try {
      setUploading(true);
      setError(null);
      const form = new FormData();
      form.append('file', file);
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/clients/${client.id}/blocked-numbers/bulk`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Upload failed');
      }
      setFile(null);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function toggleBlock(lead: Lead) {
    if (!client) return;
    try {
      setLoading(true);
      setError(null);
      const endpoint = lead.status === 'BLOCKED' ? 'unblock' : 'block';
      await apiFetch(`/api/clients/${client.id}/leads/${lead.id}/${endpoint}`, { method: 'POST' });
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update lead');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasLeads = leads.length > 0;

  return (
    <main className="page-shell">
      <div className="container">
        <section className="hero-card">
          <p className="eyebrow">Leads</p>
          <h1 className="hero-title">WhatsApp leads & contacts</h1>
          <p className="muted">
            This screen lists leads captured from WhatsApp conversations for the currently selected client.
          </p>
          <div className="cta-row" style={{ marginTop: 20 }}>
            <button className="button button-secondary" disabled={loading} onClick={loadData}>
              {loading ? 'Refreshing…' : 'Reload'}
            </button>
          </div>
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <p className="eyebrow">Leads</p>
          {error && (
            <p className="muted" style={{ marginTop: 8, color: '#ff8888' }}>
              {error}
            </p>
          )}
          {!hasLeads ? (
            <p className="muted" style={{ marginTop: 8 }}>
              No leads yet. Once your Evolution instance is connected and users start messaging, new leads will
              appear here.
            </p>
          ) : (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => {
                    const label = lead.displayName || lead.phone || lead.id;
                    const isBlocked = lead.status === 'BLOCKED';
                    const statusColor = isBlocked ? '#fb7185' : '#4ade80';
                    const statusLabel = isBlocked ? 'BLOCKED' : lead.status || 'NEW';
                    const created = new Date(lead.createdAt).toLocaleString(undefined, {
                      dateStyle: 'short',
                      timeStyle: 'short'
                    });
                    return (
                      <tr key={lead.id}>
                        <td>{label}</td>
                        <td>{lead.phone || '—'}</td>
                        <td>
                          <span
                            className="pill"
                            style={{
                              borderColor: statusColor,
                              color: statusColor
                            }}
                          >
                            {statusLabel}
                          </span>
                        </td>
                        <td>{created}</td>
                        <td>
                          <div className="cta-row" style={{ gap: 8 }}>
                            <button
                              className="button"
                              style={{
                                fontSize: 12,
                                padding: '4px 10px',
                                borderColor: isBlocked
                                  ? 'rgba(74,222,128,0.5)'
                                  : 'rgba(248,113,113,0.4)',
                                background: isBlocked
                                  ? 'rgba(22,163,74,0.3)'
                                  : 'rgba(127,29,29,0.4)',
                                color: isBlocked ? '#bbf7d0' : '#fecaca'
                              }}
                              disabled={loading}
                              onClick={() => void toggleBlock(lead)}
                            >
                              {isBlocked ? 'Unblock' : 'Block'}
                            </button>
                            <Link
                              href={`/dashboard/conversations?leadId=${encodeURIComponent(lead.id)}`}
                              className="button button-secondary"
                              style={{ fontSize: 12, padding: '4px 10px' }}
                            >
                              View
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <p className="eyebrow">Blocked numbers</p>
          <p className="muted" style={{ marginTop: 8 }}>
            Numbers in this list will never receive replies from the WhatsApp bot for this workspace, even if
            they are not yet visible as leads.
          </p>
          <div className="cta-row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <input
              type="tel"
              placeholder="Phone number"
              value={newBlockedPhone}
              onChange={(e) => setNewBlockedPhone(e.target.value)}
              style={{
                flex: 1,
                minWidth: 160,
                padding: 8,
                borderRadius: 8,
                border: '1px solid rgba(148,163,184,0.6)',
                background: 'rgba(15,23,42,0.9)',
                color: '#e5e7eb'
              }}
              disabled={loading || uploading}
            />
            <input
              type="text"
              placeholder="Reason (optional)"
              value={newBlockedReason}
              onChange={(e) => setNewBlockedReason(e.target.value)}
              style={{
                flex: 2,
                minWidth: 200,
                padding: 8,
                borderRadius: 8,
                border: '1px solid rgba(148,163,184,0.4)',
                background: 'rgba(15,23,42,0.9)',
                color: '#e5e7eb'
              }}
              disabled={loading || uploading}
            />
            <button className="button button-primary" disabled={loading || uploading || !newBlockedPhone.trim()} onClick={addBlockedNumber}>
              {loading ? 'Saving…' : 'Add to block list'}
            </button>
          </div>

          <div className="cta-row" style={{ marginTop: 16, flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
              border: '1px solid #d1d5db', background: '#f9fafb', color: '#374151'
            }}>
              📎 {file ? file.name : 'Choose CSV file...'}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={uploading} />
            </label>
            <button className="button button-secondary" disabled={!file || uploading} onClick={uploadBlocklistCsv}>
              {uploading ? '⏳ Uploading…' : '⬆ Bulk Upload CSV'}
            </button>
          </div>
          {blocked.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              No blocked numbers yet.
            </p>
          ) : (
            <ul className="list">
              {blocked.map((row) => (
                <li key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <strong>{row.phone}</strong>
                    {row.reason && (
                      <span style={{ marginLeft: 8, color: '#9ea9ca', fontSize: 12 }}>
                        {row.reason}
                      </span>
                    )}
                    <span style={{ color: '#9ea9ca', marginLeft: 8, fontSize: 12 }}>
                      added{' '}
                      {new Date(row.createdAt).toLocaleString(undefined, {
                        dateStyle: 'short',
                        timeStyle: 'short'
                      })}
                    </span>
                  </div>
                  <button
                    className="button button-secondary"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    disabled={loading}
                    onClick={() => void removeBlockedNumber(row.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

