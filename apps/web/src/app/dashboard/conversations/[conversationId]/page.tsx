'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Client = {
  id: string;
  name: string;
  slug: string;
};

type Conversation = {
  id: string;
  externalChatId: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  lead?: {
    id: string;
    displayName: string | null;
    phone: string | null;
    status: string;
  } | null;
};

type Message = {
  id: string;
  direction: string;
  role: string;
  text: string | null;
  createdAt: string;
};

type ConversationWithMessages = {
  conversation: Conversation;
  messages: Message[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://scheduled-garden-coalition-explicit.trycloudflare.com';

export default function ConversationDetailPage() {
  const params = useParams();
  const conversationId = params?.conversationId as string | undefined;

  const [client, setClient] = useState<Client | null>(null);
  const [data, setData] = useState<ConversationWithMessages | null>(null);
  const [quotations, setQuotations] = useState<
    { id: string; status: string; createdAt: string; grandTotal: number; hasPdf: boolean }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const t = window.localStorage.getItem('authToken');
      setToken(t);
      if (!t) {
        setError('Please log in first at /login.');
      }
    }
  }, []);

  function authHeaders(): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function loadDefaultClient() {
    const res = await fetch(`${API_BASE}/api/clients`, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders()
      }
    });
    const all = (await res.json()) as Client[];
    if (!all.length) {
      throw new Error('No clients available for this user');
    }
    return all[0];
  }

  async function loadData() {
    if (!conversationId) return;
    try {
      setLoading(true);
      setError(null);
      if (!token) {
        throw new Error('Not authenticated');
      }
      const cli = await loadDefaultClient();
      setClient(cli);
      const res = await fetch(
        `${API_BASE}/api/clients/${cli.id}/conversations/${encodeURIComponent(
          conversationId
        )}/messages`,
        {
          headers: authHeaders()
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to load conversation');
      }
      const json = (await res.json()) as ConversationWithMessages;
      setData(json);

      // Load quotations for this lead, if available
      if (json.conversation.lead?.id) {
        const qRes = await fetch(
          `${API_BASE}/api/clients/${cli.id}/quotations?leadId=${encodeURIComponent(
            json.conversation.lead.id
          )}`,
          {
            headers: authHeaders()
          }
        );
        if (qRes.ok) {
          const qJson = (await qRes.json()) as any[];
          setQuotations(
            qJson.map((q) => ({
              id: q.id,
              status: q.status,
              createdAt: q.createdAt,
              grandTotal: Number(q.grandTotal ?? 0),
              hasPdf: !!q.hasPdf
            }))
          );
        }
      } else {
        setQuotations([]);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load conversation');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token && conversationId) {
      void loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, conversationId]);

  return (
    <main className="page-shell">
      <div className="container">
        <section className="hero-card">
          <p className="eyebrow">Conversation</p>
          <h1 className="hero-title">WhatsApp conversation detail</h1>
          <p className="muted">
            Inspect the full message history captured from Evolution for this WhatsApp chat.
          </p>
          <div className="cta-row" style={{ marginTop: 20 }}>
            <button className="button button-secondary" disabled={loading} onClick={loadData}>
              {loading ? 'Refreshing…' : 'Reload'}
            </button>
          </div>
        </section>

        <section className="panel" style={{ marginTop: 24 }}>
          <p className="eyebrow">Conversation overview</p>
          {client && data ? (
            <p className="muted" style={{ marginTop: 8 }}>
              <strong>{client.name}</strong> · chat id: <code>{data.conversation.externalChatId}</code>
              {data.conversation.lead && (
                <>
                  <br />
                  Lead:{' '}
                  <strong>
                    {data.conversation.lead.displayName ||
                      data.conversation.lead.phone ||
                      data.conversation.lead.id}
                  </strong>
                  {data.conversation.lead.phone && (
                    <> · Phone: {data.conversation.lead.phone}</>
                  )}{' '}
                  · Status: {data.conversation.lead.status}
                </>
              )}
            </p>
          ) : (
            <p className="muted">No client loaded yet.</p>
          )}
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <p className="eyebrow">Messages</p>
          {error && (
            <p className="muted" style={{ marginTop: 8, color: '#ff8888' }}>
              {error}
            </p>
          )}
          {!data ? (
            <p className="muted" style={{ marginTop: 8 }}>
              No conversation loaded yet.
            </p>
          ) : data.messages.length === 0 ? (
            <p className="muted" style={{ marginTop: 8 }}>
              No messages recorded for this conversation.
            </p>
          ) : (
            <ul className="list">
              {data.messages.map((m) => (
                <li key={m.id}>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#9ea9ca',
                      marginBottom: 4
                    }}
                  >
                    {m.direction === 'IN' ? 'User → Bot' : 'Bot → User'} · {m.role} ·{' '}
                    {new Date(m.createdAt).toLocaleString(undefined, {
                      dateStyle: 'short',
                      timeStyle: 'short'
                    })}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.text || '(no text payload)'}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <p className="eyebrow">Quotations</p>
          {quotations.length === 0 ? (
            <p className="muted" style={{ marginTop: 8 }}>
              No quotations recorded for this lead yet.
            </p>
          ) : (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Status</th>
                    <th>Total (₹)</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {quotations.map((q) => {
                    const created = new Date(q.createdAt).toLocaleString(undefined, {
                      dateStyle: 'short',
                      timeStyle: 'short'
                    });
                    return (
                      <tr key={q.id}>
                        <td>{created}</td>
                        <td>{q.status}</td>
                        <td>{q.grandTotal.toFixed(2)}</td>
                        <td>
                          {q.hasPdf && client ? (
                            <a
                              href={`${API_BASE}/api/clients/${client.id}/quotations/${q.id}/pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="button button-secondary"
                              style={{ fontSize: 12, padding: '4px 10px' }}
                            >
                              Open PDF
                            </a>
                          ) : (
                            <span className="muted" style={{ fontSize: 12 }}>
                              No PDF
                            </span>
                          )}
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

