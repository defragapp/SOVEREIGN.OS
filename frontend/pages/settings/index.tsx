import Head from 'next/head';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Nav from '../../components/Nav';

interface Profile {
  display_name: string;
  date_of_birth: string;
  time_of_birth: string | null;
}

export default function Settings() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ display_name: '', tob: '', tobUnknown: false });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [activeTab, setActiveTab] = useState<'profile' | 'subscription' | 'privacy'>('profile');

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then((p: Profile | null) => {
        if (!p) { router.replace('/onboarding'); return; }
        setProfile(p);
        setForm({
          display_name: p.display_name || '',
          tob: p.time_of_birth || '',
          tobUnknown: !p.time_of_birth,
        });
      });
  }, [router]);

  async function saveProfile() {
    setStatus('saving');
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: form.display_name,
        time_of_birth: form.tobUnknown ? null : form.tob || null,
      }),
    });
    setStatus(res.ok ? 'saved' : 'error');
    setTimeout(() => setStatus('idle'), 2500);
  }

  async function deleteAccount() {
    if (!confirm('This will permanently delete your account and all your data. This cannot be undone. Continue?')) return;
    await fetch('/api/profile', { method: 'DELETE' });
    router.replace('/auth/signin');
  }

  return (
    <>
      <Head>
        <title>Settings Â· Sovereign</title>
        <meta name="theme-color" content="#080808" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <Nav />

      <main className="settings-root">
        <div className="settings-container">
          <header className="settings-header">
            <h1 className="settings-title">Settings</h1>
            <p className="settings-sub">Manage your profile, subscription, and privacy.</p>
          </header>

          {/* Tab bar */}
          <div className="settings-tabs">
            {(['profile', 'subscription', 'privacy'] as const).map(t => (
              <button
                key={t}
                className={`tab-btn ${activeTab === t ? 'active' : ''}`}
                onClick={() => setActiveTab(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* ââ PROFILE TAB ââ */}
          {activeTab === 'profile' && (
            <div className="glass-panel settings-panel fade-in">
              <h2 className="panel-title">Your Profile</h2>
              <p className="panel-body">
                These details shape how your spaces understand and speak to you.
                Your birth date cannot be changed after it's set.
              </p>

              <div className="field-group">
                <label className="field-label">Display Name</label>
                <input
                  className="sov-input"
                  type="text"
                  value={form.display_name}
                  onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  maxLength={40}
                />
              </div>

              <div className="field-group">
                <label className="field-label">Date of Birth</label>
                <input
                  className="sov-input sov-input--disabled"
                  type="date"
                  value={profile?.date_of_birth || ''}
                  disabled
                />
                <p className="field-hint">This is locked for the integrity of your design profile.</p>
              </div>

              <div className="field-group">
                <label className="field-label">Time of Birth</label>
                {!form.tobUnknown && (
                  <input
                    className="sov-input"
                    type="time"
                    value={form.tob}
                    onChange={e => setForm(f => ({ ...f, tob: e.target.value }))}
                  />
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.tobUnknown}
                    onChange={e => setForm(f => ({ ...f, tobUnknown: e.target.checked }))}
                  />
                  <span>I don't know my birth time</span>
                </label>
              </div>

              <div className="panel-footer">
                {status === 'saved' && <span className="status-ok">â Saved</span>}
                {status === 'error' && <span className="status-err">Something went wrong</span>}
                <button
                  className="btn-primary"
                  onClick={saveProfile}
                  disabled={status === 'saving'}
                >
                  {status === 'saving' ? 'Savingâ¦' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {/* ââ SUBSCRIPTION TAB ââ */}
          {activeTab === 'subscription' && (
            <div className="glass-panel settings-panel fade-in">
              <h2 className="panel-title">Your Subscription</h2>
              <p className="panel-body">
                Manage your plan, update billing details, or explore what's included at each tier.
              </p>
              <div className="plan-card plan-card--current">
                <div className="plan-badge">Current Plan</div>
                <div className="plan-name">Free</div>
                <div className="plan-features">
                  <span>â Launcher</span>
                  <span>â Defrag Â· 3Ã per day</span>
                  <span>â Alignment Â· 5Ã per day</span>
                  <span>â The Loop Â· 3Ã per day</span>
                </div>
              </div>
              <a href="/billing" className="btn-primary btn-upgrade">
                Upgrade to Pro â
              </a>
              <p className="field-hint">
                Pro unlocks unlimited access to all six spaces, including Compression and Covenant.
              </p>
            </div>
          )}

          {/* ââ PRIVACY TAB ââ */}
          {activeTab === 'privacy' && (
            <div className="glass-panel settings-panel fade-in">
              <h2 className="panel-title">Privacy & Data</h2>
              <p className="panel-body">
                Your data is private by default. We never sell your information or use it
                to train AI models outside of your personal experience within Sovereign.
              </p>
              <div className="privacy-item">
                <div className="privacy-label">Data encryption</div>
                <div className="privacy-val privacy-val--ok">End-to-end encrypted at rest</div>
              </div>
              <div className="privacy-item">
                <div className="privacy-label">Third-party sharing</div>
                <div className="privacy-val privacy-val--ok">None</div>
              </div>
              <div className="privacy-item">
                <div className="privacy-label">AI training</div>
                <div className="privacy-val privacy-val--ok">Your data is not used to train models</div>
              </div>
              <div className="danger-zone">
                <h3 className="danger-title">Danger Zone</h3>
                <p className="field-hint">
                  Deleting your account permanently removes all your data. There is no recovery.
                </p>
                <button className="btn-danger" onClick={deleteAccount}>
                  Delete My Account
                </button>
              </div>
            </div>
          )}
        </div>

        <style jsx>{`
          .settings-root {
            min-height: 100vh;
            background: var(--color-base);
            padding: 48px 24px 120px;
            margin-left: 220px;
          }
          @media (max-width: 768px) {
            .settings-root { margin-left: 0; padding-bottom: 100px; }
          }
          .settings-container { max-width: 600px; margin: 0 auto; }
          .settings-header { margin-bottom: 36px; }
          .settings-title {
            font-family: var(--font-display);
            font-size: clamp(2rem, 5vw, 3rem);
            font-weight: 700;
            color: var(--color-chrome);
            margin: 0 0 8px;
          }
          .settings-sub { color: var(--color-muted); margin: 0; }

          .settings-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 28px;
            background: rgba(255,255,255,0.04);
            border-radius: 12px;
            padding: 4px;
          }
          .tab-btn {
            flex: 1;
            background: transparent;
            border: none;
            color: var(--color-muted);
            padding: 10px 12px;
            border-radius: 9px;
            font-size: 0.875rem;
            cursor: pointer;
            transition: background 0.2s, color 0.2s;
          }
          .tab-btn.active { background: rgba(255,255,255,0.08); color: var(--color-chrome); }

          .settings-panel { padding: 36px; }
          .panel-title {
            font-family: var(--font-display);
            font-size: 1.4rem;
            font-weight: 600;
            color: var(--color-chrome);
            margin: 0 0 10px;
          }
          .panel-body { color: var(--color-muted); margin: 0 0 28px; line-height: 1.6; }

          .field-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
          .field-label { font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-muted); }
          .field-hint { font-size: 0.8rem; color: rgba(200,200,200,0.35); margin: 4px 0 0; }
          .sov-input {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 12px;
            padding: 12px 16px;
            font-size: 0.95rem;
            color: var(--color-chrome);
            outline: none;
            transition: border-color 0.2s;
            width: 100%;
            box-sizing: border-box;
          }
          .sov-input:focus { border-color: var(--color-accent); }
          .sov-input--disabled { opacity: 0.45; cursor: not-allowed; }
          .checkbox-label { display: flex; align-items: center; gap: 8px; color: var(--color-muted); cursor: pointer; font-size: 0.875rem; }
          .checkbox-label input { accent-color: var(--color-accent); }
          .panel-footer { display: flex; align-items: center; justify-content: flex-end; gap: 16px; margin-top: 8px; }
          .status-ok { color: #4ade80; font-size: 0.875rem; }
          .status-err { color: #f87171; font-size: 0.875rem; }

          .btn-primary {
            background: var(--color-accent);
            color: #000;
            border: none;
            border-radius: 12px;
            padding: 12px 24px;
            font-weight: 600;
            font-size: 0.9rem;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            transition: opacity 0.2s;
          }
          .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
          .btn-primary:not(:disabled):hover { opacity: 0.85; }
          .btn-upgrade { margin-top: 24px; }

          .plan-card {
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 16px;
          }
          .plan-card--current { border-color: rgba(200,200,200,0.25); }
          .plan-badge { font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-muted); margin-bottom: 8px; }
          .plan-name { font-family: var(--font-display); font-size: 1.5rem; font-weight: 700; color: var(--color-chrome); margin-bottom: 16px; }
          .plan-features { display: flex; flex-direction: column; gap: 6px; color: var(--color-muted); font-size: 0.875rem; }

          .privacy-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 14px 0;
            border-bottom: 1px solid rgba(255,255,255,0.06);
          }
          .privacy-label { color: var(--color-muted); font-size: 0.9rem; }
          .privacy-val { font-size: 0.875rem; }
          .privacy-val--ok { color: #4ade80; }

          .danger-zone {
            margin-top: 36px;
            padding-top: 24px;
            border-top: 1px solid rgba(248, 113, 113, 0.2);
          }
          .danger-title { font-size: 0.875rem; font-weight: 600; color: #f87171; margin: 0 0 8px; letter-spacing: 0.05em; text-transform: uppercase; }
          .btn-danger {
            background: transparent;
            border: 1px solid rgba(248,113,113,0.4);
            border-radius: 12px;
            color: #f87171;
            padding: 10px 20px;
            font-size: 0.875rem;
            cursor: pointer;
            margin-top: 12px;
            transition: background 0.2s, border-color 0.2s;
          }
          .btn-danger:hover { background: rgba(248,113,113,0.08); border-color: #f87171; }
        `}</style>
      </main>
    </>
  );
}
