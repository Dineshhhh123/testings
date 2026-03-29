'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

type Client = { id: string; name: string; slug: string; };

type Conversation = {
  id: string;
  externalChatId: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  isPaused: boolean;
  whatsappInstanceName?: string | null;
  lead?: { id: string; displayName: string | null; phone: string | null; businessName?: string | null; status: string; } | null;
};

export default function ConversationsDashboardPage() {
  const [client, setClient] = useState<Client | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const json = await apiFetch<Conversation[]>(`/api/clients/${cli.id}/conversations`);
      setConversations(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }

  async function togglePause(convId: string) {
    if (!client) return;
    try {
      const updated = await apiFetch<Conversation>(`/api/clients/${client.id}/conversations/${convId}/toggle-pause`, {
        method: 'PATCH'
      });
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, isPaused: updated.isPaused } : c));
    } catch (e: any) {
      alert(e.message || 'Failed to toggle pause');
    }
  }

  useEffect(() => { void loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasConversations = conversations.length > 0;

  function exportToCsv() {
    if (!conversations.length) return;

    const headers = ['Lead (Name/ID)', 'Business Name', 'Phone', 'Instance', 'State', 'Last Updated'];
    const rows = conversations.map(c => {
      const leadLabel = c.lead?.displayName || c.externalChatId;
      const businessName = c.lead?.businessName || '';
      const phone = c.lead?.phone || '';
      const instance = c.whatsappInstanceName || '';
      const updated = new Date(c.updatedAt).toLocaleString(undefined, {
        dateStyle: 'short',
        timeStyle: 'short'
      });

      return [
        `"${leadLabel.replace(/"/g, '""')}"`,
        `"${businessName.replace(/"/g, '""')}"`,
        `"${phone}"`,
        `"${instance}"`,
        `"${c.isPaused ? 'Paused' : c.state}"`,
        `"${updated}"`,
        `"${c.isPaused ? 'Manual' : 'Chatbot'}"`
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `conversations_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <main className="page-shell">
      <div className="container">
        <section className="hero-card">
          <p className="eyebrow">Conversations</p>
          <h1 className="hero-title">WhatsApp conversations</h1>
          <p className="muted">
            View all WhatsApp conversations captured for the current client. Click into any conversation to see
            the full message history.
          </p>
          <div className="cta-row" style={{ marginTop: 20 }}>
            <button className="button button-secondary" disabled={loading} onClick={loadData}>
              {loading ? 'Refreshing…' : 'Reload'}
            </button>
            <button className="button button-primary" disabled={!hasConversations || loading} onClick={exportToCsv}>
              Export to Excel
            </button>
          </div>
        </section>

        <section className="panel" style={{ marginTop: 24 }}>
          <p className="eyebrow">Current Client</p>
          {client ? (
            <p className="muted" style={{ marginTop: 8 }}>
              <strong>{client.name}</strong> · slug: <code>{client.slug}</code>
            </p>
          ) : (
            <p className="muted">No client loaded yet.</p>
          )}
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <p className="eyebrow">Conversations</p>
          {error && (
            <p className="muted" style={{ marginTop: 8, color: '#ff8888' }}>
              {error}
            </p>
          )}
          {!hasConversations ? (
            <p className="muted" style={{ marginTop: 8 }}>
              No conversations yet. Once your Evolution instance is connected and users start messaging, new
              conversations will appear here.
            </p>
          ) : (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table className="table" style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 110 }}>Lead</th>
                    <th style={{ minWidth: 120 }}>Business Name</th>
                    <th style={{ minWidth: 120 }}>Phone</th>
                    <th style={{ minWidth: 130 }}>Instance</th>
                    <th style={{ minWidth: 110 }}>State</th>
                    <th style={{ minWidth: 120 }}>Automation</th>
                    <th style={{ minWidth: 120 }}>Updated</th>
                    <th style={{ textAlign: 'right', minWidth: 180 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((c) => {
                    const leadLabel = c.lead?.displayName || c.lead?.phone || c.externalChatId;
                    const businessName = c.lead?.businessName || '—';
                    const phone = c.lead?.phone || '—';
                    const instance = c.whatsappInstanceName || '—';
                    const updated = new Date(c.updatedAt).toLocaleString(undefined, {
                      dateStyle: 'short',
                      timeStyle: 'short'
                    });
                    return (
                      <tr key={c.id}>
                        <td style={{ fontSize: 13 }}>{leadLabel}</td>
                        <td style={{ fontSize: 13 }}>{businessName}</td>
                        <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{phone}</td>
                        <td style={{ fontSize: 12, color: '#6b7280', maxWidth: 150, wordBreak: 'break-all' }}>{instance}</td>
                        <td style={{ fontSize: 12 }}>
                          <code style={{ background: 'rgba(107,114,128,0.1)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{c.state}</code>
                        </td>
                        <td>
                          {c.isPaused ? (
                            <span style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                              MANUAL CHAT
                            </span>
                          ) : (
                            <span style={{ color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                              ACTIVE AI
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{updated}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              className={`button ${c.isPaused ? 'button-primary' : 'button-secondary'}`}
                              style={{ fontSize: 11, padding: '4px 10px' }}
                              onClick={() => togglePause(c.id)}
                            >
                              {c.isPaused ? '🤖 Resume AI' : '✋ Manual Chat'}
                            </button>
                            <Link
                              href={`/dashboard/conversations/${encodeURIComponent(c.id)}`}
                              className="button button-secondary"
                              style={{ fontSize: 11, padding: '4px 10px' }}
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
      </div>
    </main>
  );
}

