'use client';

import { useEffect, useState } from 'react';
import { apiFetch, getAuthToken, API_BASE } from '@/lib/api';

type Client = { id: string; name: string; slug: string; };
type KnowledgeSource = {
  id: string; title: string; type: string; status: string;
  mimeType: string | null; createdAt: string;
  metadata?: { chunkCount?: number; ingestedAt?: string; [key: string]: unknown };
};
type RagChunk = {
  id: string; content: string; chunkIndex: number;
  source: { id: string; title: string; type: string; };
};

export default function KnowledgeDashboardPage() {
  const [client, setClient] = useState<Client | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  const [ragQuery, setRagQuery] = useState('');
  const [ragResults, setRagResults] = useState<RagChunk[]>([]);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragError, setRagError] = useState<string | null>(null);

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
      const src = await apiFetch<KnowledgeSource[]>(`/api/clients/${cli.id}/knowledge`);
      setSources(src);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load knowledge sources');
    } finally {
      setLoading(false);
    }
  }

  async function upload() {
    if (!client || !file) return;
    try {
      setLoading(true);
      setError(null);
      const form = new FormData();
      form.append('file', file);
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/clients/${client.id}/knowledge/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form
      });
      if (!res.ok) throw new Error(await res.text() || 'Upload failed');
      setFile(null);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to upload file');
    } finally {
      setLoading(false);
    }
  }

  async function ingestSource(sourceId: string) {
    if (!client) return;
    try {
      setIngestingId(sourceId);
      setError(null);
      await apiFetch(`/api/clients/${client.id}/knowledge/${sourceId}/ingest`, { method: 'POST' });
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to ingest source');
    } finally {
      setIngestingId(null);
    }
  }

  async function deleteSource(sourceId: string) {
    if (!client) return;
    const ok = typeof window === 'undefined' ? true : window.confirm('Delete this document?');
    if (!ok) return;
    try {
      setLoading(true);
      setError(null);
      await apiFetch(`/api/clients/${client.id}/knowledge/${sourceId}`, { method: 'DELETE' });
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete source');
    } finally {
      setLoading(false);
    }
  }

  async function runRagQuery() {
    if (!client || !ragQuery.trim()) return;
    try {
      setRagLoading(true);
      setRagError(null);
      setRagResults([]);
      const json = await apiFetch<{ chunks: RagChunk[] }>(`/api/clients/${client.id}/rag/query`, {
        method: 'POST',
        body: JSON.stringify({ query: ragQuery, limit: 5 })
      });
      setRagResults(json.chunks || []);
    } catch (e: unknown) {
      setRagError(e instanceof Error ? e.message : 'Failed to run retrieval query');
    } finally {
      setRagLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="page-shell">
      <div className="container">
        <section className="hero-card">
          <p className="eyebrow">Knowledge Sources</p>
          <h1 className="hero-title">Upload business documents</h1>
          <p className="muted">
            Use this screen to upload PDFs, Word docs, and spreadsheets that describe your client&apos;s
            products, services, and processes. These files are tracked per client and will later feed into the
            RAG pipeline for AI replies.
          </p>
          <div className="cta-row" style={{ marginTop: 20 }}>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={loading}
            />
            <button className="button button-primary" disabled={!file || loading} onClick={upload}>
              {loading ? 'Uploading…' : 'Upload'}
            </button>
            <button className="button button-secondary" disabled={loading} onClick={loadData}>
              Reload
            </button>
          </div>
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <p className="eyebrow">Uploaded Sources</p>
          {error && (
            <p className="muted" style={{ marginTop: 8, color: '#ff8888' }}>
              {error}
            </p>
          )}
          {sources.length === 0 ? (
            <p className="muted" style={{ marginTop: 8 }}>
              No knowledge sources yet. Upload a PDF, DOCX, XLSX, or CSV file to get started.
            </p>
          ) : (
            <ul className="list">
              {sources.map((s) => (
                <li key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <strong>{s.title}</strong> — {s.type} — status: {s.status}{' '}
                      <span style={{ color: '#9ea9ca' }}>({s.mimeType || 'unknown mime'})</span>
                    </div>
                    <div className="cta-row" style={{ gap: 8 }}>
                      <button
                        className="button button-secondary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        disabled={!!ingestingId || loading}
                        onClick={() => ingestSource(s.id)}
                      >
                        {ingestingId === s.id ? 'Ingesting…' : 'Ingest'}
                      </button>
                      <button
                        className="button"
                        style={{
                          fontSize: 12,
                          padding: '4px 10px',
                          borderColor: 'rgba(248,113,113,0.4)',
                          background: 'rgba(127,29,29,0.4)',
                          color: '#fecaca'
                        }}
                        disabled={loading}
                        onClick={() => deleteSource(s.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {typeof s.metadata?.chunkCount === 'number' && (
                      <span>
                        Chunks: {s.metadata.chunkCount}{' '}
                        {s.metadata.ingestedAt && (
                          <>
                            · ingested at:{' '}
                            {new Date(s.metadata.ingestedAt).toLocaleString(undefined, {
                              dateStyle: 'short',
                              timeStyle: 'short'
                            })}
                          </>
                        )}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <p className="eyebrow">Test retrieval (RAG)</p>
          <p className="muted" style={{ marginTop: 8 }}>
            Run a simple keyword search across all ingested chunks for this client. This is a quick way to
            verify that your documents are being parsed correctly before wiring into AI replies.
          </p>
          <textarea
            className="input"
            style={{ marginTop: 8, minHeight: 80 }}
            placeholder="Ask about a product, policy, or FAQ…"
            value={ragQuery}
            onChange={(e) => setRagQuery(e.target.value)}
          />
          <div className="cta-row" style={{ marginTop: 8 }}>
            <button
              className="button button-primary"
              disabled={!ragQuery.trim() || ragLoading || !client}
              onClick={runRagQuery}
            >
              {ragLoading ? 'Searching…' : 'Search chunks'}
            </button>
          </div>
          {ragError && (
            <p className="muted" style={{ marginTop: 8, color: '#ff8888' }}>
              {ragError}
            </p>
          )}
          {ragResults.length > 0 && (
            <ul className="list" style={{ marginTop: 12 }}>
              {ragResults.map((c) => (
                <li key={c.id}>
                  <div style={{ fontSize: 12, color: '#9ea9ca' }}>
                    From <strong>{c.source?.title}</strong> (chunk #{c.chunkIndex})
                  </div>
                  <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                    {c.content.length > 400 ? `${c.content.slice(0, 400)}…` : c.content}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

