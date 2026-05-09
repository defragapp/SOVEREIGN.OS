import React, { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";

const SPACES = [
  { href: "/defrag",      icon: "◈", name: "Defrag",      hook: "See the patterns before they become arguments.",   accent: "#10b981", tier: "Free" },
  { href: "/alignment",   icon: "◎", name: "Alignment",   hook: "Find your center. Know your next right step.",     accent: "#818cf8", tier: "Free" },
  { href: "/loop",        icon: "⟳", name: "The Loop",    hook: "Stuck in a loop? Let us show you the way out.",   accent: "#f59e0b", tier: "Free" },
  { href: "/compression", icon: "⊞", name: "Compression", hook: "From overwhelm to absolute clarity in seconds.",  accent: "#f472b6", tier: "Pro" },
  { href: "/covenant",    icon: "✦", name: "Covenant",    hook: "Timeless wisdom for today's relationships.",       accent: "#d97706", tier: "Pro" },
];

export default function Launcher() {
  const { data: session, status } = useSession();
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <Head>
        <title>SOVEREIGN — Your Spaces</title>
        <meta name="description" content="Clarity for yourself, and the people you care about." />
        <meta name="theme-color" content="#080808" />
      </Head>

      <div className="lnch-root">
        {/* Ambient orbs */}
        <div className="lnch-orb lnch-orb-a" aria-hidden />
        <div className="lnch-orb lnch-orb-b" aria-hidden />

        {/* Nav */}
        <nav className="nav">
          <div className="nav-inner">
            <span className="nav-wordmark">SOVEREIGN.OS</span>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {session ? (
                <Link href="/settings" className="nav-back" style={{ fontSize: 13 }}>
                  {session.user?.name?.split(" ")[0] ?? "Account"}
                </Link>
              ) : (
                <button onClick={() => signIn()} className="btn btn-ghost btn-sm">Enter</button>
              )}
            </div>
          </div>
        </nav>

        {/* Hero */}
        <header className={`lnch-hero ${entered ? "lnch-entered" : ""}`}>
          <p className="t-eyebrow t-muted" style={{ marginBottom: 20 }}>Your private spaces</p>
          <h1 className="lnch-headline">
            Clarity for yourself,<br />
            <em>and the people you care about.</em>
          </h1>
          {status === "unauthenticated" && (
            <button onClick={() => signIn()} className="btn btn-primary" style={{ marginTop: 32 }}>
              Create your profile
            </button>
          )}
        </header>

        {/* Space grid */}
        <section className="lnch-grid-wrap">
          <div className="space-grid">
            {SPACES.map((s, i) => (
              <Link
                key={s.href}
                href={status === "authenticated" ? s.href : `/auth/signin?callbackUrl=${s.href}`}
                className="space-card"
                style={{
                  animationDelay: `${i * 60}ms`,
                  borderColor: `${s.accent}22`,
                }}
              >
                {/* Hover glow */}
                <div
                  className="space-card-glow"
                  style={{ background: `radial-gradient(ellipse at 0 0, ${s.accent}18, transparent 70%)` }}
                />
                <div className="space-icon" style={{ color: s.accent }}>{s.icon}</div>
                <div className="space-name">{s.name}</div>
                <div className="space-hook">{s.hook}</div>
                <div className="space-tier" style={{ color: s.accent }}>
                  {s.tier === "Free" ? "Free tier available" : "Pro"}
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Footer note */}
        <footer className="lnch-footer">
          <p className="t-tiny t-muted">Your data is private. We never train on it.</p>
        </footer>
      </div>

      <style>{`
        .lnch-root { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; padding-top: 60px; position: relative; overflow: hidden; }
        .lnch-orb { position: fixed; border-radius: 50%; pointer-events: none; filter: blur(100px); }
        .lnch-orb-a { width: 700px; height: 700px; top: -20%; left: -20%; background: rgba(129,140,248,0.05); animation: pulse 10s ease-in-out infinite alternate; }
        .lnch-orb-b { width: 500px; height: 500px; bottom: -15%; right: -10%; background: rgba(16,185,129,0.04); animation: pulse 12s ease-in-out infinite alternate-reverse; }
        .lnch-hero { text-align: center; padding: 64px 24px 40px; opacity: 0; transform: translateY(16px); transition: opacity .6s var(--ease-out), transform .6s var(--ease-out); }
        .lnch-entered .lnch-hero, .lnch-hero { opacity: 1 !important; transform: none !important; }
        .lnch-hero { opacity: 1; transform: none; animation: fadeUp .6s var(--ease-out) both; }
        .lnch-headline { font-family: var(--font-serif); font-size: clamp(28px, 5vw, 52px); font-weight: 700; line-height: 1.1; letter-spacing: -0.025em; color: var(--bone); max-width: 640px; }
        .lnch-headline em { font-style: italic; color: var(--chrome-2); }
        .lnch-grid-wrap { width: 100%; max-width: 960px; padding: 0 16px 60px; }
        .lnch-footer { padding: 24px; text-align: center; }
        @media (max-width: 640px) { .space-grid { grid-template-columns: 1fr 1fr; } .lnch-headline { font-size: 26px; } }
      `}</style>
    </>
  );
}
