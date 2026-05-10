import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

type Step = 'welcome' | 'dob' | 'tob' | 'name' | 'done';

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('welcome');
  const [form, setForm] = useState({ name: '', dob: '', tob: '', tobUnknown: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (key: string, val: string | boolean) =>
    setForm(f => ({ ...f, [key]: val }));

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: form.name.trim(),
          date_of_birth: form.dob,
          time_of_birth: form.tobUnknown ? null : form.tob || null,
        }),
      });
      if (!res.ok) throw new Error('Could not save profile.');
      router.push('/launcher');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setSaving(false);
    }
  }

  return (
    <>
      <Head>
        <title>Welcome to Sovereign</title>
        <meta name="theme-color" content="#080808" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <div className="onboarding-root">
        {/* Ambient background */}
        <div className="orb orb-indigo" style={{ top: '10%', left: '20%' }} />
        <div className="orb orb-gold" style={{ bottom: '15%', right: '15%' }} />

        <div className="onboarding-card glass-panel">

          {/* Progress dots */}
          <div className="onboarding-dots">
            {(['welcome','name','dob','tob','done'] as Step[]).map((s, i) => (
              <span
                key={s}
                className={`dot ${step === s ? 'active' : ''} ${
                  ['welcome','name','dob','tob','done'].indexOf(step) > i ? 'past' : ''
                }`}
              />
            ))}
          </div>

          {/* ââ STEP: WELCOME ââ */}
          {step === 'welcome' && (
            <div className="onboarding-step fade-in">
              <div className="sovereign-mark">â¦</div>
              <h1 className="headline-display">Welcome to<br />Sovereign.</h1>
              <p className="body-copy">
                This is your private space. Everything you share here stays between you
                and the tools you choose to use. We'll ask for a few details once â
                they help us speak to your unique design.
              </p>
              <button className="btn-primary btn-lg" onClick={() => setStep('name')}>
                Let's begin â
              </button>
            </div>
          )}

          {/* ââ STEP: NAME ââ */}
          {step === 'name' && (
            <div className="onboarding-step fade-in">
              <p className="step-label">Step 1 of 3</p>
              <h2 className="headline-display">What should we<br />call you?</h2>
              <p className="body-copy">
                This is just for you. It's how your spaces will greet you.
              </p>
              <input
                className="sov-input"
                type="text"
                placeholder="Your first name"
                value={form.name}
                onChange={e => update('name', e.target.value)}
                autoFocus
                maxLength={40}
              />
              <button
                className="btn-primary btn-lg"
                disabled={!form.name.trim()}
                onClick={() => setStep('dob')}
              >
                Continue â
              </button>
            </div>
          )}

          {/* ââ STEP: DOB ââ */}
          {step === 'dob' && (
            <div className="onboarding-step fade-in">
              <p className="step-label">Step 2 of 3</p>
              <h2 className="headline-display">Your date<br />of birth.</h2>
              <p className="body-copy">
                Your birth date unlocks the patterns in your design â the way you naturally
                process decisions, relate to others, and find your footing.
              </p>
              <input
                className="sov-input"
                type="date"
                value={form.dob}
                onChange={e => update('dob', e.target.value)}
                max={new Date().toISOString().split('T')[0]}
              />
              <div className="btn-row">
                <button className="btn-ghost" onClick={() => setStep('name')}>â Back</button>
                <button
                  className="btn-primary"
                  disabled={!form.dob}
                  onClick={() => setStep('tob')}
                >
                  Continue â
                </button>
              </div>
            </div>
          )}

          {/* ââ STEP: TIME OF BIRTH ââ */}
          {step === 'tob' && (
            <div className="onboarding-step fade-in">
              <p className="step-label">Step 3 of 3</p>
              <h2 className="headline-display">Your time<br />of birth.</h2>
              <p className="body-copy">
                Your birth time adds another layer of precision to your design.
                If you're not sure, that's completely fine â just skip it.
              </p>
              {!form.tobUnknown && (
                <input
                  className="sov-input"
                  type="time"
                  value={form.tob}
                  onChange={e => update('tob', e.target.value)}
                />
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.tobUnknown}
                  onChange={e => update('tobUnknown', e.target.checked)}
                />
                <span>I don't know my birth time</span>
              </label>
              {error && <p className="error-msg">{error}</p>}
              <div className="btn-row">
                <button className="btn-ghost" onClick={() => setStep('dob')}>â Back</button>
                <button
                  className="btn-primary"
                  disabled={saving || (!form.tob && !form.tobUnknown)}
                  onClick={save}
                >
                  {saving ? 'Savingâ¦' : 'Enter Sovereign â'}
                </button>
              </div>
            </div>
          )}

        </div>

        <style jsx>{`
          .onboarding-root {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            position: relative;
            overflow: hidden;
            background: var(--color-base);
          }
          .onboarding-card {
            width: 100%;
            max-width: 480px;
            padding: 48px 40px;
            position: relative;
            z-index: 10;
          }
          .onboarding-step { display: flex; flex-direction: column; gap: 20px; }
          .sovereign-mark {
            font-size: 2rem;
            color: var(--color-accent);
            margin-bottom: 8px;
          }
          .step-label {
            font-size: 0.75rem;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--color-muted);
          }
          .headline-display {
            font-family: var(--font-display);
            font-size: clamp(2rem, 5vw, 3rem);
            font-weight: 700;
            line-height: 1.1;
            color: var(--color-chrome);
            margin: 0;
          }
          .body-copy { color: var(--color-muted); line-height: 1.65; margin: 0; }
          .sov-input {
            width: 100%;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 12px;
            padding: 14px 18px;
            font-size: 1rem;
            color: var(--color-chrome);
            outline: none;
            transition: border-color 0.2s;
          }
          .sov-input:focus { border-color: var(--color-accent); }
          .btn-primary {
            background: var(--color-accent);
            color: #000;
            border: none;
            border-radius: 12px;
            padding: 14px 28px;
            font-weight: 600;
            font-size: 0.95rem;
            cursor: pointer;
            transition: opacity 0.2s, transform 0.15s;
          }
          .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
          .btn-primary:not(:disabled):hover { opacity: 0.88; transform: translateY(-1px); }
          .btn-primary.btn-lg { padding: 16px 32px; font-size: 1rem; }
          .btn-ghost {
            background: transparent;
            color: var(--color-muted);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 14px 24px;
            font-size: 0.95rem;
            cursor: pointer;
            transition: border-color 0.2s, color 0.2s;
          }
          .btn-ghost:hover { border-color: rgba(255,255,255,0.25); color: var(--color-chrome); }
          .btn-row { display: flex; gap: 12px; }
          .btn-row .btn-primary { flex: 1; }
          .checkbox-label {
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--color-muted);
            cursor: pointer;
            font-size: 0.9rem;
          }
          .checkbox-label input { accent-color: var(--color-accent); width: 16px; height: 16px; }
          .error-msg { color: #f87171; font-size: 0.875rem; }
          .onboarding-dots {
            display: flex;
            gap: 8px;
            margin-bottom: 32px;
          }
          .dot {
            width: 6px; height: 6px;
            border-radius: 50%;
            background: rgba(255,255,255,0.15);
            transition: background 0.3s;
          }
          .dot.active { background: var(--color-accent); }
          .dot.past { background: rgba(255,255,255,0.35); }
          @media (max-width: 480px) {
            .onboarding-card { padding: 36px 24px; }
          }
        `}</style>
      </div>
    </>
  );
}
