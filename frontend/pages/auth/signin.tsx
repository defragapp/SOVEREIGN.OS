import React, { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/router";

export default function SignIn() {
  const router = useRouter();
  const callbackUrl = (router.query.callbackUrl as string) ?? "/launcher";
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<"idle"|"email"|"sent"|"loading">("idle");
  const [error, setError] = useState("");

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setPhase("loading"); setError("");
    const res = await signIn("email", { email, callbackUrl, redirect: false });
    if (res?.error) { setError("Something shifted. Try again."); setPhase("email"); }
    else setPhase("sent");
  }

  async function handleOAuth(provider: "google"|"apple") {
    setPhase("loading");
    await signIn(provider, { callbackUrl });
  }

  return (
    <>
      <Head>
        <title>Enter SOVEREIGN</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <div className="signin-root">
        {/* Ambient background */}
        <div className="signin-bg" aria-hidden>
          <div className="signin-orb signin-orb-1" />
          <div className="signin-orb signin-orb-2" />
        </div>

        {/* Back link */}
        <Link href="/" className="signin-back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          SOVEREIGN.OS
        </Link>

        <main className="signin-main">
          <div className="signin-card">
            {/* Logo mark */}
            <div className="signin-mark" aria-hidden>
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <circle cx="18" cy="18" r="17" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
                <circle cx="18" cy="18" r="10" stroke="rgba(255,255,255,0.2)" strokeWidth="1"/>
                <circle cx="18" cy="18" r="3" fill="#f0ebe1"/>
              </svg>
            </div>

            {phase === "sent" ? (
              <div className="signin-sent fade-up">
                <div className="signin-sent-icon">✉</div>
                <h1 className="signin-h1">Check your inbox</h1>
                <p className="signin-sub">
                  A secure link is on its way to <strong>{email}</strong>.<br />
                  It expires in 10 minutes.
                </p>
                <button className="btn btn-ghost btn-sm" onClick={() => setPhase("email")} style={{marginTop:24}}>
                  Try a different address
                </button>
              </div>
            ) : (
              <>
                <h1 className="signin-h1 fade-up">Enter SOVEREIGN</h1>
                <p className="signin-sub fade-up-2">
                  Your private space is waiting.
                </p>

                {/* OAuth */}
                <div className="signin-oauth fade-up-3">
                  <button
                    className="btn-oauth"
                    onClick={() => handleOAuth("google")}
                    disabled={phase === "loading"}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
                    Continue with Google
                  </button>
                  <button
                    className="btn-oauth"
                    onClick={() => handleOAuth("apple")}
                    disabled={phase === "loading"}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><path d="M13.004 0c.072.984-.269 1.97-.908 2.693-.637.723-1.617 1.27-2.562 1.198-.09-.93.285-1.917.895-2.604C11.05.582 12.06.068 13.004 0zm3.56 12.69c-.42.924-.618 1.336-1.158 2.148-.75 1.143-1.808 2.566-3.12 2.577-1.165.01-1.464-.759-3.046-.75-1.582.009-1.91.762-3.08.75-1.31-.011-2.315-1.292-3.065-2.435C.86 12.68.21 10.053.633 7.52.908 5.895 1.79 4.35 3.098 3.432a4.676 4.676 0 0 1 3.948-.504c.96.298 1.738.9 2.498.9.76 0 1.754-.717 2.982-.71.508.002 1.936.207 2.85 1.574a4.18 4.18 0 0 0-1.812 3.498c.017 2.2 1.458 3.287 1.458 3.287l-.06.213z"/></svg>
                    Continue with Apple
                  </button>
                </div>

                <div className="signin-divider fade-up-3">
                  <span>or use your email</span>
                </div>

                {/* Email magic link */}
                {phase !== "email" && phase !== "loading" ? (
                  <button
                    className="btn btn-ghost btn-full fade-up-4"
                    onClick={() => setPhase("email")}
                  >
                    Continue with Email
                  </button>
                ) : (
                  <form onSubmit={handleEmailSubmit} className="signin-form fade-up-4">
                    <input
                      type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="your@email.com" className="input" autoFocus required
                    />
                    {error && <p className="signin-error">{error}</p>}
                    <button
                      type="submit" disabled={phase === "loading"}
                      className="btn btn-primary btn-full"
                    >
                      {phase === "loading" ? (
                        <span className="loading-dots"><span/><span/><span/></span>
                      ) : "Send Link"}
                    </button>
                  </form>
                )}

                <p className="signin-legal fade-up-4">
                  By entering, you agree to our{" "}
                  <Link href="/legal/terms">Terms</Link> and{" "}
                  <Link href="/legal/privacy">Privacy Policy</Link>.
                </p>
              </>
            )}
          </div>
        </main>
      </div>

      <style>{`
        .signin-root { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; position: relative; overflow: hidden; }
        .signin-bg { position: fixed; inset: 0; pointer-events: none; }
        .signin-orb { position: absolute; border-radius: 50%; filter: blur(120px); }
        .signin-orb-1 { width: 500px; height: 500px; top: -20%; left: -10%; background: rgba(129,140,248,0.06); animation: pulse 8s ease-in-out infinite alternate; }
        .signin-orb-2 { width: 400px; height: 400px; bottom: -10%; right: -5%; background: rgba(212,167,83,0.05); animation: pulse 10s ease-in-out infinite alternate-reverse; }
        .signin-back { position: fixed; top: 24px; left: 24px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; letter-spacing: 0.08em; color: var(--chrome-3); transition: color .15s; z-index: 10; }
        .signin-back:hover { color: var(--chrome); }
        .signin-main { width: 100%; max-width: 400px; z-index: 1; }
        .signin-card { padding: 48px 40px; background: rgba(15,15,15,0.9); border: 1px solid var(--border-2); border-radius: var(--radius-lg); display: flex; flex-direction: column; align-items: center; gap: 0; }
        @media (max-width: 480px) { .signin-card { padding: 36px 24px; border-radius: var(--radius); } }
        .signin-mark { margin-bottom: 28px; }
        .signin-h1 { font-family: var(--font-serif); font-size: 28px; font-weight: 700; text-align: center; color: var(--bone); margin-bottom: 10px; }
        .signin-sub { font-size: 15px; color: var(--chrome-3); text-align: center; line-height: 1.6; margin-bottom: 32px; }
        .signin-sent { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; }
        .signin-sent-icon { font-size: 40px; margin-bottom: 8px; }
        .signin-oauth { display: flex; flex-direction: column; gap: 10px; width: 100%; }
        .btn-oauth { display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; padding: 13px 20px; background: var(--ink-3); border: 1px solid var(--border-2); border-radius: var(--radius-sm); font-size: 15px; font-weight: 500; color: var(--chrome); cursor: pointer; transition: border-color .15s, color .15s, background .15s; font-family: var(--font-sans); }
        .btn-oauth:hover { border-color: var(--chrome-3); color: var(--bone); background: var(--ink-4); }
        .btn-oauth:disabled { opacity: 0.5; cursor: default; }
        .signin-divider { width: 100%; display: flex; align-items: center; gap: 12px; margin: 20px 0; }
        .signin-divider::before, .signin-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
        .signin-divider span { font-size: 12px; color: var(--chrome-3); white-space: nowrap; }
        .signin-form { width: 100%; display: flex; flex-direction: column; gap: 12px; }
        .signin-error { font-size: 13px; color: #f472b6; text-align: center; }
        .signin-legal { font-size: 12px; color: var(--chrome-3); text-align: center; margin-top: 20px; line-height: 1.5; }
        .signin-legal a { color: var(--chrome-2); text-decoration: underline; text-underline-offset: 3px; }
      `}</style>
    </>
  );
}
