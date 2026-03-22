import Link from 'next/link';

const phases = [
  'Connect WhatsApp and track instance status',
  'Ingest PDFs, DOCX, sheets, and website content into RAG',
  'Capture lead fields, meetings, quotations, and conversation history'
];

const modules = [
  'Client onboarding and business profile',
  'WhatsApp QR connection and status',
  'Knowledge ingestion and website crawling',
  'Pricing sheets and quotation templates',
  'Lead pipeline and meeting scheduler',
  'RAG-backed AI orchestration'
];

export default function HomePage() {
  return (
    <main className="page-shell">
      <div className="container">
        <section className="hero-card">
          <p className="eyebrow">Foundation Scaffold</p>
          <h1 className="hero-title">Multi-client WhatsApp automation platform</h1>
          <p className="muted">
            This workspace now includes the first dashboard scaffold for onboarding clients, connecting
            WhatsApp, ingesting business knowledge, and managing AI-driven lead workflows.
          </p>
          <div className="cta-row" style={{ marginTop: 20 }}>
            <Link className="button button-primary" href="/dashboard">
              Open Dashboard Shell
            </Link>
            <a className="button button-secondary" href="http://localhost:3001/health">
              Existing Bot Health
            </a>
          </div>
          <ul className="list">
            {phases.map((phase) => (
              <li key={phase}>{phase}</li>
            ))}
          </ul>
        </section>

        <section className="stats-grid" style={{ marginTop: 24 }}>
          <div className="stat-card">
            <div className="stat-label">Apps</div>
            <div className="stat-value">2</div>
            <p className="muted">Dashboard UI and platform API are scaffolded as separate apps.</p>
          </div>
          <div className="stat-card">
            <div className="stat-label">Packages</div>
            <div className="stat-value">4</div>
            <p className="muted">Database, shared types, AI orchestration, and parsers are split into packages.</p>
          </div>
          <div className="stat-card">
            <div className="stat-label">Core Domains</div>
            <div className="stat-value">11</div>
            <p className="muted">Auth, clients, WhatsApp, knowledge, RAG, pricing, templates, and more.</p>
          </div>
        </section>

        <section className="two-col-grid" style={{ marginTop: 24 }}>
          <div className="panel">
            <p className="eyebrow">Initial Modules</p>
            <ul className="list">
              {modules.map((module) => (
                <li key={module}>{module}</li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <p className="eyebrow">Next Build Steps</p>
            <div className="chip-row" style={{ marginTop: 12 }}>
              <span className="chip">Auth</span>
              <span className="chip">QR Connect</span>
              <span className="chip">RAG Ingestion</span>
              <span className="chip">Lead Capture</span>
              <span className="chip">Quotation PDFs</span>
            </div>
            <p className="muted" style={{ marginTop: 18 }}>
              The next implementation pass should wire database migrations, install workspace dependencies,
              and start replacing the single-client bot configuration with per-client services.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
