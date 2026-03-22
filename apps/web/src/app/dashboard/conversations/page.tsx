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
  lead?: { id: string; displayName: string | null; phone: string | null; status: string; } | null;
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

  useEffect(() => { void loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasConversations = conversations.length > 0;

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
              <table className="table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Phone</th>
                    <th>State</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((c) => {
                    const leadLabel = c.lead?.displayName || c.lead?.phone || c.externalChatId;
                    const phone = c.lead?.phone || '—';
                    const updated = new Date(c.updatedAt).toLocaleString(undefined, {
                      dateStyle: 'short',
                      timeStyle: 'short'
                    });
                    return (
                      <tr key={c.id}>
                        <td>{leadLabel}</td>
                        <td>{phone}</td>
                        <td>{c.state}</td>
                        <td>{updated}</td>
                        <td>
                          <Link
                            href={`/dashboard/conversations/${encodeURIComponent(c.id)}`}
                            className="button button-secondary"
                            style={{ fontSize: 12, padding: '4px 10px' }}
                          >
                            View
                          </Link>
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

